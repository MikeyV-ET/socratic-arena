import { useCallback, useEffect, useRef, useState } from "react";
import { EditorView, basicSetup } from "codemirror";
import { EditorState, StateEffect, StateField } from "@codemirror/state";
import { Decoration, type DecorationSet } from "@codemirror/view";
import { markdown } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { oneDark } from "@codemirror/theme-one-dark";
import * as Y from "yjs";
import { yCollab } from "y-codemirror.next";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useArenaStore } from "@/stores/arenaStore";

// ---------------------------------------------------------------------------
// Highlight decorations (agent-initiated line highlighting)
// ---------------------------------------------------------------------------

interface HighlightRange { from: number; to: number }
interface HighlightPayload { ranges: HighlightRange[]; color: string }

const setHighlightsEffect = StateEffect.define<HighlightPayload>();
const clearHighlightsEffect = StateEffect.define<null>();

const highlightField = StateField.define<DecorationSet>({
  create() { return Decoration.none; },
  update(decos, tr) {
    for (const e of tr.effects) {
      if (e.is(setHighlightsEffect)) {
        const marks: ReturnType<typeof Decoration.line>[] = [];
        const doc = tr.state.doc;
        for (const r of e.value.ranges) {
          const lo = Math.max(1, r.from);
          const hi = Math.min(doc.lines, r.to);
          for (let line = lo; line <= hi; line++) {
            marks.push(
              Decoration.line({ class: `cm-sa-highlight cm-sa-hl-${e.value.color}` })
                .range(doc.line(line).from),
            );
          }
        }
        return Decoration.set(marks, true);
      }
      if (e.is(clearHighlightsEffect)) {
        return Decoration.none;
      }
    }
    return decos.map(tr.changes);
  },
  provide: (f) => EditorView.decorations.from(f),
});

const highlightTheme = EditorView.baseTheme({
  ".cm-sa-highlight": { transition: "background-color 0.2s ease" },
  ".cm-sa-hl-yellow": { backgroundColor: "rgba(255, 230, 0, 0.25)" },
  ".cm-sa-hl-blue":   { backgroundColor: "rgba(66, 135, 245, 0.22)" },
  ".cm-sa-hl-green":  { backgroundColor: "rgba(34, 197, 94, 0.22)" },
  ".cm-sa-hl-red":    { backgroundColor: "rgba(239, 68, 68, 0.22)" },
  ".cm-sa-hl-purple": { backgroundColor: "rgba(168, 85, 247, 0.22)" },
});

interface DocMeta {
  id: string;
  title: string;
  content_type: string;
  created_at: number;
  updated_at: number;
}

const basePath = window.location.pathname.replace(/\/+$/, "");

/**
 * Minimal Yjs WebSocket provider that speaks the y-protocols binary format.
 * Connects to our backend's /api/docs/{id}/ws endpoint.
 */
class SimpleYjsProvider {
  private ws: WebSocket | null = null;
  private doc: Y.Doc;
  private _connected = false;
  onStatusChange?: (connected: boolean) => void;

  constructor(url: string, doc: Y.Doc) {
    this.doc = doc;
    this.connect(url);

    // Send local updates to server
    this.doc.on("update", (update: Uint8Array, origin: unknown) => {
      if (origin === this) return; // don't echo server updates back
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
      // Build SYNC UPDATE message: [SYNC=0, SYNC_UPDATE=2, var_uint(len), update]
      const encoded = this.encodeSyncUpdate(update);
      this.ws.send(encoded);
    });
  }

  private connect(url: string) {
    this.ws = new WebSocket(url);
    this.ws.binaryType = "arraybuffer";

    this.ws.onopen = () => {
      this._connected = true;
      this.onStatusChange?.(true);
    };

    this.ws.onclose = () => {
      this._connected = false;
      this.onStatusChange?.(false);
    };

    this.ws.onerror = () => this.ws?.close();

    this.ws.onmessage = (event) => {
      const data = new Uint8Array(event.data);
      if (data.length < 2) return;

      const msgType = data[0]; // YMessageType: 0=SYNC, 1=AWARENESS
      if (msgType === 0) {
        // SYNC message
        const syncType = data[1]; // 0=STEP1, 1=STEP2, 2=UPDATE
        if (syncType === 0) {
          // SYNC_STEP1: server sends its state vector, we reply with our diff
          const stateVector = this.readVarUintPrefixed(data, 2);
          const diff = Y.encodeStateAsUpdate(this.doc, stateVector);
          // Reply: SYNC_STEP2
          const reply = this.encodeSyncStep2(diff);
          this.ws?.send(reply);
          // Also send our state vector so server can send us what we're missing
          const ourSV = Y.encodeStateVector(this.doc);
          const step1 = this.encodeSyncStep1(ourSV);
          this.ws?.send(step1);
        } else if (syncType === 1 || syncType === 2) {
          // SYNC_STEP2 or SYNC_UPDATE: apply the update
          const update = this.readVarUintPrefixed(data, 2);
          if (update.length > 0) {
            Y.applyUpdate(this.doc, update, this);
          }
        }
      }
      // Awareness messages (type=1) ignored for now
    };
  }

  get connected() {
    return this._connected;
  }

  destroy() {
    this.ws?.close();
    this.ws = null;
  }

  // --- Binary protocol helpers ---

  private writeVarUint(num: number): number[] {
    const bytes: number[] = [];
    while (num > 0x7f) {
      bytes.push(0x80 | (num & 0x7f));
      num >>>= 7;
    }
    bytes.push(num & 0x7f);
    return bytes;
  }

  private readVarUint(data: Uint8Array, offset: number): [number, number] {
    let num = 0;
    let shift = 0;
    let pos = offset;
    while (pos < data.length) {
      const byte = data[pos++];
      num |= (byte & 0x7f) << shift;
      if ((byte & 0x80) === 0) break;
      shift += 7;
    }
    return [num, pos];
  }

  private readVarUintPrefixed(data: Uint8Array, offset: number): Uint8Array {
    const [len, pos] = this.readVarUint(data, offset);
    return data.slice(pos, pos + len);
  }

  private encodeSyncStep1(stateVector: Uint8Array): Uint8Array {
    const lenBytes = this.writeVarUint(stateVector.length);
    const msg = new Uint8Array(2 + lenBytes.length + stateVector.length);
    msg[0] = 0; // SYNC
    msg[1] = 0; // SYNC_STEP1
    msg.set(lenBytes, 2);
    msg.set(stateVector, 2 + lenBytes.length);
    return msg;
  }

  private encodeSyncStep2(update: Uint8Array): Uint8Array {
    const lenBytes = this.writeVarUint(update.length);
    const msg = new Uint8Array(2 + lenBytes.length + update.length);
    msg[0] = 0; // SYNC
    msg[1] = 1; // SYNC_STEP2
    msg.set(lenBytes, 2);
    msg.set(update, 2 + lenBytes.length);
    return msg;
  }

  private encodeSyncUpdate(update: Uint8Array): Uint8Array {
    const lenBytes = this.writeVarUint(update.length);
    const msg = new Uint8Array(2 + lenBytes.length + update.length);
    msg[0] = 0; // SYNC
    msg[1] = 2; // SYNC_UPDATE
    msg.set(lenBytes, 2);
    msg.set(update, 2 + lenBytes.length);
    return msg;
  }
}

export function SharedEditorPane() {
  const theme = useArenaStore((s) => s.theme);
  const editorContainerRef = useRef<HTMLDivElement>(null);
  const editorViewRef = useRef<EditorView | null>(null);
  const providerRef = useRef<SimpleYjsProvider | null>(null);
  const ydocRef = useRef<Y.Doc | null>(null);

  const [docs, setDocs] = useState<DocMeta[]>([]);
  const [activeDocId, setActiveDocId] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [viewMode, setViewMode] = useState<"edit" | "preview">("edit");
  const [previewText, setPreviewText] = useState("");

  // Clean up editor + provider when switching or unmounting
  const cleanup = useCallback(() => {
    editorViewRef.current?.destroy();
    editorViewRef.current = null;
    providerRef.current?.destroy();
    providerRef.current = null;
    ydocRef.current?.destroy();
    ydocRef.current = null;
    setConnected(false);
  }, []);

  useEffect(() => () => cleanup(), [cleanup]);

  // Open a document: create Yjs doc, connect provider, mount CodeMirror
  const openDoc = useCallback((docId: string) => {
    cleanup();
    setActiveDocId(docId);

    const ydoc = new Y.Doc();
    ydocRef.current = ydoc;
    const ytext = ydoc.getText("content");

    const wsProto = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${wsProto}//${window.location.host}${basePath}/api/docs/${docId}/ws`;
    const provider = new SimpleYjsProvider(wsUrl, ydoc);
    provider.onStatusChange = setConnected;
    providerRef.current = provider;

    // Track text for markdown preview
    const updatePreview = () => setPreviewText(ytext.toString());
    ytext.observe(updatePreview);
    // Initial sync takes a moment; update once synced
    ydoc.on("update", updatePreview);

    // Wait for container to be ready
    requestAnimationFrame(() => {
      if (!editorContainerRef.current) return;

      const extensions = [
        basicSetup,
        markdown({ codeLanguages: languages }),
        yCollab(ytext),
        EditorView.lineWrapping,
        highlightField,
        highlightTheme,
      ];
      if (theme === "dark") {
        extensions.push(oneDark);
      }

      const state = EditorState.create({
        doc: ytext.toString(),
        extensions,
      });

      const view = new EditorView({
        state,
        parent: editorContainerRef.current!,
      });
      editorViewRef.current = view;
    });
  }, [cleanup, theme]);

  // Fetch doc list
  const refreshDocs = useCallback(async () => {
    try {
      const resp = await fetch(`${basePath}/api/docs`);
      const data = await resp.json();
      setDocs(data);
    } catch { /* ignore */ }
  }, []);

  // Refresh doc list on mount, WS reconnect, doc changes, and open-doc events
  const wsConnected = useArenaStore((s) => s.connected);
  const prevConnected = useRef(false);

  useEffect(() => {
    // Refresh on initial mount and WS reconnect
    if (wsConnected && !prevConnected.current) {
      refreshDocs();
    }
    prevConnected.current = wsConnected;
  }, [wsConnected, refreshDocs]);

  useEffect(() => {
    refreshDocs();
    const onDocsChanged = () => refreshDocs();
    window.addEventListener("sa-docs-changed", onDocsChanged);
    const onOpenDoc = (e: Event) => {
      const docId = (e as CustomEvent).detail?.docId;
      if (docId) openDoc(docId);
    };
    window.addEventListener("sa-open-doc", onOpenDoc);
    return () => {
      window.removeEventListener("sa-docs-changed", onDocsChanged);
      window.removeEventListener("sa-open-doc", onOpenDoc);
    };
  }, [refreshDocs, openDoc]);

  // Listen for highlight events from the main WS (agent-initiated)
  useEffect(() => {
    const onHighlight = (e: Event) => {
      const { docId, ranges, color } = (e as CustomEvent).detail ?? {};
      if (docId !== activeDocId || !editorViewRef.current) return;
      editorViewRef.current.dispatch({
        effects: setHighlightsEffect.of({ ranges: ranges ?? [], color: color ?? "yellow" }),
      });
    };
    const onClearHighlight = (e: Event) => {
      const { docId } = (e as CustomEvent).detail ?? {};
      if (docId !== activeDocId || !editorViewRef.current) return;
      editorViewRef.current.dispatch({
        effects: clearHighlightsEffect.of(null),
      });
    };
    window.addEventListener("sa-doc-highlight", onHighlight);
    window.addEventListener("sa-doc-clear-highlight", onClearHighlight);
    return () => {
      window.removeEventListener("sa-doc-highlight", onHighlight);
      window.removeEventListener("sa-doc-clear-highlight", onClearHighlight);
    };
  }, [activeDocId]);

  // Create a new doc
  const createDoc = async () => {
    const title = newTitle.trim() || "Untitled";
    try {
      const resp = await fetch(`${basePath}/api/docs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, contentType: "markdown" }),
      });
      const doc = await resp.json();
      setNewTitle("");
      setShowCreate(false);
      await refreshDocs();
      openDoc(doc.id);
    } catch { /* ignore */ }
  };

  // Delete a doc
  const deleteDoc = async (docId: string) => {
    try {
      await fetch(`${basePath}/api/docs/${docId}`, { method: "DELETE" });
      if (activeDocId === docId) {
        cleanup();
        setActiveDocId(null);
      }
      await refreshDocs();
    } catch { /* ignore */ }
  };

  const activeDoc = docs.find((d) => d.id === activeDocId);

  return (
    <div className="flex flex-col h-full bg-card" data-testid="shared-editor">
      {/* Header */}
      <div className="px-3 py-2 border-b border-border flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider shrink-0">
            Shared Editor
          </h2>
          {activeDoc && (
            <span className="text-xs text-foreground truncate" data-testid="shared-editor-title">
              {activeDoc.title}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          {activeDocId && (
            <>
              <div className="flex rounded border border-border overflow-hidden" data-testid="view-mode-toggle">
                <button
                  onClick={() => setViewMode("edit")}
                  className={`px-2 py-0.5 text-[10px] transition-colors ${
                    viewMode === "edit" ? "bg-primary/20 text-primary" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  Edit
                </button>
                <button
                  onClick={() => setViewMode("preview")}
                  className={`px-2 py-0.5 text-[10px] transition-colors ${
                    viewMode === "preview" ? "bg-primary/20 text-primary" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  Preview
                </button>
              </div>
              <span className={`w-2 h-2 rounded-full ${connected ? "bg-green-500" : "bg-red-500"}`}
                title={connected ? "Connected" : "Disconnected"} />
            </>
          )}
          <button
            onClick={() => setShowCreate(!showCreate)}
            className="px-2 py-0.5 text-xs bg-primary/10 hover:bg-primary/20 text-primary rounded transition-colors"
            data-testid="create-doc-btn"
          >
            + New
          </button>
        </div>
      </div>

      {/* Create form */}
      {showCreate && (
        <div className="px-3 py-2 border-b border-border flex items-center gap-2">
          <input
            type="text"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && createDoc()}
            placeholder="Document title..."
            className="flex-1 text-xs px-2 py-1 bg-background border border-border rounded focus:outline-none focus:border-primary"
            data-testid="create-doc-title"
            autoFocus
          />
          <button
            onClick={createDoc}
            className="px-2 py-1 text-xs bg-primary text-primary-foreground rounded hover:bg-primary/90 transition-colors"
          >
            Create
          </button>
          <button
            onClick={() => { setShowCreate(false); setNewTitle(""); }}
            className="px-2 py-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            Cancel
          </button>
        </div>
      )}

      {/* Doc list sidebar + editor area */}
      <div className="flex-1 flex overflow-hidden">
        {/* Doc list */}
        <div className="w-40 border-r border-border overflow-y-auto shrink-0">
          {docs.length === 0 && (
            <div className="text-xs text-muted-foreground text-center py-4">
              No documents
            </div>
          )}
          {docs.map((doc) => (
            <div
              key={doc.id}
              className={`flex items-center gap-1 px-2 py-1.5 text-xs cursor-pointer transition-colors group ${
                activeDocId === doc.id
                  ? "bg-primary/10 text-foreground"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
              }`}
              onClick={() => openDoc(doc.id)}
              data-testid={`doc-item-${doc.id}`}
            >
              <span className="truncate flex-1">{doc.title}</span>
              <button
                onClick={(e) => { e.stopPropagation(); deleteDoc(doc.id); }}
                className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive text-[10px] transition-opacity"
                title="Delete"
              >
                &times;
              </button>
            </div>
          ))}
        </div>

        {/* Editor / Preview area */}
        <div className="flex-1 overflow-hidden">
          {activeDocId ? (
            <>
              <div
                ref={editorContainerRef}
                className="h-full overflow-auto [&_.cm-editor]:h-full [&_.cm-scroller]:!overflow-auto"
                data-testid="shared-editor-content"
                style={{ display: viewMode === "edit" ? undefined : "none" }}
              />
              {viewMode === "preview" && (
                <div
                  className={`h-full overflow-auto p-4 prose prose-sm max-w-none prose-p:my-2 prose-li:my-0 prose-table:text-xs prose-th:text-left prose-td:px-2 prose-td:py-1 prose-th:px-2 prose-th:py-1${theme === "dark" ? " prose-invert" : ""}`}
                  data-testid="shared-editor-preview"
                >
                  <Markdown remarkPlugins={[remarkGfm]}>{previewText}</Markdown>
                </div>
              )}
            </>
          ) : (
            <div className="flex items-center justify-center h-full text-xs text-muted-foreground">
              Select or create a document to start editing
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
