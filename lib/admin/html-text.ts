/** Minimal HTML→text for the enrichment extractor. Deliberately dependency-
    free: the extraction prompt needs readable text, not DOM fidelity. */

const DROP_BLOCKS = /<(script|style|noscript|svg|head|template|iframe)\b[\s\S]*?<\/\1>/gi;
const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
  "&nbsp;": " ",
  "&mdash;": "—",
  "&ndash;": "–",
};

export function htmlToText(html: string, cap = 40_000): string {
  let s = html.replace(DROP_BLOCKS, " ");
  // Block-level closes become line breaks so headings/paragraphs stay legible.
  s = s.replace(/<\/(p|div|li|h[1-6]|tr|section|article|header|footer|br)>/gi, "\n");
  s = s.replace(/<br\s*\/?\s*>/gi, "\n");
  s = s.replace(/<[^>]+>/g, " ");
  for (const [ent, ch] of Object.entries(ENTITIES)) s = s.replaceAll(ent, ch);
  s = s.replace(/&#(\d+);/g, (_, n) => {
    const code = Number(n);
    return code > 0 && code < 0x10ffff ? String.fromCodePoint(code) : " ";
  });
  s = s.replace(/[ \t\r\f\v]+/g, " ").replace(/\n\s*\n\s*/g, "\n").trim();
  return s.length > cap ? s.slice(0, cap) : s;
}
