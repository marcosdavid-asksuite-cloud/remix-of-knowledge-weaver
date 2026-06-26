import { useQuery, useQueryClient } from "@tanstack/react-query";
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
import { runExtraction } from "@/lib/ai.functions";
import { consolidateKnowledge } from "@/lib/consolidation.functions";
import { Sparkles, Trash2 } from "lucide-react";

type ImportResult = {
  source_id: string;
  filename: string;
  chunks: number;
  avg_chunk_size: number;
  duration_ms: number;
};

export function UploadTab({ projectId }: { projectId: string }) {
  const qc = useQueryClient();
  const [processing, setProcessing] = useState(false);
  const [processStep, setProcessStep] = useState<string>("");

  const { data: sources, refetch } = useQuery({
    queryKey: ["raw_sources", projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("raw_sources")
        .select("id, filename, type, uploaded_at, raw_chunks(count)")
        .eq("project_id", projectId)
        .order("uploaded_at", { ascending: false });
      if (error) throw error;
      return data as Array<{
        id: string;
        filename: string | null;
        type: string;
        uploaded_at: string;
        raw_chunks: Array<{ count: number }>;
      }>;
    },
  });

  const totalChunks = (sources ?? []).reduce((s, r) => s + (r.raw_chunks?.[0]?.count ?? 0), 0);

  const runExtractionFn = useServerFn(runExtraction);
  const consolidateFn = useServerFn(consolidateKnowledge);

  async function processKnowledge() {
    if (!sources || sources.length === 0) {
      toast.error("Importe pelo menos uma fonte primeiro.");
      return;
    }
    setProcessing(true);
    try {
      setProcessStep("Ativando tópicos…");
      // Auto-activate all topic_definitions for this project (idempotent).
      const { data: defs } = await supabase
        .from("topic_definitions").select("id");
      const { data: existing } = await supabase
        .from("topics").select("topic_definition_id").eq("project_id", projectId);
      const have = new Set((existing ?? []).map((e) => e.topic_definition_id));
      const toInsert = (defs ?? []).filter((d) => !have.has(d.id)).map((d) => ({
        project_id: projectId,
        topic_definition_id: d.id,
      }));
      if (toInsert.length > 0) await supabase.from("topics").insert(toInsert as never);

      setProcessStep("Classificando tópicos e extraindo campos…");
      const ext = (await runExtractionFn({ data: { projectId, mode: "persist" } })) as {
        stats: { core_fields_found: number; dynamic_fields_found: number; additional_info_found: number };
      };
      setProcessStep("Consolidando base estruturada…");
      await consolidateFn({ data: { projectId } });
      toast.success(
        `Base processada: ${ext.stats.core_fields_found} campos oficiais · ${ext.stats.dynamic_fields_found} dinâmicos · ${ext.stats.additional_info_found} info adicionais`,
      );
      qc.invalidateQueries();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setProcessing(false);
      setProcessStep("");
    }
  }

  async function deleteSource(id: string) {
    if (!confirm("Apagar esta fonte e todos os chunks?")) return;
    const { error } = await supabase.from("raw_sources").delete().eq("id", id);
    if (error) toast.error(error.message);
    else {
      toast.success("Removido");
      refetch();
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Importar conteúdo</CardTitle>
          <p className="text-xs text-muted-foreground">
            Tudo o que você importa vira a <strong>Raw Knowledge</strong> (o que iria direto para um RAG tradicional).
          </p>
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
              <CsvImporter projectId={projectId} onDone={() => refetch()} />
            </TabsContent>
            <TabsContent value="pdf" className="mt-4">
              <PdfImporter projectId={projectId} onDone={() => refetch()} />
            </TabsContent>
            <TabsContent value="url" className="mt-4">
              <UrlImporter projectId={projectId} onDone={() => refetch()} />
            </TabsContent>
            <TabsContent value="fast" className="mt-4">
              <FastImporter projectId={projectId} onDone={() => refetch()} />
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Fontes ({sources?.length ?? 0})</CardTitle>
        </CardHeader>
        <CardContent>
          {!sources || sources.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhuma fonte importada ainda.</p>
          ) : (
            <div className="divide-y">
              {sources.map((s) => (
                <div key={s.id} className="flex items-center justify-between py-3">
                  <div>
                    <div className="text-sm font-medium">{s.filename ?? s.id}</div>
                    <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                      <Badge variant="outline" className="uppercase text-[10px]">{s.type}</Badge>
                      <span>{new Date(s.uploaded_at).toLocaleString()}</span>
                      <Badge variant="secondary">{s.raw_chunks?.[0]?.count ?? 0} chunks</Badge>
                    </div>
                  </div>
                  <Button size="icon" variant="ghost" onClick={() => deleteSource(s.id)}>
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Processar conhecimento</CardTitle>
          <p className="text-xs text-muted-foreground">
            Constrói a <strong>Structured Knowledge</strong> a partir das fontes acima. A Raw Knowledge nunca é modificada.
          </p>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm text-muted-foreground">
              {sources?.length ?? 0} fonte(s) · {totalChunks} chunks prontos para processamento.
            </div>
            <Button onClick={processKnowledge} disabled={processing || (sources?.length ?? 0) === 0}>
              <Sparkles className="mr-2 size-4" />
              {processing ? processStep || "Processando…" : "Process Knowledge"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ---------- Importers (lighter than before, no per-file queue UI) ----------

type ImporterProps = { projectId: string; onDone: () => void };

function CsvImporter({ projectId, onDone }: ImporterProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  async function handleUpload(file: File) {
    setBusy(true);
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

      const chunks = rows
        .map((row, i) => ({
          raw_source_id: source.id,
          content: contentCol
            ? row[contentCol] ?? ""
            : headers.map((h) => `${h}: ${row[h] ?? ""}`).join("\n"),
          metadata: row as unknown as Record<string, unknown>,
          position: i,
        }))
        .filter((c) => c.content.trim().length > 0);

      for (let i = 0; i < chunks.length; i += 500) {
        const { error } = await supabase.from("raw_chunks").insert(chunks.slice(i, i + 500) as never);
        if (error) throw error;
      }
      toast.success(`${chunks.length} chunks importados`);
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        Coluna <code>content</code>/<code>text</code>/<code>chunk</code> vira o conteúdo, caso contrário concatena todas as colunas.
      </p>
      <input
        ref={fileRef}
        type="file"
        accept=".csv"
        disabled={busy}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleUpload(f);
        }}
        className="block text-sm"
      />
    </div>
  );
}

function PdfImporter({ projectId, onDone }: ImporterProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const importPdfFn = useServerFn(importPdf);

  async function handleFiles(files: FileList) {
    setBusy(true);
    for (const file of Array.from(files)) {
      try {
        const buf = await file.arrayBuffer();
        const base64 = btoa(String.fromCharCode(...new Uint8Array(buf)));
        const res = (await importPdfFn({ data: { projectId, filename: file.name, base64 } })) as ImportResult;
        toast.success(`${file.name}: ${res.chunks} chunks`);
      } catch (e) {
        toast.error(`${file.name}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    setBusy(false);
    if (fileRef.current) fileRef.current.value = "";
    onDone();
  }

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">PDFs com texto extraível (OCR não é suportado).</p>
      <input
        ref={fileRef}
        type="file"
        accept="application/pdf"
        multiple
        disabled={busy}
        onChange={(e) => {
          if (e.target.files?.length) handleFiles(e.target.files);
        }}
        className="block text-sm"
      />
    </div>
  );
}

function UrlImporter({ projectId, onDone }: ImporterProps) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const importUrlFn = useServerFn(importUrl);

  async function run() {
    const urls = text.split(/\s+/).map((u) => u.trim()).filter((u) => /^https?:\/\//i.test(u));
    if (urls.length === 0) {
      toast.error("Nenhuma URL válida.");
      return;
    }
    setBusy(true);
    for (const url of urls) {
      try {
        const res = (await importUrlFn({ data: { projectId, url } })) as ImportResult;
        toast.success(`${url}: ${res.chunks} chunks`);
      } catch (e) {
        toast.error(`${url}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    setBusy(false);
    setText("");
    onDone();
  }

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">Uma URL por linha. O HTML é limpo automaticamente.</p>
      <Textarea
        rows={4}
        placeholder="https://hotel.com/page1&#10;https://hotel.com/page2"
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <Button onClick={run} disabled={busy}>{busy ? "Importando…" : "Importar URLs"}</Button>
    </div>
  );
}

function FastImporter({ projectId, onDone }: ImporterProps) {
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("");
  const [content, setContent] = useState("");
  const [busy, setBusy] = useState(false);
  const fn = useServerFn(importFastContent);

  async function run() {
    if (!title.trim() || !content.trim()) {
      toast.error("Título e texto são obrigatórios.");
      return;
    }
    setBusy(true);
    try {
      const res = (await fn({
        data: { projectId, title, text: content, category: category || undefined },
      })) as ImportResult;
      toast.success(`${res.chunks} chunks adicionados`);
      setTitle("");
      setCategory("");
      setContent("");
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <Input placeholder="Título" value={title} onChange={(e) => setTitle(e.target.value)} />
      <Input placeholder="Categoria (opcional)" value={category} onChange={(e) => setCategory(e.target.value)} />
      <Textarea rows={6} placeholder="Cole o texto aqui…" value={content} onChange={(e) => setContent(e.target.value)} />
      <Button onClick={run} disabled={busy}>{busy ? "Salvando…" : "Adicionar conteúdo"}</Button>
    </div>
  );
}
