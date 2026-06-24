/**
 * Soft WYSIWYG markdown rendering for CodeMirror.
 *
 * Walks the Lezer markdown syntax tree and applies decorations:
 * - Mark decorations for visual styling (bold, italic, headings, etc.)
 * - Replace decorations to hide syntax markers (**, *, #, ~~, `)
 *
 * The cursor line is excluded from syntax hiding so the user can edit
 * the raw markdown. Moving the cursor away re-renders the line.
 */

import { syntaxTree } from "@codemirror/language";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
} from "@codemirror/view";
import { type EditorState, RangeSetBuilder } from "@codemirror/state";

// --- Decoration styles ---

const boldMark = Decoration.mark({ class: "cm-md-bold" });
const italicMark = Decoration.mark({ class: "cm-md-italic" });
const strikeMark = Decoration.mark({ class: "cm-md-strike" });
const codeMark = Decoration.mark({ class: "cm-md-code" });
const h1Mark = Decoration.mark({ class: "cm-md-h1" });
const h2Mark = Decoration.mark({ class: "cm-md-h2" });
const h3Mark = Decoration.mark({ class: "cm-md-h3" });
const h4Mark = Decoration.mark({ class: "cm-md-h4" });
const quoteMark = Decoration.mark({ class: "cm-md-quote" });
const tableHeaderLine = Decoration.line({ class: "cm-md-table-header" });
const tableDelimLine = Decoration.line({ class: "cm-md-table-delim" });
const tableRowEvenLine = Decoration.line({ class: "cm-md-table-row-even" });
const tableRowOddLine = Decoration.line({ class: "cm-md-table-row-odd" });
const tablePipeMark = Decoration.mark({ class: "cm-md-table-pipe" });
const hiddenReplace = Decoration.replace({});

// Map heading level to decoration
const headingMarks: Record<string, typeof h1Mark> = {
  ATXHeading1: h1Mark,
  ATXHeading2: h2Mark,
  ATXHeading3: h3Mark,
  ATXHeading4: h4Mark,
  ATXHeading5: h4Mark,
  ATXHeading6: h4Mark,
};

function buildDecorations(state: EditorState): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const tree = syntaxTree(state);

  // Find cursor line(s) to exclude from hiding
  const cursorLines = new Set<number>();
  for (const range of state.selection.ranges) {
    const startLine = state.doc.lineAt(range.from).number;
    const endLine = state.doc.lineAt(range.to).number;
    for (let l = startLine; l <= endLine; l++) {
      cursorLines.add(l);
    }
  }

  // Collect decorations in an array first, then sort by position
  const decos: { from: number; to: number; deco: Decoration }[] = [];

  tree.iterate({
    enter(node) {
      const lineNum = state.doc.lineAt(node.from).number;
      const onCursorLine = cursorLines.has(lineNum);

      // Headings: style the whole heading, hide the # marks
      if (node.name in headingMarks) {
        decos.push({ from: node.from, to: node.to, deco: headingMarks[node.name] });
      }

      // Hide heading marks (# ## ###) when not on cursor line
      if (node.name === "HeaderMark" && !onCursorLine) {
        // Hide the # marks and the trailing space
        let hideEnd = node.to;
        if (hideEnd < state.doc.length) {
          const next = state.doc.sliceString(hideEnd, hideEnd + 1);
          if (next === " ") hideEnd++;
        }
        decos.push({ from: node.from, to: hideEnd, deco: hiddenReplace });
      }

      // Bold
      if (node.name === "StrongEmphasis") {
        decos.push({ from: node.from, to: node.to, deco: boldMark });
      }

      // Italic
      if (node.name === "Emphasis") {
        decos.push({ from: node.from, to: node.to, deco: italicMark });
      }

      // Strikethrough
      if (node.name === "Strikethrough") {
        decos.push({ from: node.from, to: node.to, deco: strikeMark });
      }

      // Hide emphasis markers (*, **, ~~) when not on cursor line
      if (node.name === "EmphasisMark" && !onCursorLine) {
        decos.push({ from: node.from, to: node.to, deco: hiddenReplace });
      }
      if (node.name === "StrikethroughMark" && !onCursorLine) {
        decos.push({ from: node.from, to: node.to, deco: hiddenReplace });
      }

      // Inline code
      if (node.name === "InlineCode") {
        decos.push({ from: node.from, to: node.to, deco: codeMark });
      }
      if (node.name === "CodeMark" && !onCursorLine) {
        decos.push({ from: node.from, to: node.to, deco: hiddenReplace });
      }

      // Blockquote content styling
      if (node.name === "Blockquote") {
        decos.push({ from: node.from, to: node.to, deco: quoteMark });
      }
      // Tables: style header, delimiter, and body rows; highlight pipes
      if (node.name === "TableHeader") {
        // Header may span one line; apply line decoration to each line
        const startLine = state.doc.lineAt(node.from).number;
        const endLine = state.doc.lineAt(node.to).number;
        for (let l = startLine; l <= endLine; l++) {
          decos.push({ from: state.doc.line(l).from, to: state.doc.line(l).from, deco: tableHeaderLine });
        }
      }
      if (node.name === "TableDelimiter") {
        decos.push({ from: state.doc.lineAt(node.from).from, to: state.doc.lineAt(node.from).from, deco: tableDelimLine });
      }
      if (node.name === "TableRow") {
        const rowLine = state.doc.lineAt(node.from).number;
        // Alternate even/odd based on line number within table
        const lineDeco = rowLine % 2 === 0 ? tableRowEvenLine : tableRowOddLine;
        decos.push({ from: state.doc.line(rowLine).from, to: state.doc.line(rowLine).from, deco: lineDeco });
      }
      // Style pipe characters in tables as subtle dividers
      if (node.name === "Table") {
        const text = state.doc.sliceString(node.from, node.to);
        for (let i = 0; i < text.length; i++) {
          if (text[i] === "|") {
            const pos = node.from + i;
            decos.push({ from: pos, to: pos + 1, deco: tablePipeMark });
          }
        }
      }

      // Hide > mark when not on cursor line
      if (node.name === "QuoteMark" && !onCursorLine) {
        let hideEnd = node.to;
        if (hideEnd < state.doc.length) {
          const next = state.doc.sliceString(hideEnd, hideEnd + 1);
          if (next === " ") hideEnd++;
        }
        decos.push({ from: node.from, to: hideEnd, deco: hiddenReplace });
      }
    },
  });

  // Sort by from position (required by RangeSetBuilder)
  decos.sort((a, b) => a.from - b.from || a.to - b.to);

  // Filter out overlapping replace decorations that would conflict
  for (const d of decos) {
    if (d.from < d.to) {
      builder.add(d.from, d.to, d.deco);
    }
  }

  return builder.finish();
}

export const wysiwygPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = buildDecorations(view.state);
    }

    update(update: ViewUpdate) {
      if (
        update.docChanged ||
        update.viewportChanged ||
        update.selectionSet
      ) {
        this.decorations = buildDecorations(update.state);
      }
    }
  },
  { decorations: (v) => v.decorations },
);

export const wysiwygTheme = EditorView.baseTheme({
  ".cm-md-bold": { fontWeight: "bold" },
  ".cm-md-italic": { fontStyle: "italic" },
  ".cm-md-strike": { textDecoration: "line-through", opacity: "0.7" },
  ".cm-md-code": {
    fontFamily: "monospace",
    backgroundColor: "rgba(128, 128, 128, 0.15)",
    borderRadius: "3px",
    padding: "1px 3px",
  },
  ".cm-md-h1": { fontSize: "1.6em", fontWeight: "bold", lineHeight: "1.3" },
  ".cm-md-h2": { fontSize: "1.35em", fontWeight: "bold", lineHeight: "1.3" },
  ".cm-md-h3": { fontSize: "1.15em", fontWeight: "bold", lineHeight: "1.3" },
  ".cm-md-h4": { fontSize: "1.05em", fontWeight: "bold", lineHeight: "1.3" },
  ".cm-md-quote": {
    borderLeft: "3px solid rgba(128, 128, 128, 0.4)",
    paddingLeft: "8px",
    fontStyle: "italic",
    opacity: "0.85",
  },
  ".cm-md-table-header": {
    fontFamily: "monospace",
    fontWeight: "bold",
    backgroundColor: "rgba(100, 140, 200, 0.15)",
    borderBottom: "2px solid rgba(100, 140, 200, 0.3)",
  },
  ".cm-md-table-delim": {
    fontFamily: "monospace",
    opacity: "0.4",
    fontSize: "0.85em",
  },
  ".cm-md-table-row-even": {
    fontFamily: "monospace",
    backgroundColor: "rgba(128, 128, 128, 0.06)",
  },
  ".cm-md-table-row-odd": {
    fontFamily: "monospace",
    backgroundColor: "rgba(128, 128, 128, 0.12)",
  },
  ".cm-md-table-pipe": {
    color: "rgba(100, 140, 200, 0.5)",
    fontWeight: "bold",
  },
});
