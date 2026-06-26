import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { normalizeValue, chooseConflictType } from "./value-normalizer";

function getSb() {
  return createClient<Database>(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_PUBLISHABLE_KEY!,
    { auth: { storage: undefined, persistSession: false, autoRefreshToken: false } },
  );
}

function unique<T>(arr: T[]): T[] {
  return Array.from(new Set(arr));
}

type Candidate = {
  id: string;
  project_id: string;
  topic_definition_id: string;
  field_name: string;
  field_type: string;
  field_value: unknown;
  field_origin: string;
  confidence: number | null;
  source_chunk_ids: string[];
  status: string;
  extraction_method: string;
};

type ExistingKF = {
  id: string;
  topic_id: string;
  field_name: string;
  field_value: unknown;
  approved_by_user: boolean;
  source_chunk_ids: string[];
  candidate_ids: string[];
};

type ExistingConflict = {
  id: string;
  project_id: string;
  topic_definition_id: string;
  field_name: string;
};

// =====================================================
// consolidateKnowledge
// =====================================================
export const consolidateKnowledge = createServerFn({ method: "POST" })
  .inputValidator((input: { projectId: string }) => input)
  .handler(async ({ data }) => {
    const sb = getSb();

    // topics: def_id -> topic_id
    const { data: topics } = await sb
      .from("topics")
      .select("id, topic_definition_id")
      .eq("project_id", data.projectId);
    const topicIdByDef = new Map<string, string>();
    for (const t of topics ?? []) topicIdByDef.set(t.topic_definition_id, t.id);
    const topicIds = Array.from(topicIdByDef.values());

    // candidates eligible for consolidation
    const { data: cands } = await sb
      .from("knowledge_candidates")
      .select("*")
      .eq("project_id", data.projectId)
      .in("status", ["pending", "approved"]);
    const candidates = (cands ?? []) as unknown as Candidate[];

    // existing KFs for these topics
    const { data: kfsRaw } = topicIds.length === 0
      ? { data: [] as unknown[] }
      : await sb.from("knowledge_fields").select("*").in("topic_id", topicIds);
    const kfByKey = new Map<string, ExistingKF>();
    for (const f of (kfsRaw ?? []) as unknown as ExistingKF[]) {
      kfByKey.set(`${f.topic_id}|${f.field_name}`, f);
    }

    // existing pending conflicts
    const { data: confRaw } = await sb
      .from("knowledge_conflicts")
      .select("*")
      .eq("project_id", data.projectId)
      .eq("status", "pending");
    const conflictByKey = new Map<string, ExistingConflict>();
    for (const c of (confRaw ?? []) as unknown as ExistingConflict[]) {
      conflictByKey.set(`${c.topic_definition_id}|${c.field_name}`, c);
    }

    // group candidates by (def_id, field_name)
    const groups = new Map<string, Candidate[]>();
    for (const c of candidates) {
      const k = `${c.topic_definition_id}|${c.field_name}`;
      const list = groups.get(k) ?? [];
      list.push(c);
      groups.set(k, list);
    }

    const stats = {
      groups_processed: 0,
      consolidated_fields: 0,
      merged_fields: 0,
      new_conflicts: 0,
      updated_conflicts: 0,
      removed_stale_conflicts: 0,
      skipped_manual: 0,
    };
    const seenConflictKeys = new Set<string>();

    for (const [key, group] of groups) {
      stats.groups_processed++;
      const [defId, fieldName] = key.split("|");
      const topicId = topicIdByDef.get(defId);
      if (!topicId) continue;
      const fieldType = group[0].field_type;
      const kfKey = `${topicId}|${fieldName}`;
      const existingKF = kfByKey.get(kfKey);

      // bucket by canonical value
      const buckets = new Map<string, Candidate[]>();
      for (const c of group) {
        const k = normalizeValue(fieldType, c.field_value);
        const list = buckets.get(k) ?? [];
        list.push(c);
        buckets.set(k, list);
      }

      if (buckets.size === 1) {
        const all = group;
        // Approved-by-user: preserve value, just merge provenance
        if (existingKF?.approved_by_user) {
          const merged = unique([
            ...(existingKF.source_chunk_ids ?? []),
            ...all.flatMap((c) => c.source_chunk_ids ?? []),
          ]);
          const cids = unique([
            ...(existingKF.candidate_ids ?? []),
            ...all.map((c) => c.id),
          ]);
          await sb.from("knowledge_fields")
            .update({ source_chunk_ids: merged as never, candidate_ids: cids as never } as never)
            .eq("id", existingKF.id);
          stats.skipped_manual++;
        } else {
          const rep = [...all].sort(
            (a, b) => (b.confidence ?? 0) - (a.confidence ?? 0),
          )[0];
          const sourceOfTruth = all.length === 1
            ? "auto_single_candidate"
            : "auto_merged_candidates";
          const payload = {
            topic_id: topicId,
            field_name: fieldName,
            field_type: fieldType,
            field_value: rep.field_value as never,
            field_origin: rep.field_origin,
            confidence:
              Math.max(...all.map((c) => c.confidence ?? 0)) || null,
            source_chunk_ids: unique(
              all.flatMap((c) => c.source_chunk_ids ?? []),
            ) as never,
            verified: false,
            source_of_truth: sourceOfTruth,
            consolidation_status: "consolidated",
            approved_by_user: false,
            candidate_ids: all.map((c) => c.id) as never,
          } as never;
          if (existingKF) {
            await sb.from("knowledge_fields").update(payload).eq("id", existingKF.id);
          } else {
            await sb.from("knowledge_fields").insert(payload);
          }
          if (all.length === 1) stats.consolidated_fields++;
          else stats.merged_fields++;
        }
        // Approve underlying candidates
        await sb.from("knowledge_candidates")
          .update({ status: "approved" })
          .in("id", all.map((c) => c.id));
        // Resolve any stale pending conflict
        const conf = conflictByKey.get(key);
        if (conf) {
          await sb.from("knowledge_conflicts").delete().eq("id", conf.id);
          stats.removed_stale_conflicts++;
        }
      } else {
        // CONFLICT
        if (existingKF?.approved_by_user) {
          // user decision wins; don't reopen
          stats.skipped_manual++;
          continue;
        }
        seenConflictKeys.add(key);
        const candIds = group.map((c) => c.id);
        const existingConflict = conflictByKey.get(key);
        if (existingConflict) {
          await sb.from("knowledge_conflicts").update({
            candidate_ids: candIds as never,
            field_type: fieldType,
            conflict_type: chooseConflictType(fieldType),
          } as never).eq("id", existingConflict.id);
          stats.updated_conflicts++;
        } else {
          await sb.from("knowledge_conflicts").insert({
            project_id: data.projectId,
            topic_definition_id: defId,
            field_name: fieldName,
            field_type: fieldType,
            conflict_type: chooseConflictType(fieldType),
            status: "pending",
            candidate_ids: candIds as never,
          } as never);
          stats.new_conflicts++;
        }
        if (existingKF) {
          await sb.from("knowledge_fields")
            .update({ consolidation_status: "needs_review" } as never)
            .eq("id", existingKF.id);
        }
      }
    }

    // remove pending conflicts whose group disappeared
    for (const [key, c] of conflictByKey) {
      if (!seenConflictKeys.has(key) && !groups.has(key)) {
        await sb.from("knowledge_conflicts").delete().eq("id", c.id);
        stats.removed_stale_conflicts++;
      }
    }

    const { count: pendingCount } = await sb
      .from("knowledge_candidates")
      .select("*", { count: "exact", head: true })
      .eq("project_id", data.projectId)
      .eq("status", "pending");

    return { ...stats, pending_candidates: pendingCount ?? 0 };
  });

// =====================================================
// approveCandidate / rejectCandidate
// =====================================================
export const approveCandidate = createServerFn({ method: "POST" })
  .inputValidator((input: { candidateId: string }) => input)
  .handler(async ({ data }) => {
    const sb = getSb();
    const { error } = await sb.from("knowledge_candidates")
      .update({ status: "approved" }).eq("id", data.candidateId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const rejectCandidate = createServerFn({ method: "POST" })
  .inputValidator((input: { candidateId: string }) => input)
  .handler(async ({ data }) => {
    const sb = getSb();
    const { error } = await sb.from("knowledge_candidates")
      .update({ status: "rejected" }).eq("id", data.candidateId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// =====================================================
// resolveConflict
// =====================================================
export const resolveConflict = createServerFn({ method: "POST" })
  .inputValidator((input: {
    conflictId: string;
    action: "select" | "edit" | "ignore";
    selectedCandidateId?: string;
    manualValue?: unknown;
    note?: string;
  }) => input)
  .handler(async ({ data }) => {
    const sb = getSb();
    const { data: conflict } = await sb
      .from("knowledge_conflicts")
      .select("*").eq("id", data.conflictId).maybeSingle();
    if (!conflict) throw new Error("Conflito não encontrado");
    const c = conflict as unknown as {
      id: string;
      project_id: string;
      topic_definition_id: string;
      field_name: string;
      field_type: string;
      candidate_ids: string[];
    };

    if (data.action === "ignore") {
      await sb.from("knowledge_conflicts").update({
        status: "ignored",
        resolved_at: new Date().toISOString(),
        resolution_note: data.note ?? null,
      } as never).eq("id", c.id);
      return { ok: true };
    }

    // find topic_id for this project + def
    const { data: topic } = await sb.from("topics")
      .select("id").eq("project_id", c.project_id)
      .eq("topic_definition_id", c.topic_definition_id).maybeSingle();
    if (!topic) throw new Error("Tópico não encontrado no projeto");
    const topicId = (topic as { id: string }).id;

    let valueToSave: unknown;
    let origin = "core";
    let sourceOfTruth: "manually_selected_candidate" | "manually_edited";

    if (data.action === "select") {
      if (!data.selectedCandidateId) throw new Error("selectedCandidateId requerido");
      const { data: cand } = await sb.from("knowledge_candidates")
        .select("*").eq("id", data.selectedCandidateId).maybeSingle();
      if (!cand) throw new Error("Candidato não encontrado");
      valueToSave = (cand as { field_value: unknown }).field_value;
      origin = (cand as { field_origin: string }).field_origin;
      sourceOfTruth = "manually_selected_candidate";
    } else {
      valueToSave = data.manualValue ?? null;
      sourceOfTruth = "manually_edited";
    }

    // Gather all source_chunk_ids from involved candidates
    const { data: candRows } = await sb.from("knowledge_candidates")
      .select("id, source_chunk_ids, field_origin").in("id", c.candidate_ids);
    const allChunks = unique(
      (candRows ?? []).flatMap((r) =>
        ((r as { source_chunk_ids: string[] }).source_chunk_ids ?? []),
      ),
    );

    // Upsert KF (by topic_id + field_name)
    const { data: existing } = await sb.from("knowledge_fields")
      .select("id").eq("topic_id", topicId).eq("field_name", c.field_name).maybeSingle();
    const payload = {
      topic_id: topicId,
      field_name: c.field_name,
      field_type: c.field_type,
      field_value: valueToSave as never,
      field_origin: origin,
      confidence: null,
      source_chunk_ids: allChunks as never,
      verified: true,
      source_of_truth: sourceOfTruth,
      consolidation_status: "consolidated",
      approved_by_user: true,
      approved_at: new Date().toISOString(),
      candidate_ids: c.candidate_ids as never,
    } as never;
    if (existing) {
      await sb.from("knowledge_fields").update(payload).eq("id", (existing as { id: string }).id);
    } else {
      await sb.from("knowledge_fields").insert(payload);
    }

    // Mark candidates: selected -> approved, others -> superseded
    if (data.action === "select" && data.selectedCandidateId) {
      await sb.from("knowledge_candidates")
        .update({ status: "approved" }).eq("id", data.selectedCandidateId);
      const others = c.candidate_ids.filter((id) => id !== data.selectedCandidateId);
      if (others.length > 0) {
        await sb.from("knowledge_candidates")
          .update({ status: "superseded" }).in("id", others);
      }
    } else {
      // manual edit: supersede all
      if (c.candidate_ids.length > 0) {
        await sb.from("knowledge_candidates")
          .update({ status: "superseded" }).in("id", c.candidate_ids);
      }
    }

    await sb.from("knowledge_conflicts").update({
      status: "resolved",
      resolved_at: new Date().toISOString(),
      selected_candidate_id: data.selectedCandidateId ?? null,
      manual_value: (data.action === "edit" ? (valueToSave as never) : null),
      resolution_note: data.note ?? null,
    } as never).eq("id", c.id);

    return { ok: true };
  });

// =====================================================
// Additional info approve/reject
// =====================================================
export const approveAdditionalInfo = createServerFn({ method: "POST" })
  .inputValidator((input: { id: string }) => input)
  .handler(async ({ data }) => {
    const sb = getSb();
    const { error } = await sb.from("additional_info").update({
      status: "approved",
      approved_at: new Date().toISOString(),
    } as never).eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const rejectAdditionalInfo = createServerFn({ method: "POST" })
  .inputValidator((input: { id: string }) => input)
  .handler(async ({ data }) => {
    const sb = getSb();
    const { error } = await sb.from("additional_info").update({
      status: "rejected",
    } as never).eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
