import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { runExtraction } from "@/lib/ai.functions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

type FieldRow = {
  field_name: string;
  field_value: unknown;
  field_type?: string;
  confidence?: number;
  source_chunk_ids?: string[];
  extraction_method?: "regex" | "keyword" | "llm";
};
type TopicBlock = {
  topic_slug: string;
  topic_name: string;
  core_fields: FieldRow[];
  dynamic_fields: FieldRow[];
  additional_information: Array<{ content: string; source_chunk_ids?: string[] }>;
};
type DetStats = {
  regex_fields: number;
  keyword_fields: number;
  llm_fields: number;
  chunks_skipped_llm: number;
  chunks_sent_to_llm: number;
  estimated_llm_calls_saved: number;
};
type Preview = {
  topics: TopicBlock[];
  chunk_topics: Record<string, { matched: string[]; via: string }>;
  statistics: {
    chunks_processed: number;
    chunks_total: number;
    topics_with_data: number;
    core_fields_found: number;
    dynamic_fields_found: number;
    additional_info_found: number;
    input_tokens: number;
    output_tokens: number;
    estimated_cost: number;
    latency_ms: number;
    classify_alias_hits: number;
    classify_llm_calls: number;
    classify_unmatched: number;
    deterministic_extraction?: DetStats;
  };
  persisted?: { candidates: number; knowledge_fields: number; knowledge_fields_skipped: number; additional_info: number };
};


const TOPIC_EMOJI: Record<string, string> = {
  breakfast: "☕", checkin: "🛎️", checkout: "🧳", parking: "🚗",
  restaurant: "🍽", pool: "🏊", gym: "🏋️", pets: "🐶", transfer: "🚐",
};

function renderValue(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "boolean") return v ? "true" : "false";
  if (Array.isArray(v)) return v.map(String).join(", ");
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

export function ExtractionsTab({ projectId }: { projectId: string }) {
  const qc = useQueryClient();
  const extractFn = useServerFn(runExtraction);
  const [busy, setBusy] = useState<null | "dry_run" | "persist">(null);
  const [lastPreview, setLastPreview] = useState<Preview | null>(null);
  const [lastMode, setLastMode] = useState<"dry_run" | "persist" | null>(null);

  const { data: runs } = useQuery({
    queryKey: ["extraction_runs", projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("extraction_runs").select("*").eq("project_id", projectId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  async function run(mode: "dry_run" | "persist") {
    if (mode === "persist" && !confirm("Persistir resultados na base. Continuar?")) return;
    setBusy(mode);
    try {
      const res = await extractFn({ data: { projectId, mode } });
      const preview = res.preview as unknown as Preview;
      setLastPreview(preview);
      setLastMode(mode);
      const s = preview.statistics;
      toast.success(
        mode === "dry_run"
          ? `Dry run: ${s.core_fields_found} core / ${s.dynamic_fields_found} dynamic. ~$${s.estimated_cost.toFixed(4)}`
          : `Persistido: ${res.persisted?.candidates ?? 0} candidates, ${res.persisted?.additional_info ?? 0} additional info. Rode Consolidation para promover.`,
      );
      qc.invalidateQueries({ queryKey: ["extraction_runs", projectId] });
      qc.invalidateQueries({ queryKey: ["knowledge_fields", projectId] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falhou");
    } finally {
      setBusy(null);
    }
  }

  async function persistFromLastPreview() {
    // No separate persist server fn — re-run in persist mode (Etapa 2 baseline)
    await run("persist");
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader><CardTitle className="text-base">Rodar extração</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            <strong>Dry Run</strong> chama o LLM e mostra o JSON proposto, mas <em>não</em> grava nada.
            Os parâmetros (chunk size, max chunks, prompts) ficam em <em>Settings → Extraction</em>.
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

      {lastPreview && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">
              Preview {lastMode === "dry_run" ? "(Dry Run)" : "(Persistido)"}
            </CardTitle>
            {lastMode === "dry_run" && (
              <Button size="sm" disabled={busy !== null} onClick={persistFromLastPreview}>
                Persist Results
              </Button>
            )}
          </CardHeader>
          <CardContent className="space-y-4">
            <StatsGrid s={lastPreview.statistics} />
            {lastPreview.persisted && (
              <div className="rounded border bg-muted/30 p-3 text-xs">
                <strong>Persistência:</strong>{" "}
                {lastPreview.persisted.knowledge_fields} novos campos ·{" "}
                {lastPreview.persisted.knowledge_fields_skipped} duplicados (merged) ·{" "}
                {lastPreview.persisted.additional_info} infos adicionais ·{" "}
                {lastPreview.persisted.candidates} candidates registrados.
              </div>
            )}
            <PreviewTopics topics={lastPreview.topics} />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle className="text-base">Histórico</CardTitle></CardHeader>
        <CardContent>
          {!runs || runs.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhuma extração ainda.</p>
          ) : (
            <div className="space-y-2">
              {runs.map((r) => {
                const s = (r.stats ?? {}) as Partial<Preview["statistics"]>;
                return (
                  <details key={r.id} className="rounded-md border p-3">
                    <summary className="cursor-pointer text-sm">
                      <span className="inline-flex items-center gap-2">
                        <Badge variant={r.mode === "dry_run" ? "outline" : "default"}>{r.mode}</Badge>
                        <Badge variant={r.status === "done" ? "secondary" : r.status === "failed" ? "destructive" : "outline"}>
                          {r.status}
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                          {new Date(r.created_at).toLocaleString()}
                        </span>
                        {typeof s.estimated_cost === "number" && (
                          <span className="text-xs text-muted-foreground">
                            ~${s.estimated_cost.toFixed(4)} · {s.core_fields_found ?? 0}c/{s.dynamic_fields_found ?? 0}d
                          </span>
                        )}
                      </span>
                    </summary>
                    {r.error && <p className="mt-2 text-sm text-destructive">{r.error}</p>}
                    {r.preview_result && (
                      <div className="mt-3">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setLastPreview(r.preview_result as unknown as Preview);
                            setLastMode(r.mode as "dry_run" | "persist");
                          }}
                        >
                          Carregar este preview acima
                        </Button>
                      </div>
                    )}
                  </details>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function StatsGrid({ s }: { s: Preview["statistics"] }) {
  const det = s.deterministic_extraction;
  const items: Array<[string, string | number]> = [
    ["Chunks processados", `${s.chunks_processed} / ${s.chunks_total}`],
    ["Tópicos com dados", s.topics_with_data],
    ["Core fields", s.core_fields_found],
    ["Dynamic fields", s.dynamic_fields_found],
    ["Additional info", s.additional_info_found],
    ["Classificados via alias", s.classify_alias_hits],
    ["Classificados via LLM", s.classify_llm_calls],
    ["Sem tópico", s.classify_unmatched],
    ["Tokens in/out", `${s.input_tokens} / ${s.output_tokens}`],
    ["Tempo total", `${(s.latency_ms / 1000).toFixed(2)}s`],
    ["Custo estimado", `~$${s.estimated_cost.toFixed(4)}`],
  ];
  const detItems: Array<[string, string | number]> = det
    ? [
        ["Campos via regex", det.regex_fields],
        ["Campos via keyword", det.keyword_fields],
        ["Campos via LLM", det.llm_fields],
        ["(chunk,tópico) sem LLM", det.chunks_skipped_llm],
        ["(chunk,tópico) → LLM", det.chunks_sent_to_llm],
        ["LLM calls economizadas", det.estimated_llm_calls_saved],
      ]
    : [];
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
        {items.map(([k, v]) => (
          <div key={k} className="rounded border p-2">
            <div className="text-[10px] uppercase text-muted-foreground">{k}</div>
            <div className="text-sm font-medium">{v}</div>
          </div>
        ))}
      </div>
      {detItems.length > 0 && (
        <div>
          <div className="mb-1 text-xs font-semibold uppercase text-muted-foreground">
            Extração determinística
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            {detItems.map(([k, v]) => (
              <div key={k} className="rounded border border-dashed p-2">
                <div className="text-[10px] uppercase text-muted-foreground">{k}</div>
                <div className="text-sm font-medium">{v}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

const METHOD_BADGE: Record<string, { label: string; cls: string }> = {
  regex: { label: "regex", cls: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" },
  keyword: { label: "keyword", cls: "bg-sky-500/15 text-sky-700 dark:text-sky-300" },
  llm: { label: "llm", cls: "bg-amber-500/15 text-amber-700 dark:text-amber-300" },
};

function MethodBadge({ m }: { m?: string }) {
  const cfg = METHOD_BADGE[m ?? "llm"] ?? METHOD_BADGE.llm;
  return (
    <span className={`inline-flex rounded px-1.5 py-0.5 font-mono text-[10px] ${cfg.cls}`}>
      {cfg.label}
    </span>
  );
}

function PreviewTopics({ topics }: { topics: TopicBlock[] }) {
  if (topics.length === 0) {
    return <p className="text-sm text-muted-foreground">Nenhum dado extraído.</p>;
  }
  return (
    <div className="space-y-3">
      {topics.map((t) => (
        <div key={t.topic_slug} className="rounded-md border">
          <div className="flex items-center justify-between border-b bg-muted/40 px-3 py-2">
            <div className="flex items-center gap-2 text-sm font-medium">
              <span>{TOPIC_EMOJI[t.topic_slug] ?? "📁"}</span>
              <span>{t.topic_name}</span>
              <Badge variant="outline" className="font-mono text-[10px]">{t.topic_slug}</Badge>
            </div>
            <div className="text-xs text-muted-foreground">
              {t.core_fields.length} core · {t.dynamic_fields.length} dynamic · {t.additional_information.length} info
            </div>
          </div>
          <div className="space-y-3 p-3">
            <FieldGroup title="Core Fields" rows={t.core_fields} variant="core" />
            <FieldGroup title="Dynamic Fields" rows={t.dynamic_fields} variant="dynamic" />
            <div>
              <div className="mb-1 text-xs font-semibold uppercase text-muted-foreground">Additional Information</div>
              {t.additional_information.length === 0 ? (
                <p className="text-xs text-muted-foreground">(nenhum)</p>
              ) : (
                <ul className="space-y-1 text-xs">
                  {t.additional_information.map((a, i) => (
                    <li key={i} className="rounded bg-muted/30 px-2 py-1">{a.content}</li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function FieldGroup({
  title, rows, variant,
}: { title: string; rows: FieldRow[]; variant: "core" | "dynamic" }) {
  return (
    <div>
      <div className="mb-1 text-xs font-semibold uppercase text-muted-foreground">{title}</div>
      {rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">(nenhum)</p>
      ) : (
        <table className="w-full text-xs">
          <tbody>
            {rows.map((f, i) => (
              <tr key={`${f.field_name}-${i}`} className="border-b last:border-0">
                <td className="py-1 pr-2 font-mono text-[11px]">{f.field_name}</td>
                {variant === "dynamic" && (
                  <td className="py-1 pr-2">
                    <Badge variant="secondary" className="text-[10px]">{f.field_type}</Badge>
                  </td>
                )}
                <td className="py-1 pr-2">{renderValue(f.field_value)}</td>
                <td className="py-1 pr-2"><MethodBadge m={f.extraction_method} /></td>
                <td className="py-1 pr-2 text-right text-muted-foreground">
                  {typeof f.confidence === "number" ? `${(f.confidence * 100).toFixed(0)}%` : ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
