import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { extractTopicAggregated } from "@/lib/ai.functions";
import { getExtractionModelOverride } from "@/features/settings/LLMConfigTab";
import { estimateCostUsd, formatUsd } from "@/lib/llm-pricing";


const TOPIC_EMOJI: Record<string, string> = {
  breakfast: "☕", checkin: "🛎️", checkout: "🧳", parking: "🚗",
  restaurant: "🍽", pool: "🏊", gym: "🏋️", pets: "🐶",
  transfer: "🚐", amenities: "✨", rooms: "🛏", wifi: "📶",
};

type Topic = {
  id: string;
  topic_definition_id: string;
  topic_definitions: { slug: string; name: string; aliases: string[] | null } | null;
};


type Dpd = {
  id: string;
  topic_definition_id: string;
  field_name: string;
  field_label: string;
  field_type: string;
  description: string | null;
  required: boolean;
};

type Field = {
  id: string;
  topic_id: string;
  field_name: string;
  field_type: string;
  field_value: unknown;
  field_origin: string;
  source_chunk_ids: string[];
  confidence: number | null;
  approved_by_user: boolean;
  source_of_truth: string;
};

type Addl = {
  id: string;
  topic_id: string;
  content: string;
  status: string;
  source_chunk_ids: string[];
};

export function StructuredKnowledgeTab({ projectId }: { projectId: string }) {
  const [selectedTopicId, setSelectedTopicId] = useState<string | null>(null);
  const [reextractingAll, setReextractingAll] = useState(false);
  const qc = useQueryClient();

  const { data: topics } = useQuery({
    queryKey: ["sk_topics", projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("topics")
        .select("id, topic_definition_id, topic_definitions(slug, name, aliases)")
        .eq("project_id", projectId);
      if (error) throw error;
      return (data ?? []) as unknown as Topic[];
    },
  });


  const { data: dpds } = useQuery({
    queryKey: ["sk_dpds"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("data_point_definitions")
        .select("id, topic_definition_id, field_name, field_label, field_type, description, required")
        .eq("active", true);
      if (error) throw error;
      return (data ?? []) as Dpd[];
    },
  });

  const topicIds = (topics ?? []).map((t) => t.id);

  const { data: fields } = useQuery({
    queryKey: ["sk_fields", projectId, topicIds.join(",")],
    enabled: topicIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("knowledge_fields")
        .select("id, topic_id, field_name, field_type, field_value, field_origin, source_chunk_ids, confidence, approved_by_user, source_of_truth")
        .in("topic_id", topicIds);
      if (error) throw error;
      return (data ?? []) as Field[];
    },
  });

  const { data: addls } = useQuery({
    queryKey: ["sk_addls", projectId, topicIds.join(",")],
    enabled: topicIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("additional_info")
        .select("id, topic_id, content, status, source_chunk_ids")
        .in("topic_id", topicIds)
        .eq("status", "approved");
      if (error) throw error;
      return (data ?? []) as Addl[];
    },
  });

  const { data: rawChunks } = useQuery({
    queryKey: ["sk_raw_chunks_cost", projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("raw_chunks")
        .select("id, content, raw_sources!inner(project_id)")
        .eq("raw_sources.project_id", projectId);
      if (error) throw error;
      return (data ?? []) as unknown as Array<{ id: string; content: string }>;
    },
  });

  // Model used for extraction cost estimate (Lovable provider only; server defaults otherwise)
  const modelOverride = useMemo(() => getExtractionModelOverride(projectId), [projectId]);
  const costModel = modelOverride?.model ?? "google/gemini-3-flash-preview";

  // Approximate input tokens per topic based on which chunks match its aliases.
  // Overhead per LLM call for prompt template + data points spec.
  const PROMPT_OVERHEAD_CHARS = 2500;
  const OUTPUT_TOKENS_EST = 500;

  const topicCosts = useMemo(() => {
    const map = new Map<string, { cost: number | null; chunks: number }>();
    if (!topics || !rawChunks) return map;
    for (const t of topics) {
      const td = t.topic_definitions;
      const terms = [td?.slug, td?.name, ...(td?.aliases ?? [])]
        .filter(Boolean)
        .map((s) => String(s).toLowerCase());
      let chars = 0;
      let count = 0;
      for (const c of rawChunks) {
        const lc = c.content.toLowerCase();
        if (terms.some((term) => term && lc.includes(term))) {
          chars += c.content.length;
          count += 1;
        }
      }
      if (count === 0) {
        map.set(t.id, { cost: 0, chunks: 0 });
        continue;
      }
      const inputTokens = Math.ceil((chars + PROMPT_OVERHEAD_CHARS) / 4);
      const cost = estimateCostUsd({
        provider: "lovable",
        model: costModel,
        inputTokens,
        outputTokens: OUTPUT_TOKENS_EST,
      });
      map.set(t.id, { cost, chunks: count });
    }
    return map;
  }, [topics, rawChunks, costModel]);

  const totalCost = useMemo(() => {
    let sum = 0;
    let hasAny = false;
    for (const v of topicCosts.values()) {
      if (v.cost != null) {
        sum += v.cost;
        hasAny = true;
      }
    }
    return hasAny ? sum : null;
  }, [topicCosts]);

  const topicsWithData = useMemo(() => {
    if (!topics) return [];
    const counts = new Map<string, number>();
    for (const f of fields ?? []) counts.set(f.topic_id, (counts.get(f.topic_id) ?? 0) + 1);
    for (const a of addls ?? []) counts.set(a.topic_id, (counts.get(a.topic_id) ?? 0) + 1);
    return topics
      .map((t) => ({ ...t, count: counts.get(t.id) ?? 0 }))
      .sort((a, b) => (b.count - a.count) || (a.topic_definitions?.name ?? "").localeCompare(b.topic_definitions?.name ?? ""));
  }, [topics, fields, addls]);


  const currentTopicId = selectedTopicId ?? topicsWithData[0]?.id ?? null;
  const currentTopic = topicsWithData.find((t) => t.id === currentTopicId);

  if (!topics || topics.length === 0) {
    return <p className="text-sm text-muted-foreground">Nenhum tópico ativo. Vá em Settings e ative tópicos.</p>;
  }

  async function reextractAll() {
    setReextractingAll(true);
    try {
      const res = await extractTopicAggregated({ data: { projectId, modelOverride: getExtractionModelOverride(projectId) } });
      const filled = res.topics.reduce((acc, t) => acc + t.core_filled, 0);
      const total = res.topics.reduce((acc, t) => acc + t.core_total, 0);
      toast.success(`Re-extração concluída · ${filled}/${total} campos preenchidos`);
      qc.invalidateQueries({ queryKey: ["sk_fields", projectId] });
      qc.invalidateQueries({ queryKey: ["sk_addls", projectId] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setReextractingAll(false);
    }
  }

  function exportAllJson() {
    const byTopic = new Map<string, { slug: string; name: string; core_fields: Record<string, unknown>; additional_information: string; sources: string[] }>();
    for (const t of topicsWithData) {
      const slug = t.topic_definitions?.slug ?? "?";
      const name = t.topic_definitions?.name ?? slug;
      const topicDpds = (dpds ?? []).filter((d) => d.topic_definition_id === t.topic_definition_id);
      const topicFields = (fields ?? []).filter((f) => f.topic_id === t.id);
      const topicAddls = (addls ?? []).filter((a) => a.topic_id === t.id);
      const core: Record<string, unknown> = {};
      for (const d of topicDpds) {
        const f = topicFields.find((x) => x.field_name === d.field_name && x.field_origin === "core");
        if (f) core[d.field_name] = f.field_value;
      }
      const userEdit = topicAddls.find((a) => (a.source_chunk_ids ?? []).length === 0);
      const additional_information = userEdit ? userEdit.content : topicAddls.map((a) => a.content).join("\n\n");
      const sources = new Set<string>();
      for (const f of topicFields) (f.source_chunk_ids ?? []).forEach((id) => sources.add(id));
      for (const a of topicAddls) (a.source_chunk_ids ?? []).forEach((id) => sources.add(id));
      byTopic.set(t.id, { slug, name, core_fields: core, additional_information, sources: Array.from(sources) });
    }
    const payload = {
      project_id: projectId,
      exported_at: new Date().toISOString(),
      topics: Array.from(byTopic.values()),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `knowledge-${projectId}-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success(`Exportado ${byTopic.size} tópicos`);
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          Cada tópico agrega todos os chunks relevantes antes de chamar a LLM — captura mais detalhes e fica mais barato.
        </p>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={exportAllJson}>
            Exportar JSON unificado
          </Button>
          <div className="flex flex-col items-end">
            <Button size="sm" variant="outline" onClick={reextractAll} disabled={reextractingAll}>
              {reextractingAll ? "Re-extraindo todos…" : "Re-extrair todos os tópicos"}
            </Button>
            <span className="mt-1 text-[10px] text-muted-foreground">
              Custo estimado total: <strong>{formatUsd(totalCost)}</strong>
              <span className="ml-1 opacity-70">· {costModel}</span>
            </span>
          </div>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-[260px_1fr]">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Tópicos</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1">
          {topicsWithData.map((t) => {
            const slug = t.topic_definitions?.slug ?? "?";
            const name = t.topic_definitions?.name ?? slug;
            const active = t.id === currentTopicId;
            const tc = topicCosts.get(t.id);
            return (
              <button
                key={t.id}
                onClick={() => setSelectedTopicId(t.id)}
                className={`flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm transition-colors ${
                  active ? "bg-accent text-accent-foreground" : "hover:bg-muted"
                }`}
              >
                <span className="flex items-center gap-2">
                  <span>{TOPIC_EMOJI[slug] ?? "📁"}</span>
                  <span>{name}</span>
                </span>
                <span className="flex items-center gap-1">
                  <span className="text-[10px] text-muted-foreground tabular-nums">
                    {tc ? formatUsd(tc.cost) : "—"}
                  </span>
                  <Badge variant={t.count > 0 ? "secondary" : "outline"} className="text-[10px]">
                    {t.count}
                  </Badge>
                </span>
              </button>
            );
          })}
        </CardContent>
      </Card>

      {currentTopic && (
        <TopicEditor
          key={currentTopic.id}
          projectId={projectId}
          topic={currentTopic}
          dpds={(dpds ?? []).filter((d) => d.topic_definition_id === currentTopic.topic_definition_id)}
          fields={(fields ?? []).filter((f) => f.topic_id === currentTopic.id)}
          addls={(addls ?? []).filter((a) => a.topic_id === currentTopic.id)}
          extractionCost={topicCosts.get(currentTopic.id)?.cost ?? null}
          extractionChunks={topicCosts.get(currentTopic.id)?.chunks ?? 0}
          costModel={costModel}
        />
      )}
      </div>
    </div>
  );
}



function TopicEditor({
  projectId, topic, dpds, fields, addls, extractionCost, extractionChunks, costModel,
}: {
  projectId: string;
  topic: Topic;
  dpds: Dpd[];
  fields: Field[];
  addls: Addl[];
  extractionCost: number | null;
  extractionChunks: number;
  costModel: string;
}) {

  const qc = useQueryClient();
  const slug = topic.topic_definitions?.slug ?? "?";
  const name = topic.topic_definitions?.name ?? slug;

  // Core form values keyed by field_name
  const [coreValues, setCoreValues] = useState<Record<string, string>>({});
  const [coreBooleans, setCoreBooleans] = useState<Record<string, boolean>>({});
  const [addlText, setAddlText] = useState("");
  const [saving, setSaving] = useState(false);
  const [reextracting, setReextracting] = useState(false);
  const [jsonOpen, setJsonOpen] = useState(false);
  const [sourcesOpen, setSourcesOpen] = useState(false);

  const coreFilled = dpds.filter((d) => fields.some((f) => f.field_name === d.field_name && f.field_origin === "core" && f.field_value != null && f.field_value !== "")).length;

  async function reextract() {
    setReextracting(true);
    try {
      const res = await extractTopicAggregated({ data: { projectId, topicSlug: slug, modelOverride: getExtractionModelOverride(projectId) } });
      const r = res.topics[0];
      if (r) {
        toast.success(`Re-extraído: ${r.core_filled}/${r.core_total} campos · ${r.chunks_used} chunks · +${r.additional_info_chars} chars de narrativa`);
      } else {
        toast.message("Re-extração concluída");
      }
      qc.invalidateQueries({ queryKey: ["sk_fields", projectId] });
      qc.invalidateQueries({ queryKey: ["sk_addls", projectId] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setReextracting(false);
    }
  }


  useEffect(() => {
    const initStr: Record<string, string> = {};
    const initBool: Record<string, boolean> = {};
    for (const d of dpds) {
      const f = fields.find((x) => x.field_name === d.field_name && x.field_origin === "core");
      if (d.field_type === "boolean") {
        initBool[d.field_name] = f?.field_value === true;
      } else {
        const v = f?.field_value;
        initStr[d.field_name] = v == null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
      }
    }
    setCoreValues(initStr);
    setCoreBooleans(initBool);

    // Compose Additional Information textarea:
    // - if user has saved an edit (single approved row with source_chunk_ids empty), prefer that
    // - else: only the AI-extracted addl contents (dynamic fields are NOT auto-merged into the textarea)
    const userEdit = addls.find((a) => (a.source_chunk_ids ?? []).length === 0);
    if (userEdit) {
      setAddlText(userEdit.content);
    } else {
      setAddlText(addls.map((a) => a.content).join("\n\n"));
    }
  }, [topic.id, dpds, fields, addls]);

  function setStr(name: string, v: string) {
    setCoreValues((s) => ({ ...s, [name]: v }));
  }
  function setBool(name: string, v: boolean) {
    setCoreBooleans((s) => ({ ...s, [name]: v }));
  }

  async function save() {
    setSaving(true);
    try {
      // 1. Upsert each core data point
      for (const d of dpds) {
        let value: unknown;
        if (d.field_type === "boolean") value = coreBooleans[d.field_name] ?? false;
        else if (d.field_type === "number" || d.field_type === "currency") {
          const raw = (coreValues[d.field_name] ?? "").trim();
          value = raw === "" ? null : Number(raw);
        } else {
          const raw = (coreValues[d.field_name] ?? "").trim();
          value = raw === "" ? null : raw;
        }
        // Skip empty optional fields with no existing record
        const existing = fields.find((x) => x.field_name === d.field_name && x.field_origin === "core");
        if (value === null && !existing) continue;

        const payload = {
          topic_id: topic.id,
          field_name: d.field_name,
          field_type: d.field_type,
          field_value: value as never,
          field_origin: "core",
          approved_by_user: true,
          approved_at: new Date().toISOString(),
          source_of_truth: "manually_edited",
          consolidation_status: "consolidated",
        } as never;
        if (existing) {
          await supabase.from("knowledge_fields").update(payload).eq("id", existing.id);
        } else {
          await supabase.from("knowledge_fields").insert(payload);
        }
      }

      // 2. Replace approved additional_info with the user-edited text (source_chunk_ids = [] marker)
      const existingAddlIds = addls.map((a) => a.id);
      if (existingAddlIds.length > 0) {
        await supabase.from("additional_info").update({ status: "rejected" } as never).in("id", existingAddlIds);
      }
      const trimmed = addlText.trim();
      if (trimmed.length > 0) {
        await supabase.from("additional_info").insert({
          topic_id: topic.id,
          content: trimmed,
          status: "approved",
          source_chunk_ids: [] as never,
          approved_at: new Date().toISOString(),
        } as never);
      }

      // 3. Delete all dynamic knowledge_fields for this topic — textarea is the single source of truth
      //    for non-core content; dynamic fields would otherwise duplicate text the user already curated.
      const dynamicIds = fields.filter((f) => f.field_origin === "dynamic").map((f) => f.id);
      if (dynamicIds.length > 0) {
        await supabase.from("knowledge_fields").delete().in("id", dynamicIds);
      }

      toast.success("Salvo");
      qc.invalidateQueries({ queryKey: ["sk_fields", projectId] });
      qc.invalidateQueries({ queryKey: ["sk_addls", projectId] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  const allSourceChunks = useMemo(() => {
    const set = new Set<string>();
    for (const f of fields) (f.source_chunk_ids ?? []).forEach((id) => set.add(id));
    for (const a of addls) (a.source_chunk_ids ?? []).forEach((id) => set.add(id));
    return Array.from(set);
  }, [fields, addls]);

  const fullJson = useMemo(() => {
    const core: Record<string, unknown> = {};
    for (const d of dpds) {
      const f = fields.find((x) => x.field_name === d.field_name && x.field_origin === "core");
      if (f) core[d.field_name] = f.field_value;
    }
    return {
      topic: slug,
      core_fields: core,
      additional_information: addlText,
      sources: allSourceChunks,
    };
  }, [dpds, fields, addlText, slug, allSourceChunks]);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-2">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <span>{TOPIC_EMOJI[slug] ?? "📁"}</span>
              {name}
              <Badge variant="outline" className="font-mono text-[10px]">{slug}</Badge>
              {dpds.length > 0 && (
                <Badge variant={coreFilled === dpds.length ? "default" : "secondary"} className="text-[10px]">
                  {coreFilled}/{dpds.length} campos
                </Badge>
              )}
            </CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">
              Core Information são os campos oficiais. Informações adicionais é texto livre que complementa a base.
            </p>
          </div>
          <div className="flex gap-1">
            <Button variant="default" size="sm" onClick={reextract} disabled={reextracting}>
              {reextracting ? "Re-extraindo…" : "Re-extrair tópico"}
            </Button>
            <Button variant="outline" size="sm" onClick={() => setSourcesOpen(true)}>
              Source Chunks ({allSourceChunks.length})
            </Button>
            <Button variant="outline" size="sm" onClick={() => setJsonOpen(true)}>View JSON</Button>
          </div>
        </CardHeader>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Core Information</CardTitle>
        </CardHeader>
        <CardContent>
          {dpds.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              Nenhum data point definido para este tópico. Crie em Settings.
            </p>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {dpds.map((d) => (
                <div key={d.id} className="space-y-1">
                  <label className="text-xs font-medium">
                    {d.field_label}
                    {d.required && <span className="ml-1 text-destructive">*</span>}
                  </label>
                  {d.field_type === "boolean" ? (
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={coreBooleans[d.field_name] ?? false}
                        onCheckedChange={(v) => setBool(d.field_name, v)}
                      />
                      <span className="text-xs text-muted-foreground">
                        {coreBooleans[d.field_name] ? "Sim" : "Não"}
                      </span>
                    </div>
                  ) : (
                    <Input
                      value={coreValues[d.field_name] ?? ""}
                      onChange={(e) => setStr(d.field_name, e.target.value)}
                      placeholder={d.description ?? ""}
                      type={d.field_type === "number" || d.field_type === "currency" ? "number" : "text"}
                    />
                  )}
                  {d.description && <p className="text-[10px] text-muted-foreground">{d.description}</p>}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Informações adicionais</CardTitle>
          <p className="text-xs text-muted-foreground">
            Texto livre que complementa os campos oficiais. Usado pela base estruturada nas respostas.
          </p>
        </CardHeader>
        <CardContent>
          <Textarea
            rows={10}
            value={addlText}
            onChange={(e) => setAddlText(e.target.value)}
            placeholder="Escreva aqui qualquer informação adicional relevante…"
          />
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button onClick={save} disabled={saving}>
          {saving ? "Salvando…" : "Salvar tópico"}
        </Button>
      </div>

      <Dialog open={jsonOpen} onOpenChange={setJsonOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>JSON · {slug}</DialogTitle></DialogHeader>
          <pre className="max-h-[60vh] overflow-auto rounded bg-muted p-3 text-xs">
            {JSON.stringify(fullJson, null, 2)}
          </pre>
          <DialogFooter><Button variant="outline" onClick={() => setJsonOpen(false)}>Fechar</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <SourcesDialog open={sourcesOpen} onClose={() => setSourcesOpen(false)} chunkIds={allSourceChunks} title={slug} />
    </div>
  );
}

function SourcesDialog({
  open, onClose, chunkIds, title,
}: { open: boolean; onClose: () => void; chunkIds: string[]; title: string }) {
  const { data: chunks } = useQuery({
    queryKey: ["sk_sources_modal", chunkIds.join(",")],
    enabled: open && chunkIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("raw_chunks")
        .select("id, content, raw_sources(filename)")
        .in("id", chunkIds);
      if (error) throw error;
      return data ?? [];
    },
  });
  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>Source Chunks · {title}</DialogTitle></DialogHeader>
        <div className="max-h-[60vh] space-y-2 overflow-y-auto">
          {chunkIds.length === 0 && <p className="text-sm text-muted-foreground">Sem chunks de origem.</p>}
          {(chunks ?? []).map((c) => {
            const src = (c as unknown as { raw_sources: { filename: string } | null }).raw_sources;
            return (
              <div key={c.id} className="rounded border p-2 text-xs">
                <div className="mb-1 flex items-center gap-2 text-[10px] text-muted-foreground">
                  <Badge variant="outline">{src?.filename ?? "?"}</Badge>
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
