import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  analyzeDynamicFields,
  approveSuggestion,
  rejectSuggestion,
  getSchemaEvolutionStats,
} from "@/lib/schema-evolution.functions";

type Aggregate = {
  topic_slug: string;
  topic_definition_id: string | null;
  field_name: string;
  inferred_type: string;
  occurrences: number;
  projects_count: number;
  consolidated_count: number;
  avg_confidence: number;
  examples: unknown[];
  suggestion_score: number;
  already_official: boolean;
  suggestion_status: "pending" | "approved" | "rejected" | null;
  suggestion_id: string | null;
};

export function SchemaEvolutionTab() {
  const qc = useQueryClient();
  const analyzeFn = useServerFn(analyzeDynamicFields);
  const statsFn = useServerFn(getSchemaEvolutionStats);
  const approveFn = useServerFn(approveSuggestion);
  const rejectFn = useServerFn(rejectSuggestion);

  const [aggs, setAggs] = useState<Aggregate[]>([]);
  const [running, setRunning] = useState(false);
  const [editing, setEditing] = useState<Record<string, { name: string; label: string; type: string }>>({});

  const { data: stats, refetch: refetchStats } = useQuery({
    queryKey: ["schema_evolution_stats"],
    queryFn: () => statsFn() as Promise<{
      dynamic_fields_total: number;
      suggestions: { pending: number; approved: number; rejected: number };
      official_data_points: number;
    }>,
  });

  async function run() {
    setRunning(true);
    try {
      const r = (await analyzeFn()) as { aggregates: Aggregate[]; created: number };
      setAggs(r.aggregates);
      toast.success(`${r.aggregates.length} dynamic fields analisados; ${r.created} novas sugestões.`);
      refetchStats();
      qc.invalidateQueries({ queryKey: ["suggestions_by_topic"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally { setRunning(false); }
  }

  async function approve(a: Aggregate) {
    if (!a.suggestion_id) { toast.error("Sem sugestão (rode Analyze primeiro)."); return; }
    const edit = editing[a.suggestion_id];
    try {
      await approveFn({ data: {
        suggestionId: a.suggestion_id,
        field_name: edit?.name,
        field_label: edit?.label,
        field_type: edit?.type,
      }});
      toast.success("Promovido a Data Point oficial.");
      run();
    } catch (e) { toast.error(e instanceof Error ? e.message : String(e)); }
  }

  async function reject(a: Aggregate) {
    if (!a.suggestion_id) return;
    try {
      await rejectFn({ data: { suggestionId: a.suggestion_id } });
      toast.success("Sugestão rejeitada.");
      run();
    } catch (e) { toast.error(e instanceof Error ? e.message : String(e)); }
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <StatCard label="Dynamic Fields" value={stats?.dynamic_fields_total ?? 0} />
        <StatCard label="Suggested (pending)" value={stats?.suggestions.pending ?? 0} />
        <StatCard label="Approved" value={stats?.suggestions.approved ?? 0} />
        <StatCard label="Rejected" value={stats?.suggestions.rejected ?? 0} />
        <StatCard label="Official Data Points" value={stats?.official_data_points ?? 0} />
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-base">Analyze Dynamic Fields</CardTitle>
            <p className="text-xs text-muted-foreground">Determinístico, sem LLM. Agrupa por topic+field_name normalizado.</p>
          </div>
          <Button onClick={run} disabled={running}>{running ? "Analisando..." : "Run Analysis"}</Button>
        </CardHeader>
        <CardContent>
          {aggs.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum resultado ainda — clique em Run Analysis.</p>
          ) : (
            <div className="overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Field</TableHead>
                    <TableHead>Topic</TableHead>
                    <TableHead className="text-right">Occur.</TableHead>
                    <TableHead className="text-right">Projects</TableHead>
                    <TableHead className="text-right">Conf.</TableHead>
                    <TableHead className="text-right">Score</TableHead>
                    <TableHead>Examples</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {aggs.map((a) => {
                    const key = a.suggestion_id ?? `${a.topic_slug}-${a.field_name}`;
                    const ed = editing[a.suggestion_id ?? ""];
                    return (
                      <TableRow key={key}>
                        <TableCell className="font-mono text-xs">
                          {a.suggestion_id && a.suggestion_status === "pending" ? (
                            <Input className="h-7 text-xs" value={ed?.name ?? a.field_name}
                              onChange={(e) => setEditing((s) => ({ ...s, [a.suggestion_id!]: { ...(s[a.suggestion_id!] ?? { label: a.field_name, type: a.inferred_type, name: a.field_name }), name: e.target.value } }))} />
                          ) : a.field_name}
                        </TableCell>
                        <TableCell><Badge variant="outline">{a.topic_slug}</Badge></TableCell>
                        <TableCell className="text-right">{a.occurrences}</TableCell>
                        <TableCell className="text-right">{a.projects_count}</TableCell>
                        <TableCell className="text-right">{a.avg_confidence.toFixed(2)}</TableCell>
                        <TableCell className="text-right font-medium">{a.suggestion_score.toFixed(1)}</TableCell>
                        <TableCell className="max-w-[200px] truncate text-xs text-muted-foreground" title={JSON.stringify(a.examples)}>
                          {a.examples.slice(0, 2).map((e) => typeof e === "string" ? e : JSON.stringify(e)).join(", ")}
                        </TableCell>
                        <TableCell>
                          {a.already_official ? <Badge>Official</Badge>
                            : a.suggestion_status === "approved" ? <Badge>Approved</Badge>
                            : a.suggestion_status === "rejected" ? <Badge variant="outline">Rejected</Badge>
                            : a.suggestion_status === "pending" ? <Badge variant="secondary">Pending</Badge>
                            : <Badge variant="outline">—</Badge>}
                        </TableCell>
                        <TableCell className="text-right">
                          {a.suggestion_status === "pending" && (
                            <div className="flex gap-1 justify-end">
                              <Button size="sm" onClick={() => approve(a)}>Approve</Button>
                              <Button size="sm" variant="ghost" onClick={() => reject(a)}>Reject</Button>
                            </div>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <SchemaGrowthCard />
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <Card><CardContent className="p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-2xl font-semibold">{value}</div>
    </CardContent></Card>
  );
}

function SchemaGrowthCard() {
  const { data } = useQuery({
    queryKey: ["schema_growth_timeline"],
    queryFn: async () => {
      const [dp, sg] = await Promise.all([
        supabase.from("data_point_definitions").select("created_at"),
        supabase.from("suggested_data_points").select("created_at, status"),
      ]);
      type Bucket = { day: string; official: number; suggested: number; approved: number };
      const buckets = new Map<string, Bucket>();
      function bump(day: string, k: keyof Omit<Bucket, "day">) {
        let b = buckets.get(day);
        if (!b) { b = { day, official: 0, suggested: 0, approved: 0 }; buckets.set(day, b); }
        b[k]++;
      }
      for (const r of dp.data ?? []) bump((r.created_at ?? "").slice(0, 10), "official");
      for (const r of sg.data ?? []) {
        const d = (r.created_at ?? "").slice(0, 10);
        bump(d, "suggested");
        if (r.status === "approved") bump(d, "approved");
      }
      return [...buckets.values()].sort((a, b) => a.day.localeCompare(b.day));
    },
  });

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Schema Growth Timeline</CardTitle></CardHeader>
      <CardContent>
        {!data || data.length === 0 ? (
          <p className="text-sm text-muted-foreground">Sem histórico ainda.</p>
        ) : (
          <Table>
            <TableHeader><TableRow>
              <TableHead>Dia</TableHead>
              <TableHead className="text-right">Official</TableHead>
              <TableHead className="text-right">Suggested</TableHead>
              <TableHead className="text-right">Approved</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {data.map((d) => (
                <TableRow key={d.day}>
                  <TableCell className="font-mono text-xs">{d.day}</TableCell>
                  <TableCell className="text-right">{d.official}</TableCell>
                  <TableCell className="text-right">{d.suggested}</TableCell>
                  <TableCell className="text-right">{d.approved}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
