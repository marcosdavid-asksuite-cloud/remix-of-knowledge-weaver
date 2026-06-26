import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

function getSb() {
  return createClient<Database>(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_PUBLISHABLE_KEY!,
    { auth: { storage: undefined, persistSession: false, autoRefreshToken: false } },
  );
}

export type ExtractionAnalytics = {
  totals: {
    total_chunks: number;
    processed_chunks: number;
    extracted_chunks: number;
    no_knowledge_chunks: number;
    marked_irrelevant_chunks: number;
    retry_needed_chunks: number;
    not_processed_chunks: number;
    total_candidates: number;
    core_candidates: number;
    dynamic_candidates: number;
    additional_info: number;
    pct_regex: number;
    pct_keyword: number;
    pct_llm: number;
    avg_confidence: number;
    total_cost: number;
    total_input_tokens: number;
    total_output_tokens: number;
    total_extraction_runs: number;
  };
  topics: Array<{
    topic_definition_id: string;
    topic_slug: string;
    topic_name: string;
    chunks_matched: number;
    candidates: number;
    core: number;
    dynamic: number;
    additional_info: number;
    avg_confidence: number;
    pct_regex: number;
    pct_keyword: number;
    pct_llm: number;
    conflicts: number;
    consolidated: number;
    pending: number;
  }>;
  data_points: Array<{
    field_name: string;
    topic_slug: string;
    topic_name: string;
    topic_definition_id: string;
    candidates: number;
    consolidated: boolean;
    avg_confidence: number;
    method_mix: { regex: number; keyword: number; llm: number };
    conflicts: number;
    missing: boolean;
    sources_count: number;
  }>;
  chunks_without_extraction: Array<{
    chunk_id: string;
    source_id: string;
    source_name: string;
    content_preview: string;
    metadata: any;
    extraction_status: string;
  }>;
  low_confidence_candidates: Array<{
    id: string;
    topic_slug: string;
    field_name: string;
    field_origin: string;
    field_value: any;
    confidence: number;
    extraction_method: string;
    source_chunk_ids: string[];
    status: string;
  }>;
  dynamic_fields_grouped: Array<{
    field_name: string;
    occurrences: number;
    topics: string[];
    examples: any[];
    sources: string[];
    candidate_ids: string[];
    suggested_topic_definition_id: string;
    suggested_topic_slug: string;
  }>;
  additional_info_stats: {
    total: number;
    approved: number;
    pending: number;
    rejected: number;
    avg_length: number;
    by_topic: Array<{ topic_slug: string; topic_name: string; total: number; approved: number; pending: number }>;
  };
  runs: Array<{
    id: string;
    created_at: string;
    mode: string;
    status: string;
    model_name: string | null;
    chunks: number;
    candidates: number;
    core: number;
    dynamic: number;
    additional: number;
    regex: number;
    keyword: number;
    llm: number;
    cost: number;
    input_tokens: number;
    output_tokens: number;
    latency_ms: number;
  }>;
};

export const getExtractionAnalytics = createServerFn({ method: "POST" })
  .inputValidator((d: { projectId: string }) => d)
  .handler(async ({ data }): Promise<ExtractionAnalytics> => {
    const sb = getSb();
    const { projectId } = data;

    const [sourcesRes, topicsRes, topicDefsRes, dpdsRes, candidatesRes, conflictsRes, addInfoRes, fieldsRes, runsRes] = await Promise.all([
      sb.from("raw_sources").select("id, filename").eq("project_id", projectId),
      sb.from("topics").select("id, topic_definition_id").eq("project_id", projectId),
      sb.from("topic_definitions").select("id, slug, name"),
      sb.from("data_point_definitions").select("id, topic_definition_id, field_name").eq("active", true),
      sb.from("knowledge_candidates").select("id, topic_definition_id, field_name, field_origin, field_value, confidence, source_chunk_ids, status, extraction_method, extraction_run_id").eq("project_id", projectId),
      sb.from("knowledge_conflicts").select("id, topic_definition_id, field_name, status").eq("project_id", projectId),
      sb.from("additional_info").select("id, topic_id, content, status").order("created_at", { ascending: false }),
      sb.from("knowledge_fields").select("id, topic_id, field_name, field_origin, consolidation_status"),
      sb.from("extraction_runs").select("*, model_configurations(model_name)").eq("project_id", projectId).order("created_at", { ascending: false }),
    ]);

    const sources = sourcesRes.data ?? [];
    const sourceIds = sources.map((s) => s.id);
    const projectTopics = topicsRes.data ?? [];
    const topicDefs = topicDefsRes.data ?? [];
    const dpds = dpdsRes.data ?? [];
    const candidates = candidatesRes.data ?? [];
    const conflicts = conflictsRes.data ?? [];
    const addInfo = addInfoRes.data ?? [];
    const fields = fieldsRes.data ?? [];
    const runs = runsRes.data ?? [];

    // chunks scoped to project
    const { data: chunksAll } = sourceIds.length > 0
      ? await sb.from("raw_chunks").select("id, raw_source_id, content, metadata, extraction_status").in("raw_source_id", sourceIds)
      : { data: [] as Array<{ id: string; raw_source_id: string; content: string; metadata: any; extraction_status: string }> };
    const allChunks = chunksAll ?? [];

    const topicDefById = new Map(topicDefs.map((t) => [t.id, t]));
    const topicByDefId = new Map(projectTopics.map((t) => [t.topic_definition_id, t.id]));
    const projectTopicIds = new Set(projectTopics.map((t) => t.id));
    const sourceById = new Map(sources.map((s) => [s.id, s]));

    // Totals
    const totalChunks = allChunks.length;
    const byStatus: Record<string, number> = {};
    for (const c of allChunks) byStatus[c.extraction_status] = (byStatus[c.extraction_status] ?? 0) + 1;
    const processedChunks = totalChunks - (byStatus["not_processed"] ?? 0);

    const candByMethod = { regex: 0, keyword: 0, llm: 0 };
    let confSum = 0, confN = 0;
    for (const c of candidates) {
      const m = (c.extraction_method ?? "llm") as "regex" | "keyword" | "llm";
      if (m in candByMethod) candByMethod[m]++;
      if (typeof c.confidence === "number") { confSum += Number(c.confidence); confN++; }
    }
    const totalCandidates = candidates.length;
    const pct = (n: number, t: number) => t > 0 ? Math.round((n / t) * 1000) / 10 : 0;

    let totalCost = 0, totalIn = 0, totalOut = 0;
    for (const r of runs) {
      const s = (r.stats ?? {}) as { estimated_cost?: number; input_tokens?: number; output_tokens?: number };
      totalCost += Number(s.estimated_cost ?? 0);
      totalIn += Number(s.input_tokens ?? 0);
      totalOut += Number(s.output_tokens ?? 0);
    }

    const projectAddInfo = addInfo.filter((a) => projectTopicIds.has(a.topic_id as string));

    // Topics
    const chunkTopicHits = new Map<string, number>();
    for (const r of runs) {
      const preview = (r.preview_result ?? {}) as { chunk_topics?: Record<string, { matched: string[] }> };
      const ct = preview.chunk_topics ?? {};
      for (const matchInfo of Object.values(ct)) {
        for (const slug of matchInfo.matched ?? []) {
          chunkTopicHits.set(slug, (chunkTopicHits.get(slug) ?? 0) + 1);
        }
      }
    }

    const topicsOut: ExtractionAnalytics["topics"] = [];
    for (const td of topicDefs) {
      if (!topicByDefId.has(td.id)) continue; // only project topics
      const tcands = candidates.filter((c) => c.topic_definition_id === td.id);
      const tcore = tcands.filter((c) => c.field_origin === "core").length;
      const tdyn = tcands.filter((c) => c.field_origin === "dynamic").length;
      const tConfs = tcands.map((c) => Number(c.confidence)).filter((n) => !isNaN(n));
      const tAvgConf = tConfs.length > 0 ? tConfs.reduce((a, b) => a + b, 0) / tConfs.length : 0;
      const tMethod = { regex: 0, keyword: 0, llm: 0 };
      for (const c of tcands) {
        const m = (c.extraction_method ?? "llm") as keyof typeof tMethod;
        if (m in tMethod) tMethod[m]++;
      }
      const tConflicts = conflicts.filter((c) => c.topic_definition_id === td.id && c.status === "pending").length;
      const topicId = topicByDefId.get(td.id);
      const tConsolidated = topicId ? fields.filter((f) => f.topic_id === topicId && f.consolidation_status === "consolidated").length : 0;
      const tPending = tcands.filter((c) => c.status === "pending").length;
      const tAddInfo = projectAddInfo.filter((a) => a.topic_id === topicId).length;
      topicsOut.push({
        topic_definition_id: td.id,
        topic_slug: td.slug,
        topic_name: td.name,
        chunks_matched: chunkTopicHits.get(td.slug) ?? 0,
        candidates: tcands.length,
        core: tcore,
        dynamic: tdyn,
        additional_info: tAddInfo,
        avg_confidence: Math.round(tAvgConf * 1000) / 1000,
        pct_regex: pct(tMethod.regex, tcands.length),
        pct_keyword: pct(tMethod.keyword, tcands.length),
        pct_llm: pct(tMethod.llm, tcands.length),
        conflicts: tConflicts,
        consolidated: tConsolidated,
        pending: tPending,
      });
    }

    // Data points: only those tied to project topics
    const dataPointsOut: ExtractionAnalytics["data_points"] = [];
    const projectDpds = dpds.filter((d) => topicByDefId.has(d.topic_definition_id));
    for (const d of projectDpds) {
      const td = topicDefById.get(d.topic_definition_id);
      if (!td) continue;
      const topicId = topicByDefId.get(d.topic_definition_id);
      const dcands = candidates.filter((c) =>
        c.topic_definition_id === d.topic_definition_id && c.field_name === d.field_name,
      );
      const dConfs = dcands.map((c) => Number(c.confidence)).filter((n) => !isNaN(n));
      const dAvgConf = dConfs.length > 0 ? dConfs.reduce((a, b) => a + b, 0) / dConfs.length : 0;
      const dMethod = { regex: 0, keyword: 0, llm: 0 };
      for (const c of dcands) {
        const m = (c.extraction_method ?? "llm") as keyof typeof dMethod;
        if (m in dMethod) dMethod[m]++;
      }
      const consolidated = topicId
        ? fields.some((f) => f.topic_id === topicId && f.field_name === d.field_name && f.consolidation_status === "consolidated")
        : false;
      const dConflicts = conflicts.filter((c) => c.topic_definition_id === d.topic_definition_id && c.field_name === d.field_name && c.status === "pending").length;
      const allSources = new Set<string>();
      dcands.forEach((c) => (c.source_chunk_ids ?? []).forEach((s: string) => allSources.add(s)));
      dataPointsOut.push({
        field_name: d.field_name,
        topic_slug: td.slug,
        topic_name: td.name,
        topic_definition_id: td.id,
        candidates: dcands.length,
        consolidated,
        avg_confidence: Math.round(dAvgConf * 1000) / 1000,
        method_mix: dMethod,
        conflicts: dConflicts,
        missing: dcands.length === 0 && !consolidated,
        sources_count: allSources.size,
      });
    }

    // Chunks without extraction
    const chunksWithout = allChunks
      .filter((c) => c.extraction_status === "no_knowledge_found" || c.extraction_status === "retry_needed" || c.extraction_status === "marked_irrelevant")
      .slice(0, 200)
      .map((c) => ({
        chunk_id: c.id,
        source_id: c.raw_source_id,
        source_name: sourceById.get(c.raw_source_id)?.filename ?? "—",
        content_preview: (c.content ?? "").slice(0, 240),
        metadata: c.metadata,
        extraction_status: c.extraction_status,
      }));

    // Low confidence candidates (<0.7) — pending only
    const lowConf = candidates
      .filter((c) => c.status === "pending" && typeof c.confidence === "number" && Number(c.confidence) < 0.7)
      .slice(0, 200)
      .map((c) => {
        const td = topicDefById.get(c.topic_definition_id);
        return {
          id: c.id,
          topic_slug: td?.slug ?? "—",
          field_name: c.field_name,
          field_origin: c.field_origin,
          field_value: c.field_value,
          confidence: Number(c.confidence),
          extraction_method: c.extraction_method ?? "llm",
          source_chunk_ids: (c.source_chunk_ids ?? []) as string[],
          status: c.status,
        };
      });

    // Dynamic fields grouped
    const dynMap = new Map<string, { occurrences: number; topics: Set<string>; examples: any[]; sources: Set<string>; candidate_ids: string[]; suggested_topic_definition_id: string; suggested_topic_slug: string }>();
    for (const c of candidates) {
      if (c.field_origin !== "dynamic") continue;
      const key = c.field_name.trim().toLowerCase();
      const td = topicDefById.get(c.topic_definition_id);
      if (!dynMap.has(key)) {
        dynMap.set(key, {
          occurrences: 0, topics: new Set(), examples: [], sources: new Set(), candidate_ids: [],
          suggested_topic_definition_id: c.topic_definition_id,
          suggested_topic_slug: td?.slug ?? "",
        });
      }
      const e = dynMap.get(key)!;
      e.occurrences++;
      if (td) e.topics.add(td.slug);
      if (e.examples.length < 5) e.examples.push(c.field_value);
      (c.source_chunk_ids ?? []).forEach((s: string) => e.sources.add(s));
      e.candidate_ids.push(c.id);
    }
    const dynamicGrouped = Array.from(dynMap.entries())
      .map(([field_name, v]) => ({
        field_name,
        occurrences: v.occurrences,
        topics: Array.from(v.topics),
        examples: v.examples,
        sources: Array.from(v.sources),
        candidate_ids: v.candidate_ids,
        suggested_topic_definition_id: v.suggested_topic_definition_id,
        suggested_topic_slug: v.suggested_topic_slug,
      }))
      .sort((a, b) => b.occurrences - a.occurrences);

    // Additional info stats
    const addLen = projectAddInfo.map((a) => (a.content ?? "").length);
    const avgLen = addLen.length > 0 ? Math.round(addLen.reduce((a, b) => a + b, 0) / addLen.length) : 0;
    const addApproved = projectAddInfo.filter((a) => a.status === "approved").length;
    const addPending = projectAddInfo.filter((a) => a.status === "pending").length;
    const addRejected = projectAddInfo.filter((a) => a.status === "rejected").length;
    const byTopicMap = new Map<string, { total: number; approved: number; pending: number; slug: string; name: string }>();
    for (const a of projectAddInfo) {
      const defId = projectTopics.find((t) => t.id === a.topic_id)?.topic_definition_id;
      const td = defId ? topicDefById.get(defId) : null;
      if (!td) continue;
      if (!byTopicMap.has(td.slug)) byTopicMap.set(td.slug, { total: 0, approved: 0, pending: 0, slug: td.slug, name: td.name });
      const e = byTopicMap.get(td.slug)!;
      e.total++;
      if (a.status === "approved") e.approved++;
      if (a.status === "pending") e.pending++;
    }
    const byTopic = Array.from(byTopicMap.values()).map((v) => ({ topic_slug: v.slug, topic_name: v.name, total: v.total, approved: v.approved, pending: v.pending }));

    // Runs table
    const runsOut = runs.map((r) => {
      const s = (r.stats ?? {}) as Record<string, number | undefined>;
      const det = ((s.deterministic_extraction ?? {}) as Record<string, number | undefined>);
      const mc = r.model_configurations as { model_name: string } | null;
      return {
        id: r.id,
        created_at: r.created_at,
        mode: r.mode,
        status: r.status,
        model_name: mc?.model_name ?? null,
        chunks: Number(s.chunks_processed ?? 0),
        candidates: Number(s.core_fields_found ?? 0) + Number(s.dynamic_fields_found ?? 0),
        core: Number(s.core_fields_found ?? 0),
        dynamic: Number(s.dynamic_fields_found ?? 0),
        additional: Number(s.additional_info_found ?? 0),
        regex: Number(det.regex_fields ?? 0),
        keyword: Number(det.keyword_fields ?? 0),
        llm: Number(det.llm_fields ?? 0),
        cost: Number(s.estimated_cost ?? 0),
        input_tokens: Number(s.input_tokens ?? 0),
        output_tokens: Number(s.output_tokens ?? 0),
        latency_ms: Number(s.latency_ms ?? 0),
      };
    });

    return {
      totals: {
        total_chunks: totalChunks,
        processed_chunks: processedChunks,
        extracted_chunks: byStatus["extracted"] ?? 0,
        no_knowledge_chunks: byStatus["no_knowledge_found"] ?? 0,
        marked_irrelevant_chunks: byStatus["marked_irrelevant"] ?? 0,
        retry_needed_chunks: byStatus["retry_needed"] ?? 0,
        not_processed_chunks: byStatus["not_processed"] ?? 0,
        total_candidates: totalCandidates,
        core_candidates: candidates.filter((c) => c.field_origin === "core").length,
        dynamic_candidates: candidates.filter((c) => c.field_origin === "dynamic").length,
        additional_info: projectAddInfo.length,
        pct_regex: pct(candByMethod.regex, totalCandidates),
        pct_keyword: pct(candByMethod.keyword, totalCandidates),
        pct_llm: pct(candByMethod.llm, totalCandidates),
        avg_confidence: confN > 0 ? Math.round((confSum / confN) * 1000) / 1000 : 0,
        total_cost: Math.round(totalCost * 10000) / 10000,
        total_input_tokens: totalIn,
        total_output_tokens: totalOut,
        total_extraction_runs: runs.length,
      },
      topics: topicsOut,
      data_points: dataPointsOut,
      chunks_without_extraction: chunksWithout,
      low_confidence_candidates: lowConf,
      dynamic_fields_grouped: dynamicGrouped,
      additional_info_stats: {
        total: projectAddInfo.length,
        approved: addApproved,
        pending: addPending,
        rejected: addRejected,
        avg_length: avgLen,
        by_topic: byTopic,
      },
      runs: runsOut,
    };
  });

// ----- Mutations -----

export const setChunkStatus = createServerFn({ method: "POST" })
  .inputValidator((d: { chunkIds: string[]; status: "not_processed" | "extracted" | "no_knowledge_found" | "marked_irrelevant" | "retry_needed" }) => d)
  .handler(async ({ data }) => {
    const sb = getSb();
    if (data.chunkIds.length === 0) return { updated: 0 };
    const { error, count } = await sb
      .from("raw_chunks")
      .update({ extraction_status: data.status } as never, { count: "exact" })
      .in("id", data.chunkIds);
    if (error) throw new Error(error.message);
    return { updated: count ?? data.chunkIds.length };
  });

export const setCandidateStatus = createServerFn({ method: "POST" })
  .inputValidator((d: { candidateId: string; status: "approved" | "rejected" | "pending"; newValue?: unknown }) => d)
  .handler(async ({ data }) => {
    const sb = getSb();
    const payload: Record<string, unknown> = { status: data.status };
    if (data.newValue !== undefined) payload.field_value = data.newValue;
    const { error } = await sb.from("knowledge_candidates").update(payload as never).eq("id", data.candidateId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const suggestDataPointFromDynamic = createServerFn({ method: "POST" })
  .inputValidator((d: {
    topic_definition_id: string;
    field_name: string;
    field_label: string;
    field_type: string;
    description?: string;
    required?: boolean;
    active?: boolean;
  }) => d)
  .handler(async ({ data }) => {
    const sb = getSb();
    const { error } = await sb.from("data_point_definitions").insert({
      topic_definition_id: data.topic_definition_id,
      field_name: data.field_name,
      field_label: data.field_label,
      field_type: data.field_type,
      description: data.description ?? null,
      required: data.required ?? false,
      active: data.active ?? true,
    } as never);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const compareExtractionRuns = createServerFn({ method: "POST" })
  .inputValidator((d: { runIdA: string; runIdB: string }) => d)
  .handler(async ({ data }) => {
    const sb = getSb();
    const [aRes, bRes] = await Promise.all([
      sb.from("extraction_runs").select("*, model_configurations(model_name)").eq("id", data.runIdA).maybeSingle(),
      sb.from("extraction_runs").select("*, model_configurations(model_name)").eq("id", data.runIdB).maybeSingle(),
    ]);
    if (aRes.error || bRes.error) throw new Error(aRes.error?.message ?? bRes.error?.message ?? "Falha");
    const shape = (r: typeof aRes.data | null) => {
      if (!r) return null;
      const s = (r.stats ?? {}) as Record<string, number | undefined>;
      const det = ((s.deterministic_extraction ?? {}) as Record<string, number | undefined>);
      const mc = r.model_configurations as { model_name: string } | null;
      return {
        id: r.id,
        created_at: r.created_at,
        mode: r.mode,
        status: r.status,
        model: mc?.model_name ?? null,
        chunks: Number(s.chunks_processed ?? 0),
        core: Number(s.core_fields_found ?? 0),
        dynamic: Number(s.dynamic_fields_found ?? 0),
        additional: Number(s.additional_info_found ?? 0),
        regex: Number(det.regex_fields ?? 0),
        keyword: Number(det.keyword_fields ?? 0),
        llm: Number(det.llm_fields ?? 0),
        chunks_skipped_llm: Number(det.chunks_skipped_llm ?? 0),
        chunks_sent_to_llm: Number(det.chunks_sent_to_llm ?? 0),
        cost: Number(s.estimated_cost ?? 0),
        latency_ms: Number(s.latency_ms ?? 0),
        input_tokens: Number(s.input_tokens ?? 0),
        output_tokens: Number(s.output_tokens ?? 0),
      };
    };
    return { a: shape(aRes.data), b: shape(bRes.data) };
  });

export const getRunDetail = createServerFn({ method: "POST" })
  .inputValidator((d: { runId: string }) => d)
  .handler(async ({ data }) => {
    const sb = getSb();
    const { data: run, error } = await sb.from("extraction_runs")
      .select("*, model_configurations(model_name)")
      .eq("id", data.runId).maybeSingle();
    if (error) throw new Error(error.message);
    const { data: cands } = await sb.from("knowledge_candidates")
      .select("id, topic_definition_id, field_name, field_origin, field_value, confidence, extraction_method, status")
      .eq("extraction_run_id", data.runId);
    return { run, candidates: cands ?? [] };
  });

export const getDataPointStats = createServerFn({ method: "POST" })
  .inputValidator((d: { projectId?: string }) => d)
  .handler(async ({ data }) => {
    const sb = getSb();
    const dpdRes = await sb.from("data_point_definitions").select("id, topic_definition_id, field_name, extraction_strategy");
    const dpds = dpdRes.data ?? [];
    let candidatesQ = sb.from("knowledge_candidates").select("topic_definition_id, field_name, confidence, status");
    if (data.projectId) candidatesQ = candidatesQ.eq("project_id", data.projectId);
    const candsRes = await candidatesQ;
    const cands = candsRes.data ?? [];
    let fieldsQ = sb.from("knowledge_fields").select("topic_id, field_name, consolidation_status, topics!inner(project_id, topic_definition_id)");
    if (data.projectId) fieldsQ = fieldsQ.eq("topics.project_id", data.projectId);
    const fieldsRes = await fieldsQ;
    const flds = fieldsRes.data ?? [];
    const out: Record<string, { candidates: number; consolidated: number; missing: boolean; avg_confidence: number; extraction_strategy: string | null }> = {};
    for (const d of dpds) {
      const k = `${d.topic_definition_id}::${d.field_name}`;
      const c = cands.filter((x) => x.topic_definition_id === d.topic_definition_id && x.field_name === d.field_name);
      const confs = c.map((x) => Number(x.confidence)).filter((n) => !isNaN(n));
      const avg = confs.length > 0 ? confs.reduce((a, b) => a + b, 0) / confs.length : 0;
      const cons = flds.filter((f) => {
        const t = f.topics as { project_id: string; topic_definition_id: string } | null;
        return t?.topic_definition_id === d.topic_definition_id && f.field_name === d.field_name && f.consolidation_status === "consolidated";
      }).length;
      out[k] = {
        candidates: c.length,
        consolidated: cons,
        missing: c.length === 0 && cons === 0,
        avg_confidence: Math.round(avg * 1000) / 1000,
        extraction_strategy: (d as { extraction_strategy?: string | null }).extraction_strategy ?? null,
      };
    }
    return out;
  });
