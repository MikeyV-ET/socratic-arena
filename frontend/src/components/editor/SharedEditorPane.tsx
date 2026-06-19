import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EditorView, basicSetup } from "codemirror";
import { EditorState, StateEffect, StateField, Compartment } from "@codemirror/state";
import { Decoration, type DecorationSet } from "@codemirror/view";
import { markdown } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { oneDark } from "@codemirror/theme-one-dark";
import * as Y from "yjs";
import { yCollab } from "y-codemirror.next";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import { useArenaStore } from "@/stores/arenaStore";
import { wysiwygPlugin, wysiwygTheme } from "./wysiwygMarkdown";
import { authorColorPlugin, authorColorTheme, authorColorConfig } from "./authorColors";

// ---------------------------------------------------------------------------
// CSV parsing
// ---------------------------------------------------------------------------

function parseCsv(text: string, delimiter = ","): string[][] {
  const rows: string[][] = [];
  let i = 0;
  while (i < text.length) {
    const row: string[] = [];
    while (i < text.length) {
      if (text[i] === '"') {
        // Quoted field
        i++;
        let field = "";
        while (i < text.length) {
          if (text[i] === '"') {
            if (i + 1 < text.length && text[i + 1] === '"') {
              field += '"';
              i += 2;
            } else {
              i++;
              break;
            }
          } else {
            field += text[i++];
          }
        }
        row.push(field);
        if (i < text.length && text[i] === delimiter) i++;
        else if (i < text.length && (text[i] === "\n" || text[i] === "\r")) {
          if (text[i] === "\r" && i + 1 < text.length && text[i + 1] === "\n") i += 2;
          else i++;
          break;
        }
      } else {
        const nextDelim = text.indexOf(delimiter, i);
        const nextNewline = text.indexOf("\n", i);
        const nextCR = text.indexOf("\r", i);
        const nl = nextCR >= 0 && nextCR < (nextNewline >= 0 ? nextNewline : Infinity) ? nextCR : nextNewline;
        const end = nextDelim >= 0 && (nl < 0 || nextDelim < nl) ? nextDelim : nl;
        if (end < 0) {
          row.push(text.slice(i));
          i = text.length;
        } else if (end === nextDelim && (nl < 0 || nextDelim < nl)) {
          row.push(text.slice(i, end));
          i = end + 1;
        } else {
          row.push(text.slice(i, end));
          i = end + 1;
          if (text[end] === "\r" && i < text.length && text[i] === "\n") i++;
          break;
        }
      }
    }
    if (row.length > 0 || i < text.length) rows.push(row);
  }
  return rows;
}

function isCsvFile(doc: DocMeta | undefined): "csv" | "tsv" | null {
  if (!doc) return null;
  const path = (doc.file_path || doc.title || "").toLowerCase();
  if (path.endsWith(".csv")) return "csv";
  if (path.endsWith(".tsv")) return "tsv";
  return null;
}

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
  file_path?: string;
}

interface FileEntry {
  name: string;
  type: "file" | "dir";
  path: string;
  size?: number;
  ext?: string;
}

interface BrowseResult {
  path: string;
  parent: string | null;
  entries: FileEntry[];
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

export function SharedEditorPane({ instanceId, config }: { instanceId?: string; config?: Record<string, any> } = {}) {
  const theme = useArenaStore((s) => s.theme);
  const updatePanelLabel = useArenaStore((s) => s.updatePanelLabel);
  const editorContainerRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const editorViewRef = useRef<EditorView | null>(null);
  const providerRef = useRef<SimpleYjsProvider | null>(null);
  const ydocRef = useRef<Y.Doc | null>(null);

  const [docs, setDocs] = useState<DocMeta[]>([]);
  const [activeDocId, setActiveDocId] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [viewMode, _setViewMode] = useState<"edit" | "preview" | "table">("edit");
  const setViewMode = useCallback((mode: "edit" | "preview" | "table") => {
    _setViewMode((prev) => {
      // Sync scroll position proportionally when switching between edit and preview
      if (prev === "edit" && mode === "preview") {
        const scroller = editorContainerRef.current?.querySelector(".cm-scroller") as HTMLElement | null;
        if (scroller && previewRef.current) {
          const pct = scroller.scrollHeight > scroller.clientHeight
            ? scroller.scrollTop / (scroller.scrollHeight - scroller.clientHeight)
            : 0;
          requestAnimationFrame(() => requestAnimationFrame(() => {
            const el = previewRef.current;
            if (el) el.scrollTop = pct * (el.scrollHeight - el.clientHeight);
          }));
        }
      } else if (prev === "preview" && mode === "edit") {
        const el = previewRef.current;
        if (el && editorViewRef.current) {
          const pct = el.scrollHeight > el.clientHeight
            ? el.scrollTop / (el.scrollHeight - el.clientHeight)
            : 0;
          requestAnimationFrame(() => requestAnimationFrame(() => {
            const scroller = editorContainerRef.current?.querySelector(".cm-scroller") as HTMLElement | null;
            if (scroller) scroller.scrollTop = pct * (scroller.scrollHeight - scroller.clientHeight);
          }));
        }
      }
      return mode;
    });
  }, []);
  const [previewText, setPreviewText] = useState("");
  const [showAuthors, setShowAuthors] = useState(true);
  const [browseResult, setBrowseResult] = useState<BrowseResult | null>(null);
  const [browseLoading, setBrowseLoading] = useState(false);
  const [treeCache, setTreeCache] = useState<Record<string, BrowseResult>>({});
  const [treeExpanded, setTreeExpanded] = useState<Set<string>>(new Set());
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [showOpen, setShowOpen] = useState(false);
  const [showToc, setShowToc] = useState(false);
  const [createDir, setCreateDir] = useState("");
  const [createBrowse, setCreateBrowse] = useState<BrowseResult | null>(null);
  const [showCreateBrowse, setShowCreateBrowse] = useState(false);
  const [tocWidth, setTocWidth] = useState(192);
  const themeCompRef = useRef(new Compartment());

  const startTocResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = tocWidth;
    const onMove = (me: MouseEvent) => {
      const newWidth = Math.max(80, Math.min(400, startWidth + me.clientX - startX));
      setTocWidth(newWidth);
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, [tocWidth]);

  // Extract markdown headings for TOC
  const headings = useMemo(() => {
    if (!previewText) return [];
    const result: { level: number; text: string; line: number }[] = [];
    const lines = previewText.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(/^(#{1,6})\s+(.+)/);
      if (m) result.push({ level: m[1].length, text: m[2].replace(/\s*#+\s*$/, ""), line: i + 1 });
    }
    return result;
  }, [previewText]);

  const scrollToHeading = useCallback((line: number) => {
    const view = editorViewRef.current;
    if (!view) return;
    const lineInfo = view.state.doc.line(Math.min(line, view.state.doc.lines));
    view.dispatch({
      effects: EditorView.scrollIntoView(lineInfo.from, { y: "start", yMargin: 20 }),
      selection: { anchor: lineInfo.from },
    });
    view.focus();
  }, []);

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

    // Update workbench tab label to show the doc name
    if (instanceId) {
      const doc = docs.find((d) => d.id === docId);
      if (doc) updatePanelLabel(instanceId, `Editor: ${doc.title}`);
    }

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
        wysiwygPlugin,
        wysiwygTheme,
        authorColorConfig.of({
          ytext,
          localClientId: ydoc.clientID,
          enabled: true,
        }),
        authorColorPlugin,
        authorColorTheme,
      ];
      extensions.push(themeCompRef.current.of(theme === "dark" ? oneDark : []));

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
  }, [cleanup, theme, docs, instanceId, updatePanelLabel]);

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

  // Reconfigure CodeMirror theme when SA theme changes
  useEffect(() => {
    if (!editorViewRef.current) return;
    editorViewRef.current.dispatch({
      effects: themeCompRef.current.reconfigure(theme === "dark" ? oneDark : []),
    });
  }, [theme]);

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

  // Open doc from config (e.g. filesystem viewer passing docId) or auto-create untitled
  const autoCreated = useRef(false);
  useEffect(() => {
    if (activeDocId || autoCreated.current) return;
    autoCreated.current = true;
    if (config?.docId) {
      (async () => {
        await refreshDocs();
        openDoc(config.docId);
      })();
    } else {
      (async () => {
        try {
          const resp = await fetch(`${basePath}/api/docs`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ title: "Untitled", contentType: "markdown" }),
          });
          const doc = await resp.json();
          await refreshDocs();
          openDoc(doc.id);
        } catch { /* ignore */ }
      })();
    }
  }, [activeDocId, refreshDocs, openDoc, config]);

  // Create a new doc (on disk if directory specified, in-memory otherwise)
  const createDoc = async () => {
    const title = newTitle.trim() || "Untitled";
    const dir = createDir.trim();
    try {
      let doc;
      if (dir) {
        // Create file on disk
        const name = title.endsWith(".md") ? title : `${title}.md`;
        const resp = await fetch(`${basePath}/api/files/create`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, directory: dir }),
        });
        doc = await resp.json();
        if (doc.error) { alert(doc.error); return; }
      } else {
        const resp = await fetch(`${basePath}/api/docs`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title, contentType: "markdown" }),
        });
        doc = await resp.json();
      }
      setNewTitle("");
      setCreateDir("");
      setShowCreate(false);
      setCreateBrowse(null);
      setShowCreateBrowse(false);
      await refreshDocs();
      openDoc(doc.id);
      if (instanceId) updatePanelLabel(instanceId, `Editor: ${doc.title || title}`);
    } catch { /* ignore */ }
  };

  // Browse for create-doc directory
  const browseCreateDir = useCallback(async (dirPath?: string) => {
    try {
      const url = dirPath
        ? `${basePath}/api/files/browse?path=${encodeURIComponent(dirPath)}`
        : `${basePath}/api/files/browse`;
      const resp = await fetch(url);
      const data: BrowseResult = await resp.json();
      setCreateBrowse(data);
      setCreateDir(data.path);
    } catch { /* ignore */ }
  }, []);

  // Browse filesystem (for legacy single-level and tree root)
  const browseDir = useCallback(async (dirPath?: string) => {
    setBrowseLoading(true);
    try {
      const url = dirPath
        ? `${basePath}/api/files/browse?path=${encodeURIComponent(dirPath)}`
        : `${basePath}/api/files/browse`;
      const resp = await fetch(url);
      const data: BrowseResult = await resp.json();
      setBrowseResult(data);
      setTreeCache((prev) => ({ ...prev, [data.path]: data }));
    } catch { /* ignore */ }
    setBrowseLoading(false);
  }, []);

  // Toggle expand/collapse a directory in tree view
  const toggleTreeDir = useCallback(async (dirPath: string) => {
    setTreeExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(dirPath)) { next.delete(dirPath); } else { next.add(dirPath); }
      return next;
    });
    if (!treeCache[dirPath]) {
      try {
        const resp = await fetch(`${basePath}/api/files/browse?path=${encodeURIComponent(dirPath)}`);
        const data: BrowseResult = await resp.json();
        setTreeCache((prev) => ({ ...prev, [dirPath]: data }));
      } catch { /* ignore */ }
    }
  }, [treeCache]);

  // Open a file from disk into the editor
  const openFile = useCallback(async (filePath: string) => {
    try {
      const resp = await fetch(`${basePath}/api/files/open`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: filePath }),
      });
      const doc: DocMeta = await resp.json();
      await refreshDocs();
      openDoc(doc.id);
      if (instanceId) updatePanelLabel(instanceId, `Editor: ${doc.title}`);
      setSidebarTab("docs");
    } catch { /* ignore */ }
  }, [refreshDocs, openDoc]);

  // Save doc back to its source file
  const saveToFile = useCallback(async () => {
    if (!activeDocId) return;
    setSaveStatus("saving");
    try {
      const resp = await fetch(`${basePath}/api/docs/${activeDocId}/save-to-file`, {
        method: "POST",
      });
      if (resp.ok) {
        setSaveStatus("saved");
        setTimeout(() => setSaveStatus("idle"), 2000);
      } else {
        setSaveStatus("error");
        setTimeout(() => setSaveStatus("idle"), 3000);
      }
    } catch {
      setSaveStatus("error");
      setTimeout(() => setSaveStatus("idle"), 3000);
    }
  }, [activeDocId]);

  // Load file browser when Open is clicked
  useEffect(() => {
    if (showOpen && !browseResult) browseDir();
  }, [showOpen, browseResult, browseDir]);

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
  const csvType = isCsvFile(activeDoc);

  // Parse CSV/TSV data for table view
  const csvData = useMemo(() => {
    if (!csvType || !previewText) return null;
    const delimiter = csvType === "tsv" ? "\t" : ",";
    return parseCsv(previewText, delimiter);
  }, [csvType, previewText]);

  // Auto-switch to table view when opening a CSV/TSV file
  const prevDocId = useRef<string | null>(null);
  useEffect(() => {
    if (activeDocId && activeDocId !== prevDocId.current) {
      prevDocId.current = activeDocId;
      if (csvType) setViewMode("table");
      else if (viewMode === "table") setViewMode("edit");
    }
  }, [activeDocId, csvType]);

  return (
    <div className="flex flex-col h-full bg-card" data-testid="shared-editor">
      {/* Header */}
      <div className="px-3 py-2 border-b border-border flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider shrink-0">
            Editor
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
              {activeDoc?.file_path && (
                <button
                  onClick={saveToFile}
                  disabled={saveStatus === "saving"}
                  className={`px-2 py-0.5 text-[10px] rounded transition-colors ${
                    saveStatus === "saved" ? "bg-green-500/20 text-green-400" :
                    saveStatus === "error" ? "bg-red-500/20 text-red-400" :
                    "bg-primary/10 hover:bg-primary/20 text-primary"
                  }`}
                  data-testid="save-file-btn"
                >
                  {saveStatus === "saving" ? "Saving..." :
                   saveStatus === "saved" ? "Saved" :
                   saveStatus === "error" ? "Error" : "Save"}
                </button>
              )}
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
                {csvType && (
                  <button
                    onClick={() => setViewMode("table")}
                    className={`px-2 py-0.5 text-[10px] transition-colors ${
                      viewMode === "table" ? "bg-primary/20 text-primary" : "text-muted-foreground hover:text-foreground"
                    }`}
                    data-testid="table-view-btn"
                  >
                    Table
                  </button>
                )}
              </div>
              <span className={`w-2 h-2 rounded-full ${connected ? "bg-green-500" : "bg-red-500"}`}
                title={connected ? "Connected" : "Disconnected"} />
            </>
          )}
          <button
            onClick={() => setShowToc(!showToc)}
            className={`px-2 py-0.5 text-[10px] rounded transition-colors ${
              showToc ? "bg-primary/20 text-primary" : "bg-primary/10 hover:bg-primary/20 text-primary"
            }`}
            title="Table of contents"
            data-testid="toc-toggle"
          >
            TOC
          </button>
          <div className="relative">
            <button
              onClick={() => setShowOpen(!showOpen)}
              className={`px-2 py-0.5 text-xs rounded transition-colors ${showOpen ? "bg-primary/20 text-primary" : "bg-primary/10 hover:bg-primary/20 text-primary"}`}
              data-testid="open-file-btn"
            >
              Open
            </button>
            {showOpen && (
              <div className="absolute top-full right-0 z-50 mt-1 w-96 max-h-[28rem] bg-card border border-border rounded-md shadow-lg flex flex-col overflow-hidden" data-testid="file-tree-panel">
                {browseResult && (
                  <>
                    <div className="px-2 py-1.5 text-[9px] text-muted-foreground border-b border-border shrink-0 flex items-center gap-1">
                      {browseResult.path.split("/").filter(Boolean).map((seg, i, arr) => {
                        const fullPath = "/" + arr.slice(0, i + 1).join("/");
                        return (
                          <span key={fullPath} className="flex items-center gap-0.5">
                            {i > 0 && <span className="text-muted-foreground/50">/</span>}
                            <span className="cursor-pointer hover:text-foreground transition-colors" onClick={() => browseDir(fullPath)}>{seg}</span>
                          </span>
                        );
                      })}
                    </div>
                    <div className="flex-1 overflow-y-auto">
                      {browseResult.parent && (
                        <div
                          className="flex items-center gap-1 px-2 py-1.5 text-xs cursor-pointer text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
                          onClick={() => browseDir(browseResult.parent!)}
                        >..</div>
                      )}
                      {browseLoading ? (
                        <div className="text-xs text-muted-foreground text-center py-4">Loading...</div>
                      ) : (
                        browseResult.entries.map((entry) => {
                          if (entry.type === "dir") {
                            const isExpanded = treeExpanded.has(entry.path);
                            const subEntries = treeCache[entry.path]?.entries || [];
                            return (
                              <div key={entry.path}>
                                <div
                                  className="flex items-center gap-1 px-2 py-1.5 text-xs cursor-pointer text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
                                  onClick={() => toggleTreeDir(entry.path)}
                                  title={entry.path}
                                >
                                  <span className="text-[10px] shrink-0 w-3">{isExpanded ? "▼" : "▶"}</span>
                                  <span className="truncate flex-1 font-medium">{entry.name}/</span>
                                </div>
                                {isExpanded && subEntries.length > 0 && (
                                  <div className="ml-3 border-l border-border/50">
                                    {subEntries.map((sub) => {
                                      if (sub.type === "dir") {
                                        const subExp = treeExpanded.has(sub.path);
                                        const subSub = treeCache[sub.path]?.entries || [];
                                        return (
                                          <div key={sub.path}>
                                            <div
                                              className="flex items-center gap-1 px-2 py-1 text-xs cursor-pointer text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
                                              onClick={() => toggleTreeDir(sub.path)}
                                              title={sub.path}
                                            >
                                              <span className="text-[10px] shrink-0 w-3">{subExp ? "▼" : "▶"}</span>
                                              <span className="truncate flex-1 font-medium">{sub.name}/</span>
                                            </div>
                                            {subExp && subSub.length > 0 && (
                                              <div className="ml-3 border-l border-border/50">
                                                {subSub.map((leaf) => (
                                                  <div
                                                    key={leaf.path}
                                                    className="flex items-center gap-1 px-2 py-1 text-xs cursor-pointer text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
                                                    onClick={() => { if (leaf.type === "dir") toggleTreeDir(leaf.path); else { openFile(leaf.path); setShowOpen(false); } }}
                                                    title={leaf.path}
                                                  >
                                                    <span className="text-[10px] shrink-0 w-3">{leaf.type === "dir" ? "▶" : ""}</span>
                                                    <span className="truncate flex-1">{leaf.name}{leaf.type === "dir" ? "/" : ""}</span>
                                                    {leaf.size !== undefined && <span className="text-[9px] text-muted-foreground shrink-0">{leaf.size < 1024 ? `${leaf.size}B` : `${(leaf.size / 1024).toFixed(0)}K`}</span>}
                                                  </div>
                                                ))}
                                              </div>
                                            )}
                                          </div>
                                        );
                                      }
                                      return (
                                        <div
                                          key={sub.path}
                                          className="flex items-center gap-1 px-2 py-1 text-xs cursor-pointer text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
                                          onClick={() => { openFile(sub.path); setShowOpen(false); }}
                                          title={sub.path}
                                        >
                                          <span className="text-[10px] shrink-0 w-3"></span>
                                          <span className="truncate flex-1">{sub.name}</span>
                                          {sub.size !== undefined && <span className="text-[9px] text-muted-foreground shrink-0">{sub.size < 1024 ? `${sub.size}B` : `${(sub.size / 1024).toFixed(0)}K`}</span>}
                                        </div>
                                      );
                                    })}
                                  </div>
                                )}
                                {isExpanded && subEntries.length === 0 && (
                                  <div className="ml-3 px-2 py-1 text-[10px] text-muted-foreground/50 italic">empty</div>
                                )}
                              </div>
                            );
                          }
                          return (
                            <div
                              key={entry.path}
                              className="flex items-center gap-1 px-2 py-1.5 text-xs cursor-pointer text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
                              onClick={() => { openFile(entry.path); setShowOpen(false); }}
                              title={entry.path}
                            >
                              <span className="text-[10px] shrink-0 w-3"></span>
                              <span className="truncate flex-1">{entry.name}</span>
                              {entry.size !== undefined && <span className="text-[9px] text-muted-foreground shrink-0">{entry.size < 1024 ? `${entry.size}B` : `${(entry.size / 1024).toFixed(0)}K`}</span>}
                            </div>
                          );
                        })
                      )}
                    </div>
                  </>
                )}
                {!browseResult && !browseLoading && (
                  <div className="text-xs text-muted-foreground text-center py-4">Loading...</div>
                )}
              </div>
            )}
          </div>
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
        <div className="px-3 py-2 border-b border-border space-y-2">
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && createDoc()}
              placeholder="Filename (e.g. notes.md)..."
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
              onClick={() => { setShowCreate(false); setNewTitle(""); setCreateDir(""); setCreateBrowse(null); setShowCreateBrowse(false); }}
              className="px-2 py-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              Cancel
            </button>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={createDir}
              onChange={(e) => setCreateDir(e.target.value)}
              placeholder="Directory (leave empty for in-memory doc)..."
              className="flex-1 text-xs px-2 py-1 bg-background border border-border rounded focus:outline-none focus:border-primary font-mono"
              data-testid="create-doc-dir"
            />
            <button
              onClick={() => { setShowCreateBrowse(!showCreateBrowse); if (!showCreateBrowse && !createBrowse) browseCreateDir(); }}
              className="px-2 py-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              Browse
            </button>
          </div>
          {showCreateBrowse && createBrowse && (
            <div className="max-h-48 overflow-y-auto border border-border rounded bg-background">
              <div className="px-2 py-1 text-[9px] text-muted-foreground border-b border-border truncate" title={createBrowse.path}>
                {createBrowse.path}
              </div>
              {createBrowse.parent && (
                <div
                  className="px-2 py-1 text-xs cursor-pointer text-muted-foreground hover:text-foreground hover:bg-muted/50"
                  onClick={() => browseCreateDir(createBrowse.parent!)}
                >..</div>
              )}
              {createBrowse.entries.filter(e => e.type === "dir").map((entry) => (
                <div
                  key={entry.path}
                  className="px-2 py-1 text-xs cursor-pointer text-muted-foreground hover:text-foreground hover:bg-muted/50"
                  onClick={() => browseCreateDir(entry.path)}
                >
                  {entry.name}/
                </div>
              ))}
              <div
                className="px-2 py-1 text-xs cursor-pointer text-primary hover:bg-primary/10 font-medium"
                onClick={() => { setCreateDir(createBrowse.path); setShowCreateBrowse(false); }}
              >
                Select this directory
              </div>
            </div>
          )}
        </div>
      )}

      {/* Editor / Preview area with optional resizable TOC sidebar */}
      <div className="flex-1 overflow-hidden flex">
        {showToc && (
          <>
            <div
              className="h-full overflow-y-auto bg-card shrink-0"
              data-testid="toc-pane"
              style={{ width: tocWidth }}
            >
              <div className="px-2 py-1.5 text-[10px] font-medium text-muted-foreground uppercase tracking-wider border-b border-border">
                Contents
              </div>
              {headings.length === 0 ? (
                <div className="px-2 py-3 text-[10px] text-muted-foreground">No headings</div>
              ) : (
                headings.map((h, i) => (
                  <button
                    key={`${h.line}-${i}`}
                    onClick={() => scrollToHeading(h.line)}
                    className="block w-full text-left px-2 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors truncate"
                    style={{ paddingLeft: `${(h.level - 1) * 12 + 8}px` }}
                    title={h.text}
                  >
                    {h.text}
                  </button>
                ))
              )}
            </div>
            <div
              className="w-1 shrink-0 bg-border hover:bg-primary/40 transition-colors cursor-col-resize"
              data-testid="toc-resize-handle"
              onMouseDown={startTocResize}
            />
          </>
        )}
        {activeDocId ? (
          <>
            <div
              ref={editorContainerRef}
              className="h-full flex-1 overflow-auto [&_.cm-editor]:h-full [&_.cm-scroller]:!overflow-auto"
              data-testid="shared-editor-content"
              style={{ display: viewMode === "edit" ? undefined : "none" }}
            />
            <div
              ref={previewRef}
              className={`h-full flex-1 overflow-auto p-4 prose prose-sm max-w-none prose-p:my-2 prose-li:my-0 prose-table:text-xs prose-th:text-left prose-td:px-2 prose-td:py-1 prose-th:px-2 prose-th:py-1${theme === "dark" ? " prose-invert" : ""}`}
              data-testid="shared-editor-preview"
              style={{ display: viewMode === "preview" ? undefined : "none" }}
            >
              <Markdown
                remarkPlugins={[remarkGfm, remarkMath]}
                rehypePlugins={[rehypeKatex]}
                urlTransform={(url) => {
                  if (!url) return url;
                  // Pass through absolute URLs
                  if (url.startsWith("http://") || url.startsWith("https://") || url.startsWith("data:")) return url;
                  // Resolve relative/absolute file paths via raw endpoint
                  const docDir = activeDoc?.file_path ? activeDoc.file_path.replace(/\/[^/]+$/, "") : "";
                  let absPath = url;
                  if (url.startsWith("/")) {
                    absPath = url;
                  } else if (docDir) {
                    absPath = `${docDir}/${url}`.replace(/\/\.\//g, "/");
                  }
                  return `${basePath}/api/files/raw?path=${encodeURIComponent(absPath)}`;
                }}
              >{previewText}</Markdown>
            </div>
            {viewMode === "table" && csvData && (
              <div
                className="h-full flex-1 overflow-auto"
                data-testid="csv-table-view"
              >
                <table className="w-full text-xs border-collapse">
                  {csvData.length > 0 && (
                    <thead className="sticky top-0 z-10">
                      <tr>
                        <th className="px-3 py-1.5 text-left text-[10px] font-medium text-muted-foreground uppercase tracking-wider bg-muted border-b border-border w-10">#</th>
                        {csvData[0].map((cell, ci) => (
                          <th
                            key={ci}
                            className="px-3 py-1.5 text-left text-[10px] font-medium text-muted-foreground uppercase tracking-wider bg-muted border-b border-border whitespace-nowrap"
                          >
                            {cell}
                          </th>
                        ))}
                      </tr>
                    </thead>
                  )}
                  <tbody>
                    {csvData.slice(1).map((row, ri) => (
                      <tr key={ri} className="hover:bg-muted/30 transition-colors">
                        <td className="px-3 py-1 text-muted-foreground border-b border-border/50 tabular-nums">{ri + 1}</td>
                        {row.map((cell, ci) => (
                          <td key={ci} className="px-3 py-1 text-foreground border-b border-border/50 whitespace-pre-wrap break-words max-w-xs">
                            {cell}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        ) : (
          <div className="flex items-center justify-center h-full flex-1 text-xs text-muted-foreground">
            Open a file or create a new document
          </div>
        )}
      </div>
    </div>
  );
}
