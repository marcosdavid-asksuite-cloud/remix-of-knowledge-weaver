// Simple text chunker for ingestion pipeline.
// Target ~800 chars per chunk, split on paragraph / sentence boundaries.

export type Chunk = { content: string; metadata: Record<string, unknown> };

export function chunkText(
  text: string,
  baseMeta: Record<string, unknown> = {},
  target = 800,
  maxLen = 1200,
): Chunk[] {
  const clean = text.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (!clean) return [];
  const paragraphs = clean.split(/\n\n+/);
  const out: Chunk[] = [];
  let buf = "";
  for (const p of paragraphs) {
    const para = p.trim();
    if (!para) continue;
    if ((buf + "\n\n" + para).length > maxLen && buf.length > 0) {
      out.push({ content: buf.trim(), metadata: { ...baseMeta } });
      buf = "";
    }
    if (para.length > maxLen) {
      // Hard split long paragraph by sentences
      const sentences = para.split(/(?<=[.!?])\s+/);
      for (const s of sentences) {
        if ((buf + " " + s).length > target && buf.length > 0) {
          out.push({ content: buf.trim(), metadata: { ...baseMeta } });
          buf = "";
        }
        buf = buf ? buf + " " + s : s;
      }
    } else {
      buf = buf ? buf + "\n\n" + para : para;
      if (buf.length >= target) {
        out.push({ content: buf.trim(), metadata: { ...baseMeta } });
        buf = "";
      }
    }
  }
  if (buf.trim()) out.push({ content: buf.trim(), metadata: { ...baseMeta } });
  return out;
}

// Lightweight HTML → text. Strips scripts/styles/nav/footer/header/aside, then tags.
export function htmlToText(html: string): { title: string | null; text: string } {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? decodeEntities(titleMatch[1]).trim() : null;

  let h = html;
  // Drop non-content blocks
  h = h.replace(/<!--[\s\S]*?-->/g, "");
  h = h.replace(/<script[\s\S]*?<\/script>/gi, "");
  h = h.replace(/<style[\s\S]*?<\/style>/gi, "");
  h = h.replace(/<noscript[\s\S]*?<\/noscript>/gi, "");
  h = h.replace(/<nav[\s\S]*?<\/nav>/gi, "");
  h = h.replace(/<footer[\s\S]*?<\/footer>/gi, "");
  h = h.replace(/<header[\s\S]*?<\/header>/gi, "");
  h = h.replace(/<aside[\s\S]*?<\/aside>/gi, "");
  h = h.replace(/<form[\s\S]*?<\/form>/gi, "");
  // Try to extract <main> or <article> if present
  const main = h.match(/<(main|article)[^>]*>([\s\S]*?)<\/\1>/i);
  if (main) h = main[2];

  // Block-level → newlines
  h = h.replace(/<(\/)?(p|div|section|li|h[1-6]|br|tr)[^>]*>/gi, "\n");
  // Strip remaining tags
  h = h.replace(/<[^>]+>/g, " ");
  h = decodeEntities(h);
  h = h.replace(/[ \t]+/g, " ").replace(/\n[ \t]+/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  return { title, text: h };
}

function decodeEntities(s: string) {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)));
}
