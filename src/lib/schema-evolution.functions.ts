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

function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function labelize(name: string): string {
  return name.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export type DynamicAggregate = {
  topic_slug: string;
  topic_definition_id: string | null;
  field_name: string;
  inferred_type: string;
  occurrences: number;
  projects_count: number;
  consolidated_count: number;
  avg_confidence: number;
  examples: any[];
  suggestion_score: number;
  already_official: boolean;
  suggestion_status: "pending" | "approved" | "rejected" | null;
  suggestion_id: string | null;
};

export const analyzeDynamicFields = createServerFn({ method: "POST" })
  .handler(async () => {
    const sb = getSb();

    const { data: cands, error } = await sb
      .from("knowledge_candidates")
      .select("id, project_id, topic_definition_id, field_name, field_value, field_type, confidence, field_origin, status")
      .eq("field_origin", "dynamic");
    if (error) throw new Error(error.message);

    // Topic definitions map (id <-> slug)
    const { data: tds } = await sb.from("topic_definitions").select("id, slug");
    const slugById = new Map<string, string>((tds ?? []).map((t) => [t.id, t.slug]));
    const tdBySlug = new Map<string, string>((tds ?? []).map((t) => [t.slug, t.id]));

    // Existing official data points (per topic)
    const { data: dpds } = await sb
      .from("data_point_definitions")
      .select("id, field_name, topic_definition_id, topic_definitions(slug)");
    const officialByTopic = new Set<string>();
    for (const d of dpds ?? []) {
      const slug = (d as { topic_definitions: { slug: string } | null }).topic_definitions?.slug;
      if (slug) officialByTopic.add(`${slug}::${normalizeName(d.field_name)}`);
    }

    // Existing suggestions
    const { data: existingSugg } = await sb
      .from("suggested_data_points")
      .select("id, topic_slug, suggested_field_name, status");
    const existingByKey = new Map<string, { id: string; status: string }>();
    for (const s of existingSugg ?? []) {
      existingByKey.set(`${s.topic_slug}::${normalizeName(s.suggested_field_name)}`, {
        id: s.id, status: s.status,
      });
    }

    type Group = {
      topic_slug: string;
      field_name: string;
      type_counts: Map<string, number>;
      project_ids: Set<string>;
      confidences: number[];
      examples: unknown[];
      consolidated: number;
      occurrences: number;
    };
    const groups = new Map<string, Group>();
    for (const c of cands ?? []) {
      const slug = slugById.get(c.topic_definition_id);
      if (!slug) continue;
      const fn = normalizeName(c.field_name ?? "");
      if (!fn) continue;
      const key = `${slug}::${fn}`;
      let g = groups.get(key);
      if (!g) {
        g = {
          topic_slug: slug, field_name: fn, type_counts: new Map(),
          project_ids: new Set(), confidences: [], examples: [],
          consolidated: 0, occurrences: 0,
        };
        groups.set(key, g);
      }
      g.occurrences++;
      g.project_ids.add(c.project_id);
      g.type_counts.set(c.field_type, (g.type_counts.get(c.field_type) ?? 0) + 1);
      if (typeof c.confidence === "number") g.confidences.push(c.confidence);
      if (g.examples.length < 5) g.examples.push(c.field_value as unknown);
      if (c.status === "approved" || c.status === "consolidated") g.consolidated++;
    }

    // Build aggregates + auto-create suggestions
    const aggregates: DynamicAggregate[] = [];
    const maxOcc = Math.max(1, ...Array.from(groups.values()).map((g) => g.occurrences));
    const maxProj = Math.max(1, ...Array.from(groups.values()).map((g) => g.project_ids.size));
    let created = 0;

    for (const [key, g] of groups) {
      const inferred_type =
        [...g.type_counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "text";
      const avgConf = g.confidences.length
        ? g.confidences.reduce((s, x) => s + x, 0) / g.confidences.length
        : 0;
      const score =
        (g.occurrences / maxOcc) * 40 +
        (g.project_ids.size / maxProj) * 30 +
        avgConf * 20 +
        Math.min(g.consolidated / Math.max(g.occurrences, 1), 1) * 10;

      const officialKey = `${g.topic_slug}::${g.field_name}`;
      const already_official = officialByTopic.has(officialKey);
      const existing = existingByKey.get(key);

      // Auto-create suggestion if not official + threshold + not rejected
      const meets = g.occurrences >= 10 || g.project_ids.size >= 3;
      if (meets && !already_official && (!existing || existing.status === "pending")) {
        const td_id = tdBySlug.get(g.topic_slug) ?? null;
        if (existing) {
          await sb.from("suggested_data_points").update({
            occurrences: g.occurrences,
            projects_count: g.project_ids.size,
            consolidated_count: g.consolidated,
            avg_confidence: avgConf,
            suggestion_score: Math.round(score * 10) / 10,
            examples: g.examples as never,
            suggested_type: inferred_type,
          }).eq("id", existing.id);
        } else {
          const { data: ins } = await sb.from("suggested_data_points").insert({
            topic_definition_id: td_id,
            topic_slug: g.topic_slug,
            suggested_field_name: g.field_name,
            suggested_label: labelize(g.field_name),
            suggested_type: inferred_type,
            occurrences: g.occurrences,
            projects_count: g.project_ids.size,
            consolidated_count: g.consolidated,
            avg_confidence: avgConf,
            suggestion_score: Math.round(score * 10) / 10,
            examples: g.examples as never,
            status: "pending",
          }).select("id").single();
          if (ins) {
            created++;
            existingByKey.set(key, { id: ins.id, status: "pending" });
          }
        }
      }

      const finalExisting = existingByKey.get(key) ?? null;
      aggregates.push({
        topic_slug: g.topic_slug,
        topic_definition_id: tdBySlug.get(g.topic_slug) ?? null,
        field_name: g.field_name,
        inferred_type,
        occurrences: g.occurrences,
        projects_count: g.project_ids.size,
        consolidated_count: g.consolidated,
        avg_confidence: Math.round(avgConf * 100) / 100,
        examples: g.examples,
        suggestion_score: Math.round(score * 10) / 10,
        already_official,
        suggestion_status: (finalExisting?.status as "pending" | "approved" | "rejected" | undefined) ?? null,
        suggestion_id: finalExisting?.id ?? null,
      });
    }

    aggregates.sort((a, b) => b.suggestion_score - a.suggestion_score);
    return { aggregates, created };
  });

export const approveSuggestion = createServerFn({ method: "POST" })
  .inputValidator((input: {
    suggestionId: string;
    field_name?: string;
    field_label?: string;
    field_type?: string;
    description?: string;
    required?: boolean;
  }) => input)
  .handler(async ({ data }) => {
    const sb = getSb();
    const { data: s, error } = await sb.from("suggested_data_points")
      .select("*").eq("id", data.suggestionId).single();
    if (error || !s) throw new Error(error?.message ?? "Sugestão não encontrada");

    if (!s.topic_definition_id) throw new Error("Topic definition ausente.");

    const fname = normalizeName(data.field_name ?? s.suggested_field_name);
    const { data: dp, error: dpErr } = await sb.from("data_point_definitions").insert({
      topic_definition_id: s.topic_definition_id,
      field_name: fname,
      field_label: data.field_label ?? s.suggested_label,
      field_type: data.field_type ?? s.suggested_type,
      description: data.description ?? `Promoted from dynamic field (score ${s.suggestion_score})`,
      required: data.required ?? false,
      active: true,
      extraction_strategy: "llm",
    } as never).select("id").single();
    if (dpErr || !dp) throw new Error(dpErr?.message ?? "Falha ao criar Data Point");

    await sb.from("suggested_data_points").update({
      status: "approved",
      resulting_data_point_id: dp.id,
    }).eq("id", s.id);

    return { data_point_id: dp.id };
  });

export const rejectSuggestion = createServerFn({ method: "POST" })
  .inputValidator((input: { suggestionId: string }) => input)
  .handler(async ({ data }) => {
    const sb = getSb();
    const { error } = await sb.from("suggested_data_points")
      .update({ status: "rejected" }).eq("id", data.suggestionId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const getSchemaEvolutionStats = createServerFn({ method: "GET" })
  .handler(async () => {
    const sb = getSb();
    const [dyn, sugg, dpd] = await Promise.all([
      sb.from("knowledge_candidates").select("id", { count: "exact", head: true }).eq("field_origin", "dynamic"),
      sb.from("suggested_data_points").select("status"),
      sb.from("data_point_definitions").select("id", { count: "exact", head: true }),
    ]);
    const byStatus = { pending: 0, approved: 0, rejected: 0 };
    for (const s of sugg.data ?? []) {
      const st = s.status as "pending" | "approved" | "rejected";
      byStatus[st] = (byStatus[st] ?? 0) + 1;
    }
    return {
      dynamic_fields_total: dyn.count ?? 0,
      suggestions: byStatus,
      official_data_points: dpd.count ?? 0,
    };
  });

export const getSuggestionsByTopic = createServerFn({ method: "GET" })
  .handler(async () => {
    const sb = getSb();
    const { data } = await sb.from("suggested_data_points")
      .select("topic_slug, status").eq("status", "pending");
    const map = new Map<string, number>();
    for (const r of data ?? []) {
      map.set(r.topic_slug, (map.get(r.topic_slug) ?? 0) + 1);
    }
    return Object.fromEntries(map);
  });
