import { useCallback, useEffect, useRef, useState } from "react";
import { Excalidraw, serializeAsJSON } from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";
import type { ExcalidrawImperativeAPI, ExcalidrawElement, AppState, BinaryFiles } from "@excalidraw/excalidraw/types";
import { useArenaStore } from "@/stores/arenaStore";

const API = import.meta.env.VITE_API_URL || "";

interface WhiteboardMeta {
  id: string;
  title: string;
  created_at: number;
  updated_at: number;
}

export function WhiteboardPane({ instanceId }: { instanceId?: string; config?: Record<string, any> }) {
  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null);
  const [boards, setBoards] = useState<WhiteboardMeta[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [initialData, setInitialData] = useState<any>(undefined);
  const [saveStatus, setSaveStatus] = useState<"saved" | "saving" | "">(""); 
  const [showList, setShowList] = useState(true);
  const [newTitle, setNewTitle] = useState("");
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const theme = useArenaStore((s) => s.theme);
  const updatePanelLabel = useArenaStore((s) => s.updatePanelLabel);

  // Fetch whiteboard list
  const refreshBoards = useCallback(async () => {
    try {
      const resp = await fetch(`${API}/api/whiteboards`);
      if (resp.ok) setBoards(await resp.json());
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { refreshBoards(); }, [refreshBoards]);

  // Load a whiteboard
  const loadBoard = useCallback(async (id: string) => {
    try {
      const resp = await fetch(`${API}/api/whiteboards/${id}`);
      if (!resp.ok) return;
      const data = await resp.json();
      setActiveId(id);
      setInitialData({
        elements: data.elements || [],
        appState: { ...(data.appState || {}), theme: theme === "dark" ? "dark" : "light" },
        files: data.files || {},
        scrollToContent: true,
      });
      setShowList(false);
      setSaveStatus("saved");
      if (instanceId) {
        const board = boards.find((b) => b.id === id);
        if (board) updatePanelLabel(instanceId, `Whiteboard: ${board.title}`);
      }
    } catch { /* ignore */ }
  }, [theme, boards, instanceId, updatePanelLabel]);

  // Create new whiteboard
  const createBoard = useCallback(async () => {
    const title = newTitle.trim() || "Untitled";
    try {
      const resp = await fetch(`${API}/api/whiteboards`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title }),
      });
      if (!resp.ok) return;
      const board = await resp.json();
      setNewTitle("");
      await refreshBoards();
      loadBoard(board.id);
    } catch { /* ignore */ }
  }, [newTitle, refreshBoards, loadBoard]);

  // Debounced save on change
  const handleChange = useCallback(
    (elements: readonly ExcalidrawElement[], appState: AppState, files: BinaryFiles) => {
      if (!activeId) return;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      setSaveStatus("saving");
      saveTimer.current = setTimeout(async () => {
        try {
          await fetch(`${API}/api/whiteboards/${activeId}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              elements: elements.filter((e) => !e.isDeleted),
              appState: { viewBackgroundColor: appState.viewBackgroundColor },
              files,
            }),
          });
          setSaveStatus("saved");
        } catch {
          setSaveStatus("");
        }
      }, 1000);
    },
    [activeId],
  );

  // Delete a whiteboard
  const deleteBoard = useCallback(async (id: string) => {
    try {
      await fetch(`${API}/api/whiteboards/${id}`, { method: "DELETE" });
      if (activeId === id) {
        setActiveId(null);
        setInitialData(undefined);
        setShowList(true);
      }
      refreshBoards();
    } catch { /* ignore */ }
  }, [activeId, refreshBoards]);

  // Board list view
  if (showList || !activeId) {
    return (
      <div className="h-full flex flex-col p-4 gap-3">
        <div className="text-sm font-medium text-foreground">Whiteboards</div>
        <div className="flex gap-2">
          <input
            className="flex-1 px-2 py-1 text-xs rounded border border-border bg-background text-foreground"
            placeholder="New whiteboard title..."
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && createBoard()}
          />
          <button
            className="px-3 py-1 text-xs rounded bg-primary text-primary-foreground hover:opacity-90"
            onClick={createBoard}
          >+ New</button>
        </div>
        <div className="flex-1 overflow-auto space-y-1">
          {boards.length === 0 && (
            <div className="text-xs text-muted-foreground text-center py-8">No whiteboards yet. Create one above.</div>
          )}
          {boards.map((b) => (
            <div
              key={b.id}
              className="flex items-center gap-2 px-2 py-1.5 rounded text-xs cursor-pointer hover:bg-muted/50 transition-colors"
            >
              <span className="flex-1 truncate text-foreground" onClick={() => loadBoard(b.id)}>{b.title}</span>
              <span className="text-[9px] text-muted-foreground shrink-0">{new Date(b.updated_at * 1000).toLocaleDateString()}</span>
              <button
                className="text-[9px] text-muted-foreground hover:text-destructive shrink-0"
                onClick={(e) => { e.stopPropagation(); deleteBoard(b.id); }}
              >x</button>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // Excalidraw view
  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center gap-2 px-3 py-1 border-b border-border text-xs">
        <button
          className="text-muted-foreground hover:text-foreground transition-colors"
          onClick={() => setShowList(true)}
        >← Boards</button>
        <span className="flex-1 truncate font-medium text-foreground">
          {boards.find((b) => b.id === activeId)?.title || "Whiteboard"}
        </span>
        {saveStatus && (
          <span className="text-[10px] text-muted-foreground">
            {saveStatus === "saving" ? "Saving..." : "Saved"}
          </span>
        )}
      </div>
      <div className="flex-1">
        <Excalidraw
          key={activeId}
          initialData={initialData}
          onChange={handleChange}
          excalidrawAPI={(api) => { apiRef.current = api; }}
          theme={theme === "dark" ? "dark" : "light"}
        />
      </div>
    </div>
  );
}