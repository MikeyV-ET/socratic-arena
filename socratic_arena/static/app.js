/* Socratic Arena — Frontend Application */

let currentSessionId = null;
let ws = null;
let pendingCorrectionExchangeId = null;
let pendingForkSnapshotId = null;
let snapshotExchangeMap = {}; // maps exchange_id -> snapshot_id

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
        } else if (data.type === 'fork_created') {
            refreshForks();
            refreshTimeline();
            setStatus('Fork created');
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

function addMessage(role, content, exchangeId = null, hasCorrection = false, snapshotId = null) {
    const chatDiv = document.getElementById('chat-messages');
    const msgDiv = document.createElement('div');
    msgDiv.className = `message ${role}${hasCorrection ? ' tagged' : ''}`;
    if (exchangeId) msgDiv.dataset.exchangeId = exchangeId;
    if (snapshotId) msgDiv.dataset.snapshotId = snapshotId;

    let actionButtons = '';
    if (role === 'agent' && exchangeId) {
        actionButtons = `<div class="actions">
            <button class="btn-tag" onclick="showCorrectionDialog('${exchangeId}')">Tag</button>
            <button class="btn-fork-action" onclick="showForkDialog('${exchangeId}')">Fork</button>
        </div>`;
    }

    msgDiv.innerHTML = `
        <div class="role">${role}</div>
        <div class="content">${escapeHtml(content)}</div>
        ${actionButtons}
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
            if (result.snapshot && result.snapshot.id) {
                streamingDiv.dataset.snapshotId = result.snapshot.id;
                snapshotExchangeMap[result.exchange_id] = result.snapshot.id;
            }
            const actions = document.createElement('div');
            actions.className = 'actions';
            actions.innerHTML = `
                <button class="btn-tag" onclick="showCorrectionDialog('${result.exchange_id}')">Tag</button>
                <button class="btn-fork-action" onclick="showForkDialog('${result.exchange_id}')">Fork</button>
            `;
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
        const forkPoints = await api('GET', `/api/sessions/${currentSessionId}/fork-points`);
        const forks = await api('GET', `/api/sessions/${currentSessionId}/forks`);

        // Build lookup: snapshot_id -> fork count
        const forkCounts = {};
        for (const fp of forkPoints) {
            forkCounts[fp.id] = fp.fork_count || 0;
        }

        const view = document.getElementById('timeline-view');
        if (forkPoints.length === 0) {
            view.innerHTML = '<p class="placeholder">Interaction timeline will appear here.</p>';
        } else {
            view.innerHTML = forkPoints.map(s => {
                const hasForks = (forkCounts[s.id] || 0) > 0;
                const dotClass = s.has_correction ? 'correction' : (hasForks ? 'fork' : '');
                return `
                    <div class="timeline-item">
                        <div class="timeline-dot ${dotClass}"></div>
                        <div class="timeline-info">
                            <div>
                                Exchange #${s.sequence_num}
                                ${s.has_correction ? '<span class="badge correction-badge">correction</span>' : ''}
                                ${hasForks ? `<span class="badge fork-badge">${forkCounts[s.id]} fork${forkCounts[s.id] > 1 ? 's' : ''}</span>` : ''}
                            </div>
                            <div class="seq">${s.timestamp || ''} | ${s.workspace_state ? s.workspace_state.slice(0, 8) : 'no snapshot'}</div>
                        </div>
                        <div class="timeline-actions">
                            <button class="btn-timeline-fork" onclick="showForkDialogFromSnapshot('${s.id}')">Fork</button>
                        </div>
                    </div>
                `;
            }).join('');
        }
        document.getElementById('snapshot-count').textContent = `Snapshots: ${forkPoints.length + 1}`;
    } catch (e) {
        console.error('Failed to refresh timeline:', e);
    }
}

function showForkDialogFromSnapshot(snapshotId) {
    pendingForkSnapshotId = snapshotId;
    document.getElementById('fork-context').textContent = 'Forking from snapshot';
    hideAllDialogs();
    document.getElementById('dialog-overlay').classList.remove('hidden');
    document.getElementById('fork-dialog').classList.add('active');
    document.getElementById('fork-intervention').value = '';
    document.getElementById('fork-notes').value = '';
    document.getElementById('fork-intervention').focus();
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

// ---------------------------------------------------------------------------
// Fork & Rewind
// ---------------------------------------------------------------------------

async function showForkDialog(exchangeId) {
    // Find the snapshot ID for this exchange
    let snapshotId = snapshotExchangeMap[exchangeId];

    if (!snapshotId) {
        // Try to find it from the fork points API
        try {
            const points = await api('GET', `/api/sessions/${currentSessionId}/fork-points`);
            for (const point of points) {
                for (const ex of (point.exchanges || [])) {
                    if (ex.id === exchangeId) {
                        snapshotId = point.id;
                        snapshotExchangeMap[exchangeId] = snapshotId;
                        break;
                    }
                }
                if (snapshotId) break;
            }
        } catch (e) {
            console.error('Failed to find snapshot for exchange:', e);
        }
    }

    if (!snapshotId) {
        alert('Could not find the snapshot for this exchange. Try refreshing the page.');
        return;
    }

    pendingForkSnapshotId = snapshotId;

    // Show the exchange content as context
    const msgDiv = document.querySelector(`[data-exchange-id="${exchangeId}"]`);
    const content = msgDiv ? msgDiv.querySelector('.content').textContent : '';
    document.getElementById('fork-context').textContent =
        'Forking from: "' + content.slice(0, 100) + (content.length > 100 ? '...' : '') + '"';

    hideAllDialogs();
    document.getElementById('dialog-overlay').classList.remove('hidden');
    document.getElementById('fork-dialog').classList.add('active');
    document.getElementById('fork-intervention').value = '';
    document.getElementById('fork-notes').value = '';
    document.getElementById('fork-intervention').focus();
}

async function submitFork() {
    if (!pendingForkSnapshotId) return;

    const intervention = document.getElementById('fork-intervention').value.trim();
    const notes = document.getElementById('fork-notes').value.trim();

    if (!intervention) {
        alert('Please enter your alternative question or intervention.');
        return;
    }

    setStatus('Creating fork...');
    hideDialogs();

    try {
        const result = await api('POST', `/api/snapshots/${pendingForkSnapshotId}/fork`, {
            alternative_intervention: intervention,
            notes: notes || null,
        });

        await refreshForks();
        await refreshTimeline();
        setStatus('Fork created successfully');

        // Automatically show the comparison
        showComparison(result.fork.id);
    } catch (e) {
        setStatus('Fork failed: ' + e.message);
        alert('Failed to create fork: ' + e.message);
    }
}

async function refreshForks() {
    if (!currentSessionId) return;
    try {
        const forks = await api('GET', `/api/sessions/${currentSessionId}/forks`);
        const list = document.getElementById('forks-list');
        document.getElementById('fork-count').textContent = `Forks: ${forks.length}`;

        if (forks.length === 0) {
            list.innerHTML = '<p class="placeholder">No forks yet. Click the fork button on any exchange to explore alternatives.</p>';
            return;
        }

        list.innerHTML = forks.map(f => `
            <div class="fork-item" onclick="showComparison('${f.id}')">
                <div class="fork-header">
                    <span class="fork-icon">&#x1F500;</span>
                    <span class="fork-label">Fork at exchange #${f.source_sequence_num || '?'}</span>
                    <span class="fork-status">${f.forked_session_status || 'active'}</span>
                </div>
                <div class="fork-intervention">${escapeHtml(f.alternative_intervention)}</div>
                ${f.notes ? `<div class="fork-notes">${escapeHtml(f.notes)}</div>` : ''}
                <div class="fork-meta">${f.created_at || ''}</div>
            </div>
        `).join('');
    } catch (e) {
        console.error('Failed to refresh forks:', e);
    }
}

async function showComparison(forkId) {
    // Switch to compare tab
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab')[2].classList.add('active'); // Compare tab
    document.getElementById('tab-compare').classList.add('active');

    const view = document.getElementById('compare-view');
    view.innerHTML = '<p class="placeholder">Loading comparison...</p>';

    try {
        const comparison = await api('GET', `/api/forks/${forkId}/compare`);
        renderComparison(comparison);
    } catch (e) {
        view.innerHTML = `<p class="placeholder">Failed to load comparison: ${escapeHtml(e.message)}</p>`;
    }
}

function renderComparison(comparison) {
    const view = document.getElementById('compare-view');
    const forkSeq = comparison.fork_point_sequence || 0;

    // Split exchanges into shared (before fork) and divergent (after fork)
    const origExchanges = comparison.original.exchanges || [];
    const forkExchanges = comparison.forked.exchanges || [];

    // Shared exchanges (before fork point)
    const sharedOrig = origExchanges.filter(e => e.sequence_num <= forkSeq);
    // Divergent exchanges
    const divergentOrig = origExchanges.filter(e => e.sequence_num > forkSeq);
    const divergentFork = forkExchanges.filter(e => e.sequence_num > 0); // skip initial snap

    let html = `
        <div class="compare-header">
            <h3>Trajectory Comparison</h3>
            <p class="compare-meta">Fork point: exchange #${forkSeq}</p>
        </div>
    `;

    // Shared context (collapsed)
    if (sharedOrig.length > 0) {
        html += `
            <details class="compare-shared">
                <summary>Shared context (${sharedOrig.length} exchanges before fork)</summary>
                <div class="compare-exchanges">
                    ${sharedOrig.map(e => `
                        <div class="compare-exchange ${e.role}">
                            <span class="role-badge">${e.role}</span>
                            ${escapeHtml(e.content)}
                        </div>
                    `).join('')}
                </div>
            </details>
        `;
    }

    // Side-by-side divergent
    html += `
        <div class="compare-divergent">
            <div class="compare-column">
                <div class="compare-column-header">Original</div>
                ${divergentOrig.length === 0 ? '<p class="placeholder">No further exchanges</p>' :
                    divergentOrig.map(e => `
                        <div class="compare-exchange ${e.role}">
                            <span class="role-badge">${e.role}</span>
                            ${escapeHtml(e.content)}
                        </div>
                    `).join('')
                }
            </div>
            <div class="compare-divider"></div>
            <div class="compare-column">
                <div class="compare-column-header">Fork</div>
                ${divergentFork.length === 0 ? '<p class="placeholder">No exchanges yet</p>' :
                    divergentFork.map(e => `
                        <div class="compare-exchange ${e.role}">
                            <span class="role-badge">${e.role}</span>
                            ${escapeHtml(e.content)}
                        </div>
                    `).join('')
                }
            </div>
        </div>
    `;

    // Workspace diff
    if (comparison.workspace_diff && comparison.workspace_diff.stat) {
        html += `
            <details class="compare-diff">
                <summary>Workspace differences</summary>
                <pre class="diff-content">${escapeHtml(comparison.workspace_diff.stat)}</pre>
                ${comparison.workspace_diff.diff ? `<pre class="diff-patch">${escapeHtml(comparison.workspace_diff.diff)}</pre>` : ''}
            </details>
        `;
    }

    view.innerHTML = html;
}

// Update loadSession to also build snapshot map and load forks
const _originalLoadSession = loadSession;
loadSession = async function(sessionId) {
    await _originalLoadSession(sessionId);
    // Build snapshot-exchange map from fork points
    try {
        const points = await api('GET', `/api/sessions/${sessionId}/fork-points`);
        for (const point of points) {
            for (const ex of (point.exchanges || [])) {
                snapshotExchangeMap[ex.id] = point.id;
            }
        }
    } catch (e) {
        console.error('Failed to load fork points:', e);
    }
    await refreshForks();
}