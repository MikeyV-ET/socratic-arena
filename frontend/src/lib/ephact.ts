/** Parse <ephact> tags from agent speech (TUI-compatible). Tags inside fenced code are ignored. */

export type EphactType = "table" | "list" | "code" | "paragraph" | string;

export interface ParsedEphact {
  type: EphactType;
  title: string;
  content: string;
}

const OPEN_RE = /<ephact\b([^>]*)>([\s\S]*?)<\/ephact>/gi;

function stripFencedCode(s: string): { text: string; holes: string[] } {
  const holes: string[] = [];
  const text = s.replace(/```[\s\S]*?```/g, (m) => {
    holes.push(m);
    return `\0CODE${holes.length - 1}\0`;
  });
  return { text, holes };
}

function restoreFenced(s: string, holes: string[]): string {
  return s.replace(/\0CODE(\d+)\0/g, (_, i) => holes[Number(i)] ?? "");
}

function parseAttrs(attr: string): { type: string; title: string } {
  const typeM = attr.match(/\btype\s*=\s*["']([^"']+)["']/i);
  const titleM = attr.match(/\btitle\s*=\s*["']([^"']+)["']/i);
  const type = (typeM?.[1] || "paragraph").trim();
  const title = (titleM?.[1] || type.charAt(0).toUpperCase() + type.slice(1)).trim();
  return { type, title };
}

export function extractEphacts(raw: string): ParsedEphact[] {
  if (!raw || !raw.includes("<ephact")) return [];
  const { text, holes } = stripFencedCode(raw);
  const out: ParsedEphact[] = [];
  let m: RegExpExecArray | null;
  const re = new RegExp(OPEN_RE.source, "gi");
  while ((m = re.exec(text)) !== null) {
    const { type, title } = parseAttrs(m[1] || "");
    const content = restoreFenced((m[2] || "").trim(), holes);
    if (content) out.push({ type, title, content });
  }
  return out;
}

export type ControlKind = "continue" | "context" | "system" | "control" | "interjection";

export interface ControlInfo {
  kind: ControlKind;
  label: string;
  /** Clean body without wrapper chrome */
  summary: string;
  id?: string;
}

/** Soft classify control / ops turns that currently render as "Eric". */
export function classifyControlTurn(content: string): ControlInfo | null {
  let t = (content || "").trim();
  if (!t) return null;
  // Strip trailing context footer for classification
  t = t.replace(/\s*\[Context left[^\]]*\]\s*/gi, "").trim();

  // Agent registered control with asdaaas (delay, etc.)
  if (/^\[aa\.control\]/i.test(t)) {
    const body = t.replace(/^\[aa\.control\]\s*/i, "").trim();
    const act = body.split(":")[0]?.trim() || "control";
    return {
      kind: act === "delay" ? "control" : "control",
      label: act.length < 16 ? act : "control",
      summary: body,
    };
  }

  const contM = t.match(/^\[continue\s*\(([^)]*)\)\]\s*/i)
    || t.match(/^\[continue\b[^\]]*\]\s*/i);
  if (contM || (/your turn ended/i.test(t) && /continue/i.test(t))) {
    const meta = contM?.[1] || "";
    const idM = meta.match(/\bid\s*=\s*([^\s,]+)/i) || t.match(/\bcont_[a-z0-9_]+/i);
    const body = t
      .replace(/^\[continue[^\]]*\]\s*/i, "")
      .replace(/^Your turn ended\.\s*/i, "")
      .trim();
    return {
      kind: "continue",
      label: "continue",
      summary: body || "turn ended — continue / delay / stand by",
      id: idM ? (idM[1] || idM[0]) : undefined,
    };
  }
  if (/^\[interjection\b/i.test(t)) {
    return {
      kind: "interjection",
      label: "interjection",
      summary: t.replace(/^\[interjection[^\]]*\]\s*/i, "").trim() || t,
    };
  }
  if (/^\[system:/i.test(t) || /^\[system\b/i.test(t)) {
    return {
      kind: "system",
      label: "system",
      summary: t.replace(/^\[system[^\]]*\]\s*/i, "").trim() || t,
    };
  }
  if (/^\[(?:delay|ack|doorbell|command)\b/i.test(t)) {
    return {
      kind: "control",
      label: "control",
      summary: t.replace(/^\[[^\]]+\]\s*/i, "").trim() || t,
    };
  }
  if (
    (t.length < 500 && /compaction complete|just compacted/i.test(t)) ||
    /^\[compaction\b/i.test(t)
  ) {
    return {
      kind: "context",
      label: "context",
      summary: t.replace(/^\[compaction[^\]]*\]\s*/i, "").trim() || t,
    };
  }
  return null;
}

export function isControlTurnContent(content: string): boolean {
  return classifyControlTurn(content) != null;
}
