import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  consolidateKnowledge,
  approveCandidate,
  rejectCandidate,
  resolveConflict,
  approveAdditionalInfo,
  rejectAdditionalInfo,
} from "@/lib/consolidation.functions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";

type TopicRow = {
  id: string;
  topic_definition_id: string;
  topic_definitions: { slug: string; name: string } | null;
};
type Candidate = {
  id: string;
  topic_definition_id: string;
  field_name: string;
  field_type: string;
  field_value: unknown;
  field_origin: string;
  confidence: number | null;
  source_chunk_ids: string[];
  status: string;
  extraction_method: string;
  extraction_run_id: string | null;
};
type KField = {
  id: string;
  topic_id: string;
  field_name: string;
  field_type: string;
  field_value: unknown;
  field_origin: string;
  confidence: number | null;
  source_chunk_ids: string[];
  source_of_truth: string;
  consolidation_status: string;
  approved_by_user: boolean;
  candidate_ids: string[];
};
type Conflict = {
  id: string;
  topic_definition_id: string;
  field_name: string;
  field_type: string;
  conflict_type: string;
  status: string;
  candidate_ids: string[];
};
type Addl = {
  id: string;
  topic_id: string;
  content: string;
  status: string;
};

function renderValue(v: unknown): string {
  if (v == null) return "—";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

const METHOD_COLOR: Record<string, string> = {
  regex: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  keyword: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
  llm: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
};

const SOT_LABEL: Record<string, string> = {
  auto_single_candidate: "auto · single",
  auto_merged_candidates: "auto · merged",
  manually_selected_candidate: "manual · selected",
  manually_edited: "manual · edited",
  imported: "imported",
};

export function ConsolidationTab({ projectId }: { projectId: string }) {
  const qc = useQueryClient();
  const runFn = useServerFn(consolidateKnowledge);
  const approveCandFn = useServerFn(approveCandidate);
  const rejectCandFn = useServerFn(rejectCandidate);
  const resolveFn = useServerFn(resolveConflict);
  const approveAddFn = useServerFn(approveAdditionalInfo);
  const rejectAddFn = useServerFn(rejectAdditionalInfo);
  const [running, setRunning] = useState(false);
  const [sourcesFor, setSourcesFor] = useState<null | { ids: string[]; title: string }>(null);

  const { data: topics } = useQuery({
    queryKey: ["consol_topics", projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("topics")
        .select("id, topic_definition_id, topic_definitions(slug, name)")
        .eq("project_id", projectId);
      if (error) throw error;
      return (data ?? []) as unknown as TopicRow[];
    },
  });

  const topicIds = (topics ?? []).map((t) => t.id);
  const topicByDef = useMemo(() => {
    const m = new Map<string, TopicRow>();
    for (const t of topics ?? []) m.set(t.topic_definition_id, t);
    return m;
  }, [topics]);
  const topicById = useMemo(() => {
    const m = new Map<string, TopicRow>();
    for (const t of topics ?? []) m.set(t.id, t);
    return m;
  }, [topics]);

  const { data: candidates } = useQuery({
    queryKey: ["consol_candidates", projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("knowledge_candidates").select("*")
        .eq("project_id", projectId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as Candidate[];
    },
  });

  const { data: fields } = useQuery({
    queryKey: ["consol_fields", projectId, topicIds.join(",")],
    enabled: topicIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("knowledge_fields").select("*").in("topic_id", topicIds);
      if (error) throw error;
      return (data ?? []) as unknown as KField[];
    },
  });

  const { data: conflicts } = useQuery({
    queryKey: ["consol_conflicts", projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("knowledge_conflicts").select("*")
        .eq("project_id", projectId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as Conflict[];
    },
  });

  const { data: addls } = useQuery({
    queryKey: ["consol_addl", projectId, topicIds.join(",")],
    enabled: topicIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("additional_info").select("*").in("topic_id", topicIds);
      if (error) throw error;
      return (data ?? []) as unknown as Addl[];
    },
  });

  function refresh() {
    qc.invalidateQueries({ queryKey: ["consol_candidates", projectId] });
    qc.invalidateQueries({ queryKey: ["consol_fields", projectId] });
    qc.invalidateQueries({ queryKey: ["consol_conflicts", projectId] });
    qc.invalidateQueries({ queryKey: ["consol_addl", projectId] });
    qc.invalidateQueries({ queryKey: ["knowledge_fields", projectId] });
  }

  async function runConsolidation() {
    setRunning(true);
    try {
      const res = await runFn({ data: { projectId } });
      toast.success(
        `Consolidação: ${res.consolidated_fields} single · ${res.merged_fields} merged · ${res.new_conflicts} novos conflitos`,
      );
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falhou");
    } finally {
      setRunning(false);
    }
  }

  const pendingCands = (candidates ?? []).filter((c) => c.status === "pending");
  const consolidated = (fields ?? []).filter((f) => f.consolidation_status === "consolidated");
  const pendingConflicts = (conflicts ?? []).filter((c) => c.status === "pending");
  const resolvedConflicts = (conflicts ?? []).filter((c) => c.status !== "pending");

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Pending candidates" value={pendingCands.length} />
        <Stat label="Consolidated fields" value={consolidated.length} />
        <Stat label="Pending conflicts" value={pendingConflicts.length} tone={pendingConflicts.length > 0 ? "warn" : undefined} />
        <Stat label="Resolved conflicts" value={resolvedConflicts.length} />
      </div>

      <div className="flex gap-2">
        <Button onClick={runConsolidation} disabled={running}>
          {running ? "Consolidando…" : "Run Consolidation"}
        </Button>
        <Button variant="outline" onClick={runConsolidation} disabled={running}>
          Re-run
        </Button>
      </div>

      {pendingConflicts.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Conflicts ({pendingConflicts.length})</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {pendingConflicts.map((c) => (
              <ConflictCard
                key={c.id}
                conflict={c}
                topicName={topicByDef.get(c.topic_definition_id)?.topic_definitions?.name ?? c.topic_definition_id}
                candidates={(candidates ?? []).filter((k) => c.candidate_ids.includes(k.id))}
                onResolve={async (action, payload) => {
                  try {
                    await resolveFn({ data: { conflictId: c.id, action, ...payload } });
                    toast.success("Conflito resolvido");
                    refresh();
                  } catch (e) {
                    toast.error(e instanceof Error ? e.message : "Falhou");
                  }
                }}
                onViewSources={(ids, title) => setSourcesFor({ ids, title })}
              />
            ))}
          </CardContent>
        </Card>
      )}

      {(topics ?? []).map((t) => {
        const tFields = consolidated.filter((f) => f.topic_id === t.id);
        const tCands = pendingCands.filter((c) => c.topic_definition_id === t.topic_definition_id);
        const tAddl = (addls ?? []).filter((a) => a.topic_id === t.id);
        if (tFields.length === 0 && tCands.length === 0 && tAddl.length === 0) return null;
        return (
          <Card key={t.id}>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                {t.topic_definitions?.name}
                <Badge variant="outline" className="font-mono text-[10px]">{t.topic_definitions?.slug}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              {tFields.length > 0 && (
                <div>
                  <div className="mb-2 text-xs font-semibold uppercase text-muted-foreground">
                    Consolidated Fields
                  </div>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left text-[11px] text-muted-foreground">
                        <th className="py-1 pr-2">Field</th>
                        <th className="py-1 pr-2">Value</th>
                        <th className="py-1 pr-2">Source of truth</th>
                        <th className="py-1 pr-2">Conf.</th>
                        <th className="py-1 pr-2">Sources</th>
                        <th className="py-1 pr-2">Approved</th>
                        <th className="py-1 pr-2"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {tFields.map((f) => (
                        <tr key={f.id} className="border-b last:border-0">
                          <td className="py-1 pr-2 font-mono text-[11px]">{f.field_name}</td>
                          <td className="py-1 pr-2">{renderValue(f.field_value)}</td>
                          <td className="py-1 pr-2">
                            <Badge variant="outline" className="text-[10px]">
                              {SOT_LABEL[f.source_of_truth] ?? f.source_of_truth}
                            </Badge>
                          </td>
                          <td className="py-1 pr-2 text-xs">{f.confidence != null ? f.confidence.toFixed(2) : "—"}</td>
                          <td className="py-1 pr-2 text-xs">{f.source_chunk_ids?.length ?? 0}</td>
                          <td className="py-1 pr-2">{f.approved_by_user ? "✓" : ""}</td>
                          <td className="py-1 pr-2 text-right">
                            <Button size="sm" variant="ghost"
                              onClick={() => setSourcesFor({ ids: f.source_chunk_ids ?? [], title: `${t.topic_definitions?.slug} · ${f.field_name}` })}>
                              View Sources
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {tCands.length > 0 && (
                <div>
                  <div className="mb-2 text-xs font-semibold uppercase text-muted-foreground">
                    Pending Candidates
                  </div>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left text-[11px] text-muted-foreground">
                        <th className="py-1 pr-2">Field</th>
                        <th className="py-1 pr-2">Value</th>
                        <th className="py-1 pr-2">Method</th>
                        <th className="py-1 pr-2">Conf.</th>
                        <th className="py-1 pr-2"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {tCands.map((c) => (
                        <tr key={c.id} className="border-b last:border-0">
                          <td className="py-1 pr-2 font-mono text-[11px]">{c.field_name}</td>
                          <td className="py-1 pr-2">{renderValue(c.field_value)}</td>
                          <td className="py-1 pr-2">
                            <span className={`inline-flex rounded px-1.5 py-0.5 font-mono text-[10px] ${METHOD_COLOR[c.extraction_method] ?? METHOD_COLOR.llm}`}>
                              {c.extraction_method}
                            </span>
                          </td>
                          <td className="py-1 pr-2 text-xs">{c.confidence != null ? c.confidence.toFixed(2) : "—"}</td>
                          <td className="py-1 pr-2 text-right whitespace-nowrap">
                            <Button size="sm" variant="ghost"
                              onClick={async () => {
                                await approveCandFn({ data: { candidateId: c.id } });
                                toast.success("Aprovado");
                                refresh();
                              }}>Approve</Button>
                            <Button size="sm" variant="ghost"
                              onClick={async () => {
                                await rejectCandFn({ data: { candidateId: c.id } });
                                toast.success("Rejeitado");
                                refresh();
                              }}>Reject</Button>
                            <Button size="sm" variant="ghost"
                              onClick={() => setSourcesFor({ ids: c.source_chunk_ids ?? [], title: `cand ${c.field_name}` })}>
                              Sources
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {tAddl.length > 0 && (
                <div>
                  <div className="mb-2 text-xs font-semibold uppercase text-muted-foreground">
                    Additional Information
                  </div>
                  <ul className="space-y-2">
                    {tAddl.map((a) => (
                      <li key={a.id} className="flex items-start justify-between gap-3 rounded border p-2 text-sm">
                        <span className="flex-1">
                          <Badge variant={a.status === "approved" ? "default" : a.status === "rejected" ? "destructive" : "outline"} className="mr-2 text-[10px]">
                            {a.status}
                          </Badge>
                          {a.content}
                        </span>
                        {a.status !== "approved" && (
                          <Button size="sm" variant="ghost" onClick={async () => {
                            await approveAddFn({ data: { id: a.id } });
                            refresh();
                          }}>Approve</Button>
                        )}
                        {a.status !== "rejected" && (
                          <Button size="sm" variant="ghost" onClick={async () => {
                            await rejectAddFn({ data: { id: a.id } });
                            refresh();
                          }}>Reject</Button>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </CardContent>
          </Card>
        );
      })}

      <SourcesDialog
        open={sourcesFor != null}
        onClose={() => setSourcesFor(null)}
        chunkIds={sourcesFor?.ids ?? []}
        title={sourcesFor?.title ?? ""}
      />

      {/* avoid unused warnings */}
      {void topicById && null}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "warn" }) {
  return (
    <div className={`rounded border p-3 ${tone === "warn" ? "border-amber-500/50 bg-amber-500/5" : ""}`}>
      <div className="text-[10px] uppercase text-muted-foreground">{label}</div>
      <div className="text-2xl font-semibold">{value}</div>
    </div>
  );
}

function ConflictCard({
  conflict, topicName, candidates, onResolve, onViewSources,
}: {
  conflict: Conflict;
  topicName: string;
  candidates: Candidate[];
  onResolve: (action: "select" | "edit" | "ignore", payload: { selectedCandidateId?: string; manualValue?: unknown; note?: string }) => Promise<void>;
  onViewSources: (ids: string[], title: string) => void;
}) {
  const [manual, setManual] = useState("");
  const [editing, setEditing] = useState(false);

  return (
    <div className="rounded-md border bg-amber-500/5 p-3">
      <div className="mb-2 flex items-center gap-2 text-sm">
        <Badge variant="outline">{topicName}</Badge>
        <code className="font-mono text-xs">{conflict.field_name}</code>
        <Badge variant="secondary" className="text-[10px]">{conflict.field_type}</Badge>
        <Badge variant="destructive" className="text-[10px]">{conflict.conflict_type}</Badge>
      </div>
      <div className="space-y-2">
        {candidates.map((c) => (
          <div key={c.id} className="flex items-center justify-between gap-3 rounded border bg-background p-2 text-sm">
            <div className="flex-1">
              <div className="font-medium">{renderValue(c.field_value)}</div>
              <div className="mt-1 flex gap-2 text-[11px] text-muted-foreground">
                <span className={`inline-flex rounded px-1.5 py-0.5 font-mono text-[10px] ${METHOD_COLOR[c.extraction_method] ?? METHOD_COLOR.llm}`}>
                  {c.extraction_method}
                </span>
                <span>conf {c.confidence != null ? c.confidence.toFixed(2) : "—"}</span>
                <span>{c.source_chunk_ids?.length ?? 0} chunks</span>
              </div>
            </div>
            <div className="flex gap-1">
              <Button size="sm" variant="default" onClick={() => onResolve("select", { selectedCandidateId: c.id })}>
                Select
              </Button>
              <Button size="sm" variant="ghost" onClick={() => onViewSources(c.source_chunk_ids ?? [], `cand ${c.field_name}`)}>
                Sources
              </Button>
            </div>
          </div>
        ))}
      </div>
      <div className="mt-3 flex items-center gap-2">
        {editing ? (
          <>
            <Input
              placeholder="Valor manual"
              value={manual}
              onChange={(e) => setManual(e.target.value)}
              className="h-8 text-sm"
            />
            <Button size="sm" onClick={() => onResolve("edit", { manualValue: manual })}>
              Save
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>×</Button>
          </>
        ) : (
          <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
            Edit manually
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={() => onResolve("ignore", {})}>
          Ignore conflict
        </Button>
      </div>
    </div>
  );
}

function SourcesDialog({
  open, onClose, chunkIds, title,
}: { open: boolean; onClose: () => void; chunkIds: string[]; title: string }) {
  const { data: chunks } = useQuery({
    queryKey: ["sources_modal", chunkIds.join(",")],
    enabled: open && chunkIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("raw_chunks")
        .select("id, content, raw_source_id, raw_sources(name)")
        .in("id", chunkIds);
      if (error) throw error;
      return data ?? [];
    },
  });
  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>Sources · {title}</DialogTitle></DialogHeader>
        <div className="max-h-[60vh] space-y-2 overflow-y-auto">
          {chunkIds.length === 0 && <p className="text-sm text-muted-foreground">Sem chunks de origem.</p>}
          {(chunks ?? []).map((c) => {
            const src = (c as unknown as { raw_sources: { name: string } | null }).raw_sources;
            return (
              <div key={c.id} className="rounded border p-2 text-xs">
                <div className="mb-1 flex items-center gap-2 text-[10px] text-muted-foreground">
                  <Badge variant="outline">{src?.name ?? "?"}</Badge>
                  <code>{c.id.slice(0, 8)}</code>
                </div>
                <pre className="whitespace-pre-wrap font-sans">{c.content}</pre>
              </div>
            );
          })}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Fechar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
