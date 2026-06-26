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

export type TopicHealth = {
  topic_definition_id: string;
  topic_slug: string;
  topic_name: string;
  health_score: number;
  core_coverage: number;
  required_coverage: number;
  confidence_score: number;
  approved_ratio: number;
  dynamic_ratio: number;
  additional_info_count: number;
  additional_info_approved: number;
  pending_conflicts_count: number;
  pending_candidates_count: number;
  pending_additional_info_count: number;
  total_core_defs: number;
  filled_core_count: number;
  total_required_defs: number;
  filled_required_count: number;
  dynamic_fields_count: number;
  consolidated_fields: Array<{
    field_name: string;
    field_label: string;
    field_value: unknown;
    confidence: number | null;
    source_of_truth: string | null;
  }>;
  dynamic_fields: Array<{
    field_name: string;
    field_value: unknown;
    confidence: number | null;
    source_of_truth: string | null;
  }>;
  missing_required_fields: Array<{ field_name: string; field_label: string; field_type: string }>;
  missing_optional_fields: Array<{ field_name: string; field_label: string; field_type: string }>;
  flags: string[];
};

export type HealthReport = {
  project_id: string;
  computed_at: string;
  overall_health_score: number;
  avg_core_coverage: number;
  total_pending_conflicts: number;
  total_missing_required: number;
  critical_topics_count: number;
  topics: TopicHealth[];
};

function clamp(n: number, lo = 0, hi = 100) {
  return Math.max(lo, Math.min(hi, n));
}

export const calculateKnowledgeHealth = createServerFn({ method: "POST" })
  .inputValidator((d: { projectId: string; persistSnapshot?: boolean }) => d)
  .handler(async ({ data }): Promise<HealthReport> => {
    const sb = getSb();
    const { projectId, persistSnapshot = true } = data;

    // Fetch all needed data in parallel
    const [topicDefsRes, topicsRes, defsRes, fieldsRes, conflictsRes, candidatesRes, addInfoRes] = await Promise.all([
      sb.from("topic_definitions").select("id, slug, name").order("name"),
      sb.from("topics").select("id, topic_definition_id").eq("project_id", projectId),
      sb.from("data_point_definitions").select("id, topic_definition_id, field_name, field_label, field_type, required").eq("active", true),
      sb.from("knowledge_fields").select("id, topic_id, field_name, field_value, field_origin, confidence, source_of_truth, consolidation_status, approved_by_user"),
      sb.from("knowledge_conflicts").select("id, topic_definition_id, status").eq("project_id", projectId).eq("status", "pending"),
      sb.from("knowledge_candidates").select("id, topic_definition_id, field_origin, status").eq("project_id", projectId).eq("status", "pending"),
      sb.from("additional_info").select("id, topic_id, status"),
    ]);

    for (const r of [topicDefsRes, topicsRes, defsRes, fieldsRes, conflictsRes, candidatesRes, addInfoRes]) {
      if (r.error) throw new Error(r.error.message);
    }

    const topicDefs = topicDefsRes.data ?? [];
    const projectTopics = topicsRes.data ?? [];
    const allDefs = defsRes.data ?? [];
    const allFields = fieldsRes.data ?? [];
    const pendingConflicts = conflictsRes.data ?? [];
    const pendingCandidates = candidatesRes.data ?? [];
    const allAddInfo = addInfoRes.data ?? [];

    // Maps
    const topicByDefId = new Map(projectTopics.map((t) => [t.topic_definition_id, t.id]));
    const topicDefById = new Map(projectTopics.map((t) => [t.id, t.topic_definition_id]));
    const projectTopicIds = new Set(projectTopics.map((t) => t.id));

    // Only keep fields belonging to this project's topics
    const projectFields = allFields.filter((f) => projectTopicIds.has(f.topic_id as string));
    const projectAddInfo = allAddInfo.filter((a) => projectTopicIds.has(a.topic_id as string));

    const topics: TopicHealth[] = [];

    for (const td of topicDefs) {
      const topicId = topicByDefId.get(td.id);
      const defs = allDefs.filter((d) => d.topic_definition_id === td.id);
      const requiredDefs = defs.filter((d) => d.required);

      const fields = topicId ? projectFields.filter((f) => f.topic_id === topicId) : [];
      // Consolidated = consolidation_status === 'consolidated' OR approved_by_user
      const consolidatedFields = fields.filter(
        (f) => f.consolidation_status === "consolidated" || f.approved_by_user === true,
      );

      const coreFilled = new Set(
        consolidatedFields.filter((f) => f.field_origin === "core").map((f) => f.field_name),
      );
      const requiredFilled = requiredDefs.filter((d) => coreFilled.has(d.field_name));

      const dynFields = consolidatedFields.filter((f) => f.field_origin === "dynamic");

      const total_core_defs = defs.length;
      const filled_core_count = defs.filter((d) => coreFilled.has(d.field_name)).length;
      const total_required_defs = requiredDefs.length;
      const filled_required_count = requiredFilled.length;

      const core_coverage = total_core_defs > 0 ? (filled_core_count / total_core_defs) * 100 : 0;
      const required_coverage =
        total_required_defs > 0
          ? (filled_required_count / total_required_defs) * 100
          : core_coverage;

      const confidences = consolidatedFields
        .map((f) => (typeof f.confidence === "number" ? f.confidence : null))
        .filter((c): c is number => c !== null);
      const confidence_score =
        confidences.length > 0
          ? (confidences.reduce((a, b) => a + b, 0) / confidences.length) * 100
          : 70;

      const totalFields = consolidatedFields.length;
      const dynamic_ratio = totalFields > 0 ? dynFields.length / totalFields : 0;

      const topicConflicts = pendingConflicts.filter((c) => c.topic_definition_id === td.id);
      const topicCandidates = pendingCandidates.filter((c) => c.topic_definition_id === td.id);
      const topicAddInfo = topicId ? projectAddInfo.filter((a) => a.topic_id === topicId) : [];
      const addInfoPending = topicAddInfo.filter((a) => a.status === "pending").length;
      const addInfoApproved = topicAddInfo.filter((a) => a.status === "approved").length;
      const addInfoTotal = topicAddInfo.length;

      const pendingTotal = topicCandidates.length + addInfoPending;

      const conflict_penalty = Math.min(40, topicConflicts.length * 10);
      let review_penalty = 0;
      if (pendingTotal > 10) review_penalty = 20;
      else if (pendingTotal >= 4) review_penalty = 10;
      else if (pendingTotal >= 1) review_penalty = 5;

      // approved_ratio: % of candidates that ended up approved/consolidated
      // simplified: approved fields vs (approved + pending)
      const approvedCount = consolidatedFields.length;
      const denom = approvedCount + topicCandidates.length;
      const approved_ratio = denom > 0 ? (approvedCount / denom) * 100 : 100;

      let health_score =
        core_coverage * 0.45 +
        required_coverage * 0.25 +
        confidence_score * 0.2 +
        approved_ratio * 0.1 -
        conflict_penalty -
        review_penalty;
      health_score = clamp(Math.round(health_score));

      // Flags
      const flags: string[] = [];
      if (total_required_defs > 0 && filled_required_count < total_required_defs)
        flags.push("missing_required_fields");
      if (topicConflicts.length > 0) flags.push("pending_conflicts");
      if (dynamic_ratio > 0.5) flags.push("schema_may_be_incomplete");
      if (filled_core_count <= 1 && addInfoApproved >= 2) flags.push("high_text_dependency");
      if (filled_core_count === 0 && dynFields.length === 0 && addInfoApproved === 0)
        flags.push("empty_topic");

      const missing_required_fields = requiredDefs
        .filter((d) => !coreFilled.has(d.field_name))
        .map((d) => ({ field_name: d.field_name, field_label: d.field_label, field_type: d.field_type }));
      const missing_optional_fields = defs
        .filter((d) => !d.required && !coreFilled.has(d.field_name))
        .map((d) => ({ field_name: d.field_name, field_label: d.field_label, field_type: d.field_type }));

      const defByName = new Map(defs.map((d) => [d.field_name, d]));
      const consolidated_fields = consolidatedFields
        .filter((f) => f.field_origin === "core")
        .map((f) => ({
          field_name: f.field_name,
          field_label: defByName.get(f.field_name)?.field_label ?? f.field_name,
          field_value: f.field_value,
          confidence: f.confidence as number | null,
          source_of_truth: (f.source_of_truth as string | null) ?? null,
        }));
      const dynamic_fields = dynFields.map((f) => ({
        field_name: f.field_name,
        field_value: f.field_value,
        confidence: f.confidence as number | null,
        source_of_truth: (f.source_of_truth as string | null) ?? null,
      }));

      topics.push({
        topic_definition_id: td.id,
        topic_slug: td.slug,
        topic_name: td.name,
        health_score,
        core_coverage: Math.round(core_coverage * 10) / 10,
        required_coverage: Math.round(required_coverage * 10) / 10,
        confidence_score: Math.round(confidence_score * 10) / 10,
        approved_ratio: Math.round(approved_ratio * 10) / 10,
        dynamic_ratio: Math.round(dynamic_ratio * 1000) / 1000,
        additional_info_count: addInfoTotal,
        additional_info_approved: addInfoApproved,
        pending_conflicts_count: topicConflicts.length,
        pending_candidates_count: topicCandidates.length,
        pending_additional_info_count: addInfoPending,
        total_core_defs,
        filled_core_count,
        total_required_defs,
        filled_required_count,
        dynamic_fields_count: dynFields.length,
        consolidated_fields,
        dynamic_fields,
        missing_required_fields,
        missing_optional_fields,
        flags,
      });
    }

    const overall =
      topics.length > 0 ? topics.reduce((a, t) => a + t.health_score, 0) / topics.length : 0;
    const avgCore =
      topics.length > 0 ? topics.reduce((a, t) => a + t.core_coverage, 0) / topics.length : 0;
    const totalPendingConflicts = topics.reduce((a, t) => a + t.pending_conflicts_count, 0);
    const totalMissingRequired = topics.reduce((a, t) => a + t.missing_required_fields.length, 0);
    const critical = topics.filter((t) => t.health_score < 60).length;

    // Persist snapshot (best-effort)
    if (persistSnapshot && topics.length > 0) {
      const rows = topics.map((t) => ({
        project_id: projectId,
        topic_definition_id: t.topic_definition_id,
        health_score: t.health_score,
        core_coverage: t.core_coverage,
        required_coverage: t.required_coverage,
        confidence_score: t.confidence_score,
        approved_ratio: t.approved_ratio,
        dynamic_ratio: t.dynamic_ratio,
        additional_info_count: t.additional_info_count,
        missing_required_fields: t.missing_required_fields as unknown as object,
        missing_optional_fields: t.missing_optional_fields as unknown as object,
        pending_conflicts_count: t.pending_conflicts_count,
        pending_candidates_count: t.pending_candidates_count,
        pending_additional_info_count: t.pending_additional_info_count,
        flags: t.flags as unknown as object,
      }));
      await sb.from("knowledge_health_snapshots").insert(rows);
    }

    return {
      project_id: projectId,
      computed_at: new Date().toISOString(),
      overall_health_score: Math.round(overall),
      avg_core_coverage: Math.round(avgCore * 10) / 10,
      total_pending_conflicts: totalPendingConflicts,
      total_missing_required: totalMissingRequired,
      critical_topics_count: critical,
      topics,
    };
  });
