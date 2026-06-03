import { useState, useEffect, useCallback } from "react";
import { useArenaStore } from "@/stores/arenaStore";

interface FsEntry {
  name: string;
  type: "dir" | "file";
  path: string;
  size?: number;
  ext?: string;
}

interface DirListing {
  path: string;
  parent: string | null;
  entries: FsEntry[];
}

const basePath = (window as any).__SA_BASE_PATH ?? "";

export function FilesystemPane() {
  const addPanel = useArenaStore((s) => s.addPanel);
  const [currentPath, setCurrentPath] = useState<string>("");
  const [listing, setListing] = useState<DirListing | null>(null);
  const [expanded, setExpanded] = useState<Record<string, FsEntry[]>>({});
  const [loading, setLoading] = useState(false);

  const fetchDir = useCallback(async (dirPath?: string) => {
    setLoading(true);
    try {
      const url = dirPath
        ? `${basePath}/api/files/browse?path=${encodeURIComponent(dirPath)}`
        : `${basePath}/api/files/browse`;
      const resp = await fetch(url);
      const data: DirListing = await resp.json();
      setListing(data);
      setCurrentPath(data.path);
      setExpanded({});
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => { fetchDir(); }, [fetchDir]);

  const toggleFolder = async (entry: FsEntry) => {
    if (expanded[entry.path]) {
      setExpanded((prev) => { const next = { ...prev }; delete next[entry.path]; return next; });
      return;
    }
    try {
      const resp = await fetch(`${basePath}/api/files/browse?path=${encodeURIComponent(entry.path)}`);
      const data: DirListing = await resp.json();
      setExpanded((prev) => ({ ...prev, [entry.path]: data.entries }));
    } catch { /* ignore */ }
  };

  const openFile = async (entry: FsEntry) => {
    try {
      const resp = await fetch(`${basePath}/api/files/open`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: entry.path }),
      });
      const doc = await resp.json();
      const docId = doc.id || doc.docId;
      addPanel("editor", { docId });
    } catch { /* ignore */ }
  };

  const breadcrumbParts = currentPath ? currentPath.split("/").filter(Boolean) : [];

  const renderEntry = (entry: FsEntry, depth: number) => {
    const isExpanded = !!expanded[entry.path];
    const children = expanded[entry.path];
    return (
      <div key={entry.path}>
        <div
          data-testid="fs-tree-item"
          className="flex items-center gap-1 px-2 py-1 text-xs hover:bg-muted/50 cursor-pointer transition-colors"
          style={{ paddingLeft: `${8 + depth * 16}px` }}
        >
          {entry.type === "dir" ? (
            <div
              data-testid="fs-folder"
              className="flex items-center gap-1 flex-1"
              onClick={() => toggleFolder(entry)}
            >
              <span className="text-muted-foreground w-3">{isExpanded ? "▼" : "▶"}</span>
              <span className="text-yellow-500">📁</span>
              <span>{entry.name}</span>
            </div>
          ) : (
            <div
              data-testid="fs-file"
              className="flex items-center gap-1 flex-1"
              onClick={() => openFile(entry)}
            >
              <span className="w-3" />
              <span className="text-muted-foreground">📄</span>
              <span>{entry.name}</span>
              {entry.size != null && (
                <span className="ml-auto text-muted-foreground text-[10px]">
                  {entry.size < 1024 ? `${entry.size}B` : `${(entry.size / 1024).toFixed(1)}K`}
                </span>
              )}
            </div>
          )}
        </div>
        {isExpanded && children && children.map((child) => renderEntry(child, depth + 1))}
      </div>
    );
  };

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div
        data-testid="fs-breadcrumb"
        className="flex items-center gap-0.5 px-2 py-1.5 text-xs border-b border-border bg-card overflow-x-auto flex-shrink-0"
      >
        <button
          className="text-muted-foreground hover:text-foreground"
          onClick={() => fetchDir("/")}
        >
          /
        </button>
        {breadcrumbParts.map((part, i) => {
          const path = "/" + breadcrumbParts.slice(0, i + 1).join("/");
          return (
            <span key={path} className="flex items-center gap-0.5">
              <span className="text-muted-foreground">/</span>
              <button
                className="hover:text-foreground text-muted-foreground hover:underline"
                onClick={() => fetchDir(path)}
              >
                {part}
              </button>
            </span>
          );
        })}
      </div>
      <div className="flex-1 overflow-auto">
        {loading && <div className="p-2 text-xs text-muted-foreground">Loading...</div>}
        {listing && (
          <>
            {listing.parent && (
              <div
                data-testid="fs-tree-item"
                className="flex items-center gap-1 px-2 py-1 text-xs hover:bg-muted/50 cursor-pointer transition-colors"
                onClick={() => fetchDir(listing.parent!)}
              >
                <span className="w-3 text-muted-foreground">↑</span>
                <span className="text-muted-foreground">..</span>
              </div>
            )}
            {listing.entries.map((entry) => renderEntry(entry, 0))}
          </>
        )}
      </div>
    </div>
  );
}