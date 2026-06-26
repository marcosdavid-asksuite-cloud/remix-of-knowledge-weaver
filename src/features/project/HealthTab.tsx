import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { calculateKnowledgeHealth, type HealthReport, type TopicHealth } from "@/lib/health.functions";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";

function scoreBadge(score: number) {
  if (score >= 80) return <Badge className="bg-emerald-600 text-white hover:bg-emerald-600">Healthy {score}</Badge>;
  if (score >= 60) return <Badge className="bg-amber-500 text-white hover:bg-amber-500">Attention {score}</Badge>;
  return <Badge variant="destructive">Critical {score}</Badge>;
}

const FLAG_LABELS: Record<string, string> = {
  missing_required_fields: "Este tópico possui campos obrigatórios sem preenchimento.",
  pending_conflicts: "Existem conflitos pendentes que podem afetar respostas.",
  schema_may_be_incomplete: "Muitas informações estão em campos dinâmicos. Talvez o schema oficial precise ser ampliado.",
  high_text_dependency: "Este tópico depende muito de texto adicional.",
  empty_topic: "Este tópico ainda não possui nenhuma informação consolidada.",
};

function toCsv(report: HealthReport) {
  const head = [
    "topic","health_score","core_coverage","required_coverage","confidence_score",
    "dynamic_ratio","missing_required_fields","missing_optional_fields",
    "pending_conflicts_count","pending_candidates_count","flags",
  ];
  const lines = [head.join(",")];
  for (const t of report.topics) {
    const row = [
      t.topic_slug,
      t.health_score,
      t.core_coverage,
      t.required_coverage,
      t.confidence_score,
      t.dynamic_ratio,
      t.missing_required_fields.map((m) => m.field_name).join("|"),
      t.missing_optional_fields.map((m) => m.field_name).join("|"),
      t.pending_conflicts_count,
      t.pending_candidates_count,
      t.flags.join("|"),
    ].map((v) => {
      const s = String(v ?? "");
      return s.includes(",") || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s;
    });
    lines.push(row.join(","));
  }
  return lines.join("\n");
}

export function HealthTab({ projectId }: { projectId: string }) {
  const qc = useQueryClient();
  const runCalc = useServerFn(calculateKnowledgeHealth);
  const [selected, setSelected] = useState<TopicHealth | null>(null);

  const { data: report, isLoading, isFetching } = useQuery({
    queryKey: ["health", projectId],
    queryFn: () => runCalc({ data: { projectId, persistSnapshot: false } }),
    staleTime: 30_000,
  });

  async function recompute() {
    try {
      await runCalc({ data: { projectId, persistSnapshot: true } });
      await qc.invalidateQueries({ queryKey: ["health", projectId] });
      toast.success("Snapshot recalculado.");
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  function exportCsv() {
    if (!report) return;
    const blob = new Blob([toCsv(report)], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `health-${projectId.slice(0, 8)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (isLoading) return <p className="text-sm text-muted-foreground">Calculando...</p>;
  if (!report) return <p className="text-sm text-muted-foreground">Sem dados.</p>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Knowledge Health</h2>
          <p className="text-xs text-muted-foreground">
            Diagnóstico determinístico da base estruturada. Atualizado em {new Date(report.computed_at).toLocaleString()}.
          </p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={exportCsv}>Export Health CSV</Button>
          <Button size="sm" onClick={recompute} disabled={isFetching}>
            {isFetching ? "Recalculando..." : "Recalcular & Snapshot"}
          </Button>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-5">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground">Overall Health</CardTitle></CardHeader>
          <CardContent>
            <div className="text-3xl font-semibold">{report.overall_health_score}</div>
            <Progress className="mt-2" value={report.overall_health_score} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground">Core Coverage Média</CardTitle></CardHeader>
          <CardContent>
            <div className="text-3xl font-semibold">{report.avg_core_coverage}%</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground">Conflitos Pendentes</CardTitle></CardHeader>
          <CardContent><div className="text-3xl font-semibold">{report.total_pending_conflicts}</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground">Required Faltantes</CardTitle></CardHeader>
          <CardContent><div className="text-3xl font-semibold">{report.total_missing_required}</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground">Tópicos Críticos</CardTitle></CardHeader>
          <CardContent><div className="text-3xl font-semibold">{report.critical_topics_count}</div></CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-sm">Tópicos</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr>
                <th className="py-2 pr-3">Topic</th>
                <th className="py-2 pr-3">Health</th>
                <th className="py-2 pr-3">Core</th>
                <th className="py-2 pr-3">Required</th>
                <th className="py-2 pr-3">Conflicts</th>
                <th className="py-2 pr-3">Pending Review</th>
                <th className="py-2 pr-3">Dyn Ratio</th>
                <th className="py-2 pr-3">Flags</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {report.topics.map((t) => (
                <tr key={t.topic_definition_id} className="border-t">
                  <td className="py-2 pr-3">
                    <div className="font-medium">{t.topic_name}</div>
                    <div className="text-xs text-muted-foreground">{t.topic_slug}</div>
                  </td>
                  <td className="py-2 pr-3">{scoreBadge(t.health_score)}</td>
                  <td className="py-2 pr-3 tabular-nums">{t.filled_core_count}/{t.total_core_defs} · {t.core_coverage}%</td>
                  <td className="py-2 pr-3 tabular-nums">{t.filled_required_count}/{t.total_required_defs} · {t.required_coverage}%</td>
                  <td className="py-2 pr-3 tabular-nums">{t.pending_conflicts_count}</td>
                  <td className="py-2 pr-3 tabular-nums">{t.pending_candidates_count + t.pending_additional_info_count}</td>
                  <td className="py-2 pr-3 tabular-nums">{Math.round(t.dynamic_ratio * 100)}%</td>
                  <td className="py-2 pr-3">
                    <div className="flex flex-wrap gap-1">
                      {t.flags.map((f) => (
                        <Badge key={f} variant="outline" className="text-[10px]">{f}</Badge>
                      ))}
                    </div>
                  </td>
                  <td className="py-2 text-right">
                    <Button size="sm" variant="ghost" onClick={() => setSelected(t)}>Detalhes</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Dialog open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          {selected && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  {selected.topic_name}
                  {scoreBadge(selected.health_score)}
                </DialogTitle>
              </DialogHeader>

              {selected.flags.length > 0 && (
                <section className="space-y-1">
                  <h3 className="text-sm font-semibold">Issues</h3>
                  <ul className="space-y-1 text-sm">
                    {selected.flags.map((f) => (
                      <li key={f} className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-amber-900">
                        {FLAG_LABELS[f] ?? f}
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              <section>
                <h3 className="mb-1 text-sm font-semibold">Missing Core Fields ({selected.missing_required_fields.length + selected.missing_optional_fields.length})</h3>
                <div className="space-y-2 text-sm">
                  {selected.missing_required_fields.length > 0 && (
                    <div>
                      <div className="text-xs text-muted-foreground">Required</div>
                      <ul className="ml-4 list-disc">
                        {selected.missing_required_fields.map((m) => (
                          <li key={m.field_name}>
                            <span className="font-medium">{m.field_label}</span>{" "}
                            <span className="text-xs text-muted-foreground">({m.field_name} · {m.field_type})</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {selected.missing_optional_fields.length > 0 && (
                    <div>
                      <div className="text-xs text-muted-foreground">Optional</div>
                      <ul className="ml-4 list-disc">
                        {selected.missing_optional_fields.map((m) => (
                          <li key={m.field_name}>
                            <span className="font-medium">{m.field_label}</span>{" "}
                            <span className="text-xs text-muted-foreground">({m.field_name} · {m.field_type})</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {selected.missing_required_fields.length + selected.missing_optional_fields.length === 0 && (
                    <p className="text-xs text-muted-foreground">Nenhum campo oficial faltando.</p>
                  )}
                </div>
              </section>

              <section>
                <h3 className="mb-1 text-sm font-semibold">Consolidated Fields ({selected.consolidated_fields.length})</h3>
                {selected.consolidated_fields.length === 0 ? (
                  <p className="text-xs text-muted-foreground">Nenhum campo consolidado.</p>
                ) : (
                  <ul className="space-y-1 text-sm">
                    {selected.consolidated_fields.map((f) => (
                      <li key={f.field_name} className="rounded border px-2 py-1">
                        <div className="font-medium">{f.field_label}</div>
                        <div className="text-xs">
                          Valor: <code className="font-mono">{JSON.stringify(f.field_value)}</code>
                        </div>
                        <div className="text-xs text-muted-foreground">
                          confidence: {f.confidence ?? "—"} · source: {f.source_of_truth ?? "—"}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section>
                <h3 className="mb-1 text-sm font-semibold">Dynamic Fields ({selected.dynamic_fields.length})</h3>
                {selected.dynamic_fields.length === 0 ? (
                  <p className="text-xs text-muted-foreground">Nenhum campo dinâmico.</p>
                ) : (
                  <ul className="space-y-1 text-sm">
                    {selected.dynamic_fields.map((f) => (
                      <li key={f.field_name} className="rounded border px-2 py-1">
                        <div className="font-medium">{f.field_name}</div>
                        <div className="text-xs">
                          Valor: <code className="font-mono">{JSON.stringify(f.field_value)}</code>
                        </div>
                        <div className="text-xs text-muted-foreground">
                          confidence: {f.confidence ?? "—"} · source: {f.source_of_truth ?? "—"}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section>
                <h3 className="mb-1 text-sm font-semibold">Additional Information</h3>
                <p className="text-sm">
                  Aprovadas: <strong>{selected.additional_info_approved}</strong> · Pendentes: <strong>{selected.pending_additional_info_count}</strong> · Total: <strong>{selected.additional_info_count}</strong>
                </p>
              </section>

              <section className="flex flex-wrap gap-2 border-t pt-3">
                <Button size="sm" variant="outline" onClick={() => { setSelected(null); document.querySelector<HTMLButtonElement>('[role="tab"][value="knowledge"]')?.click(); }}>Go to Knowledge</Button>
                <Button size="sm" variant="outline" onClick={() => { setSelected(null); document.querySelector<HTMLButtonElement>('[role="tab"][value="consolidation"]')?.click(); }}>Go to Conflicts</Button>
                <Button size="sm" variant="outline" asChild>
                  <a href="/settings">Go to Data Point Definitions</a>
                </Button>
                <Button size="sm" variant="outline" onClick={() => { setSelected(null); document.querySelector<HTMLButtonElement>('[role="tab"][value="benchmark"]')?.click(); }}>Go to Benchmark</Button>
              </section>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
