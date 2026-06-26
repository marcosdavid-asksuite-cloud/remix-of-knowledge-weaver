import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { runExtraction } from "@/lib/ai.functions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export function ExtractionsTab({ projectId }: { projectId: string }) {
  const qc = useQueryClient();
  const extractFn = useServerFn(runExtraction);
  const [busy, setBusy] = useState<null | "dry_run" | "persist">(null);

  const { data: runs } = useQuery({
    queryKey: ["extraction_runs", projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("extraction_runs").select("*").eq("project_id", projectId).order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  async function run(mode: "dry_run" | "persist") {
    if (mode === "persist" && !confirm("Isso vai gravar campos extraídos na base. Continuar?")) return;
    setBusy(mode);
    try {
      const res = await extractFn({ data: { projectId, mode } });
      toast.success(
        mode === "dry_run"
          ? `Dry run completo. ${res.stats.fields_proposed} campos propostos. Custo ~$${res.stats.estimated_cost.toFixed(4)}.`
          : `Extração persistida. ${res.stats.fields_proposed} campos. Custo ~$${res.stats.estimated_cost.toFixed(4)}.`,
      );
      qc.invalidateQueries({ queryKey: ["extraction_runs", projectId] });
      qc.invalidateQueries({ queryKey: ["knowledge_fields", projectId] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falhou");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader><CardTitle className="text-base">Rodar extração</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            <strong>Dry Run</strong> chama o LLM e mostra o JSON proposto, mas <em>não</em> grava nada.
            Use para inspecionar antes de pagar a extração definitiva.
          </p>
          <div className="flex gap-2">
            <Button variant="outline" disabled={busy !== null} onClick={() => run("dry_run")}>
              {busy === "dry_run" ? "Rodando..." : "Dry Run"}
            </Button>
            <Button disabled={busy !== null} onClick={() => run("persist")}>
              {busy === "persist" ? "Rodando..." : "Run & Persist"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Histórico</CardTitle></CardHeader>
        <CardContent>
          {!runs || runs.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhuma extração ainda.</p>
          ) : (
            <div className="space-y-3">
              {runs.map((r) => (
                <details key={r.id} className="rounded-md border p-3">
                  <summary className="cursor-pointer text-sm">
                    <div className="inline-flex items-center gap-2">
                      <Badge variant={r.mode === "dry_run" ? "outline" : "default"}>{r.mode}</Badge>
                      <Badge variant={r.status === "done" ? "secondary" : r.status === "failed" ? "destructive" : "outline"}>
                        {r.status}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        {new Date(r.created_at).toLocaleString()}
                      </span>
                      {r.stats && typeof r.stats === "object" && "estimated_cost" in r.stats && (
                        <span className="text-xs text-muted-foreground">
                          ~${Number((r.stats as { estimated_cost: number }).estimated_cost).toFixed(4)}
                        </span>
                      )}
                    </div>
                  </summary>
                  {r.error && <p className="mt-2 text-sm text-destructive">{r.error}</p>}
                  {r.stats && (
                    <pre className="mt-2 overflow-x-auto rounded bg-muted p-3 text-xs">
                      {JSON.stringify(r.stats, null, 2)}
                    </pre>
                  )}
                  {r.preview_result && (
                    <pre className="mt-2 max-h-96 overflow-auto rounded bg-muted p-3 text-xs">
                      {JSON.stringify(r.preview_result, null, 2)}
                    </pre>
                  )}
                </details>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
