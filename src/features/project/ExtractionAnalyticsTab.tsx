import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
  getExtractionAnalytics,
  setChunkStatus,
  setCandidateStatus,
  suggestDataPointFromDynamic,
  compareExtractionRuns,
  getRunDetail,
  type ExtractionAnalytics,
} from "@/lib/analytics.functions";
import { runExtraction } from "@/lib/ai.functions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";

type SortKey =
  | "topic_name" | "chunks_matched" | "candidates" | "core" | "dynamic"
  | "additional_info" | "avg_confidence" | "pct_regex" | "pct_keyword" | "pct_llm"
  | "conflicts" | "consolidated";

function pctTxt(n: number) { return `${n.toFixed(1)}%`; }
function money(n: number) { return `$${n.toFixed(4)}`; }

function StatCard({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="text-xl font-semibold">{value}</div>
        {hint && <div className="text-[10px] text-muted-foreground mt-1">{hint}</div>}
      </CardContent>
    </Card>
  );
}

export function ExtractionAnalyticsTab({ projectId, initialTopicSlug }: { projectId: string; initialTopicSlug?: string }) {
  const qc = useQueryClient();
  const fetchAnalytics = useServerFn(getExtractionAnalytics);
  const callSetChunkStatus = useServerFn(setChunkStatus);
  const callSetCandidateStatus = useServerFn(setCandidateStatus);
  const callSuggestDataPoint = useServerFn(suggestDataPointFromDynamic);
  const callCompare = useServerFn(compareExtractionRuns);
  const callRunDetail = useServerFn(getRunDetail);
  const callRunExtraction = useServerFn(runExtraction);

  const [topicFilter, setTopicFilter] = useState(initialTopicSlug ?? "all");
  const [sortBy, setSortBy] = useState<SortKey>("topic_name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [suggestModal, setSuggestModal] = useState<null | { field_name: string; suggested_topic_definition_id: string }>(null);
  const [compareA, setCompareA] = useState("");
  const [compareB, setCompareB] = useState("");
  const [compareResult, setCompareResult] = useState<Awaited<ReturnType<typeof compareExtractionRuns>> | null>(null);
  const [runDetailId, setRunDetailId] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["extraction-analytics", projectId],
    queryFn: () => fetchAnalytics({ data: { projectId } }),
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["extraction-analytics", projectId] });

  if (isLoading) return <p className="text-sm">Carregando analytics...</p>;
  if (!data) return <p className="text-sm">Sem dados ainda. Rode uma extração primeiro.</p>;

  const topics = data.topics
    .filter((t) => topicFilter === "all" || t.topic_slug === topicFilter)
    .sort((a, b) => {
      const av = a[sortBy] as number | string;
      const bv = b[sortBy] as number | string;
      const cmp = typeof av === "number" && typeof bv === "number" ? av - bv : String(av).localeCompare(String(bv));
      return sortDir === "asc" ? cmp : -cmp;
    });
  const filteredDataPoints = data.data_points.filter((d) => topicFilter === "all" || d.topic_slug === topicFilter);
  const filteredLowConf = data.low_confidence_candidates.filter((c) => topicFilter === "all" || c.topic_slug === topicFilter);
  const filteredDynamic = data.dynamic_fields_grouped.filter((d) => topicFilter === "all" || d.topics.includes(topicFilter));

  function toggleSort(k: SortKey) {
    if (sortBy === k) setSortDir(sortDir === "asc" ? "desc" : "asc");
    else { setSortBy(k); setSortDir("desc"); }
  }

  async function handleMarkIrrelevant(chunkId: string) {
    await callSetChunkStatus({ data: { chunkIds: [chunkId], status: "marked_irrelevant" } });
    toast.success("Chunk marcado como irrelevante");
    invalidate();
  }

  async function handleRetryChunk(chunkId: string) {
    await callSetChunkStatus({ data: { chunkIds: [chunkId], status: "retry_needed" } });
    toast.info("Reprocessando chunk via LLM...");
    try {
      await callRunExtraction({ data: { projectId, mode: "persist", chunkIds: [chunkId] } });
      toast.success("Chunk reprocessado");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
    invalidate();
  }

  async function handleApproveCandidate(id: string) {
    await callSetCandidateStatus({ data: { candidateId: id, status: "approved" } });
    toast.success("Aprovado");
    invalidate();
  }
  async function handleRejectCandidate(id: string) {
    await callSetCandidateStatus({ data: { candidateId: id, status: "rejected" } });
    toast.success("Rejeitado");
    invalidate();
  }
  async function handleEditValue(id: string, current: unknown) {
    const next = window.prompt("Novo valor:", typeof current === "string" ? current : JSON.stringify(current));
    if (next === null) return;
    let parsed: unknown = next;
    try { parsed = JSON.parse(next); } catch { /* keep string */ }
    await callSetCandidateStatus({ data: { candidateId: id, status: "approved", newValue: parsed } });
    toast.success("Valor editado e aprovado");
    invalidate();
  }

  async function handleRetryLowConfidenceBulk() {
    const chunkIds = Array.from(new Set(filteredLowConf.flatMap((c) => c.source_chunk_ids))).slice(0, 25);
    if (chunkIds.length === 0) { toast.info("Nada para reprocessar"); return; }
    toast.info(`Reprocessando ${chunkIds.length} chunk(s)...`);
    try {
      await callRunExtraction({ data: { projectId, mode: "persist", chunkIds } });
      toast.success("Reprocessamento concluído");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
    invalidate();
  }

  async function handleCompare() {
    if (!compareA || !compareB) { toast.error("Selecione dois runs"); return; }
    const res = await callCompare({ data: { runIdA: compareA, runIdB: compareB } });
    setCompareResult(res);
  }

  return (
    <div className="space-y-6">
      {/* Filter */}
      <div className="flex items-center gap-3">
        <Label className="text-xs">Filtrar tópico:</Label>
        <Select value={topicFilter} onValueChange={setTopicFilter}>
          <SelectTrigger className="w-[220px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os tópicos</SelectItem>
            {data.topics.map((t) => <SelectItem key={t.topic_slug} value={t.topic_slug}>{t.topic_name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Button variant="outline" size="sm" onClick={invalidate}>Atualizar</Button>
      </div>

      {/* General metrics */}
      <div>
        <h3 className="text-sm font-semibold mb-2">Métricas gerais</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard label="Total RawChunks" value={data.totals.total_chunks} />
          <StatCard label="Processados" value={data.totals.processed_chunks} />
          <StatCard label="Com Conhecimento" value={data.totals.extracted_chunks} />
          <StatCard label="Sem Extração" value={data.totals.no_knowledge_chunks} hint={`${data.totals.marked_irrelevant_chunks} marcados irrelevantes`} />
          <StatCard label="Total Candidates" value={data.totals.total_candidates} />
          <StatCard label="Core" value={data.totals.core_candidates} />
          <StatCard label="Dynamic" value={data.totals.dynamic_candidates} />
          <StatCard label="AdditionalInfo" value={data.totals.additional_info} />
          <StatCard label="% Regex" value={pctTxt(data.totals.pct_regex)} />
          <StatCard label="% Keyword" value={pctTxt(data.totals.pct_keyword)} />
          <StatCard label="% LLM" value={pctTxt(data.totals.pct_llm)} />
          <StatCard label="Avg Confidence" value={data.totals.avg_confidence.toFixed(2)} />
          <StatCard label="Custo Total Extração" value={money(data.totals.total_cost)} />
          <StatCard label="Tokens (in/out)" value={`${data.totals.total_input_tokens}/${data.totals.total_output_tokens}`} />
          <StatCard label="Extraction Runs" value={data.totals.total_extraction_runs} />
        </div>
      </div>

      {/* By topic */}
      <Card>
        <CardHeader><CardTitle className="text-base">Métricas por tópico</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-muted-foreground">
              <tr>
                {([
                  ["topic_name", "Topic"], ["chunks_matched", "Chunks"], ["candidates", "Cands"],
                  ["core", "Core"], ["dynamic", "Dynamic"], ["additional_info", "AddInfo"],
                  ["avg_confidence", "Avg Conf"], ["pct_regex", "Regex%"], ["pct_keyword", "Kw%"],
                  ["pct_llm", "LLM%"], ["conflicts", "Conflicts"], ["consolidated", "Consolid."],
                ] as Array<[SortKey, string]>).map(([k, label]) => (
                  <th key={k} className="text-left px-2 py-1 cursor-pointer select-none" onClick={() => toggleSort(k)}>
                    {label}{sortBy === k ? (sortDir === "asc" ? " ↑" : " ↓") : ""}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {topics.map((t) => (
                <tr key={t.topic_slug} className="border-t">
                  <td className="px-2 py-1 font-medium">{t.topic_name}</td>
                  <td className="px-2 py-1">{t.chunks_matched}</td>
                  <td className="px-2 py-1">{t.candidates}</td>
                  <td className="px-2 py-1">{t.core}</td>
                  <td className="px-2 py-1">{t.dynamic}</td>
                  <td className="px-2 py-1">{t.additional_info}</td>
                  <td className="px-2 py-1">{t.avg_confidence.toFixed(2)}</td>
                  <td className="px-2 py-1">{pctTxt(t.pct_regex)}</td>
                  <td className="px-2 py-1">{pctTxt(t.pct_keyword)}</td>
                  <td className="px-2 py-1">{pctTxt(t.pct_llm)}</td>
                  <td className="px-2 py-1">{t.conflicts > 0 ? <Badge variant="destructive">{t.conflicts}</Badge> : 0}</td>
                  <td className="px-2 py-1">{t.consolidated}</td>
                </tr>
              ))}
              {topics.length === 0 && <tr><td className="px-2 py-3 text-muted-foreground" colSpan={12}>Sem dados.</td></tr>}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {/* By data point */}
      <Card>
        <CardHeader><CardTitle className="text-base">Métricas por Data Point</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-muted-foreground">
              <tr>
                <th className="text-left px-2 py-1">Data Point</th>
                <th className="text-left px-2 py-1">Topic</th>
                <th className="text-left px-2 py-1">Candidates</th>
                <th className="text-left px-2 py-1">Consolidated</th>
                <th className="text-left px-2 py-1">Avg Conf</th>
                <th className="text-left px-2 py-1">Method Mix</th>
                <th className="text-left px-2 py-1">Conflicts</th>
                <th className="text-left px-2 py-1">Missing</th>
                <th className="text-left px-2 py-1">Sources</th>
              </tr>
            </thead>
            <tbody>
              {filteredDataPoints.map((d) => (
                <tr key={`${d.topic_slug}::${d.field_name}`} className="border-t">
                  <td className="px-2 py-1 font-mono">{d.field_name}</td>
                  <td className="px-2 py-1">{d.topic_name}</td>
                  <td className="px-2 py-1">{d.candidates}</td>
                  <td className="px-2 py-1">{d.consolidated ? <Badge className="bg-emerald-600 text-white">yes</Badge> : <Badge variant="outline">no</Badge>}</td>
                  <td className="px-2 py-1">{d.avg_confidence.toFixed(2)}</td>
                  <td className="px-2 py-1">r{d.method_mix.regex} / k{d.method_mix.keyword} / l{d.method_mix.llm}</td>
                  <td className="px-2 py-1">{d.conflicts > 0 ? <Badge variant="destructive">{d.conflicts}</Badge> : 0}</td>
                  <td className="px-2 py-1">{d.missing ? <Badge variant="destructive">missing</Badge> : "—"}</td>
                  <td className="px-2 py-1">{d.sources_count}</td>
                </tr>
              ))}
              {filteredDataPoints.length === 0 && <tr><td className="px-2 py-3 text-muted-foreground" colSpan={9}>Sem data points.</td></tr>}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {/* Chunks without extraction */}
      <Card>
        <CardHeader><CardTitle className="text-base">Chunks sem extração</CardTitle></CardHeader>
        <CardContent>
          {data.chunks_without_extraction.length === 0 && <p className="text-sm text-muted-foreground">Nenhum.</p>}
          <div className="space-y-2 max-h-[400px] overflow-auto">
            {data.chunks_without_extraction.map((c) => (
              <div key={c.chunk_id} className="border rounded p-2 text-xs">
                <div className="flex items-center justify-between mb-1">
                  <div className="flex gap-2 items-center">
                    <Badge variant="outline">{c.extraction_status}</Badge>
                    <span className="text-muted-foreground">{c.source_name}</span>
                  </div>
                  <div className="flex gap-1">
                    <Button size="sm" variant="ghost" onClick={() => alert(c.content_preview)}>View</Button>
                    <Button size="sm" variant="ghost" onClick={() => handleMarkIrrelevant(c.chunk_id)}>Irrelevante</Button>
                    <Button size="sm" variant="outline" onClick={() => handleRetryChunk(c.chunk_id)}>Retry LLM</Button>
                  </div>
                </div>
                <p className="text-muted-foreground line-clamp-2">{c.content_preview}</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Low confidence */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">Low Confidence Candidates (&lt;0.7)</CardTitle>
          <Button size="sm" variant="outline" onClick={handleRetryLowConfidenceBulk}>Retry todos via LLM</Button>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-muted-foreground">
              <tr>
                <th className="text-left px-2 py-1">Topic</th>
                <th className="text-left px-2 py-1">Field</th>
                <th className="text-left px-2 py-1">Value</th>
                <th className="text-left px-2 py-1">Conf</th>
                <th className="text-left px-2 py-1">Method</th>
                <th className="text-left px-2 py-1">Source</th>
                <th className="text-left px-2 py-1">Ações</th>
              </tr>
            </thead>
            <tbody>
              {filteredLowConf.map((c) => (
                <tr key={c.id} className="border-t">
                  <td className="px-2 py-1">{c.topic_slug}</td>
                  <td className="px-2 py-1 font-mono">{c.field_name}</td>
                  <td className="px-2 py-1 max-w-[200px] truncate">{typeof c.field_value === "string" ? c.field_value : JSON.stringify(c.field_value)}</td>
                  <td className="px-2 py-1">{c.confidence.toFixed(2)}</td>
                  <td className="px-2 py-1">{c.extraction_method}</td>
                  <td className="px-2 py-1 max-w-[120px] truncate">{c.source_chunk_ids[0]?.slice(0, 8)}</td>
                  <td className="px-2 py-1 flex gap-1">
                    <Button size="sm" variant="ghost" onClick={() => handleApproveCandidate(c.id)}>✓</Button>
                    <Button size="sm" variant="ghost" onClick={() => handleRejectCandidate(c.id)}>✗</Button>
                    <Button size="sm" variant="ghost" onClick={() => handleEditValue(c.id, c.field_value)}>edit</Button>
                  </td>
                </tr>
              ))}
              {filteredLowConf.length === 0 && <tr><td className="px-2 py-3 text-muted-foreground" colSpan={7}>Nenhum low-confidence pendente.</td></tr>}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {/* Dynamic fields */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Dynamic Fields Analysis</CardTitle>
          <a href="/settings" className="text-xs underline text-muted-foreground">Schema Evolution →</a>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-muted-foreground">
              <tr>
                <th className="text-left px-2 py-1">Field</th>
                <th className="text-left px-2 py-1">Ocorrências</th>
                <th className="text-left px-2 py-1">Tópicos</th>
                <th className="text-left px-2 py-1">Exemplos</th>
                <th className="text-left px-2 py-1">Sources</th>
                <th className="text-left px-2 py-1">Ação</th>
              </tr>
            </thead>
            <tbody>
              {filteredDynamic.map((d) => (
                <tr key={d.field_name} className="border-t">
                  <td className="px-2 py-1 font-mono">{d.field_name}</td>
                  <td className="px-2 py-1">{d.occurrences}</td>
                  <td className="px-2 py-1">{d.topics.join(", ")}</td>
                  <td className="px-2 py-1 max-w-[280px] truncate">{d.examples.map((e: unknown) => (typeof e === "string" ? e : JSON.stringify(e))).join(" | ")}</td>
                  <td className="px-2 py-1">{d.sources.length}</td>
                  <td className="px-2 py-1">
                    <Button size="sm" variant="outline" onClick={() => setSuggestModal({ field_name: d.field_name, suggested_topic_definition_id: d.suggested_topic_definition_id })}>
                      Suggest as Data Point
                    </Button>
                  </td>
                </tr>
              ))}
              {filteredDynamic.length === 0 && <tr><td className="px-2 py-3 text-muted-foreground" colSpan={6}>Sem dynamic fields.</td></tr>}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {/* Additional info */}
      <Card>
        <CardHeader><CardTitle className="text-base">Additional Information Analysis</CardTitle></CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-3">
            <StatCard label="Total" value={data.additional_info_stats.total} />
            <StatCard label="Approved" value={data.additional_info_stats.approved} />
            <StatCard label="Pending" value={data.additional_info_stats.pending} />
            <StatCard label="Rejected" value={data.additional_info_stats.rejected} />
            <StatCard label="Avg Length" value={`${data.additional_info_stats.avg_length} chars`} />
          </div>
          <table className="w-full text-xs">
            <thead className="text-muted-foreground">
              <tr><th className="text-left px-2 py-1">Topic</th><th className="text-left px-2 py-1">Total</th><th className="text-left px-2 py-1">Approved</th><th className="text-left px-2 py-1">Pending</th></tr>
            </thead>
            <tbody>
              {data.additional_info_stats.by_topic
                .filter((t) => topicFilter === "all" || t.topic_slug === topicFilter)
                .map((t) => (
                <tr key={t.topic_slug} className="border-t">
                  <td className="px-2 py-1">{t.topic_name}</td>
                  <td className="px-2 py-1">{t.total}</td>
                  <td className="px-2 py-1">{t.approved}</td>
                  <td className="px-2 py-1">{t.pending}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {/* Runs */}
      <Card>
        <CardHeader><CardTitle className="text-base">Extraction Runs</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-muted-foreground">
              <tr>
                <th className="text-left px-2 py-1">Date</th>
                <th className="text-left px-2 py-1">Mode</th>
                <th className="text-left px-2 py-1">Model</th>
                <th className="text-left px-2 py-1">Status</th>
                <th className="text-left px-2 py-1">Chunks</th>
                <th className="text-left px-2 py-1">Cands</th>
                <th className="text-left px-2 py-1">Core</th>
                <th className="text-left px-2 py-1">Dyn</th>
                <th className="text-left px-2 py-1">Add</th>
                <th className="text-left px-2 py-1">Regex/Kw/LLM</th>
                <th className="text-left px-2 py-1">Cost</th>
                <th className="text-left px-2 py-1">Tokens</th>
                <th className="text-left px-2 py-1">ms</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.runs.map((r) => (
                <tr key={r.id} className="border-t">
                  <td className="px-2 py-1">{new Date(r.created_at).toLocaleString()}</td>
                  <td className="px-2 py-1">{r.mode}</td>
                  <td className="px-2 py-1">{r.model_name ?? "—"}</td>
                  <td className="px-2 py-1">{r.status}</td>
                  <td className="px-2 py-1">{r.chunks}</td>
                  <td className="px-2 py-1">{r.candidates}</td>
                  <td className="px-2 py-1">{r.core}</td>
                  <td className="px-2 py-1">{r.dynamic}</td>
                  <td className="px-2 py-1">{r.additional}</td>
                  <td className="px-2 py-1">{r.regex}/{r.keyword}/{r.llm}</td>
                  <td className="px-2 py-1">{money(r.cost)}</td>
                  <td className="px-2 py-1">{r.input_tokens}/{r.output_tokens}</td>
                  <td className="px-2 py-1">{r.latency_ms}</td>
                  <td className="px-2 py-1"><Button size="sm" variant="ghost" onClick={() => setRunDetailId(r.id)}>view</Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {/* Compare runs */}
      <Card>
        <CardHeader><CardTitle className="text-base">Compare Extraction Runs</CardTitle></CardHeader>
        <CardContent>
          <div className="flex gap-2 items-end mb-3">
            <div className="flex-1">
              <Label className="text-xs">Run A</Label>
              <Select value={compareA} onValueChange={setCompareA}>
                <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>{data.runs.map((r) => <SelectItem key={r.id} value={r.id}>{new Date(r.created_at).toLocaleString()} — {r.model_name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="flex-1">
              <Label className="text-xs">Run B</Label>
              <Select value={compareB} onValueChange={setCompareB}>
                <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>{data.runs.map((r) => <SelectItem key={r.id} value={r.id}>{new Date(r.created_at).toLocaleString()} — {r.model_name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <Button onClick={handleCompare}>Comparar</Button>
          </div>
          {compareResult && compareResult.a && compareResult.b && (
            <table className="w-full text-xs">
              <thead><tr><th className="text-left px-2 py-1">Métrica</th><th className="text-left px-2 py-1">Run A</th><th className="text-left px-2 py-1">Run B</th></tr></thead>
              <tbody>
                {([
                  ["model", "Modelo"], ["mode", "Modo"], ["chunks", "Chunks"], ["core", "Core"], ["dynamic", "Dynamic"], ["additional", "Additional"],
                  ["regex", "Regex"], ["keyword", "Keyword"], ["llm", "LLM"], ["chunks_skipped_llm", "Chunks skipped LLM"],
                  ["chunks_sent_to_llm", "Chunks → LLM"], ["cost", "Custo"], ["latency_ms", "Latency ms"],
                  ["input_tokens", "Input tokens"], ["output_tokens", "Output tokens"],
                ] as Array<[keyof NonNullable<typeof compareResult.a>, string]>).map(([k, label]) => (
                  <tr key={String(k)} className="border-t">
                    <td className="px-2 py-1">{label}</td>
                    <td className="px-2 py-1">{String(compareResult.a?.[k] ?? "—")}</td>
                    <td className="px-2 py-1">{String(compareResult.b?.[k] ?? "—")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      {/* Suggest data point modal */}
      <SuggestModal
        open={!!suggestModal}
        initial={suggestModal}
        topicDefs={data.topics.map((t) => ({ id: t.topic_definition_id, name: t.topic_name }))}
        onClose={() => setSuggestModal(null)}
        onSubmit={async (payload) => {
          await callSuggestDataPoint({ data: payload });
          toast.success("Data Point criado");
          setSuggestModal(null);
          invalidate();
        }}
      />

      {/* Run detail modal */}
      <RunDetailDialog runId={runDetailId} onClose={() => setRunDetailId(null)} fetchDetail={callRunDetail} />
    </div>
  );
}

function SuggestModal({ open, initial, topicDefs, onClose, onSubmit }: {
  open: boolean;
  initial: { field_name: string; suggested_topic_definition_id: string } | null;
  topicDefs: Array<{ id: string; name: string }>;
  onClose: () => void;
  onSubmit: (p: { topic_definition_id: string; field_name: string; field_label: string; field_type: string; description?: string; required?: boolean; active?: boolean }) => Promise<void>;
}) {
  const [topicDef, setTopicDef] = useState("");
  const [name, setName] = useState("");
  const [label, setLabel] = useState("");
  const [type, setType] = useState("text");
  const [desc, setDesc] = useState("");
  const [required, setRequired] = useState(false);
  const [active, setActive] = useState(true);

  useMemo(() => {
    if (initial && open) {
      setName(initial.field_name);
      setLabel(initial.field_name.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()));
      setTopicDef(initial.suggested_topic_definition_id);
      setType("text"); setDesc(""); setRequired(false); setActive(true);
    }
  }, [initial, open]);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Sugerir Data Point</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div><Label className="text-xs">Topic</Label>
            <Select value={topicDef} onValueChange={setTopicDef}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{topicDefs.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div><Label className="text-xs">field_name</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
          <div><Label className="text-xs">field_label</Label><Input value={label} onChange={(e) => setLabel(e.target.value)} /></div>
          <div><Label className="text-xs">field_type</Label>
            <Select value={type} onValueChange={setType}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {["text","boolean","number","currency","time","time_range","multi_select"].map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div><Label className="text-xs">description</Label><Textarea value={desc} onChange={(e) => setDesc(e.target.value)} /></div>
          <div className="flex gap-4">
            <label className="text-xs flex gap-1 items-center"><input type="checkbox" checked={required} onChange={(e) => setRequired(e.target.checked)} /> required</label>
            <label className="text-xs flex gap-1 items-center"><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> active</label>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={() => onSubmit({ topic_definition_id: topicDef, field_name: name, field_label: label, field_type: type, description: desc, required, active })} disabled={!topicDef || !name || !label}>Criar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RunDetailDialog({ runId, onClose, fetchDetail }: {
  runId: string | null;
  onClose: () => void;
  fetchDetail: (a: { data: { runId: string } }) => Promise<{ run: unknown; candidates: unknown[] }>;
}) {
  const { data } = useQuery({
    queryKey: ["run-detail", runId],
    queryFn: () => fetchDetail({ data: { runId: runId! } }),
    enabled: !!runId,
  });
  return (
    <Dialog open={!!runId} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-3xl max-h-[80vh] overflow-auto">
        <DialogHeader><DialogTitle>Run detail</DialogTitle></DialogHeader>
        {data ? (
          <div className="space-y-2 text-xs">
            <h4 className="font-semibold">Run</h4>
            <pre className="bg-muted p-2 rounded overflow-auto text-[10px]">{JSON.stringify((data.run as { stats?: unknown; preview_result?: unknown; error?: unknown } | null) ? { stats: (data.run as { stats?: unknown }).stats, error: (data.run as { error?: unknown }).error } : null, null, 2)}</pre>
            <h4 className="font-semibold mt-2">Candidates gerados ({data.candidates.length})</h4>
            <pre className="bg-muted p-2 rounded overflow-auto text-[10px]">{JSON.stringify(data.candidates.slice(0, 50), null, 2)}</pre>
          </div>
        ) : <p className="text-sm">Carregando...</p>}
      </DialogContent>
    </Dialog>
  );
}
