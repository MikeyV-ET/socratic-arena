import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";

const basePath = (window as any).__SA_BASE_PATH ?? "";

/** Keep test mirror bounded — full rewrite of unbounded string every chunk was O(n²) lag. */
const MIRROR_MAX_CHARS = 80_000;
const MIRROR_FLUSH_MS = 100;

function stripAnsi(s: string): string {
  return s
    .replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, "")
    .replace(/\x1b\][^\x07]*\x07/g, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "");
}

export function ShellPane({ instanceId, config }: { instanceId: string; config?: Record<string, any> }) {
  const agent = config?.agent as string | undefined;
  const sessionId = (config?.sessionId as string) || instanceId;
  const containerRef = useRef<HTMLDivElement>(null);
  const mirrorRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const outputRef = useRef("");
  const mirrorDirtyRef = useRef(false);
  const mirrorTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const term = new Terminal({
      cursorBlink: true,
      fontSize: 14,
      screenReaderMode: false,
      // Slightly larger scrollback is fine; avoid pathological growth in mirror
      scrollback: 5000,
      theme: {
        background: "#1e1e1e",
        foreground: "#d4d4d4",
      },
    });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(containerRef.current);
    fitAddon.fit();
    termRef.current = term;

    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    const host = basePath ? new URL(basePath, window.location.href).host : window.location.host;
    const wsUrl = `${proto}//${host}/ws/shell/${sessionId}`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    const pending: string[] = [];

    const flushMirror = () => {
      mirrorTimerRef.current = null;
      if (!mirrorDirtyRef.current || !mirrorRef.current) return;
      mirrorDirtyRef.current = false;
      // Only keep a tail for e2e/mirror consumers
      const full = outputRef.current;
      mirrorRef.current.textContent =
        full.length > MIRROR_MAX_CHARS ? full.slice(-MIRROR_MAX_CHARS) : full;
    };

    const scheduleMirror = () => {
      mirrorDirtyRef.current = true;
      if (mirrorTimerRef.current == null) {
        mirrorTimerRef.current = window.setTimeout(flushMirror, MIRROR_FLUSH_MS);
      }
    };

    ws.onopen = () => {
      const dims = fitAddon.proposeDimensions();
      if (dims) {
        ws.send(`\x1b[8;${dims.rows};${dims.cols}t`);
      }
      for (const d of pending) ws.send(d);
      pending.length = 0;
    };

    ws.onmessage = (ev) => {
      const data = typeof ev.data === "string" ? ev.data : String(ev.data);
      term.write(data);
      // Cap retained plain text so += doesn't grow without bound
      outputRef.current += stripAnsi(data);
      if (outputRef.current.length > MIRROR_MAX_CHARS * 2) {
        outputRef.current = outputRef.current.slice(-MIRROR_MAX_CHARS);
      }
      scheduleMirror();
    };

    ws.onclose = () => {
      term.write("\r\n\x1b[90m[session ended]\x1b[0m\r\n");
    };

    term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      } else {
        pending.push(data);
      }
    });

    const ro = new ResizeObserver(() => {
      fitAddon.fit();
      const dims = fitAddon.proposeDimensions();
      if (dims && ws.readyState === WebSocket.OPEN) {
        ws.send(`\x1b[8;${dims.rows};${dims.cols}t`);
      }
    });
    ro.observe(containerRef.current);

    return () => {
      ro.disconnect();
      if (mirrorTimerRef.current != null) {
        window.clearTimeout(mirrorTimerRef.current);
        mirrorTimerRef.current = null;
      }
      ws.close();
      wsRef.current = null;
      term.dispose();
      termRef.current = null;
    };
  }, [sessionId]);

  return (
    <div className="h-full w-full relative" style={{ backgroundColor: "#1e1e1e" }}>
      {agent && (
        <div
          data-testid="shell-agent-badge"
          className="absolute top-1 right-2 z-10 px-2 py-0.5 rounded text-xs font-medium"
          style={{ backgroundColor: "rgba(59,130,246,0.8)", color: "#fff" }}
        >
          {agent}
        </div>
      )}
      <div
        data-testid="shell-terminal"
        ref={containerRef}
        className="h-full w-full"
        tabIndex={-1}
      >
        <div
          ref={mirrorRef}
          data-testid="shell-mirror"
          style={{
            position: "absolute",
            bottom: 0,
            left: 0,
            width: "1px",
            height: "1px",
            overflow: "hidden",
            opacity: 0.01,
            pointerEvents: "none",
          }}
        />
      </div>
    </div>
  );
}
