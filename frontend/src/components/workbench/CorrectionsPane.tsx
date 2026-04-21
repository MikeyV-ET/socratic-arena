import { useState, useEffect, useCallback } from "react";
import { useArenaStore } from "@/stores/arenaStore";
import type { Correction } from "@/types";

function formatTime(ts: number): string {
  try {
    return new Date(ts * 1000).toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

function CorrectionEditor({
  nodeId,
  existing,
  onSave,
  onCancel,
  onDelete,
}: {
  nodeId: string;
  existing: Correction | null;
  onSave: (data: { whatWasMissing: string; whatShouldHaveHappened: string; correctionText: string }) => void;
  onCancel: () => void;
  onDelete?: () => void;
}) {
  const [whatWasMissing, setWhatWasMissing] = useState(existing?.whatWasMissing || "");
  const [whatShouldHave, setWhatShouldHave] = useState(existing?.whatShouldHaveHappened || "");
  const [correctionText, setCorrectionText] = useState(existing?.correctionText || "");

  const nodeContent = useArenaStore((s) => s.tree.nodes[nodeId]?.content || "");
  const preview = nodeContent.slice(0, 200) + (nodeContent.length > 200 ? "..." : "");

  return (
    <div className="space-y-3" data-testid="correction-editor">
      <div className="px-3 py-2 bg-muted/30 rounded-md border border-border/50">
        <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Node content</p>
        <p className="text-xs text-foreground line-clamp-3">{preview || "(empty)"}</p>
      </div>

      <div>
        <label className="text-[10px] text-muted-foreground uppercase tracking-wider block mb-1">
          What was missing?
        </label>
        <textarea
          value={whatWasMissing}
          onChange={(e) => setWhatWasMissing(e.target.value)}
          className="w-full px-2 py-1.5 text-xs bg-background border border-border rounded-sm resize-y min-h-[60px] focus:outline-none focus:border-primary"
          placeholder="What the agent failed to do, say, or consider..."
          data-testid="correction-missing"
        />
      </div>

      <div>
        <label className="text-[10px] text-muted-foreground uppercase tracking-wider block mb-1">
          What should have happened?
        </label>
        <textarea
          value={whatShouldHave}
          onChange={(e) => setWhatShouldHave(e.target.value)}
          className="w-full px-2 py-1.5 text-xs bg-background border border-border rounded-sm resize-y min-h-[60px] focus:outline-none focus:border-primary"
          placeholder="The ideal behavior or response..."
          data-testid="correction-should"
        />
      </div>

      <div>
        <label className="text-[10px] text-muted-foreground uppercase tracking-wider block mb-1">
          Correction
        </label>
        <textarea
          value={correctionText}
          onChange={(e) => setCorrectionText(e.target.value)}
          className="w-full px-2 py-1.5 text-xs bg-background border border-border rounded-sm resize-y min-h-[60px] focus:outline-none focus:border-primary"
          placeholder="The corrective instruction (becomes training signal)..."
          data-testid="correction-text"
        />
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={() => onSave({ whatWasMissing, whatShouldHaveHappened: whatShouldHave, correctionText })}
          className="px-3 py-1 text-xs bg-primary text-primary-foreground rounded-sm hover:bg-primary/90"
          data-testid="correction-save"
        >
          {existing ? "Update" : "Save"}
        </button>
        <button
          onClick={onCancel}
          className="px-3 py-1 text-xs text-muted-foreground hover:text-foreground"
        >
          Cancel
        </button>
        {existing && onDelete && (
          <button
            onClick={onDelete}
            className="px-3 py-1 text-xs text-destructive hover:text-destructive/70 ml-auto"
            data-testid="correction-delete"
          >
            Delete
          </button>
        )}
      </div>
    </div>
  );
}

function CorrectionCard({ correction, onEdit }: { correction: Correction; onEdit: () => void }) {
  const nodeContent = useArenaStore((s) => s.tree.nodes[correction.nodeId]?.content || "");
  const nodePreview = nodeContent.slice(0, 100) + (nodeContent.length > 100 ? "..." : "");

  return (
    <div
      className="border border-border rounded-md p-3 hover:bg-muted/30 cursor-pointer transition-colors"
      onClick={onEdit}
      data-testid={`correction-card-${correction.id}`}
    >
      <div className="flex items-center justify-between text-[10px] text-muted-foreground mb-1.5">
        <span>{formatTime(correction.createdAt)}</span>
        <span className="font-mono">node: {correction.nodeId.slice(0, 8)}</span>
      </div>
      {nodePreview && (
        <p className="text-xs text-muted-foreground/70 line-clamp-1 mb-1.5 italic">{nodePreview}</p>
      )}
      {correction.whatWasMissing && (
        <p className="text-xs text-foreground line-clamp-2">
          <span className="text-destructive/70 font-medium">Missing: </span>
          {correction.whatWasMissing}
        </p>
      )}
      {correction.correctionText && (
        <p className="text-xs text-foreground line-clamp-2 mt-1">
          <span className="text-primary/70 font-medium">Correction: </span>
          {correction.correctionText}
        </p>
      )}
    </div>
  );
}

export function CorrectionsPane() {
  const corrections = useArenaStore((s) => s.corrections);
  const editingNodeId = useArenaStore((s) => s.editingCorrectionNodeId);
  const setEditingNodeId = useArenaStore((s) => s.setEditingCorrectionNodeId);
  const [editingCorrectionId, setEditingCorrectionId] = useState<string | null>(null);

  const existingForNode = editingNodeId
    ? corrections.find((c) => c.nodeId === editingNodeId)
    : editingCorrectionId
      ? corrections.find((c) => c.id === editingCorrectionId)
      : null;

  const activeNodeId = editingNodeId || existingForNode?.nodeId || null;

  const handleSave = useCallback(
    async (data: { whatWasMissing: string; whatShouldHaveHappened: string; correctionText: string }) => {
      const base = window.location.pathname.replace(/\/+$/, "");

      if (existingForNode) {
        await fetch(`${base}/api/corrections/${existingForNode.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        });
      } else if (activeNodeId) {
        await fetch(`${base}/api/corrections`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ nodeId: activeNodeId, ...data }),
        });
      }
      setEditingNodeId(null);
      setEditingCorrectionId(null);
    },
    [existingForNode, activeNodeId, setEditingNodeId],
  );

  const handleDelete = useCallback(async () => {
    if (!existingForNode) return;
    const base = window.location.pathname.replace(/\/+$/, "");
    await fetch(`${base}/api/corrections/${existingForNode.id}`, { method: "DELETE" });
    setEditingNodeId(null);
    setEditingCorrectionId(null);
  }, [existingForNode, setEditingNodeId]);

  const handleCancel = () => {
    setEditingNodeId(null);
    setEditingCorrectionId(null);
  };

  const handleEditCard = (correction: Correction) => {
    setEditingNodeId(correction.nodeId);
    setEditingCorrectionId(correction.id);
  };

  return (
    <div className="flex flex-col h-full bg-card" data-testid="corrections-pane">
      <div className="px-3 py-2 border-b border-border flex items-center justify-between">
        <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          Corrections
        </h2>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">{corrections.length} total</span>
          <a
            href={`${window.location.pathname.replace(/\/+$/, "")}/api/export/training-data`}
            download="training_data.jsonl"
            className={`text-[10px] px-2 py-0.5 rounded transition-colors ${
              corrections.length > 0
                ? "bg-primary/10 text-primary hover:bg-primary/20"
                : "bg-muted/30 text-muted-foreground/50 pointer-events-none"
            }`}
            aria-disabled={corrections.length === 0}
            data-testid="export-button"
          >
            Export JSONL
          </a>
        </div>
      </div>

      {activeNodeId ? (
        <div className="flex-1 overflow-auto p-3">
          <CorrectionEditor
            nodeId={activeNodeId}
            existing={existingForNode || null}
            onSave={handleSave}
            onCancel={handleCancel}
            onDelete={existingForNode ? handleDelete : undefined}
          />
        </div>
      ) : corrections.length === 0 ? (
        <div className="flex-1 flex items-center justify-center p-4">
          <div className="text-center">
            <p className="text-sm text-muted-foreground">No corrections yet</p>
            <p className="text-xs text-muted-foreground/70 mt-1">
              Hover over a message and click the pencil icon to add a correction
            </p>
          </div>
        </div>
      ) : (
        <div className="flex-1 overflow-auto p-2 space-y-1.5" data-testid="corrections-list">
          {corrections.map((c) => (
            <CorrectionCard key={c.id} correction={c} onEdit={() => handleEditCard(c)} />
          ))}
        </div>
      )}
    </div>
  );
}
