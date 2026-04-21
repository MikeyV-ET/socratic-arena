import { useState, useEffect, useCallback } from "react";

interface Boundary {
  index: number;
  timestamp: number;
  datetime: string;
  checkpointId: string;
  summaryPreview: string;
  turnCount: number;
}

function formatDate(datetime: string): string {
  try {
    const d = new Date(datetime);
    return d.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return datetime;
  }
}

function BoundaryCard({
  boundary,
  isExpanded,
  onToggle,
  fullSummary,
  loading,
}: {
  boundary: Boundary;
  isExpanded: boolean;
  onToggle: () => void;
  fullSummary: string | null;
  loading: boolean;
}) {
  return (
    <div
      className="border border-border rounded-md overflow-hidden"
      data-testid={`boundary-${boundary.index}`}
    >
      <button
        className="w-full text-left px-3 py-2 hover:bg-muted/50 transition-colors flex items-start gap-2"
        onClick={onToggle}
      >
        <span className="text-xs font-mono text-primary mt-0.5 shrink-0">
          #{boundary.index}
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 text-xs">
            <span className="text-muted-foreground">
              {formatDate(boundary.datetime)}
            </span>
            <span className="text-muted-foreground/60">
              turn {boundary.turnCount}
            </span>
          </div>
          {!isExpanded && boundary.summaryPreview && (
            <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
              {boundary.summaryPreview}
            </p>
          )}
        </div>
        <span className="text-muted-foreground text-xs mt-0.5 shrink-0">
          {isExpanded ? "\u25B2" : "\u25BC"}
        </span>
      </button>

      {isExpanded && (
        <div className="px-3 pb-3 border-t border-border/50">
          {loading ? (
            <p className="text-xs text-muted-foreground animate-pulse mt-2">
              Loading summary...
            </p>
          ) : fullSummary ? (
            <div className="mt-2 text-xs text-foreground whitespace-pre-wrap font-mono leading-relaxed max-h-96 overflow-auto">
              {fullSummary}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground mt-2">
              No summary available for this boundary.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export function BoundariesPane() {
  const [boundaries, setBoundaries] = useState<Boundary[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [summaries, setSummaries] = useState<Record<string, string>>({});
  const [loadingSummary, setLoadingSummary] = useState<string | null>(null);
  const [filter, setFilter] = useState("");

  const agent = "Q";

  useEffect(() => {
    setLoading(true);
    const base = window.location.pathname.replace(/\/+$/, "");
    fetch(`${base}/api/compaction-boundaries?agent=${agent}`)
      .then((r) => r.json())
      .then((data) => {
        setBoundaries(data.boundaries || []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [agent]);

  const toggleExpand = useCallback(
    (checkpointId: string) => {
      if (expandedId === checkpointId) {
        setExpandedId(null);
        return;
      }

      setExpandedId(checkpointId);

      if (!summaries[checkpointId]) {
        setLoadingSummary(checkpointId);
        const base = window.location.pathname.replace(/\/+$/, "");
        fetch(`${base}/api/compaction-boundaries/${checkpointId}?agent=${agent}`)
          .then((r) => r.json())
          .then((data) => {
            setSummaries((prev) => ({
              ...prev,
              [checkpointId]: data.summary || "",
            }));
            setLoadingSummary(null);
          })
          .catch(() => setLoadingSummary(null));
      }
    },
    [expandedId, summaries, agent],
  );

  const filtered = filter
    ? boundaries.filter(
        (b) =>
          b.summaryPreview.toLowerCase().includes(filter.toLowerCase()) ||
          String(b.index).includes(filter) ||
          String(b.turnCount).includes(filter),
      )
    : boundaries;

  if (loading) {
    return (
      <div className="flex flex-col h-full bg-card">
        <div className="px-3 py-2 border-b border-border">
          <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Compaction Boundaries
          </h2>
        </div>
        <div className="flex-1 flex items-center justify-center">
          <p className="text-xs text-muted-foreground animate-pulse">
            Loading boundaries...
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-card" data-testid="boundaries-pane">
      <div className="px-3 py-2 border-b border-border space-y-1.5">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Compaction Boundaries
          </h2>
          <span className="text-xs text-muted-foreground">
            {filtered.length} of {boundaries.length} ({agent})
          </span>
        </div>
        {boundaries.length > 5 && (
          <input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter boundaries..."
            className="w-full px-2 py-1 text-xs bg-background border border-border rounded-sm focus:outline-none focus:border-primary"
            data-testid="boundaries-filter"
          />
        )}
      </div>

      {filtered.length === 0 ? (
        <div className="flex-1 flex items-center justify-center">
          <p className="text-sm text-muted-foreground">
            {filter ? "No boundaries match filter" : `No compaction boundaries found for ${agent}`}
          </p>
        </div>
      ) : (
        <div
          className="flex-1 overflow-auto p-2 space-y-1.5"
          data-testid="boundaries-list"
        >
          {filtered.map((b) => (
            <BoundaryCard
              key={b.checkpointId}
              boundary={b}
              isExpanded={expandedId === b.checkpointId}
              onToggle={() => toggleExpand(b.checkpointId)}
              fullSummary={summaries[b.checkpointId] ?? null}
              loading={loadingSummary === b.checkpointId}
            />
          ))}
        </div>
      )}
    </div>
  );
}
