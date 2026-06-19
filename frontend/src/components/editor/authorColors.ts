/**
 * Author coloring for the shared editor.
 *
 * Reads Yjs internal Item structures to determine which client wrote
 * each character, then applies colored text per distinct author.
 *
 * - Local client (mentor/Eric) = green text
 * - Each remote client gets a unique color from a palette
 * - Canonical (initial file load) text = default color (no markup)
 *
 * Uses Y.Text._start to walk the internal linked list. This is an
 * internal API but is stable across Yjs versions and widely used
 * by projects like y-prosemirror for author decorations.
 */

import * as Y from "yjs";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
} from "@codemirror/view";
import { type EditorState, Facet, RangeSetBuilder } from "@codemirror/state";

// --- Color palette for distinct authors ---
// Index 0 = local user (green). 1-7 = remote authors (distinct hues).
const AUTHOR_CLASSES = [
  "cm-author-0",  // local/mentor — green
  "cm-author-1",  // blue
  "cm-author-2",  // orange
  "cm-author-3",  // purple
  "cm-author-4",  // cyan
  "cm-author-5",  // rose
  "cm-author-6",  // amber
  "cm-author-7",  // teal
];

const authorMarks = AUTHOR_CLASSES.map((cls) => Decoration.mark({ class: cls }));

// --- Configuration facet ---

interface AuthorColorConfig {
  ytext: Y.Text;
  localClientId: number;
  /** Client IDs to treat as canonical (no coloring). */
  canonicalClients?: Set<number>;
  enabled: boolean;
}

export const authorColorConfig = Facet.define<AuthorColorConfig, AuthorColorConfig>({
  combine(values) {
    return values[values.length - 1] ?? { ytext: null as never, localClientId: 0, enabled: false };
  },
});

// --- Decorations ---

interface YjsItem {
  id: { client: number; clock: number };
  content: { str?: string };
  length: number;
  right: YjsItem | null;
  deleted: boolean;
}

function buildAuthorDecorations(state: EditorState): DecorationSet {
  const config = state.facet(authorColorConfig);
  if (!config.enabled || !config.ytext) return Decoration.none;

  const builder = new RangeSetBuilder<Decoration>();

  // Map remote client IDs to palette indices (1-7)
  const remoteColorMap = new Map<number, number>();
  let nextRemoteIdx = 1;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let item: YjsItem | null = (config.ytext as any)._start;
  let pos = 0;

  while (item) {
    if (!item.deleted && item.length > 0) {
      const clientId = item.id.client;
      const len = item.length;

      // Skip canonical clients (initial file content)
      if (!config.canonicalClients?.has(clientId)) {
        let markIdx: number;
        if (clientId === config.localClientId) {
          markIdx = 0; // local = green
        } else {
          if (!remoteColorMap.has(clientId)) {
            remoteColorMap.set(clientId, nextRemoteIdx);
            nextRemoteIdx = (nextRemoteIdx % 7) + 1;
          }
          markIdx = remoteColorMap.get(clientId)!;
        }

        const from = pos;
        const to = Math.min(pos + len, state.doc.length);
        if (from < to) {
          builder.add(from, to, authorMarks[markIdx]);
        }
      }

      pos += len;
    }
    item = item.right;
  }

  return builder.finish();
}

export const authorColorPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = buildAuthorDecorations(view.state);
    }

    update(update: ViewUpdate) {
      if (update.docChanged || update.startState.facet(authorColorConfig) !== update.state.facet(authorColorConfig)) {
        this.decorations = buildAuthorDecorations(update.state);
      }
    }
  },
  { decorations: (v) => v.decorations },
);

export const authorColorTheme = EditorView.baseTheme({
  // Local user — green
  "&light .cm-author-0": { color: "#16a34a" },
  "&dark .cm-author-0": { color: "#4ade80" },
  // Remote author 1 — blue
  "&light .cm-author-1": { color: "#2563eb" },
  "&dark .cm-author-1": { color: "#60a5fa" },
  // Remote author 2 — orange
  "&light .cm-author-2": { color: "#ea580c" },
  "&dark .cm-author-2": { color: "#fb923c" },
  // Remote author 3 — purple
  "&light .cm-author-3": { color: "#9333ea" },
  "&dark .cm-author-3": { color: "#c084fc" },
  // Remote author 4 — cyan
  "&light .cm-author-4": { color: "#0891b2" },
  "&dark .cm-author-4": { color: "#22d3ee" },
  // Remote author 5 — rose
  "&light .cm-author-5": { color: "#e11d48" },
  "&dark .cm-author-5": { color: "#fb7185" },
  // Remote author 6 — amber
  "&light .cm-author-6": { color: "#d97706" },
  "&dark .cm-author-6": { color: "#fbbf24" },
  // Remote author 7 — teal
  "&light .cm-author-7": { color: "#0d9488" },
  "&dark .cm-author-7": { color: "#2dd4bf" },
});
