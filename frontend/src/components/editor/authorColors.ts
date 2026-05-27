/**
 * Author coloring for the shared editor.
 *
 * Reads Yjs internal Item structures to determine which client wrote
 * each character, then applies colored text:
 * - Local client (mentor) = green text
 * - Remote clients (agent) = blue text
 * - Canonical (pre-tracking) text = default color
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

const mentorMark = Decoration.mark({ class: "cm-author-mentor" });
const agentMark = Decoration.mark({ class: "cm-author-agent" });

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

  // Walk the Y.Text internal linked list
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let item: YjsItem | null = (config.ytext as any)._start;
  let pos = 0;

  while (item) {
    if (!item.deleted && item.length > 0) {
      const clientId = item.id.client;
      const len = item.length;

      // Skip canonical clients
      if (!config.canonicalClients?.has(clientId)) {
        const isLocal = clientId === config.localClientId;
        const mark = isLocal ? mentorMark : agentMark;

        // Clamp to document length
        const from = pos;
        const to = Math.min(pos + len, state.doc.length);
        if (from < to) {
          builder.add(from, to, mark);
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
  "&light .cm-author-mentor": { color: "#16a34a" },
  "&light .cm-author-agent": { color: "#2563eb" },
  "&dark .cm-author-mentor": { color: "#4ade80" },
  "&dark .cm-author-agent": { color: "#60a5fa" },
});
