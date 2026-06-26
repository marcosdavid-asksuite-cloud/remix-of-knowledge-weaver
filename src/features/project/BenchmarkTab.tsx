import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { runBenchmark } from "@/lib/benchmark.functions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

type Mode = "raw_chunks" | "structured" | "structured_only" | "external_agent";
const ALL_MODES: Mode[] = ["raw_chunks", "structured", "structured_only", "external_agent"];
const MODE_LABEL: Record<Mode, string> = {
  raw_chunks: "Raw chunks",
  structured: "Structured (+addl)",
  structured_only: "Structured only",
  external_agent: "External Agent",
};
const MODE_COLOR: Record<Mode, string> = {
  raw_chunks: "border-amber-500/40 bg-amber-500/5",
  structured: "border-emerald-500/40 bg-emerald-500/5",
  structured_only: "border-sky-500/40 bg-sky-500/5",
  external_agent: "border-violet-500/40 bg-violet-500/5",
};

type TestRun = {
  id: string;
  question_id: string;
  mode: string;
  answer: string | null;
  context_sent: unknown;
  latency_ms: number | null;
  input_tokens: number | null;
  output_tokens: number | null;
  estimated_cost: number | null;
  model_name: string | null;
  status: string;
  error_message: string | null;
  created_at: string;
  test_batch_id: string | null;
};

type TestEval = {
  id: string;
  test_run_id: string;
  precision_score: number | null;
  completeness_score: number | null;
  usefulness_score: number | null;
  hallucination_score: number | null;
  latency_score: number | null;
  notes: string | null;
};

export function BenchmarkTab({ projectId }: { projectId: string }) {
  const qc = useQueryClient();
  const runFn = useServerFn(runBenchmark);
  const [selectedModes, setSelectedModes] = useState<Mode[]>(["raw_chunks", "structured", "structured_only"]);
  const [questionLimit, setQuestionLimit] = useState<string>("");
  const [maxChunks, setMaxChunks] = useState<string>("20");
  const [temperature, setTemperature] = useState<string>("");
  const [modelOverride, setModelOverride] = useState<string>("");
  const [includeAddl, setIncludeAddl] = useState<boolean>(true);
  const [batchName, setBatchName] = useState<string>("");
  const [externalAgentId, setExternalAgentId] = useState<string>("");
  const [activeBatchId, setActiveBatchId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const { data: agents } = useQuery({
    queryKey: ["external-agents-bench", projectId],
    queryFn: async () => {
      const { data } = await supabase.from("external_agents").select("id, name, model")
        .or(`project_id.eq.${projectId},project_id.is.null`).eq("active", true);
      return data ?? [];
    },
  });

  const { data: questions } = useQuery({
    queryKey: ["test_questions", projectId],
    queryFn: async () => {
      const { data } = await supabase
        .from("test_questions").select("*").eq("project_id", projectId)
        .order("created_at", { ascending: false });
      return data ?? [];
    },
  });
  const activeQs = (questions ?? []).filter((q) => q.active);

  const { data: batches } = useQuery({
    queryKey: ["test_batches", projectId],
    queryFn: async () => {
      const { data } = await supabase
        .from("test_batches").select("*").eq("project_id", projectId)
        .order("started_at", { ascending: false }).limit(20);
      return data ?? [];
    },
    refetchInterval: busy ? 2000 : false,
  });

  // Auto-select most recent batch when none picked.
  const currentBatchId = activeBatchId ?? batches?.[0]?.id ?? null;
  const currentBatch = batches?.find((b) => b.id === currentBatchId) ?? null;

  const { data: runs } = useQuery({
    queryKey: ["benchmark_runs", currentBatchId],
    enabled: !!currentBatchId,
    queryFn: async () => {
      const { data } = await supabase
        .from("test_runs").select("*").eq("test_batch_id", currentBatchId!)
        .order("created_at", { ascending: true });
      return (data ?? []) as TestRun[];
    },
  });

  const runIds = (runs ?? []).map((r) => r.id);
  const { data: evals } = useQuery({
    queryKey: ["benchmark_evals", runIds.join(",")],
    enabled: runIds.length > 0,
    queryFn: async () => {
      const { data } = await supabase
        .from("test_evaluations").select("*").in("test_run_id", runIds);
      return (data ?? []) as TestEval[];
    },
  });
  const evalByRunId = useMemo(() => {
    const m = new Map<string, TestEval>();
    for (const e of evals ?? []) m.set(e.test_run_id, e);
    return m;
  }, [evals]);

  // Group runs by question for results table
  const runsByQuestion = useMemo(() => {
    const m = new Map<string, Record<Mode, TestRun | undefined>>();
    for (const r of runs ?? []) {
      const slot = m.get(r.question_id) ?? ({} as Record<Mode, TestRun | undefined>);
      slot[r.mode as Mode] = r;
      m.set(r.question_id, slot);
    }
    return m;
  }, [runs]);

  function toggleMode(m: Mode) {
    setSelectedModes((prev) => prev.includes(m) ? prev.filter((x) => x !== m) : [...prev, m]);
  }

  async function startRun() {
    if (selectedModes.length === 0) { toast.error("Selecione ao menos um modo"); return; }
    if (activeQs.length === 0) { toast.error("Sem perguntas ativas"); return; }
    if (selectedModes.includes("external_agent") && !externalAgentId) {
      toast.error("Selecione um External Agent"); return;
    }
    const limit = questionLimit ? Math.max(1, parseInt(questionLimit, 10)) : activeQs.length;
    const ids = activeQs.slice(0, limit).map((q) => q.id);
    setBusy(true);
    try {
      const res = await runFn({
        data: {
          projectId,
          questionIds: ids,
          modes: selectedModes,
          name: batchName.trim() || undefined,
          modelName: modelOverride.trim() || undefined,
          temperature: temperature ? Number(temperature) : undefined,
          maxRawChunks: maxChunks ? parseInt(maxChunks, 10) : undefined,
          includeAdditional: includeAddl,
          externalAgentId: externalAgentId || undefined,
        },
      });
      toast.success(`Benchmark concluído. ${res.statistics.successes}/${res.statistics.total_runs} runs.`);
      setActiveBatchId(res.batchId);
      setBatchName("");
      qc.invalidateQueries({ queryKey: ["test_batches", projectId] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falhou");
    } finally {
      setBusy(false);
    }
  }

  function exportCsv() {
    if (!runs || runs.length === 0 || !questions) return;
    const qById = new Map(questions.map((q) => [q.id, q.question]));
    const headers = [
      "question", "mode", "status", "answer", "latency_ms", "input_tokens", "output_tokens",
      "estimated_cost", "precision_score", "completeness_score", "usefulness_score",
      "hallucination_score", "latency_score", "notes",
    ];
    const escape = (v: unknown) => {
      const s = v == null ? "" : String(v).replace(/"/g, '""');
      return /[",\n]/.test(s) ? `"${s}"` : s;
    };
    const lines = [headers.join(",")];
    for (const r of runs) {
      const ev = evalByRunId.get(r.id);
      lines.push([
        escape(qById.get(r.question_id) ?? ""),
        r.mode, r.status,
        escape(r.answer ?? r.error_message ?? ""),
        r.latency_ms ?? "",
        r.input_tokens ?? "",
        r.output_tokens ?? "",
        r.estimated_cost ?? "",
        ev?.precision_score ?? "",
        ev?.completeness_score ?? "",
        ev?.usefulness_score ?? "",
        ev?.hallucination_score ?? "",
        ev?.latency_score ?? "",
        escape(ev?.notes ?? ""),
      ].join(","));
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `benchmark-${currentBatch?.name ?? currentBatchId ?? "results"}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // ---- aggregated dashboard ----
  const dashboard = useMemo(() => {
    const out = {
      total_questions: 0,
      total_runs: runs?.length ?? 0,
      total_cost: 0,
      byMode: {} as Record<Mode, {
        n: number; latency: number; cost: number; inT: number; outT: number;
        precision: number[]; completeness: number[]; usefulness: number[]; hallucination: number[];
      }>,
    };
    out.total_questions = new Set((runs ?? []).map((r) => r.question_id)).size;
    for (const m of ALL_MODES) out.byMode[m] = {
      n: 0, latency: 0, cost: 0, inT: 0, outT: 0,
      precision: [], completeness: [], usefulness: [], hallucination: [],
    };
    for (const r of runs ?? []) {
      if (r.status !== "success") continue;
      const m = r.mode as Mode;
      if (!out.byMode[m]) continue;
      out.byMode[m].n++;
      out.byMode[m].latency += r.latency_ms ?? 0;
      out.byMode[m].cost += Number(r.estimated_cost ?? 0);
      out.byMode[m].inT += r.input_tokens ?? 0;
      out.byMode[m].outT += r.output_tokens ?? 0;
      out.total_cost += Number(r.estimated_cost ?? 0);
      const ev = evalByRunId.get(r.id);
      if (ev) {
        if (ev.precision_score != null) out.byMode[m].precision.push(ev.precision_score);
        if (ev.completeness_score != null) out.byMode[m].completeness.push(ev.completeness_score);
        if (ev.usefulness_score != null) out.byMode[m].usefulness.push(ev.usefulness_score);
        if (ev.hallucination_score != null) out.byMode[m].hallucination.push(ev.hallucination_score);
      }
    }
    return out;
  }, [runs, evalByRunId]);

  const avg = (a: number[]) => a.length ? (a.reduce((x, y) => x + y, 0) / a.length) : null;

  return (
    <div className="space-y-6">
      {/* Run config */}
      <Card>
        <CardHeader><CardTitle className="text-base">Rodar benchmark</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div>
            <div className="mb-1 text-xs text-muted-foreground">Modos</div>
            <div className="flex flex-wrap gap-2">
              {ALL_MODES.map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => toggleMode(m)}
                  className={`rounded border px-3 py-1 text-xs ${selectedModes.includes(m) ? "border-primary bg-primary/10" : "border-border"}`}
                >
                  {MODE_LABEL[m]}
                </button>
              ))}
            </div>
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">Nome do batch (opcional)</label>
              <Input value={batchName} onChange={(e) => setBatchName(e.target.value)} placeholder="ex.: v1-baseline" />
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">Modelo override (vazio = ativo)</label>
              <Input value={modelOverride} onChange={(e) => setModelOverride(e.target.value)} placeholder="google/gemini-3-flash-preview" />
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">Temperature</label>
              <Input value={temperature} onChange={(e) => setTemperature(e.target.value)} placeholder="0.2" />
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">Limite de perguntas</label>
              <Input value={questionLimit} onChange={(e) => setQuestionLimit(e.target.value)} placeholder={`máx ${activeQs.length}`} />
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">Max chunks (raw_chunks)</label>
              <Input value={maxChunks} onChange={(e) => setMaxChunks(e.target.value)} />
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">External Agent</label>
              <select
                className="w-full rounded border bg-background px-2 py-1.5 text-sm"
                value={externalAgentId}
                onChange={(e) => setExternalAgentId(e.target.value)}
              >
                <option value="">— (necessário para modo external_agent) —</option>
                {(agents ?? []).map((a) => (
                  <option key={a.id} value={a.id}>{a.name} ({a.model ?? "?"})</option>
                ))}
              </select>
            </div>
            <div className="flex items-end gap-2">
              <label className="flex items-center gap-2 text-xs">
                <input type="checkbox" checked={includeAddl} onChange={(e) => setIncludeAddl(e.target.checked)} />
                Incluir AdditionalInfo no <code>structured</code>
              </label>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button disabled={busy || activeQs.length === 0} onClick={startRun}>
              {busy ? "Rodando..." : `Run benchmark (${activeQs.length} perguntas × ${selectedModes.length} modos)`}
            </Button>
            <span className="text-xs text-muted-foreground">
              ≈ {activeQs.length * selectedModes.length} chamadas LLM
            </span>
          </div>
        </CardContent>
      </Card>

      {/* Batch picker */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Batch atual</CardTitle>
            {currentBatchId && runs && runs.length > 0 && (
              <Button size="sm" variant="outline" onClick={exportCsv}>Export Results CSV</Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {(batches ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum batch rodado ainda.</p>
          ) : (
            <div className="space-y-2">
              <select
                className="w-full rounded border bg-background p-2 text-sm"
                value={currentBatchId ?? ""}
                onChange={(e) => setActiveBatchId(e.target.value || null)}
              >
                {(batches ?? []).map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name} — {b.status} — {new Date(b.started_at).toLocaleString()}
                  </option>
                ))}
              </select>
              {currentBatch && (
                <div className="text-xs text-muted-foreground">
                  modos: {(currentBatch.modes ?? []).join(", ")} · modelo: {currentBatch.model_name ?? "?"}
                  {currentBatch.temperature != null && ` · temp ${currentBatch.temperature}`}
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Dashboard */}
      {currentBatch && runs && runs.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base">Resumo</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <Stat label="Perguntas" value={dashboard.total_questions} />
              <Stat label="Respostas" value={dashboard.total_runs} />
              <Stat label="Custo total" value={`$${dashboard.total_cost.toFixed(4)}`} />
              <Stat label="Modos" value={(currentBatch.modes ?? []).length} />
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="py-1 pr-3">Mode</th>
                    <th className="py-1 pr-3">N</th>
                    <th className="py-1 pr-3">Avg Latency</th>
                    <th className="py-1 pr-3">Avg In Tokens</th>
                    <th className="py-1 pr-3">Avg Out Tokens</th>
                    <th className="py-1 pr-3">Cost</th>
                    <th className="py-1 pr-3">Precision</th>
                    <th className="py-1 pr-3">Completeness</th>
                    <th className="py-1 pr-3">Usefulness</th>
                    <th className="py-1 pr-3">Hallucination</th>
                  </tr>
                </thead>
                <tbody>
                  {ALL_MODES.filter((m) => (currentBatch.modes ?? []).includes(m)).map((m) => {
                    const d = dashboard.byMode[m];
                    const n = d.n || 1;
                    const p = avg(d.precision);
                    const c = avg(d.completeness);
                    const u = avg(d.usefulness);
                    const h = avg(d.hallucination);
                    return (
                      <tr key={m} className="border-b">
                        <td className="py-1 pr-3 font-medium">{MODE_LABEL[m]}</td>
                        <td className="py-1 pr-3">{d.n}</td>
                        <td className="py-1 pr-3">{Math.round(d.latency / n)} ms</td>
                        <td className="py-1 pr-3">{Math.round(d.inT / n)}</td>
                        <td className="py-1 pr-3">{Math.round(d.outT / n)}</td>
                        <td className="py-1 pr-3">${d.cost.toFixed(4)}</td>
                        <td className="py-1 pr-3">{p == null ? "—" : p.toFixed(2)}</td>
                        <td className="py-1 pr-3">{c == null ? "—" : c.toFixed(2)}</td>
                        <td className="py-1 pr-3">{u == null ? "—" : u.toFixed(2)}</td>
                        <td className="py-1 pr-3">{h == null ? "—" : h.toFixed(2)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Results per question */}
      {currentBatchId && runsByQuestion.size > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base">Resultados</CardTitle></CardHeader>
          <CardContent className="space-y-6">
            {Array.from(runsByQuestion.entries()).map(([qid, slots]) => {
              const qText = questions?.find((q) => q.id === qid)?.question ?? qid;
              const modes = ALL_MODES.filter((m) => (currentBatch?.modes ?? []).includes(m));
              return (
                <div key={qid} className="space-y-2">
                  <div className="text-sm font-medium">{qText}</div>
                  <div className={`grid gap-3 ${modes.length === 3 ? "md:grid-cols-3" : modes.length === 2 ? "md:grid-cols-2" : ""}`}>
                    {modes.map((m) => (
                      <RunCell
                        key={m}
                        mode={m}
                        run={slots[m]}
                        evaluation={slots[m] ? evalByRunId.get(slots[m]!.id) : undefined}
                        onSaved={() => qc.invalidateQueries({ queryKey: ["benchmark_evals", runIds.join(",")] })}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded border p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-lg font-semibold">{value}</div>
    </div>
  );
}

function RunCell({ mode, run, evaluation, onSaved }: {
  mode: Mode;
  run?: TestRun;
  evaluation?: TestEval;
  onSaved: () => void;
}) {
  const [showCtx, setShowCtx] = useState(false);
  const [showEval, setShowEval] = useState(false);

  if (!run) {
    return (
      <div className={`rounded border p-3 text-xs text-muted-foreground ${MODE_COLOR[mode]}`}>
        <Badge variant="outline">{MODE_LABEL[mode]}</Badge>
        <div className="mt-2">Sem execução.</div>
      </div>
    );
  }

  return (
    <div className={`flex flex-col gap-2 rounded border p-3 ${MODE_COLOR[mode]}`}>
      <div className="flex items-center justify-between gap-2">
        <Badge variant="outline">{MODE_LABEL[mode]}</Badge>
        {run.status === "error" ? (
          <Badge variant="destructive">error</Badge>
        ) : (
          <span className="text-[10px] text-muted-foreground">
            {run.latency_ms}ms · {run.input_tokens}/{run.output_tokens}t · ${Number(run.estimated_cost ?? 0).toFixed(5)}
          </span>
        )}
      </div>
      <div className="whitespace-pre-wrap rounded bg-background/60 p-2 text-xs">
        {run.status === "error" ? <span className="text-destructive">{run.error_message}</span> : run.answer}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="ghost" onClick={() => setShowCtx((v) => !v)}>
          {showCtx ? "Hide context" : "View context"}
        </Button>
        <Button size="sm" variant="outline" onClick={() => setShowEval((v) => !v)}>
          {evaluation ? "Edit eval" : "Evaluate"}
        </Button>
        {evaluation && (
          <span className="text-[10px] text-muted-foreground">
            P{evaluation.precision_score ?? "-"} C{evaluation.completeness_score ?? "-"}
            U{evaluation.usefulness_score ?? "-"} H{evaluation.hallucination_score ?? "-"}
          </span>
        )}
      </div>
      {showCtx && (
        <pre className="max-h-64 overflow-auto rounded bg-muted p-2 text-[10px]">
          {JSON.stringify(run.context_sent, null, 2)}
        </pre>
      )}
      {showEval && <EvalForm runId={run.id} existing={evaluation} onSaved={() => { setShowEval(false); onSaved(); }} />}
    </div>
  );
}

function EvalForm({ runId, existing, onSaved }: {
  runId: string;
  existing?: TestEval;
  onSaved: () => void;
}) {
  const [p, setP] = useState<string>(existing?.precision_score?.toString() ?? "");
  const [c, setC] = useState<string>(existing?.completeness_score?.toString() ?? "");
  const [u, setU] = useState<string>(existing?.usefulness_score?.toString() ?? "");
  const [h, setH] = useState<string>(existing?.hallucination_score?.toString() ?? "");
  const [l, setL] = useState<string>(existing?.latency_score?.toString() ?? "");
  const [notes, setNotes] = useState<string>(existing?.notes ?? "");
  const [saving, setSaving] = useState(false);

  const num = (v: string) => v === "" ? null : Math.max(1, Math.min(5, Math.round(Number(v))));

  async function save() {
    setSaving(true);
    const payload = {
      test_run_id: runId,
      evaluator: "human",
      precision_score: num(p),
      completeness_score: num(c),
      usefulness_score: num(u),
      hallucination_score: num(h),
      latency_score: num(l),
      notes: notes.trim() || null,
    };
    const { error } = await supabase
      .from("test_evaluations")
      .upsert(payload, { onConflict: "test_run_id,evaluator" });
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Avaliação salva");
    onSaved();
  }

  const scoreInput = (label: string, val: string, set: (v: string) => void, hint?: string) => (
    <label className="flex items-center gap-2 text-[11px]">
      <span className="w-28">{label}</span>
      <input
        type="number" min={1} max={5} value={val} onChange={(e) => set(e.target.value)}
        className="w-14 rounded border bg-background px-1 py-0.5 text-xs"
      />
      {hint && <span className="text-muted-foreground">{hint}</span>}
    </label>
  );

  return (
    <div className="space-y-1 rounded border bg-background/80 p-2">
      {scoreInput("Precisão", p, setP, "1–5")}
      {scoreInput("Completude", c, setC, "1–5")}
      {scoreInput("Utilidade", u, setU, "1–5")}
      {scoreInput("Alucinação", h, setH, "1=nenhuma, 5=muita")}
      {scoreInput("Latência percebida", l, setL, "1–5")}
      <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notas" className="text-xs" />
      <Button size="sm" onClick={save} disabled={saving}>{saving ? "..." : "Salvar"}</Button>
    </div>
  );
}
