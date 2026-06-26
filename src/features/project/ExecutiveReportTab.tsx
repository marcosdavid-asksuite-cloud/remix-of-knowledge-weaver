import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { calculateKnowledgeHealth, type TopicHealth } from "@/lib/health.functions";
import { generateExecutiveSummary } from "@/lib/report.functions";
import { createSnapshot } from "@/lib/snapshot.functions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";

function pct(n: number | null | undefined) {
  if (n == null || Number.isNaN(n)) return "—";
  return `${Math.round(n)}%`;
}
function num(n: number | null | undefined, digits = 0) {
  if (n == null || Number.isNaN(n)) return "—";
  return n.toLocaleString("pt-BR", { maximumFractionDigits: digits });
}
function money(n: number | null | undefined) {
  if (n == null) return "—";
  return `US$ ${n.toFixed(4)}`;
}

type BatchStats = {
  total_questions?: number;
  successes?: number;
  errors?: number;
  avg_latency_by_mode?: Record<string, number>;
  total_cost_by_mode?: Record<string, number>;
  avg_tokens_by_mode?: Record<string, { input: number; output: number }>;
};

export function ExecutiveReportTab({ projectId }: { projectId: string }) {
  const qc = useQueryClient();
  const runHealth = useServerFn(calculateKnowledgeHealth);
  const runSummary = useServerFn(generateExecutiveSummary);
  const runSnapshot = useServerFn(createSnapshot);

  const [summary, setSummary] = useState<string>("");

  // ---- Health
  const { data: health, isLoading: hLoading } = useQuery({
    queryKey: ["health", projectId],
    queryFn: () => runHealth({ data: { projectId, persistSnapshot: false } }),
  });

  // ---- Aggregated counts
  const { data: counts } = useQuery({
    queryKey: ["report-counts", projectId],
    queryFn: async () => {
      const [{ count: sources }, { data: topics }] = await Promise.all([
        supabase.from("raw_sources").select("id", { count: "exact", head: true }).eq("project_id", projectId),
        supabase.from("topics").select("id").eq("project_id", projectId),
      ]);
      const topicIds = (topics ?? []).map((t) => t.id);
      let chunks = 0, consolidated = 0, dynamic = 0, additional = 0, conflicts = 0;
      if (topicIds.length > 0) {
        const [
          { count: ch }, { count: kf }, { count: dyn },
          { count: ad }, { count: cf },
        ] = await Promise.all([
          supabase.from("raw_chunks").select("id, raw_source_id!inner(project_id)", { count: "exact", head: true })
            .eq("raw_source_id.project_id" as never, projectId as never)
            .then((r) => ({ count: r.count ?? 0 })).catch(() => ({ count: 0 })),
          supabase.from("knowledge_fields").select("id", { count: "exact", head: true })
            .in("topic_id", topicIds).eq("consolidation_status", "consolidated"),
          supabase.from("knowledge_fields").select("id", { count: "exact", head: true })
            .in("topic_id", topicIds).eq("field_origin", "dynamic"),
          supabase.from("additional_info").select("id", { count: "exact", head: true })
            .in("topic_id", topicIds).eq("status", "approved"),
          supabase.from("knowledge_conflicts").select("id", { count: "exact", head: true })
            .in("topic_id", topicIds).eq("status", "pending"),
        ]);
        chunks = ch; consolidated = kf ?? 0; dynamic = dyn ?? 0; additional = ad ?? 0; conflicts = cf ?? 0;
      }
      return { sources: sources ?? 0, chunks, consolidated, dynamic, additional, conflicts };
    },
  });

  // ---- Schema suggestions
  const { data: schemaCounts } = useQuery({
    queryKey: ["report-schema", projectId],
    queryFn: async () => {
      const [{ count: suggested }, { count: approved }] = await Promise.all([
        supabase.from("suggested_data_points").select("id", { count: "exact", head: true }).eq("status", "pending"),
        supabase.from("suggested_data_points").select("id", { count: "exact", head: true }).eq("status", "approved"),
      ]);
      return { suggested: suggested ?? 0, approved: approved ?? 0 };
    },
  });

  // ---- LLM costs
  const { data: costs } = useQuery({
    queryKey: ["report-costs", projectId],
    queryFn: async () => {
      const { data } = await supabase
        .from("llm_calls")
        .select("prompt_type, estimated_cost")
        .order("created_at", { ascending: false })
        .limit(5000);
      let extraction = 0, benchmark = 0, total = 0;
      for (const r of data ?? []) {
        const c = Number(r.estimated_cost ?? 0);
        total += c;
        if ((r.prompt_type ?? "").startsWith("benchmark")) benchmark += c;
        else extraction += c;
      }
      return { extraction, benchmark, total };
    },
  });

  // ---- Latest benchmark batch
  const { data: lastBatch } = useQuery({
    queryKey: ["report-last-batch", projectId],
    queryFn: async () => {
      const { data } = await supabase.from("test_batches").select("*")
        .eq("project_id", projectId).eq("status", "completed")
        .order("created_at", { ascending: false }).limit(1).maybeSingle();
      return data;
    },
  });

  // ---- Evaluations for precision/completeness winner
  const { data: evalSummary } = useQuery({
    queryKey: ["report-evals", projectId, lastBatch?.id],
    enabled: !!lastBatch?.id,
    queryFn: async () => {
      const { data: runs } = await supabase
        .from("test_runs").select("id, mode, context_sent, input_tokens")
        .eq("test_batch_id", lastBatch!.id);
      const { data: evals } = await supabase
        .from("test_evaluations").select("test_run_id, precision_score, completeness_score");
      const byRun = new Map(evals?.map((e) => [e.test_run_id, e]) ?? []);
      const modeAgg: Record<string, { p: number[]; c: number[]; tokens: number[]; ctxSize: number[]; sources: number[] }> = {};
      for (const r of runs ?? []) {
        const mode = r.mode ?? "unknown";
        if (!modeAgg[mode]) modeAgg[mode] = { p: [], c: [], tokens: [], ctxSize: [], sources: [] };
        const e = byRun.get(r.id);
        if (e?.precision_score != null) modeAgg[mode].p.push(Number(e.precision_score));
        if (e?.completeness_score != null) modeAgg[mode].c.push(Number(e.completeness_score));
        if (r.input_tokens != null) modeAgg[mode].tokens.push(r.input_tokens);
        const ctx = (r.context_sent as { context?: string; chunks?: number; topics?: unknown[] } | null) ?? {};
        if (typeof ctx.context === "string") modeAgg[mode].ctxSize.push(ctx.context.length);
        if (typeof ctx.chunks === "number") modeAgg[mode].sources.push(ctx.chunks);
        else if (Array.isArray(ctx.topics)) modeAgg[mode].sources.push(ctx.topics.length);
      }
      const avg = (arr: number[]) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);
      const out: Record<string, { precision: number; completeness: number; avgTokens: number; avgCtxSize: number; avgSources: number }> = {};
      for (const [mode, agg] of Object.entries(modeAgg)) {
        out[mode] = {
          precision: avg(agg.p),
          completeness: avg(agg.c),
          avgTokens: avg(agg.tokens),
          avgCtxSize: avg(agg.ctxSize),
          avgSources: avg(agg.sources),
        };
      }
      return out;
    },
  });

  // ---- Compute Overall Project Score
  const overall = useMemo(() => {
    if (!health) return null;
    const stats = (lastBatch?.statistics ?? {}) as BatchStats;
    // precision/completeness aggregate across non-external modes
    const modes = evalSummary ? Object.values(evalSummary) : [];
    const avgPrecision = modes.length ? (modes.reduce((s, m) => s + m.precision, 0) / modes.length) * 20 : 0; // 1-5 → 0-100
    const avgCompleteness = modes.length ? (modes.reduce((s, m) => s + m.completeness, 0) / modes.length) * 20 : 0;
    const knowledgeHealth = health.overall_health_score ?? 0;
    const avgConfidence = (health.topics ?? []).length
      ? (health.topics ?? []).reduce((s: number, t: TopicHealth) => s + (t.confidence_score ?? 0), 0) / (health.topics ?? []).length
      : 0;
    const coreCoverage = (health.topics ?? []).length
      ? (health.topics ?? []).reduce((s: number, t: TopicHealth) => s + (t.core_coverage ?? 0), 0) / (health.topics ?? []).length
      : 0;
    const pendingPenalty = Math.min(100, (counts?.conflicts ?? 0) * 10);
    const score =
      0.30 * knowledgeHealth +
      0.30 * avgPrecision +
      0.15 * avgCompleteness +
      0.10 * avgConfidence +
      0.10 * coreCoverage +
      0.05 * (100 - pendingPenalty);
    return {
      score: Math.round(score),
      breakdown: {
        knowledgeHealth, avgPrecision, avgCompleteness, avgConfidence, coreCoverage,
        pendingPenalty, stats,
      },
    };
  }, [health, lastBatch, evalSummary, counts]);

  // ---- Top missing core fields
  const topMissing = useMemo(() => {
    if (!health?.topics) return [];
    const rows: { topic: string; field: string }[] = [];
    for (const t of health.topics as TopicHealth[]) {
      for (const m of t.missing_required_fields ?? []) {
        rows.push({ topic: t.topic_name, field: m.field_label || m.field_name });
      }
    }
    return rows.slice(0, 10);
  }, [health]);

  // ---- Topic ranking
  const topicRows = useMemo(() => {
    if (!health?.topics) return [];
    return [...(health.topics as TopicHealth[])].sort((a, b) => b.health_score - a.health_score);
  }, [health]);

  // ---- Architecture comparison Raw vs Hybrid (structured)
  const arch = useMemo(() => {
    if (!evalSummary) return null;
    const raw = evalSummary["raw_chunks"];
    const hyb = evalSummary["structured"];
    if (!raw || !hyb) return null;
    const stats = (lastBatch?.statistics ?? {}) as BatchStats;
    const rawLat = stats.avg_latency_by_mode?.raw_chunks ?? 0;
    const hybLat = stats.avg_latency_by_mode?.structured ?? 0;
    const rawCost = stats.total_cost_by_mode?.raw_chunks ?? 0;
    const hybCost = stats.total_cost_by_mode?.structured ?? 0;
    return {
      precision: { raw: raw.precision, hybrid: hyb.precision },
      completeness: { raw: raw.completeness, hybrid: hyb.completeness },
      latency: { raw: rawLat, hybrid: hybLat },
      cost: { raw: rawCost, hybrid: hybCost },
      tokens: { raw: raw.avgTokens, hybrid: hyb.avgTokens },
      ctxSize: { raw: raw.avgCtxSize, hybrid: hyb.avgCtxSize },
      sources: { raw: raw.avgSources, hybrid: hyb.avgSources },
    };
  }, [evalSummary, lastBatch]);

  function diffBadge(rawVal: number, hybVal: number, lowerIsBetter = false) {
    if (rawVal === 0 && hybVal === 0) return <Badge variant="secondary">—</Badge>;
    const base = rawVal || 1;
    const diff = ((hybVal - rawVal) / base) * 100;
    const hybridWins = lowerIsBetter ? hybVal < rawVal : hybVal > rawVal;
    const arrow = hybVal === rawVal ? "=" : hybridWins ? (lowerIsBetter ? "↓" : "↑") : (lowerIsBetter ? "↑" : "↓");
    const label = `Hybrid ${arrow} ${diff > 0 ? "+" : ""}${diff.toFixed(0)}%`;
    return <Badge variant={hybridWins ? "default" : "destructive"}>{label}</Badge>;
  }

  const summaryMut = useMutation({
    mutationFn: async () => {
      const metrics = {
        overall_score: overall?.score,
        knowledge_health: health?.overall_health_score,
        counts,
        schema: schemaCounts,
        costs,
        benchmark_stats: lastBatch?.statistics,
        architecture_comparison: arch,
        top_missing: topMissing,
        worst_topics: topicRows.slice(-5).map((t) => ({ name: t.topic_name, score: t.health_score })),
        best_topics: topicRows.slice(0, 5).map((t) => ({ name: t.topic_name, score: t.health_score })),
      };
      return await runSummary({ data: { projectId, metrics } });
    },
    onSuccess: (r) => { setSummary(r.summary); toast.success("Resumo gerado."); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Falha ao gerar resumo."),
  });

  const snapshotMut = useMutation({
    mutationFn: async () => {
      const name = `Snapshot ${new Date().toLocaleString("pt-BR")}`;
      return await runSnapshot({
        data: {
          projectId,
          name,
          overallScore: overall?.score,
          payload: {
            health,
            counts,
            schema: schemaCounts,
            costs,
            benchmark_stats: lastBatch?.statistics,
            architecture_comparison: arch,
            summary,
          } as Record<string, unknown>,
        },
      });
    },
    onSuccess: () => { toast.success("Snapshot salvo."); qc.invalidateQueries({ queryKey: ["snapshots", projectId] }); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Falha"),
  });

  function exportJson() {
    const blob = new Blob([JSON.stringify({
      overall, health, counts, schema: schemaCounts, costs,
      benchmark: lastBatch, evaluations: evalSummary, architecture: arch,
      top_missing: topMissing, topics: topicRows, summary,
    }, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `executive-report-${projectId}-${Date.now()}.json`;
    a.click();
  }

  function exportPdf() {
    // Simple browser-print approach (zero deps). User can Save as PDF.
    window.print();
  }

  if (hLoading) return <Skeleton className="h-96" />;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-xl font-semibold">Executive Report</h2>
          <p className="text-sm text-muted-foreground">Consolidação automática das métricas existentes.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={exportJson}>Export JSON</Button>
          <Button variant="outline" onClick={exportPdf}>Export PDF</Button>
          <Button variant="outline" onClick={() => snapshotMut.mutate()} disabled={snapshotMut.isPending}>
            {snapshotMut.isPending ? "Salvando..." : "Save Snapshot"}
          </Button>
          <Button onClick={() => summaryMut.mutate()} disabled={summaryMut.isPending}>
            {summaryMut.isPending ? "Gerando..." : "Generate Executive Report"}
          </Button>
        </div>
      </div>

      {/* Overall score */}
      <Card>
        <CardHeader><CardTitle>Overall Project Score</CardTitle></CardHeader>
        <CardContent>
          <div className="flex items-end gap-6">
            <div className="text-6xl font-bold">{overall?.score ?? "—"}</div>
            <div className="grid flex-1 grid-cols-2 gap-2 text-xs md:grid-cols-3">
              <div>Knowledge Health: <b>{pct(overall?.breakdown.knowledgeHealth)}</b></div>
              <div>Benchmark Precision: <b>{pct(overall?.breakdown.avgPrecision)}</b></div>
              <div>Benchmark Completeness: <b>{pct(overall?.breakdown.avgCompleteness)}</b></div>
              <div>Avg Confidence: <b>{pct(overall?.breakdown.avgConfidence)}</b></div>
              <div>Core Coverage: <b>{pct(overall?.breakdown.coreCoverage)}</b></div>
              <div>Pending Conflicts: <b>{counts?.conflicts ?? 0}</b></div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Cards */}
      <div className="grid gap-3 md:grid-cols-4">
        {[
          ["Knowledge Health", health ? `${health.overall_health_score}` : "—"],
          ["Benchmark Winner", arch ? (arch.precision.hybrid > arch.precision.raw ? "Hybrid" : "Raw") : "—"],
          ["Total Sources", num(counts?.sources)],
          ["Total Raw Chunks", num(counts?.chunks)],
          ["Consolidated Fields", num(counts?.consolidated)],
          ["Dynamic Fields", num(counts?.dynamic)],
          ["Additional Info", num(counts?.additional)],
          ["Pending Conflicts", num(counts?.conflicts)],
          ["Suggested Data Points", num(schemaCounts?.suggested)],
          ["Approved Data Points", num(schemaCounts?.approved)],
          ["Extraction Cost", money(costs?.extraction)],
          ["Benchmark Cost", money(costs?.benchmark)],
          ["Total LLM Cost", money(costs?.total)],
        ].map(([label, value]) => (
          <Card key={String(label)}>
            <CardContent className="py-3">
              <div className="text-xs text-muted-foreground">{label}</div>
              <div className="text-lg font-semibold">{value}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Architecture comparison */}
      <Card>
        <CardHeader><CardTitle>Architecture Comparison — Raw vs Hybrid</CardTitle></CardHeader>
        <CardContent>
          {!arch ? (
            <p className="text-sm text-muted-foreground">
              Sem comparação disponível. Rode um benchmark com modos <code>raw_chunks</code> e <code>structured</code> e avalie as respostas.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Métrica</TableHead>
                  <TableHead>Raw</TableHead>
                  <TableHead>Hybrid</TableHead>
                  <TableHead>Vencedor</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow><TableCell>Precision (1-5)</TableCell><TableCell>{arch.precision.raw.toFixed(2)}</TableCell><TableCell>{arch.precision.hybrid.toFixed(2)}</TableCell><TableCell>{diffBadge(arch.precision.raw, arch.precision.hybrid)}</TableCell></TableRow>
                <TableRow><TableCell>Completeness (1-5)</TableCell><TableCell>{arch.completeness.raw.toFixed(2)}</TableCell><TableCell>{arch.completeness.hybrid.toFixed(2)}</TableCell><TableCell>{diffBadge(arch.completeness.raw, arch.completeness.hybrid)}</TableCell></TableRow>
                <TableRow><TableCell>Latency (ms)</TableCell><TableCell>{num(arch.latency.raw)}</TableCell><TableCell>{num(arch.latency.hybrid)}</TableCell><TableCell>{diffBadge(arch.latency.raw, arch.latency.hybrid, true)}</TableCell></TableRow>
                <TableRow><TableCell>Cost (USD)</TableCell><TableCell>{money(arch.cost.raw)}</TableCell><TableCell>{money(arch.cost.hybrid)}</TableCell><TableCell>{diffBadge(arch.cost.raw, arch.cost.hybrid, true)}</TableCell></TableRow>
                <TableRow><TableCell>Avg Input Tokens</TableCell><TableCell>{num(arch.tokens.raw)}</TableCell><TableCell>{num(arch.tokens.hybrid)}</TableCell><TableCell>{diffBadge(arch.tokens.raw, arch.tokens.hybrid, true)}</TableCell></TableRow>
                <TableRow><TableCell>Context Size (chars)</TableCell><TableCell>{num(arch.ctxSize.raw)}</TableCell><TableCell>{num(arch.ctxSize.hybrid)}</TableCell><TableCell>{diffBadge(arch.ctxSize.raw, arch.ctxSize.hybrid, true)}</TableCell></TableRow>
                <TableRow><TableCell>Avg Sources Used</TableCell><TableCell>{num(arch.sources.raw)}</TableCell><TableCell>{num(arch.sources.hybrid)}</TableCell><TableCell>{diffBadge(arch.sources.raw, arch.sources.hybrid, true)}</TableCell></TableRow>
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Topic ranking */}
      <Card>
        <CardHeader><CardTitle>Melhores e Piores Tópicos</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Topic</TableHead>
                <TableHead>Health</TableHead>
                <TableHead>Core Coverage</TableHead>
                <TableHead>Conflicts</TableHead>
                <TableHead>Missing</TableHead>
                <TableHead>Dynamic</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {topicRows.map((t) => (
                <TableRow key={t.topic_slug}>
                  <TableCell>{t.topic_name}</TableCell>
                  <TableCell>{t.health_score}</TableCell>
                  <TableCell>{pct(t.core_coverage)}</TableCell>
                  <TableCell>{t.pending_conflicts_count}</TableCell>
                  <TableCell>{(t.missing_required_fields ?? []).length}</TableCell>
                  <TableCell>{t.dynamic_fields_count}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Top 10 missing */}
      <Card>
        <CardHeader><CardTitle>Top 10 Lacunas (Core Fields Faltantes)</CardTitle></CardHeader>
        <CardContent>
          {topMissing.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum campo core faltando 🎉</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {topMissing.map((m, i) => (
                <li key={i} className="flex items-center justify-between border-b py-1">
                  <span><b>{m.topic}</b> — {m.field}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Executive summary */}
      <Card>
        <CardHeader><CardTitle>Resumo Executivo</CardTitle></CardHeader>
        <CardContent>
          {summary ? (
            <pre className="whitespace-pre-wrap text-sm leading-relaxed">{summary}</pre>
          ) : (
            <p className="text-sm text-muted-foreground">
              Clique em <b>Generate Executive Report</b> para gerar um resumo em linguagem natural baseado nas métricas acima.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
