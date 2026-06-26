import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { runTestAnswer } from "@/lib/ai.functions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";

export function PlaygroundTab({ projectId }: { projectId: string }) {
  const qc = useQueryClient();
  const answerFn = useServerFn(runTestAnswer);
  const [selectedQ, setSelectedQ] = useState<string | null>(null);
  const [busy, setBusy] = useState<null | "structured" | "raw_chunks" | "both">(null);

  const { data: questions } = useQuery({
    queryKey: ["test_questions", projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("test_questions").select("*").eq("project_id", projectId).order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const qIds = (questions ?? []).map((q) => q.id);
  const { data: runs } = useQuery({
    queryKey: ["test_runs", projectId, qIds.join(",")],
    enabled: qIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("test_runs").select("*").in("question_id", qIds).order("created_at", { ascending: false }).limit(50);
      if (error) throw error;
      return data;
    },
  });

  const { data: consolidatedCount } = useQuery({
    queryKey: ["consolidated_count", projectId],
    queryFn: async () => {
      const { data: topics } = await supabase
        .from("topics").select("id").eq("project_id", projectId);
      const ids = (topics ?? []).map((t) => t.id);
      if (ids.length === 0) return 0;
      const { count } = await supabase
        .from("knowledge_fields")
        .select("*", { count: "exact", head: true })
        .in("topic_id", ids)
        .eq("consolidation_status", "consolidated");
      return count ?? 0;
    },
  });


  async function run(mode: "structured" | "raw_chunks") {
    if (!selectedQ) { toast.error("Escolha uma pergunta"); return; }
    setBusy(mode);
    try {
      const res = await answerFn({ data: { questionId: selectedQ, mode } });
      toast.success(`${mode}: ${res.latency}ms · ~$${res.estimated_cost.toFixed(5)}`);
      qc.invalidateQueries({ queryKey: ["test_runs", projectId] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falhou");
    } finally { setBusy(null); }
  }

  async function runBoth() {
    if (!selectedQ) { toast.error("Escolha uma pergunta"); return; }
    setBusy("both");
    try {
      await Promise.all([
        answerFn({ data: { questionId: selectedQ, mode: "structured" } }),
        answerFn({ data: { questionId: selectedQ, mode: "raw_chunks" } }),
      ]);
      toast.success("Ambos completos");
      qc.invalidateQueries({ queryKey: ["test_runs", projectId] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falhou");
    } finally { setBusy(null); }
  }

  const selectedRuns = (runs ?? []).filter((r) => r.question_id === selectedQ);
  const lastStructured = selectedRuns.find((r) => r.mode === "structured");
  const lastRaw = selectedRuns.find((r) => r.mode === "raw_chunks");

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader><CardTitle className="text-base">Pergunta</CardTitle></CardHeader>
        <CardContent>
          {!questions || questions.length === 0 ? (
            <p className="text-sm text-muted-foreground">Cadastre perguntas na aba Questions.</p>
          ) : (
            <div className="space-y-2">
              <select
                className="w-full rounded border bg-background p-2 text-sm"
                value={selectedQ ?? ""}
                onChange={(e) => setSelectedQ(e.target.value || null)}
              >
                <option value="">— escolher —</option>
                {questions.map((q) => (
                  <option key={q.id} value={q.id}>{q.question}</option>
                ))}
              </select>
              <div className="flex gap-2 pt-2">
                <Button disabled={busy !== null || !selectedQ} onClick={() => run("structured")}>
                  {busy === "structured" ? "..." : "Rodar structured"}
                </Button>
                <Button variant="outline" disabled={busy !== null || !selectedQ} onClick={() => run("raw_chunks")}>
                  {busy === "raw_chunks" ? "..." : "Rodar raw_chunks"}
                </Button>
                <Button variant="secondary" disabled={busy !== null || !selectedQ} onClick={runBoth}>
                  {busy === "both" ? "..." : "Rodar ambos"}
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {selectedQ && (
        <div className="grid gap-4 md:grid-cols-2">
          <RunCard title="Structured (base híbrida)" run={lastStructured} onEdit={() => qc.invalidateQueries({ queryKey: ["test_runs", projectId] })} />
          <RunCard title="Raw chunks (baseline)" run={lastRaw} onEdit={() => qc.invalidateQueries({ queryKey: ["test_runs", projectId] })} />
        </div>
      )}

      {selectedQ && selectedRuns.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base">Histórico</CardTitle></CardHeader>
          <CardContent>
            <div className="divide-y text-sm">
              {selectedRuns.map((r) => (
                <div key={r.id} className="py-2">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Badge variant="outline">{r.mode}</Badge>
                    <span>{new Date(r.created_at).toLocaleString()}</span>
                    {r.human_score != null && <Badge variant="secondary">score {r.human_score}</Badge>}
                  </div>
                  <p className="mt-1 line-clamp-3">{r.answer}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function RunCard({ title, run, onEdit }: {
  title: string;
  run?: { id: string; answer: string | null; context_sent: unknown; human_score: number | null; human_notes: string | null };
  onEdit: () => void;
}) {
  const [score, setScore] = useState<string>(run?.human_score?.toString() ?? "");
  const [notes, setNotes] = useState<string>(run?.human_notes ?? "");

  async function saveEval() {
    if (!run) return;
    const { error } = await supabase.from("test_runs").update({
      human_score: score === "" ? null : Number(score),
      human_notes: notes || null,
    }).eq("id", run.id);
    if (error) toast.error(error.message);
    else { toast.success("Avaliação salva"); onEdit(); }
  }

  return (
    <Card>
      <CardHeader><CardTitle className="text-sm">{title}</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        {!run ? (
          <p className="text-sm text-muted-foreground">Sem execução ainda.</p>
        ) : (
          <>
            <div className="rounded border bg-muted/30 p-3 text-sm whitespace-pre-wrap">{run.answer}</div>
            <details className="text-xs">
              <summary className="cursor-pointer text-muted-foreground">Contexto enviado</summary>
              <pre className="mt-2 max-h-64 overflow-auto rounded bg-muted p-2">
                {JSON.stringify(run.context_sent, null, 2)}
              </pre>
            </details>
            <div className="grid grid-cols-[80px_1fr] items-start gap-2">
              <input
                type="number" min={0} max={5}
                value={score}
                onChange={(e) => setScore(e.target.value)}
                placeholder="0-5"
                className="rounded border bg-background p-1 text-sm"
              />
              <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Anotações humanas" />
            </div>
            <Button size="sm" variant="outline" onClick={saveEval}>Salvar avaliação</Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}
