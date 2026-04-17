import { useArenaStore } from "@/stores/arenaStore";

export function FontSizeControl({ paneId }: { paneId: string }) {
  const step = useArenaStore((s) => s.paneFontSizes[paneId] ?? 0);
  const adjust = useArenaStore((s) => s.adjustPaneFont);

  return (
    <div className="flex items-center gap-0.5">
      <button
        onClick={() => adjust(paneId, -1)}
        disabled={step <= -3}
        className="px-1 py-0.5 text-[10px] text-muted-foreground hover:text-foreground disabled:opacity-30 transition-colors"
        title="Decrease font size"
      >
        A-
      </button>
      <button
        onClick={() => adjust(paneId, 1)}
        disabled={step >= 4}
        className="px-1 py-0.5 text-[11px] font-medium text-muted-foreground hover:text-foreground disabled:opacity-30 transition-colors"
        title="Increase font size"
      >
        A+
      </button>
    </div>
  );
}