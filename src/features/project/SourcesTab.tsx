import { useQuery } from "@tanstack/react-query";
import { useRef, useState } from "react";
import Papa from "papaparse";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export function SourcesTab({ projectId }: { projectId: string }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

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

  async function handleUpload(file: File) {
    setUploading(true);
    try {
      const text = await file.text();
      const parsed = Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: true });
      if (parsed.errors.length > 0) {
        console.warn("CSV parse warnings", parsed.errors);
      }
      const rows = parsed.data;
      if (rows.length === 0) {
        toast.error("CSV vazio");
        return;
      }
      // Decide content column: prefer "content"/"text"/"chunk"; otherwise concat all
      const headers = parsed.meta.fields ?? [];
      const contentCol = headers.find((h) => /^(content|text|chunk|body)$/i.test(h));

      const { data: source, error: sErr } = await supabase
        .from("raw_sources")
        .insert({ project_id: projectId, type: "csv", filename: file.name })
        .select("id").single();
      if (sErr || !source) throw new Error(sErr?.message ?? "Falha ao criar source");

      const chunks = rows.map((row, i) => ({
        raw_source_id: source.id,
        content: contentCol ? (row[contentCol] ?? "") : headers.map((h) => `${h}: ${row[h] ?? ""}`).join("\n"),
        metadata: row as unknown as Record<string, unknown>,
        position: i,
      })).filter((c) => c.content.trim().length > 0);

      // batch insert
      const batchSize = 500;
      for (let i = 0; i < chunks.length; i += batchSize) {
        const { error: cErr } = await supabase.from("raw_chunks").insert(chunks.slice(i, i + batchSize) as never);
        if (cErr) throw cErr;
      }
      toast.success(`Importados ${chunks.length} chunks`);
      refetch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro no upload");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function deleteSource(id: string) {
    if (!confirm("Apagar esta fonte e todos os chunks?")) return;
    const { error } = await supabase.from("raw_sources").delete().eq("id", id);
    if (error) toast.error(error.message);
    else { toast.success("Removido"); refetch(); }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Importar CSV</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-3 text-sm text-muted-foreground">
            Se houver coluna <code>content</code>, <code>text</code> ou <code>chunk</code>, ela vira o conteúdo do chunk.
            Caso contrário, concatenamos todas as colunas.
          </p>
          <input
            ref={fileRef}
            type="file"
            accept=".csv"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleUpload(f);
            }}
            disabled={uploading}
            className="block text-sm"
          />
          {uploading && <p className="mt-2 text-xs text-muted-foreground">Processando...</p>}
        </CardContent>
      </Card>

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
