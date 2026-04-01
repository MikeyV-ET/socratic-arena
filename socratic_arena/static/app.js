/* Socratic Arena — Frontend Application */

let currentSessionId = null;
let ws = null;
let pendingCorrectionExchangeId = null;

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

async function api(method, path, body = null) {
    const opts = { method, headers: { 'Content-Type': 'application/json' } };
    if (body) opts.body = JSON.stringify(body);
    const resp = await fetch(path, opts);
    if (!resp.ok) {
        const err = await resp.json().catch(() => ({ detail: resp.statusText }));
        throw new Error(err.detail || 'API error');
    }
    return resp.json();
}

// ---------------------------------------------------------------------------
// Session management
// ---------------------------------------------------------------------------

function showNewSessionDialog() {
    hideAllDialogs();
    document.getElementById('dialog-overlay').classList.remove('hidden');
    document.getElementById('new-session-dialog').classList.add('active');
}

function showSessionList() {
    hideAllDialogs();
    document.getElementById('dialog-overlay').classList.remove('hidden');
    document.getElementById('session-list-dialog').classList.add('active');
    loadSessionList();
}

function hideDialogs() {
    document.getElementById('dialog-overlay').classList.add('hidden');
    hideAllDialogs();
}

function hideAllDialogs() {
    document.querySelectorAll('.dialog').forEach(d => d.classList.remove('active'));
}

async function createSession() {
    const title = document.getElementById('new-title').value;
    const systemPrompt = document.getElementById('new-system-prompt').value;
    const backend = document.getElementById('new-backend').value;
    const rewardMode = document.getElementById('new-reward-mode').value;

    try {
        const session = await api('POST', '/api/sessions', {
            title, system_prompt: systemPrompt, backend, reward_mode: rewardMode
        });
        currentSessionId = session.id;
        document.getElementById('session-title').textContent = session.title;
        document.getElementById('chat-messages').innerHTML = '';
        setStatus('Session created');
        hideDialogs();
        connectWebSocket(session.id);
    } catch (e) {
        alert('Failed to create session: ' + e.message);
    }
}

async function loadSessionList() {
    try {
        const sessions = await api('GET', '/api/sessions');
        const list = document.getElementById('session-list');
        if (sessions.length === 0) {
            list.innerHTML = '<p class="placeholder">No sessions yet.</p>';
            return;
        }
        list.innerHTML = sessions.map(s => `
            <div class="session-item" onclick="loadSession('${s.id}')">
                <div class="title">${escapeHtml(s.title)}</div>
                <div class="meta">${s.status} | ${s.snapshot_count} snapshots | ${s.created_at || ''}</div>
            </div>
        `).join('');
    } catch (e) {
        console.error('Failed to load sessions:', e);
    }
}

async function loadSession(sessionId) {
    currentSessionId = sessionId;
    hideDialogs();

    try {
        const session = await api('GET', `/api/sessions/${sessionId}`);
        document.getElementById('session-title').textContent = session.title;

        // Load history
        const exchanges = await api('GET', `/api/sessions/${sessionId}/history`);
        const chatDiv = document.getElementById('chat-messages');
        chatDiv.innerHTML = '';
        exchanges.forEach(ex => addMessage(ex.role, ex.content, ex.id, ex.has_correction));

        // Load corrections
        await refreshCorrections();
        await refreshTimeline();

        setStatus('Session loaded');
        connectWebSocket(sessionId);
    } catch (e) {
        alert('Failed to load session: ' + e.message);
    }
}

// ---------------------------------------------------------------------------
// WebSocket
// ---------------------------------------------------------------------------

function connectWebSocket(sessionId) {
    if (ws) ws.close();

    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${protocol}//${location.host}/ws/session/${sessionId}`);

    ws.onopen = () => setStatus('Connected');
    ws.onclose = () => setStatus('Disconnected');
    ws.onerror = (e) => { console.error('WS error:', e); setStatus('Connection error'); };

    ws.onmessage = (event) => {
        const data = JSON.parse(event.data);

        if (data.type === 'agent_chunk') {
            appendToStreaming(data.content);
        } else if (data.type === 'agent_complete') {
            finalizeStreaming(data.result);
        } else if (data.type === 'correction_tagged') {
            refreshCorrections();
            refreshTimeline();
        } else if (data.type === 'error') {
            setStatus('Error: ' + data.detail);
        }
    };
}

// ---------------------------------------------------------------------------
// Messaging
// ---------------------------------------------------------------------------

async function sendMessage() {
    const input = document.getElementById('chat-input');
    const message = input.value.trim();
    if (!message || !currentSessionId) return;

    input.value = '';

    // Add human message to chat
    addMessage('human', message);

    // Start streaming placeholder for agent
    startStreaming();

    // Send via REST (WebSocket will handle streaming chunks)
    try {
        const result = await api('POST', `/api/sessions/${currentSessionId}/messages`, { message });
        // Response already handled by WebSocket streaming
        // But if WS isn't connected, show the result directly
        if (!ws || ws.readyState !== WebSocket.OPEN) {
            finalizeStreaming(result);
        }
    } catch (e) {
        removeStreaming();
        setStatus('Error: ' + e.message);
    }
}

function handleChatKeydown(event) {
    if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        sendMessage();
    }
}

// ---------------------------------------------------------------------------
// Chat rendering
// ---------------------------------------------------------------------------

function addMessage(role, content, exchangeId = null, hasCorrection = false) {
    const chatDiv = document.getElementById('chat-messages');
    const msgDiv = document.createElement('div');
    msgDiv.className = `message ${role}${hasCorrection ? ' tagged' : ''}`;
    if (exchangeId) msgDiv.dataset.exchangeId = exchangeId;

    const tagButton = role === 'agent' && exchangeId
        ? `<div class="actions"><button onclick="showCorrectionDialog('${exchangeId}')">Tag</button></div>`
        : '';

    msgDiv.innerHTML = `
        <div class="role">${role}</div>
        <div class="content">${escapeHtml(content)}</div>
        ${tagButton}
    `;

    chatDiv.appendChild(msgDiv);
    chatDiv.scrollTop = chatDiv.scrollHeight;
}

let streamingDiv = null;

function startStreaming() {
    const chatDiv = document.getElementById('chat-messages');
    streamingDiv = document.createElement('div');
    streamingDiv.className = 'message agent streaming';
    streamingDiv.innerHTML = `
        <div class="role">Agent</div>
        <div class="content"></div>
    `;
    chatDiv.appendChild(streamingDiv);
    chatDiv.scrollTop = chatDiv.scrollHeight;
    setStatus('Agent thinking...');
}

function appendToStreaming(chunk) {
    if (streamingDiv) {
        const content = streamingDiv.querySelector('.content');
        content.textContent += chunk;
        const chatDiv = document.getElementById('chat-messages');
        chatDiv.scrollTop = chatDiv.scrollHeight;
    }
}

function finalizeStreaming(result) {
    if (streamingDiv) {
        streamingDiv.classList.remove('streaming');
        if (result && result.exchange_id) {
            streamingDiv.dataset.exchangeId = result.exchange_id;
            const actions = document.createElement('div');
            actions.className = 'actions';
            actions.innerHTML = `<button onclick="showCorrectionDialog('${result.exchange_id}')">Tag</button>`;
            streamingDiv.appendChild(actions);
        }
        if (result && result.agent_response) {
            const content = streamingDiv.querySelector('.content');
            content.textContent = result.agent_response;
        }
        streamingDiv = null;
    }
    updateCounts();
    setStatus('Ready');
}

function removeStreaming() {
    if (streamingDiv) {
        streamingDiv.remove();
        streamingDiv = null;
    }
}

// ---------------------------------------------------------------------------
// Correction tagging
// ---------------------------------------------------------------------------

function showCorrectionDialog(exchangeId) {
    pendingCorrectionExchangeId = exchangeId;
    hideAllDialogs();
    document.getElementById('dialog-overlay').classList.remove('hidden');
    document.getElementById('correction-dialog').classList.add('active');
    document.getElementById('correction-text').value = '';
    document.getElementById('correction-text').focus();
}

async function submitCorrection() {
    if (!pendingCorrectionExchangeId) return;

    const whatWasMissing = document.getElementById('correction-text').value.trim();
    const severity = document.getElementById('correction-severity').value;

    if (!whatWasMissing) {
        alert('Please describe what was missing.');
        return;
    }

    try {
        await api('POST', `/api/exchanges/${pendingCorrectionExchangeId}/tag`, {
            what_was_missing: whatWasMissing,
            severity: severity,
        });

        // Mark the message as tagged
        const msgDiv = document.querySelector(`[data-exchange-id="${pendingCorrectionExchangeId}"]`);
        if (msgDiv) msgDiv.classList.add('tagged');

        hideDialogs();
        await refreshCorrections();
        await refreshTimeline();
        setStatus('Correction tagged');
    } catch (e) {
        alert('Failed to tag correction: ' + e.message);
    }
}

async function refreshCorrections() {
    if (!currentSessionId) return;
    try {
        const corrections = await api('GET', `/api/sessions/${currentSessionId}/corrections`);
        const list = document.getElementById('corrections-list');
        if (corrections.length === 0) {
            list.innerHTML = '<p class="placeholder">No corrections tagged yet.</p>';
        } else {
            list.innerHTML = corrections.map(c => `
                <div class="correction-item">
                    <div class="severity">${c.severity}</div>
                    <div class="missing">${escapeHtml(c.what_was_missing)}</div>
                    ${c.operating_constraint ? `<div class="constraint">${escapeHtml(c.operating_constraint)}</div>` : ''}
                </div>
            `).join('');
        }
        document.getElementById('correction-count').textContent = `Corrections: ${corrections.length}`;
    } catch (e) {
        console.error('Failed to refresh corrections:', e);
    }
}

// ---------------------------------------------------------------------------
// Timeline
// ---------------------------------------------------------------------------

async function refreshTimeline() {
    if (!currentSessionId) return;
    try {
        const snapshots = await api('GET', `/api/sessions/${currentSessionId}/snapshots`);
        const view = document.getElementById('timeline-view');
        if (snapshots.length <= 1) {
            view.innerHTML = '<p class="placeholder">Interaction timeline will appear here.</p>';
        } else {
            view.innerHTML = snapshots.slice(1).map(s => `
                <div class="timeline-item">
                    <div class="timeline-dot${s.has_exchange ? '' : ' fork'}"></div>
                    <div class="timeline-info">
                        <div>Exchange #${s.sequence_num}</div>
                        <div class="seq">${s.timestamp || ''} | ${s.workspace_state ? s.workspace_state.slice(0, 8) : 'no snapshot'}</div>
                    </div>
                </div>
            `).join('');
        }
        document.getElementById('snapshot-count').textContent = `Snapshots: ${snapshots.length}`;
    } catch (e) {
        console.error('Failed to refresh timeline:', e);
    }
}

// ---------------------------------------------------------------------------
// Tab switching
// ---------------------------------------------------------------------------

function switchTab(tabName) {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
    event.target.classList.add('active');
    document.getElementById(`tab-${tabName}`).classList.add('active');
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function setStatus(text) {
    document.getElementById('status-text').textContent = text;
}

async function updateCounts() {
    if (!currentSessionId) return;
    await refreshTimeline();
    await refreshCorrections();
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}