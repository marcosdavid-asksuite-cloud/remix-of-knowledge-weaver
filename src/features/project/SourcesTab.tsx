import { useQuery } from "@tanstack/react-query";
import { useRef, useState } from "react";
import Papa from "papaparse";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { importPdf, importUrl, importFastContent } from "@/lib/importers.functions";

type QueueItem = {
  id: string;
  label: string;
  kind: "csv" | "pdf" | "url" | "fast";
  status: "queued" | "processing" | "done" | "error";
  message?: string;
  chunks?: number;
  avg?: number;
  duration?: number;
};

type ImportResult = {
  source_id: string;
  filename: string;
  chunks: number;
  avg_chunk_size: number;
  duration_ms: number;
};

export function SourcesTab({ projectId }: { projectId: string }) {
  const [queue, setQueue] = useState<QueueItem[]>([]);

  const { data: sources, refetch } = useQuery({
    queryKey: ["raw_sources", projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("raw_sources").select("id, filename, type, uploaded_at, raw_chunks(count)")
        .eq("project_id", projectId).order("uploaded_at", { ascending: false });
      if (error) throw error;
      return data as Array<{ id: string; filename: string | null; type: string; uploaded_at: string; raw_chunks: Array<{ count: number }> }>;
    },
  });

  function updateItem(id: string, patch: Partial<QueueItem>) {
    setQueue((q) => q.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  }

  async function deleteSource(id: string) {
    if (!confirm("Apagar esta fonte e todos os chunks?")) return;
    const { error } = await supabase.from("raw_sources").delete().eq("id", id);
    if (error) toast.error(error.message);
    else { toast.success("Removido"); refetch(); }
  }

  const lastBatch = queue.filter((q) => q.status === "done");
  const totalChunks = lastBatch.reduce((s, i) => s + (i.chunks ?? 0), 0);
  const avgSize = lastBatch.length
    ? Math.round(lastBatch.reduce((s, i) => s + (i.avg ?? 0) * (i.chunks ?? 0), 0) / Math.max(totalChunks, 1))
    : 0;
  const totalDuration = lastBatch.reduce((s, i) => s + (i.duration ?? 0), 0);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Importar Conteúdo</CardTitle>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="csv">
            <TabsList>
              <TabsTrigger value="csv">CSV</TabsTrigger>
              <TabsTrigger value="pdf">PDF</TabsTrigger>
              <TabsTrigger value="url">URL</TabsTrigger>
              <TabsTrigger value="fast">Fast Content</TabsTrigger>
            </TabsList>
            <TabsContent value="csv" className="mt-4">
              <CsvImporter projectId={projectId} queueAdd={(q) => setQueue((s) => [...s, q])} updateItem={updateItem} onDone={() => refetch()} />
            </TabsContent>
            <TabsContent value="pdf" className="mt-4">
              <PdfImporter projectId={projectId} queueAdd={(q) => setQueue((s) => [...s, q])} updateItem={updateItem} onDone={() => refetch()} />
            </TabsContent>
            <TabsContent value="url" className="mt-4">
              <UrlImporter projectId={projectId} queueAdd={(q) => setQueue((s) => [...s, q])} updateItem={updateItem} onDone={() => refetch()} />
            </TabsContent>
            <TabsContent value="fast" className="mt-4">
              <FastContentImporter projectId={projectId} queueAdd={(q) => setQueue((s) => [...s, q])} updateItem={updateItem} onDone={() => refetch()} />
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      {queue.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base">Fila de Importação</CardTitle></CardHeader>
          <CardContent>
            <div className="divide-y">
              {queue.map((it) => (
                <div key={it.id} className="flex items-center justify-between py-2 text-sm">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="uppercase text-[10px]">{it.kind}</Badge>
                    <span className="truncate max-w-[400px]">{it.label}</span>
                  </div>
                  <div className="flex items-center gap-3 text-xs">
                    {it.status === "done" && (
                      <span className="text-muted-foreground">{it.chunks} chunks · {it.avg}c · {it.duration}ms</span>
                    )}
                    {it.message && it.status === "error" && (
                      <span className="text-destructive max-w-[300px] truncate" title={it.message}>{it.message}</span>
                    )}
                    <StatusBadge status={it.status} />
                  </div>
                </div>
              ))}
            </div>
            {lastBatch.length > 0 && (
              <div className="mt-4 grid grid-cols-4 gap-2 rounded-lg border bg-muted/30 p-3 text-xs">
                <Metric label="Fontes" value={lastBatch.length} />
                <Metric label="Chunks gerados" value={totalChunks} />
                <Metric label="Tamanho médio" value={`${avgSize}c`} />
                <Metric label="Tempo total" value={`${totalDuration}ms`} />
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle className="text-base">Fontes</CardTitle></CardHeader>
        <CardContent>
          {!sources || sources.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhuma fonte importada.</p>
          ) : (
            <div className="divide-y">
              {sources.map((s) => (
                <div key={s.id} className="flex items-center justify-between py-3">
                  <div>
                    <div className="text-sm font-medium">{s.filename ?? s.id}</div>
                    <div className="text-xs text-muted-foreground">
                      <Badge variant="outline" className="mr-2 uppercase text-[10px]">{s.type}</Badge>
                      {new Date(s.uploaded_at).toLocaleString()} ·{" "}
                      <Badge variant="secondary">{s.raw_chunks?.[0]?.count ?? 0} chunks</Badge>
                    </div>
                  </div>
                  <Button size="sm" variant="ghost" onClick={() => deleteSource(s.id)}>Remover</Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function StatusBadge({ status }: { status: QueueItem["status"] }) {
  const map: Record<QueueItem["status"], { v: "default" | "secondary" | "outline" | "destructive"; l: string }> = {
    queued: { v: "outline", l: "Aguardando" },
    processing: { v: "secondary", l: "Processando..." },
    done: { v: "default", l: "Concluído" },
    error: { v: "destructive", l: "Erro" },
  };
  const c = map[status];
  return <Badge variant={c.v}>{c.l}</Badge>;
}

function Metric({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] uppercase text-muted-foreground">{label}</div>
      <div className="text-sm font-medium">{value}</div>
    </div>
  );
}

// ------------ Importer components ------------

type ImporterProps = {
  projectId: string;
  queueAdd: (q: QueueItem) => void;
  updateItem: (id: string, patch: Partial<QueueItem>) => void;
  onDone: () => void;
};

function CsvImporter({ projectId, queueAdd, updateItem, onDone }: ImporterProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  async function handleUpload(file: File) {
    const id = crypto.randomUUID();
    queueAdd({ id, label: file.name, kind: "csv", status: "processing" });
    const started = Date.now();
    setUploading(true);
    try {
      const text = await file.text();
      const parsed = Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: true });
      const rows = parsed.data;
      if (rows.length === 0) throw new Error("CSV vazio");
      const headers = parsed.meta.fields ?? [];
      const contentCol = headers.find((h) => /^(content|text|chunk|body)$/i.test(h));

      const { data: source, error: sErr } = await supabase
        .from("raw_sources")
        .insert({ project_id: projectId, type: "csv", filename: file.name })
        .select("id").single();
      if (sErr || !source) throw new Error(sErr?.message ?? "Falha");

      const chunks = rows.map((row, i) => ({
        raw_source_id: source.id,
        content: contentCol ? (row[contentCol] ?? "") : headers.map((h) => `${h}: ${row[h] ?? ""}`).join("\n"),
        metadata: row as unknown as Record<string, unknown>,
        position: i,
      })).filter((c) => c.content.trim().length > 0);

      const batchSize = 500;
      for (let i = 0; i < chunks.length; i += batchSize) {
        const { error: cErr } = await supabase.from("raw_chunks").insert(chunks.slice(i, i + batchSize) as never);
        if (cErr) throw cErr;
      }
      const totalLen = chunks.reduce((s, c) => s + c.content.length, 0);
      updateItem(id, {
        status: "done", chunks: chunks.length,
        avg: Math.round(totalLen / Math.max(chunks.length, 1)),
        duration: Date.now() - started,
      });
      onDone();
    } catch (e) {
      updateItem(id, { status: "error", message: e instanceof Error ? e.message : String(e) });
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        Coluna <code>content</code>/<code>text</code>/<code>chunk</code> vira o conteúdo; caso contrário concatena todas.
      </p>
      <input ref={fileRef} type="file" accept=".csv" disabled={uploading}
        onChange={(e) => { const f = e.target.files?.[0]; if (f) handleUpload(f); }}
        className="block text-sm" />
    </div>
  );
}

function PdfImporter({ projectId, queueAdd, updateItem, onDone }: ImporterProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const importPdfFn = useServerFn(importPdf);

  async function handleFiles(files: FileList) {
    setBusy(true);
    const arr = Array.from(files);
    // Queue them all first
    const ids = arr.map((f) => {
      const id = crypto.randomUUID();
      queueAdd({ id, label: f.name, kind: "pdf", status: "queued" });
      return { id, file: f };
    });
    for (const { id, file } of ids) {
      updateItem(id, { status: "processing" });
      try {
        const buf = await file.arrayBuffer();
        const base64 = btoa(String.fromCharCode(...new Uint8Array(buf)));
        const res = (await importPdfFn({ data: { projectId, filename: file.name, base64 } })) as ImportResult;
        updateItem(id, { status: "done", chunks: res.chunks, avg: res.avg_chunk_size, duration: res.duration_ms });
      } catch (e) {
        updateItem(id, { status: "error", message: e instanceof Error ? e.message : String(e) });
      }
    }
    setBusy(false);
    if (fileRef.current) fileRef.current.value = "";
    onDone();
  }

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        PDFs com texto extraível. OCR não é suportado — PDFs escaneados sem texto serão rejeitados.
      </p>
      <input ref={fileRef} type="file" accept="application/pdf" multiple disabled={busy}
        onChange={(e) => { if (e.target.files?.length) handleFiles(e.target.files); }}
        className="block text-sm" />
    </div>
  );
}

function UrlImporter({ projectId, queueAdd, updateItem, onDone }: ImporterProps) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const importUrlFn = useServerFn(importUrl);

  async function run() {
    const urls = text.split(/\s+/).map((u) => u.trim()).filter((u) => /^https?:\/\//i.test(u));
    if (urls.length === 0) { toast.error("Nenhuma URL válida."); return; }
    setBusy(true);
    const items = urls.map((url) => {
      const id = crypto.randomUUID();
      queueAdd({ id, label: url, kind: "url", status: "queued" });
      return { id, url };
    });
    for (const { id, url } of items) {
      updateItem(id, { status: "processing" });
      try {
        const res = (await importUrlFn({ data: { projectId, url } })) as ImportResult;
        updateItem(id, { status: "done", chunks: res.chunks, avg: res.avg_chunk_size, duration: res.duration_ms });
      } catch (e) {
        updateItem(id, { status: "error", message: e instanceof Error ? e.message : String(e) });
      }
    }
    setBusy(false); setText(""); onDone();
  }

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">Uma URL por linha. HTML é limpo automaticamente (header/footer/nav/scripts removidos).</p>
      <Textarea rows={4} placeholder="https://hotel.com/page1&#10;https://hotel.com/page2"
        value={text} onChange={(e) => setText(e.target.value)} />
      <Button onClick={run} disabled={busy}>{busy ? "Importando..." : "Importar URLs"}</Button>
    </div>
  );
}

function FastContentImporter({ projectId, queueAdd, updateItem, onDone }: ImporterProps) {
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("");
  const [content, setContent] = useState("");
  const [busy, setBusy] = useState(false);
  const fn = useServerFn(importFastContent);

  async function run() {
    if (!title.trim() || !content.trim()) { toast.error("Título e texto são obrigatórios."); return; }
    const id = crypto.randomUUID();
    queueAdd({ id, label: title, kind: "fast", status: "processing" });
    setBusy(true);
    try {
      const res = (await fn({ data: { projectId, title, text: content, category: category || undefined } })) as ImportResult;
      updateItem(id, { status: "done", chunks: res.chunks, avg: res.avg_chunk_size, duration: res.duration_ms });
      setTitle(""); setCategory(""); setContent("");
      onDone();
    } catch (e) {
      updateItem(id, { status: "error", message: e instanceof Error ? e.message : String(e) });
    } finally { setBusy(false); }
  }

  return (
    <div className="space-y-2">
      <Input placeholder="Título" value={title} onChange={(e) => setTitle(e.target.value)} />
      <Input placeholder="Categoria (opcional)" value={category} onChange={(e) => setCategory(e.target.value)} />
      <Textarea rows={6} placeholder="Cole aqui o texto livre..."
        value={content} onChange={(e) => setContent(e.target.value)} />
      <Button onClick={run} disabled={busy}>{busy ? "Salvando..." : "Adicionar Conteúdo"}</Button>
    </div>
  );
}
