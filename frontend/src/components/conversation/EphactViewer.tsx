import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useArenaStore, type EphactItem } from "@/stores/arenaStore";

const EMPTY_EPHACTS: EphactItem[] = [];

export function EphactViewer({ agent }: { agent: string }) {
  const stackRaw = useArenaStore((s) => s.ephactsByAgent[agent]);
  const stack = stackRaw ?? EMPTY_EPHACTS;
  const activeIdx = useArenaStore((s) => s.ephactActiveByAgent[agent] ?? 0);
  const visible = useArenaStore((s) => s.ephactViewerVisible);
  const setIdx = useArenaStore((s) => s.setEphactActive);
  const remove = useArenaStore((s) => s.removeEphact);
  const clearAll = useArenaStore((s) => s.clearEphacts);
  const setVisible = useArenaStore((s) => s.setEphactViewerVisible);
  const theme = useArenaStore((s) => s.theme);

  const item: EphactItem | null = stack.length ? stack[Math.min(activeIdx, stack.length - 1)] : null;

  const popout = () => {
    if (!item) return;
    const params = new URLSearchParams({
      panel: `ephact-${item.id}`,
      type: "ephact",
      config: JSON.stringify({ ephact: item }),
    });
    window.open(
      `${window.location.origin}${window.location.pathname}?${params.toString()}`,
      `ephact-${item.id}`,
      "width=720,height=480,menubar=no,toolbar=no",
    );
  };

  if (!visible || !item) return null;

  const prose =
    "text-sm leading-relaxed prose prose-sm max-w-none prose-p:my-1 prose-table:text-xs " +
    (theme === "dark" ? "prose-invert" : "");

  return (
    <div
      className="border-t border-border bg-card/80 flex flex-col shrink-0"
      style={{ maxHeight: "50%" }}
      data-testid="ephact-viewer"
    >
      <div className="overflow-y-auto px-3 py-2 min-h-0 flex-1">
        <div className="text-[10px] text-muted-foreground mb-1 font-mono">
          {item.type}
          {item.sourceNodeId ? ` · ${item.sourceNodeId.slice(0, 8)}` : ""}
        </div>
        <div className={prose}>
          <Markdown remarkPlugins={[remarkGfm]}>{item.content}</Markdown>
        </div>
      </div>
      {/* Bottom chrome: tabs scroll horizontally; actions always visible (no overflow clip) */}
      <div className="flex items-center gap-1 px-2 py-1 border-t border-border/60 text-[11px] shrink-0 min-w-0">
        <span className="text-muted-foreground font-medium shrink-0">📌</span>
        <div className="flex-1 flex items-center gap-0.5 overflow-x-auto min-w-0 py-0.5">
          {stack.map((e, i) => (
            <div
              key={e.id}
              className={`flex items-center shrink-0 rounded border text-[11px] ${
                i === activeIdx
                  ? "bg-accent/20 border-accent/40 text-foreground"
                  : "bg-muted/40 border-transparent text-muted-foreground"
              }`}
            >
              <button
                type="button"
                onClick={() => setIdx(agent, i)}
                className="px-1.5 py-0.5 truncate max-w-[9rem] hover:opacity-90"
                title={e.title}
              >
                {e.title}
              </button>
              <button
                type="button"
                className="px-1 py-0.5 opacity-70 hover:opacity-100 border-l border-border/40"
                title={`Close ${e.title}`}
                aria-label={`Close ${e.title}`}
                onClick={(ev) => {
                  ev.stopPropagation();
                  remove(agent, e.id);
                }}
                data-testid="ephact-close-one"
              >
                ×
              </button>
            </div>
          ))}
        </div>
        <div className="flex items-center gap-0.5 shrink-0 pl-1 border-l border-border/50">
          <button
            type="button"
            className="px-1.5 py-0.5 rounded border border-border text-muted-foreground hover:text-foreground hover:bg-muted"
            title="Close all ephacts"
            onClick={() => clearAll(agent)}
            data-testid="ephact-clear-all"
          >
            clear
          </button>
          <button
            type="button"
            className="px-1.5 py-0.5 rounded border border-border text-muted-foreground hover:text-foreground"
            title="Pop out"
            onClick={popout}
            data-testid="ephact-popout"
          >
            ↗
          </button>
          <button
            type="button"
            className="px-1.5 py-0.5 rounded border border-border text-muted-foreground hover:text-foreground"
            title="Hide viewer"
            onClick={() => setVisible(false)}
          >
            ▽
          </button>
        </div>
      </div>
    </div>
  );
}

/** Standalone popout body */
export function EphactPopoutBody({ ephact }: { ephact: EphactItem }) {
  const theme = useArenaStore((s) => s.theme);
  const prose =
    "text-sm leading-relaxed prose prose-sm max-w-none p-4 " +
    (theme === "dark" ? "prose-invert" : "");
  return (
    <div className="h-full overflow-y-auto bg-background" data-theme={theme}>
      <div className="px-4 py-2 border-b border-border text-sm font-medium">📌 {ephact.title}</div>
      <div className={prose}>
        <Markdown remarkPlugins={[remarkGfm]}>{ephact.content}</Markdown>
      </div>
    </div>
  );
}
