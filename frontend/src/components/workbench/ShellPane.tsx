import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";

const basePath = (window as any).__SA_BASE_PATH ?? "";

function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, "")
    .replace(/\x1b\][^\x07]*\x07/g, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "");
}

export function ShellPane({ instanceId }: { instanceId: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mirrorRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const outputRef = useRef("");

  useEffect(() => {
    if (!containerRef.current) return;

    const term = new Terminal({
      cursorBlink: true,
      fontSize: 14,
      screenReaderMode: false,
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
    const wsUrl = `${proto}//${host}/ws/shell/${instanceId}`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    // Buffer input typed before the WebSocket finishes connecting.
    const pending: string[] = [];

    ws.onopen = () => {
      const dims = fitAddon.proposeDimensions();
      if (dims) {
        ws.send(`\x1b[8;${dims.rows};${dims.cols}t`);
      }
      // Flush any keystrokes that arrived before the connection opened
      for (const d of pending) ws.send(d);
      pending.length = 0;
    };

    ws.onmessage = (ev) => {
      term.write(ev.data);
      outputRef.current += stripAnsi(ev.data);
      if (mirrorRef.current) {
        mirrorRef.current.textContent = outputRef.current;
      }
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

    const container = containerRef.current;

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
      ws.close();
      wsRef.current = null;
      term.dispose();
      termRef.current = null;
    };
  }, [instanceId]);



  return (
    <div className="h-full w-full relative" style={{ backgroundColor: "#1e1e1e" }}>
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