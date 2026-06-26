import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { approveAdditionalInfo, rejectAdditionalInfo } from "@/lib/consolidation.functions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";

type TopicRow = {
  id: string;
  topic_definition_id: string;
  topic_definitions: { slug: string; name: string } | null;
};
type Field = {
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
type Addl = {
  id: string;
  topic_id: string;
  content: string;
  status: string;
  source_chunk_ids: string[];
};
type Conflict = {
  id: string;
  topic_definition_id: string;
  field_name: string;
  status: string;
};
type Cand = {
  id: string;
  topic_definition_id: string;
  field_name: string;
  status: string;
};

const SOT_LABEL: Record<string, string> = {
  auto_single_candidate: "auto consolidated",
  auto_merged_candidates: "auto consolidated",
  manually_selected_candidate: "manually selected",
  manually_edited: "manually edited",
  imported: "imported",
};

export function KnowledgeTab({ projectId }: { projectId: string }) {
  const qc = useQueryClient();
  const approveAddFn = useServerFn(approveAdditionalInfo);
  const rejectAddFn = useServerFn(rejectAdditionalInfo);
  const [jsonFor, setJsonFor] = useState<null | Field>(null);
  const [sourcesFor, setSourcesFor] = useState<null | { ids: string[]; title: string }>(null);

  const { data: topics } = useQuery({
    queryKey: ["topics_kn", projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("topics").select("id, topic_definition_id, topic_definitions(slug, name)").eq("project_id", projectId);
      if (error) throw error;
      return (data ?? []) as unknown as TopicRow[];
    },
  });

  const topicIds = (topics ?? []).map((t) => t.id);

  const { data: fields } = useQuery({
    queryKey: ["knowledge_fields", projectId, topicIds.join(",")],
    enabled: topicIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("knowledge_fields").select("*").in("topic_id", topicIds);
      if (error) throw error;
      return (data ?? []) as unknown as Field[];
    },
  });

  const { data: addls } = useQuery({
    queryKey: ["additional_info", projectId, topicIds.join(",")],
    enabled: topicIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("additional_info").select("*").in("topic_id", topicIds);
      if (error) throw error;
      return (data ?? []) as unknown as Addl[];
    },
  });

  const { data: conflicts } = useQuery({
    queryKey: ["conflicts_kn", projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("knowledge_conflicts").select("id, topic_definition_id, field_name, status")
        .eq("project_id", projectId).eq("status", "pending");
      if (error) throw error;
      return (data ?? []) as unknown as Conflict[];
    },
  });

  const { data: pendingCands } = useQuery({
    queryKey: ["pending_cands_kn", projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("knowledge_candidates").select("id, topic_definition_id, field_name, status")
        .eq("project_id", projectId).eq("status", "pending");
      if (error) throw error;
      return (data ?? []) as unknown as Cand[];
    },
  });

  function refresh() {
    qc.invalidateQueries({ queryKey: ["knowledge_fields", projectId] });
    qc.invalidateQueries({ queryKey: ["additional_info", projectId] });
  }

  if (!topics || topics.length === 0) {
    return <p className="text-sm text-muted-foreground">Ative tópicos na aba Topics primeiro.</p>;
  }

  const consolidatedFields = (fields ?? []).filter((f) => f.consolidation_status === "consolidated");
  const reviewFields = (fields ?? []).filter((f) => f.consolidation_status === "needs_review");
  const approvedAddl = (addls ?? []).filter((a) => a.status === "approved");
  const pendingAddl = (addls ?? []).filter((a) => a.status === "pending");
  const totalReview = reviewFields.length + (conflicts?.length ?? 0) + (pendingCands?.length ?? 0);

  return (
    <div className="space-y-6">
      <div className="rounded border border-dashed bg-muted/30 p-3 text-xs text-muted-foreground">
        A base oficial mostrada aqui é composta apenas por <strong>KnowledgeFields consolidados</strong> e
        <strong> AdditionalInfo aprovadas</strong>. Itens pendentes e conflitos devem ser tratados na aba <strong>Consolidation</strong>.
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Official Knowledge ({consolidatedFields.length})</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {topics.map((t) => {
            const tFields = consolidatedFields.filter((f) => f.topic_id === t.id);
            if (tFields.length === 0) return null;
            return (
              <div key={t.id}>
                <div className="mb-2 flex items-center gap-2 text-sm font-medium">
                  {t.topic_definitions?.name}
                  <Badge variant="outline" className="font-mono text-[10px]">{t.topic_definitions?.slug}</Badge>
                  <Badge variant="secondary" className="text-[10px]">{tFields.length} fields</Badge>
                </div>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-[11px] text-muted-foreground">
                      <th className="py-1 pr-2">Field</th>
                      <th className="py-1 pr-2">Value</th>
                      <th className="py-1 pr-2">Origin</th>
                      <th className="py-1 pr-2">Sources</th>
                      <th className="py-1 pr-2">Approved</th>
                      <th className="py-1 pr-2"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {tFields.map((f) => (
                      <tr key={f.id} className="border-b last:border-0">
                        <td className="py-1 pr-2 font-mono text-[11px]">{f.field_name}</td>
                        <td className="py-1 pr-2">
                          {typeof f.field_value === "object" ? JSON.stringify(f.field_value) : String(f.field_value ?? "—")}
                        </td>
                        <td className="py-1 pr-2">
                          <Badge variant="outline" className="text-[10px]">
                            {SOT_LABEL[f.source_of_truth] ?? f.source_of_truth}
                          </Badge>
                        </td>
                        <td className="py-1 pr-2 text-xs">{f.source_chunk_ids?.length ?? 0}</td>
                        <td className="py-1 pr-2">{f.approved_by_user ? "✓" : ""}</td>
                        <td className="py-1 pr-2 text-right whitespace-nowrap">
                          <Button size="sm" variant="ghost" onClick={() => setJsonFor(f)}>JSON</Button>
                          <Button size="sm" variant="ghost"
                            onClick={() => setSourcesFor({
                              ids: f.source_chunk_ids ?? [],
                              title: `${t.topic_definitions?.slug} · ${f.field_name}`,
                            })}>Sources</Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          })}
          {consolidatedFields.length === 0 && (
            <p className="text-sm text-muted-foreground">Nenhum campo consolidado ainda. Rode a consolidação na aba Consolidation.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Needs Review ({totalReview})</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {totalReview === 0 ? (
            <p className="text-muted-foreground">Nada para revisar.</p>
          ) : (
            <>
              {(conflicts?.length ?? 0) > 0 && (
                <p>⚠ {conflicts!.length} conflito(s) pendente(s).</p>
              )}
              {(pendingCands?.length ?? 0) > 0 && (
                <p>• {pendingCands!.length} candidato(s) ainda não consolidado(s).</p>
              )}
              {reviewFields.length > 0 && (
                <p>• {reviewFields.length} campo(s) marcados como needs_review.</p>
              )}
              <p className="text-xs text-muted-foreground">Vá em <strong>Consolidation</strong> para resolver.</p>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Additional Information</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <div className="mb-2 text-xs font-semibold uppercase text-muted-foreground">
              Approved ({approvedAddl.length})
            </div>
            {approvedAddl.length === 0 ? (
              <p className="text-sm text-muted-foreground">—</p>
            ) : (
              <ul className="space-y-1">
                {approvedAddl.map((a) => {
                  const t = topics.find((t) => t.id === a.topic_id);
                  return (
                    <li key={a.id} className="flex items-start justify-between gap-3 rounded border p-2 text-sm">
                      <span><Badge variant="outline" className="mr-2 text-[10px]">{t?.topic_definitions?.slug}</Badge>{a.content}</span>
                      <Button size="sm" variant="ghost" onClick={async () => {
                        await rejectAddFn({ data: { id: a.id } });
                        refresh();
                      }}>Reject</Button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
          {pendingAddl.length > 0 && (
            <div>
              <div className="mb-2 text-xs font-semibold uppercase text-muted-foreground">
                Pending ({pendingAddl.length})
              </div>
              <ul className="space-y-1">
                {pendingAddl.map((a) => {
                  const t = topics.find((t) => t.id === a.topic_id);
                  return (
                    <li key={a.id} className="flex items-start justify-between gap-3 rounded border p-2 text-sm">
                      <span><Badge variant="outline" className="mr-2 text-[10px]">{t?.topic_definitions?.slug}</Badge>{a.content}</span>
                      <span className="flex gap-1">
                        <Button size="sm" variant="default" onClick={async () => {
                          await approveAddFn({ data: { id: a.id } });
                          refresh();
                        }}>Approve</Button>
                        <Button size="sm" variant="ghost" onClick={async () => {
                          await rejectAddFn({ data: { id: a.id } });
                          refresh();
                        }}>Reject</Button>
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={jsonFor != null} onOpenChange={(v) => { if (!v) setJsonFor(null); }}>
        <DialogContent className="max-w-xl">
          <DialogHeader><DialogTitle>JSON · {jsonFor?.field_name}</DialogTitle></DialogHeader>
          <pre className="max-h-[60vh] overflow-auto rounded bg-muted p-3 text-xs">
            {jsonFor ? JSON.stringify(jsonFor, null, 2) : ""}
          </pre>
          <DialogFooter><Button variant="outline" onClick={() => setJsonFor(null)}>Fechar</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <SourcesDialog
        open={sourcesFor != null}
        onClose={() => setSourcesFor(null)}
        chunkIds={sourcesFor?.ids ?? []}
        title={sourcesFor?.title ?? ""}
      />

      {(() => { toast; return null; })()}
    </div>
  );
}

function SourcesDialog({
  open, onClose, chunkIds, title,
}: { open: boolean; onClose: () => void; chunkIds: string[]; title: string }) {
  const { data: chunks } = useQuery({
    queryKey: ["sources_modal_kn", chunkIds.join(",")],
    enabled: open && chunkIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("raw_chunks")
        .select("id, content, raw_sources(name)")
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
        <DialogFooter><Button variant="outline" onClick={onClose}>Fechar</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
