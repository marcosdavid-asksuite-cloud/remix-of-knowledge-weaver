import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { chunkText, htmlToText } from "./chunker";

function getSb() {
  return createClient<Database>(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_PUBLISHABLE_KEY!,
    { auth: { storage: undefined, persistSession: false, autoRefreshToken: false } },
  );
}

type ImportSummary = {
  source_id: string;
  filename: string;
  chunks: number;
  avg_chunk_size: number;
  duration_ms: number;
};

async function insertChunks(
  sb: ReturnType<typeof getSb>,
  sourceId: string,
  chunks: { content: string; metadata: Record<string, unknown> }[],
) {
  const rows = chunks.map((c, i) => ({
    raw_source_id: sourceId,
    content: c.content,
    metadata: c.metadata as never,
    position: i,
  }));
  const batchSize = 500;
  for (let i = 0; i < rows.length; i += batchSize) {
    const { error } = await sb.from("raw_chunks").insert(rows.slice(i, i + batchSize) as never);
    if (error) throw new Error(error.message);
  }
}

// ---------------- PDF ----------------
export const importPdf = createServerFn({ method: "POST" })
  .inputValidator((input: { projectId: string; filename: string; base64: string }) => input)
  .handler(async ({ data }): Promise<ImportSummary> => {
    const started = Date.now();
    const sb = getSb();

    // Decode base64 → Uint8Array
    const bin = atob(data.base64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);

    const { extractText, getDocumentProxy } = await import("unpdf");
    const pdf = await getDocumentProxy(bytes);
    const { text: pages } = await extractText(pdf, { mergePages: false });

    const chunks: { content: string; metadata: Record<string, unknown> }[] = [];
    let position = 0;
    pages.forEach((pageText, idx) => {
      const pageNum = idx + 1;
      const parts = chunkText(pageText, { page_number: pageNum, filename: data.filename });
      for (const c of parts) {
        chunks.push({ content: c.content, metadata: { ...c.metadata, position } });
        position++;
      }
    });

    if (chunks.length === 0) {
      throw new Error("PDF não contém texto extraível. Talvez seja um PDF escaneado (OCR não suportado).");
    }

    const { data: source, error } = await sb
      .from("raw_sources")
      .insert({ project_id: data.projectId, type: "pdf", filename: data.filename })
      .select("id").single();
    if (error || !source) throw new Error(error?.message ?? "Falha ao criar source");

    await insertChunks(sb, source.id, chunks);

    const totalLen = chunks.reduce((s, c) => s + c.content.length, 0);
    return {
      source_id: source.id,
      filename: data.filename,
      chunks: chunks.length,
      avg_chunk_size: Math.round(totalLen / chunks.length),
      duration_ms: Date.now() - started,
    };
  });

// ---------------- URL ----------------
export const importUrl = createServerFn({ method: "POST" })
  .inputValidator((input: { projectId: string; url: string }) => input)
  .handler(async ({ data }): Promise<ImportSummary> => {
    const started = Date.now();
    const sb = getSb();

    let html: string;
    try {
      const res = await fetch(data.url, {
        headers: { "User-Agent": "Mozilla/5.0 HybridKB-Lab/1.0" },
        redirect: "follow",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      html = await res.text();
    } catch (e) {
      throw new Error(`Falha ao baixar URL: ${e instanceof Error ? e.message : String(e)}`);
    }

    const { title, text } = htmlToText(html);
    if (!text.trim()) throw new Error("Nenhum conteúdo de texto encontrado na página.");

    const chunks = chunkText(text, { url: data.url, title, imported_at: new Date().toISOString() });
    if (chunks.length === 0) throw new Error("Conteúdo muito curto para gerar chunks.");

    const filename = title ?? data.url;
    const { data: source, error } = await sb
      .from("raw_sources")
      .insert({ project_id: data.projectId, type: "url", filename })
      .select("id").single();
    if (error || !source) throw new Error(error?.message ?? "Falha ao criar source");

    await insertChunks(sb, source.id, chunks);

    const totalLen = chunks.reduce((s, c) => s + c.content.length, 0);
    return {
      source_id: source.id,
      filename,
      chunks: chunks.length,
      avg_chunk_size: Math.round(totalLen / chunks.length),
      duration_ms: Date.now() - started,
    };
  });

// ---------------- Fast Content ----------------
export const importFastContent = createServerFn({ method: "POST" })
  .inputValidator((input: { projectId: string; title: string; text: string; category?: string }) => input)
  .handler(async ({ data }): Promise<ImportSummary> => {
    const started = Date.now();
    const sb = getSb();

    if (!data.text.trim()) throw new Error("Texto vazio.");

    const chunks = chunkText(data.text, {
      title: data.title,
      category: data.category ?? null,
      origin: "fast_content",
    });
    if (chunks.length === 0) throw new Error("Texto muito curto.");

    const { data: source, error } = await sb
      .from("raw_sources")
      .insert({ project_id: data.projectId, type: "fast_content", filename: data.title })
      .select("id").single();
    if (error || !source) throw new Error(error?.message ?? "Falha ao criar source");

    await insertChunks(sb, source.id, chunks);

    const totalLen = chunks.reduce((s, c) => s + c.content.length, 0);
    return {
      source_id: source.id,
      filename: data.title,
      chunks: chunks.length,
      avg_chunk_size: Math.round(totalLen / chunks.length),
      duration_ms: Date.now() - started,
    };
  });
