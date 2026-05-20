"""Agent-friendly browser interface via Chrome DevTools Protocol.

Provides two capabilities for SA panel Chrome instances:
1. snapshot() — accessibility tree extraction with stable element refs
2. act() — click, type, scroll, navigate by element ref

Uses raw WebSocket CDP (no new dependencies). Connects to Chrome's
--remote-debugging-port already allocated by panel_manager.py.
"""

import asyncio
import json
import logging
from dataclasses import dataclass, field
from typing import Any

import websockets

log = logging.getLogger("panel_browser")


async def _get_ws_url(cdp_port: int) -> str:
    """Get the Chrome DevTools WebSocket URL for the active page."""
    import aiohttp
    async with aiohttp.ClientSession() as session:
        async with session.get(f"http://127.0.0.1:{cdp_port}/json") as resp:
            targets = await resp.json()
    # Prefer the first real page (skip chrome:// internal pages and about:blank)
    for t in targets:
        url = t.get("url", "")
        if t.get("type") == "page" and not url.startswith("chrome://") and url not in ("", "about:blank"):
            return t["webSocketDebuggerUrl"]
    # Fall back to any page target
    for t in targets:
        if t.get("type") == "page":
            return t["webSocketDebuggerUrl"]
    if targets:
        return targets[0]["webSocketDebuggerUrl"]
    raise RuntimeError(f"No CDP targets on port {cdp_port}")


class CDPSession:
    """Lightweight CDP WebSocket session with command ID tracking."""

    def __init__(self, ws):
        self._ws = ws
        self._cmd_id = 0

    async def send(self, method: str, params: dict | None = None) -> dict:
        self._cmd_id += 1
        msg = {"id": self._cmd_id, "method": method}
        if params:
            msg["params"] = params
        await self._ws.send(json.dumps(msg))
        # Read responses until we get ours (skip events)
        while True:
            raw = await asyncio.wait_for(self._ws.recv(), timeout=15)
            resp = json.loads(raw)
            if resp.get("id") == self._cmd_id:
                if "error" in resp:
                    raise RuntimeError(f"CDP error: {resp['error']}")
                return resp.get("result", {})


@dataclass
class AXNode:
    """A processed accessibility tree node with a stable ref."""
    ref: str
    role: str
    name: str
    value: str = ""
    description: str = ""
    focused: bool = False
    children: list["AXNode"] = field(default_factory=list)
    backend_node_id: int = 0  # for action dispatch


def _process_ax_tree(raw_nodes: list[dict]) -> tuple[list[AXNode], dict[str, AXNode]]:
    """Convert raw CDP AXTree nodes into compact ref-assigned AXNodes.

    Returns (root_children, ref_map) where ref_map maps "@eN" -> AXNode.
    """
    # Build lookup by nodeId
    by_id: dict[str, dict] = {}
    for n in raw_nodes:
        by_id[n["nodeId"]] = n

    ref_counter = 0
    ref_map: dict[str, AXNode] = {}

    def _get_prop(node: dict, prop_name: str) -> str:
        """Extract a named property value from AX node."""
        val = node.get(prop_name, {})
        if isinstance(val, dict):
            return val.get("value", "")
        return str(val) if val else ""

    def _build(node_data: dict) -> AXNode | None:
        nonlocal ref_counter
        role = _get_prop(node_data, "role")
        name = _get_prop(node_data, "name")
        value = _get_prop(node_data, "value")
        desc = _get_prop(node_data, "description")

        # Skip ignored/none nodes without interesting children
        if role in ("none", "IgnoredRole", "InlineTextBox", ""):
            # Still process children -- they might be interesting
            child_nodes = []
            for child_id in node_data.get("childIds", []):
                child_data = by_id.get(child_id)
                if child_data:
                    child = _build(child_data)
                    if child:
                        child_nodes.append(child)
            # If this node has no name and only passes through children, flatten
            if len(child_nodes) == 1:
                return child_nodes[0]
            if child_nodes:
                # Create a passthrough group
                ref_counter += 1
                ref = f"@e{ref_counter}"
                ax = AXNode(
                    ref=ref, role=role or "group", name=name,
                    value=value, description=desc,
                    backend_node_id=node_data.get("backendDOMNodeId", 0),
                )
                ax.children = child_nodes
                ref_map[ref] = ax
                return ax
            return None

        # Check focus state
        focused = False
        for prop in node_data.get("properties", []):
            if prop.get("name") == "focused" and prop.get("value", {}).get("value"):
                focused = True
                break

        ref_counter += 1
        ref = f"@e{ref_counter}"

        ax = AXNode(
            ref=ref, role=role, name=name,
            value=value, description=desc,
            focused=focused,
            backend_node_id=node_data.get("backendDOMNodeId", 0),
        )

        # Process children
        for child_id in node_data.get("childIds", []):
            child_data = by_id.get(child_id)
            if child_data:
                child = _build(child_data)
                if child:
                    ax.children.append(child)

        ref_map[ref] = ax
        return ax

    # Build from root (first node)
    roots = []
    if raw_nodes:
        root = _build(raw_nodes[0])
        if root:
            roots.append(root)

    return roots, ref_map


def _format_tree(nodes: list[AXNode], indent: int = 0) -> str:
    """Render AXNodes as compact indented text for the agent."""
    lines = []
    for n in nodes:
        prefix = "  " * indent
        parts = [f"{prefix}{n.ref} {n.role}"]
        if n.name:
            parts.append(f'"{n.name}"')
        if n.value:
            parts.append(f'value="{n.value}"')
        if n.focused:
            parts.append("[focused]")
        lines.append(" ".join(parts))
        if n.children:
            lines.append(_format_tree(n.children, indent + 1))
    return "\n".join(lines)


async def snapshot(cdp_port: int) -> dict:
    """Get the accessibility tree of the active page.

    Returns:
        {
            "url": "https://...",
            "title": "Page Title",
            "tree": "compact text representation",
            "refs": {"@e1": {"role": ..., "name": ...}, ...}
        }
    """
    ws_url = await _get_ws_url(cdp_port)
    async with websockets.connect(ws_url, max_size=10 * 1024 * 1024) as ws:
        cdp = CDPSession(ws)

        # Enable required domains
        await cdp.send("Page.enable")
        await cdp.send("Accessibility.enable")
        await cdp.send("DOM.enable")

        # Get page info
        tree_result = await cdp.send("Page.getNavigationHistory")
        entries = tree_result.get("entries", [])
        current_idx = tree_result.get("currentIndex", 0)
        url = entries[current_idx]["url"] if entries else ""
        title = entries[current_idx].get("title", "") if entries else ""

        # Get full accessibility tree
        ax_result = await cdp.send("Accessibility.getFullAXTree")
        raw_nodes = ax_result.get("nodes", [])

        # Process into compact form
        roots, ref_map = _process_ax_tree(raw_nodes)
        tree_text = _format_tree(roots)

        # Build refs summary (only interactive/named elements)
        refs = {}
        for ref, node in ref_map.items():
            if node.name or node.role in (
                "link", "button", "textbox", "combobox", "checkbox",
                "radio", "tab", "menuitem", "searchbox", "slider",
            ):
                entry = {"role": node.role, "name": node.name}
                if node.value:
                    entry["value"] = node.value
                if node.focused:
                    entry["focused"] = True
                refs[ref] = entry

        await cdp.send("Accessibility.disable")
        await cdp.send("DOM.disable")
        await cdp.send("Page.disable")

    return {
        "url": url,
        "title": title,
        "tree": tree_text,
        "element_count": len(ref_map),
        "interactive_count": len(refs),
        "refs": refs,
    }


async def act(cdp_port: int, ref: str, action: str, value: str = "") -> dict:
    """Perform an action on an element identified by ref.

    Actions:
        click   — click the element
        type    — type text into a focused/focusable element
        clear   — clear a text field
        scroll  — scroll element into view
        focus   — focus the element
        hover   — move mouse over element

    Returns: {"ok": True, "action": ..., "ref": ...} or error dict.
    """
    ws_url = await _get_ws_url(cdp_port)
    async with websockets.connect(ws_url, max_size=10 * 1024 * 1024) as ws:
        cdp = CDPSession(ws)

        await cdp.send("Accessibility.enable")
        await cdp.send("DOM.enable")

        # Get the AX tree to find the node by ref
        ax_result = await cdp.send("Accessibility.getFullAXTree")
        raw_nodes = ax_result.get("nodes", [])
        _, ref_map = _process_ax_tree(raw_nodes)

        target = ref_map.get(ref)
        if not target:
            return {"ok": False, "error": f"Ref {ref} not found in current page"}

        backend_node_id = target.backend_node_id
        if not backend_node_id:
            return {"ok": False, "error": f"Ref {ref} has no DOM backing node"}

        if action == "scroll":
            # Scroll element into view
            result = await cdp.send("DOM.scrollIntoViewIfNeeded", {
                "backendNodeId": backend_node_id,
            })
            return {"ok": True, "action": "scroll", "ref": ref}

        if action == "focus":
            await cdp.send("DOM.focus", {"backendNodeId": backend_node_id})
            return {"ok": True, "action": "focus", "ref": ref}

        if action == "click":
            # Get element position for click
            box = await cdp.send("DOM.getBoxModel", {
                "backendNodeId": backend_node_id,
            })
            model = box.get("model", {})
            content = model.get("content", [])
            if len(content) < 4:
                return {"ok": False, "error": f"Cannot get position of {ref}"}

            # content is [x1,y1, x2,y2, x3,y3, x4,y4] (quad)
            cx = (content[0] + content[2] + content[4] + content[6]) / 4
            cy = (content[1] + content[3] + content[5] + content[7]) / 4

            # Scroll into view first
            try:
                await cdp.send("DOM.scrollIntoViewIfNeeded", {
                    "backendNodeId": backend_node_id,
                })
                # Re-get position after scroll
                box = await cdp.send("DOM.getBoxModel", {
                    "backendNodeId": backend_node_id,
                })
                content = box.get("model", {}).get("content", content)
                cx = (content[0] + content[2] + content[4] + content[6]) / 4
                cy = (content[1] + content[3] + content[5] + content[7]) / 4
            except Exception:
                pass

            # Dispatch mouse events
            await cdp.send("Input.dispatchMouseEvent", {
                "type": "mouseMoved", "x": cx, "y": cy,
            })
            await cdp.send("Input.dispatchMouseEvent", {
                "type": "mousePressed", "x": cx, "y": cy,
                "button": "left", "clickCount": 1,
            })
            await cdp.send("Input.dispatchMouseEvent", {
                "type": "mouseReleased", "x": cx, "y": cy,
                "button": "left", "clickCount": 1,
            })
            return {"ok": True, "action": "click", "ref": ref}

        if action == "hover":
            box = await cdp.send("DOM.getBoxModel", {
                "backendNodeId": backend_node_id,
            })
            content = box.get("model", {}).get("content", [])
            if len(content) < 4:
                return {"ok": False, "error": f"Cannot get position of {ref}"}
            cx = (content[0] + content[2] + content[4] + content[6]) / 4
            cy = (content[1] + content[3] + content[5] + content[7]) / 4
            await cdp.send("Input.dispatchMouseEvent", {
                "type": "mouseMoved", "x": cx, "y": cy,
            })
            return {"ok": True, "action": "hover", "ref": ref}

        if action == "type":
            # Focus the element first
            await cdp.send("DOM.focus", {"backendNodeId": backend_node_id})
            # Type each character
            for char in value:
                await cdp.send("Input.dispatchKeyEvent", {
                    "type": "keyDown", "text": char,
                })
                await cdp.send("Input.dispatchKeyEvent", {
                    "type": "keyUp",
                })
            return {"ok": True, "action": "type", "ref": ref, "text": value}

        if action == "clear":
            await cdp.send("DOM.focus", {"backendNodeId": backend_node_id})
            # Select all + delete
            await cdp.send("Input.dispatchKeyEvent", {
                "type": "keyDown",
                "key": "a",
                "code": "KeyA",
                "windowsVirtualKeyCode": 65,
                "nativeVirtualKeyCode": 65,
                "modifiers": 2,  # Ctrl
            })
            await cdp.send("Input.dispatchKeyEvent", {
                "type": "keyUp", "key": "a", "code": "KeyA", "modifiers": 2,
            })
            await cdp.send("Input.dispatchKeyEvent", {
                "type": "keyDown",
                "key": "Backspace",
                "code": "Backspace",
                "windowsVirtualKeyCode": 8,
            })
            await cdp.send("Input.dispatchKeyEvent", {
                "type": "keyUp", "key": "Backspace", "code": "Backspace",
            })
            return {"ok": True, "action": "clear", "ref": ref}

        return {"ok": False, "error": f"Unknown action: {action}"}


async def scroll_to_bottom(cdp_port: int, ref: str | None = None, timeout_ms: int = 5000, scroll_step: int = 800) -> dict:
    """Incrementally scroll a container to trigger lazy loading.

    Sites like LinkedIn use IntersectionObserver on a sentinel element.
    window.scrollTo(0, body.scrollHeight) misses these because:
      1. The scroll container is often a nested div, not window/body.
      2. Jumping to the absolute bottom may skip the sentinel.

    This function:
      1. Finds the scrollable container (from a ref, or auto-detects).
      2. Records the current child count.
      3. Scrolls down in steps, pausing between each.
      4. Uses MutationObserver to detect newly added child nodes.
      5. Returns when new items appear or timeout is reached.

    Args:
        ref: Optional ref of an element inside the scrollable list.
             If given, finds the nearest scrollable ancestor.
             If None, scrolls the main document scrolling element.
        timeout_ms: Max time to wait for new content (default 5000ms).
        scroll_step: Pixels per scroll step (default 800).

    Returns:
        {"ok": True, "new_items": N, "scroll_height_before": X, "scroll_height_after": Y}
    """
    ws_url = await _get_ws_url(cdp_port)
    async with websockets.connect(ws_url, max_size=10 * 1024 * 1024) as ws:
        cdp = CDPSession(ws)

        await cdp.send("Runtime.enable")

        # If ref given, resolve its backendNodeId to find the scroll container
        container_selector = "null"
        if ref:
            await cdp.send("Accessibility.enable")
            await cdp.send("DOM.enable")
            ax_result = await cdp.send("Accessibility.getFullAXTree")
            _, ref_map = _process_ax_tree(ax_result.get("nodes", []))
            target = ref_map.get(ref)
            if target and target.backend_node_id:
                # Resolve to a JS object we can use
                resolve = await cdp.send("DOM.resolveNode", {
                    "backendNodeId": target.backend_node_id,
                })
                object_id = resolve.get("object", {}).get("objectId")
                if object_id:
                    container_selector = f'"{object_id}"'
            await cdp.send("Accessibility.disable")
            await cdp.send("DOM.disable")

        # JS that does incremental scroll + MutationObserver detection.
        # Runs entirely in-page, returns a promise that resolves when
        # new items appear or timeout expires.
        js = f"""
        (async () => {{
            const TIMEOUT = {timeout_ms};
            const STEP = {scroll_step};
            const objectId = {container_selector};

            // Find the scroll container
            let container;
            if (objectId && typeof objectId === 'string') {{
                // We can't directly use objectId from here; fall back to auto-detect
                container = null;
            }}

            if (!container) {{
                // Auto-detect: find the largest scrollable element on the page
                // (LinkedIn uses a specific div, not document.scrollingElement)
                const candidates = document.querySelectorAll('*');
                let best = null;
                let bestScore = 0;
                for (const el of candidates) {{
                    if (el.scrollHeight > el.clientHeight + 50) {{
                        const score = el.scrollHeight - el.clientHeight;
                        if (score > bestScore) {{
                            bestScore = score;
                            best = el;
                        }}
                    }}
                }}
                container = best || document.scrollingElement || document.documentElement;
            }}

            const childCountBefore = container.children.length;
            const scrollHeightBefore = container.scrollHeight;

            // Set up MutationObserver to detect new child nodes
            let newItems = 0;
            const observer = new MutationObserver((mutations) => {{
                for (const m of mutations) {{
                    newItems += m.addedNodes.length;
                }}
            }});
            observer.observe(container, {{ childList: true, subtree: true }});

            // Incremental scroll
            const deadline = Date.now() + TIMEOUT;
            while (Date.now() < deadline) {{
                const maxScroll = container.scrollHeight - container.clientHeight;
                if (container.scrollTop >= maxScroll - 5) {{
                    // Already at bottom; wait a beat for content to load
                    await new Promise(r => setTimeout(r, 500));
                    if (newItems > 0) break;
                    // Try one more scroll in case scrollHeight grew
                    container.scrollTop = container.scrollHeight;
                    await new Promise(r => setTimeout(r, 500));
                    break;
                }}
                container.scrollTop = Math.min(container.scrollTop + STEP, maxScroll);
                await new Promise(r => setTimeout(r, 300));
                if (newItems > 0) {{
                    // Content appeared; keep scrolling to trigger more
                    await new Promise(r => setTimeout(r, 200));
                }}
            }}

            observer.disconnect();
            const scrollHeightAfter = container.scrollHeight;
            const childCountAfter = container.children.length;

            return JSON.stringify({{
                newItems: newItems,
                childCountBefore: childCountBefore,
                childCountAfter: childCountAfter,
                scrollHeightBefore: scrollHeightBefore,
                scrollHeightAfter: scrollHeightAfter,
                containerTag: container.tagName,
                containerClass: (container.className || '').substring(0, 100),
            }});
        }})()
        """

        result = await cdp.send("Runtime.evaluate", {
            "expression": js,
            "awaitPromise": True,
            "returnByValue": True,
            "timeout": timeout_ms + 3000,  # CDP timeout slightly longer than JS timeout
        })

        await cdp.send("Runtime.disable")

        value_str = result.get("result", {}).get("value", "{}")
        try:
            info = json.loads(value_str)
        except (json.JSONDecodeError, TypeError):
            info = {"error": "Failed to parse scroll result", "raw": value_str}

        return {"ok": True, **info}


async def clipboard(cdp_port: int) -> dict:
    """Read the clipboard contents from the browser via CDP."""
    ws_url = await _get_ws_url(cdp_port)
    async with websockets.connect(ws_url, max_size=10 * 1024 * 1024) as ws:
        cdp = CDPSession(ws)
        await cdp.send("Runtime.enable")
        result = await cdp.send("Runtime.evaluate", {
            "expression": "navigator.clipboard.readText()",
            "awaitPromise": True,
        })
        await cdp.send("Runtime.disable")
        value = result.get("result", {}).get("value", "")
        return {"ok": True, "text": value}


async def navigate(cdp_port: int, url: str) -> dict:
    """Navigate the active page to a URL."""
    ws_url = await _get_ws_url(cdp_port)
    async with websockets.connect(ws_url, max_size=10 * 1024 * 1024) as ws:
        cdp = CDPSession(ws)
        result = await cdp.send("Page.navigate", {"url": url})
        # Wait for load
        await asyncio.sleep(1)
        return {"ok": True, "url": url, "frameId": result.get("frameId", "")}


async def list_tabs(cdp_port: int) -> dict:
    """List all open Chrome tabs via CDP /json endpoint.

    Returns: {"tabs": [{"id": "...", "title": "...", "url": "...", "type": "page"}, ...]}
    """
    import aiohttp
    async with aiohttp.ClientSession() as session:
        async with session.get(f"http://127.0.0.1:{cdp_port}/json") as resp:
            targets = await resp.json()
    tabs = []
    for t in targets:
        tabs.append({
            "id": t.get("id", ""),
            "title": t.get("title", ""),
            "url": t.get("url", ""),
            "type": t.get("type", ""),
            "ws": t.get("webSocketDebuggerUrl", ""),
        })
    return {"tabs": tabs}


async def activate_tab(cdp_port: int, tab_id: str) -> dict:
    """Activate (bring to front) a Chrome tab by its target ID.

    Returns: {"ok": True, "tabId": "..."}
    """
    import aiohttp
    async with aiohttp.ClientSession() as session:
        async with session.get(f"http://127.0.0.1:{cdp_port}/json/activate/{tab_id}") as resp:
            text = await resp.text()
    return {"ok": "Target activated" in text, "tabId": tab_id, "response": text.strip()}


async def page_content(cdp_port: int, tab_id: str | None = None) -> dict:
    """Extract the full text content of a page (much faster than AX tree).

    If tab_id is given, extracts from that specific tab. Otherwise uses the active tab.
    Returns: {"url": "...", "title": "...", "text": "full page text"}
    """
    if tab_id:
        # Get the WS URL for the specific tab
        import aiohttp
        async with aiohttp.ClientSession() as session:
            async with session.get(f"http://127.0.0.1:{cdp_port}/json") as resp:
                targets = await resp.json()
        ws_url = None
        for t in targets:
            if t.get("id") == tab_id:
                ws_url = t.get("webSocketDebuggerUrl")
                break
        if not ws_url:
            return {"ok": False, "error": f"Tab {tab_id} not found"}
    else:
        ws_url = None
        for attempt in range(15):
            try:
                ws_url = await _get_ws_url(cdp_port)
                break
            except RuntimeError:
                pass
            await asyncio.sleep(1)
        if not ws_url:
            return {"ok": False, "error": "No CDP page target available"}

    # Connect and extract. If we land on about:blank, reconnect to find the real tab.
    url = ""
    title = ""
    text = ""
    for reconnect in range(3):
        async with websockets.connect(ws_url, max_size=10 * 1024 * 1024) as ws:
            cdp = CDPSession(ws)
            for attempt in range(20):
                r = await cdp.send("Runtime.evaluate", {
                    "expression": "JSON.stringify({url: location.href, title: document.title, ready: document.readyState, text: document.body ? document.body.innerText : ''})",
                    "returnByValue": True,
                })
                try:
                    info = json.loads(r.get("result", {}).get("value", "{}"))
                except (json.JSONDecodeError, TypeError):
                    await asyncio.sleep(0.5)
                    continue

                url = info.get("url", "")
                title = info.get("title", "")
                text = info.get("text", "")
                ready = info.get("ready", "")

                if ready in ("complete", "interactive") and url and url != "about:blank":
                    break
                await asyncio.sleep(0.5)

        if url and url != "about:blank":
            break
        # We were stuck on about:blank — re-query targets for the real page
        log.info("page_content: stuck on about:blank, re-querying targets (attempt %d)", reconnect + 1)
        await asyncio.sleep(2)
        try:
            ws_url = await _get_ws_url(cdp_port)
        except RuntimeError:
            pass

    log.info("page_content result: text_len=%d url=%s", len(text), url)

    return {"ok": True, "url": url, "title": title, "text": text}


async def close_tab(cdp_port: int, tab_id: str) -> dict:
    """Close a Chrome tab by its target ID.

    Returns: {"ok": True, "tabId": "..."}
    """
    import aiohttp
    async with aiohttp.ClientSession() as session:
        async with session.get(f"http://127.0.0.1:{cdp_port}/json/close/{tab_id}") as resp:
            text = await resp.text()
    return {"ok": "Target is closing" in text, "tabId": tab_id, "response": text.strip()}