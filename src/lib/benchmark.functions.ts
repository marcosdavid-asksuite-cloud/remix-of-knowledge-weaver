import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

// Local pricing table mirrors ai.functions.ts (kept self-contained).
const PRICING: Record<string, { in: number; out: number }> = {
  "google/gemini-3-flash-preview": { in: 0.1, out: 0.4 },
  "google/gemini-3.1-flash-lite": { in: 0.05, out: 0.2 },
  "google/gemini-3.5-flash": { in: 0.1, out: 0.4 },
  "google/gemini-2.5-flash": { in: 0.075, out: 0.3 },
  "google/gemini-2.5-pro": { in: 1.25, out: 5 },
  "openai/gpt-5-mini": { in: 0.25, out: 2 },
  "openai/gpt-5-nano": { in: 0.05, out: 0.4 },
};

function estimateCost(model: string, inT: number, outT: number) {
  const p = PRICING[model] ?? { in: 0.1, out: 0.4 };
  return (inT * p.in + outT * p.out) / 1_000_000;
}

function getSb() {
  return createClient<Database>(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_PUBLISHABLE_KEY!,
    { auth: { storage: undefined, persistSession: false, autoRefreshToken: false } },
  );
}

async function callGateway(opts: {
  model: string;
  temperature: number;
  maxTokens: number;
  system: string;
  user: string;
}): Promise<{ content: string; inputTokens: number; outputTokens: number; latency: number }> {
  const apiKey = process.env.LOVABLE_API_KEY;
  if (!apiKey) throw new Error("LOVABLE_API_KEY not configured");
  const t0 = Date.now();
  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", "Lovable-API-Key": apiKey },
    body: JSON.stringify({
      model: opts.model,
      messages: [
        { role: "system", content: opts.system },
        { role: "user", content: opts.user },
      ],
      temperature: opts.temperature,
      max_tokens: opts.maxTokens,
    }),
  });
  const latency = Date.now() - t0;
  if (!res.ok) {
    const text = await res.text();
    if (res.status === 429) throw new Error("Rate limit excedido. Tente novamente em instantes.");
    if (res.status === 402) throw new Error("Créditos de IA esgotados.");
    throw new Error(`Gateway ${res.status}: ${text.slice(0, 300)}`);
  }
  const json = (await res.json()) as {
    choices: Array<{ message: { content: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  return {
    content: json.choices[0]?.message?.content ?? "",
    inputTokens: json.usage?.prompt_tokens ?? 0,
    outputTokens: json.usage?.completion_tokens ?? 0,
    latency,
  };
}

type Mode = "raw_chunks" | "structured" | "structured_only" | "external_agent";

type TopicLite = {
  id: string;
  defId: string;
  slug: string;
  name: string;
  aliases: string[];
};

function normalizeText(s: string) {
  return s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function topicsForQuestion(question: string, allTopics: TopicLite[], pinnedDefIds: string[]) {
  if (pinnedDefIds.length > 0) {
    const set = new Set(pinnedDefIds);
    const pinned = allTopics.filter((t) => set.has(t.defId));
    if (pinned.length > 0) return pinned;
  }
  const qn = " " + normalizeText(question) + " ";
  const matched = allTopics.filter((t) => {
    const kws = [t.slug, t.name, ...t.aliases].filter(Boolean).map(normalizeText);
    return kws.some((k) => k.length >= 3 && qn.includes(k));
  });
  return matched;
}

const ANSWER_SYSTEM_PROMPT = `Você é uma IA de atendimento hoteleiro.
Responda somente com base no contexto fornecido.
Se a informação não estiver no contexto, diga que não encontrou essa informação.
Não invente.
Responda de forma clara, objetiva e útil para um viajante.`;

function buildPrompt(question: string, context: string) {
  return `Pergunta:\n${question}\n\nContexto:\n${context}`;
}

// Limit chunks loaded per project (cheap guard).
const CHUNK_FETCH_LIMIT = 1000;

async function buildRawChunksContext(
  sb: ReturnType<typeof getSb>,
  projectId: string,
  question: string,
  topics: TopicLite[],
  maxChunks: number,
): Promise<{ text: string; meta: Record<string, unknown> }> {
  const { data: sources } = await sb
    .from("raw_sources").select("id, filename").eq("project_id", projectId);
  const sourceIds = (sources ?? []).map((s) => s.id);
  if (sourceIds.length === 0) return { text: "(sem fontes brutas)", meta: { chunks: 0 } };
  const sourceNameById = new Map((sources ?? []).map((s) => [s.id, s.filename ?? "?"]));

  const { data: chunks } = await sb
    .from("raw_chunks").select("id, content, raw_source_id, position")
    .in("raw_source_id", sourceIds)
    .order("position")
    .limit(CHUNK_FETCH_LIMIT);

  const all = chunks ?? [];
  if (all.length === 0) return { text: "(sem chunks)", meta: { chunks: 0 } };

  // 1) keyword set: question tokens + topic aliases.
  const qTokens = normalizeText(question)
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 4);
  const topicKws = topics.flatMap((t) => [t.slug, t.name, ...t.aliases].filter(Boolean).map(normalizeText));
  const keywords = Array.from(new Set([...qTokens, ...topicKws])).filter((k) => k.length >= 3);

  type Scored = { id: string; content: string; source_id: string; score: number };
  const scored: Scored[] = all.map((c) => {
    const norm = normalizeText(c.content);
    let score = 0;
    for (const kw of keywords) {
      if (norm.includes(kw)) score += kw.length >= 5 ? 2 : 1;
    }
    return { id: c.id, content: c.content, source_id: c.raw_source_id, score };
  });

  let selected = scored.filter((s) => s.score > 0).sort((a, b) => b.score - a.score);
  if (selected.length === 0) selected = scored.slice(0, maxChunks);
  selected = selected.slice(0, maxChunks);

  const text = selected
    .map((s) => `# Fonte: ${sourceNameById.get(s.source_id) ?? "?"}\n${s.content}`)
    .join("\n---\n");
  return { text, meta: { chunks: selected.length, keywords } };
}

async function buildStructuredContext(
  sb: ReturnType<typeof getSb>,
  topics: TopicLite[],
  includeAdditional: boolean,
): Promise<{ text: string; meta: Record<string, unknown> }> {
  if (topics.length === 0) return { text: "(nenhum tópico relevante)", meta: { topics: 0 } };
  const topicIds = topics.map((t) => t.id);
  const { data: fields } = await sb
    .from("knowledge_fields").select("*")
    .in("topic_id", topicIds)
    .eq("consolidation_status", "consolidated");
  const { data: addl } = includeAdditional
    ? await sb.from("additional_info").select("topic_id, content")
        .in("topic_id", topicIds).eq("status", "approved")
    : { data: [] as Array<{ topic_id: string; content: string }> };

  type Payload = {
    topic: string;
    official_fields: Array<{ label: string; value: unknown; source_of_truth: string | null }>;
    additional_information?: string[];
  };
  const payloads: Payload[] = [];
  for (const t of topics) {
    const tFields = (fields ?? []).filter((f) => f.topic_id === t.id);
    const tAddl = (addl ?? []).filter((a) => a.topic_id === t.id).map((a) => a.content);
    if (tFields.length === 0 && tAddl.length === 0) continue;
    const p: Payload = {
      topic: t.slug,
      official_fields: tFields.map((f) => ({
        label: f.field_name,
        value: f.field_value,
        source_of_truth: (f as { source_of_truth?: string | null }).source_of_truth ?? null,
      })),
    };
    if (includeAdditional && tAddl.length > 0) p.additional_information = tAddl;
    payloads.push(p);
  }
  if (payloads.length === 0) return { text: "(base estruturada vazia para esses tópicos)", meta: { topics: 0 } };
  return {
    text: JSON.stringify(payloads, null, 2),
    meta: { topics: payloads.length, official_fields: payloads.reduce((n, p) => n + p.official_fields.length, 0) },
  };
}

export const runBenchmark = createServerFn({ method: "POST" })
  .inputValidator((input: {
    projectId: string;
    questionIds: string[];
    modes: Mode[];
    name?: string;
    modelName?: string;
    temperature?: number;
    maxRawChunks?: number;
    includeAdditional?: boolean;
    externalAgentId?: string;
  }) => input)
  .handler(async ({ data }) => {
    const sb = getSb();
    if (data.modes.length === 0) throw new Error("Selecione ao menos um modo.");
    if (data.questionIds.length === 0) throw new Error("Selecione ao menos uma pergunta.");
    if (data.modes.includes("external_agent") && !data.externalAgentId) {
      throw new Error("Selecione um External Agent para o modo external_agent.");
    }

    // Resolve model config (active) — let user override model + temperature.
    const { data: modelCfg } = await sb
      .from("model_configurations").select("*").eq("active", true)
      .order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (!modelCfg) throw new Error("Nenhum modelo ativo configurado.");
    const model = data.modelName ?? modelCfg.model_name;
    const temperature = data.temperature ?? Number(modelCfg.temperature);
    const maxRawChunks = Math.max(1, Math.min(80, data.maxRawChunks ?? 20));
    const includeAdditional = data.includeAdditional ?? true;

    // Load external agent if needed
    let externalAgent: {
      id: string; name: string; endpoint: string; auth_type: string;
      auth_header_name: string | null; api_key: string | null;
      custom_headers: Record<string, string>; model: string | null;
      temperature: number | null; timeout_ms: number | null;
      payload_template: unknown; response_path: string | null;
      context_options: { structured?: boolean; additional?: boolean; raw_chunks?: boolean };
    } | null = null;
    if (data.externalAgentId) {
      const { data: ea } = await sb.from("external_agents").select("*").eq("id", data.externalAgentId).maybeSingle();
      if (ea) externalAgent = ea as never;
    }

    // Topics for the project.
    const { data: topicsRaw } = await sb
      .from("topics")
      .select("id, topic_definition_id, topic_definitions(slug, name, aliases)")
      .eq("project_id", data.projectId);
    const allTopics: TopicLite[] = (topicsRaw ?? []).map((t) => {
      const td = t.topic_definitions as { slug: string; name: string; aliases: string[] } | null;
      return {
        id: t.id,
        defId: t.topic_definition_id,
        slug: td?.slug ?? "",
        name: td?.name ?? "",
        aliases: td?.aliases ?? [],
      };
    });

    // Questions
    const { data: questions } = await sb
      .from("test_questions").select("*").in("id", data.questionIds);
    const qs = questions ?? [];
    if (qs.length === 0) throw new Error("Nenhuma pergunta encontrada.");

    // Create batch
    const { data: batch, error: batchErr } = await sb.from("test_batches").insert({
      project_id: data.projectId,
      name: data.name ?? `Benchmark ${new Date().toISOString().slice(0, 16)}`,
      status: "running",
      modes: data.modes,
      question_count: qs.length,
      model_name: model,
      temperature,
      options: {
        max_raw_chunks: maxRawChunks,
        include_additional: includeAdditional,
      } as never,
    }).select("*").single();
    if (batchErr || !batch) throw new Error(batchErr?.message ?? "Falha ao criar batch");

    // Stats accumulators
    const stats = {
      total_questions: qs.length,
      total_runs: 0,
      successes: 0,
      errors: 0,
      avg_latency_by_mode: {} as Record<string, number>,
      total_cost_by_mode: {} as Record<string, number>,
      avg_tokens_by_mode: {} as Record<string, { input: number; output: number }>,
    };
    const acc: Record<string, { latency: number[]; cost: number; inputT: number[]; outputT: number[]; n: number }> = {};
    for (const m of data.modes) acc[m] = { latency: [], cost: 0, inputT: [], outputT: [], n: 0 };

    try {
      for (const q of qs) {
        const pinnedDefIds = ((q as { topic_definition_ids?: string[] }).topic_definition_ids ?? []) as string[];
        const matchedTopics = topicsForQuestion(q.question, allTopics, pinnedDefIds);
        const useTopics = matchedTopics.length > 0 ? matchedTopics : allTopics;

        for (const mode of data.modes) {
          let context: { text: string; meta: Record<string, unknown> };
          try {
            if (mode === "raw_chunks") {
              context = await buildRawChunksContext(sb, data.projectId, q.question, useTopics, maxRawChunks);
            } else if (mode === "structured") {
              context = await buildStructuredContext(sb, useTopics, true);
            } else if (mode === "structured_only") {
              context = await buildStructuredContext(sb, useTopics, false);
            } else {
              // external_agent — build context based on agent options
              const co = externalAgent?.context_options ?? {};
              const parts: string[] = [];
              const meta: Record<string, unknown> = {};
              if (co.structured !== false) {
                const s = await buildStructuredContext(sb, useTopics, co.additional !== false);
                parts.push(s.text);
                Object.assign(meta, { structured: s.meta });
              }
              if (co.raw_chunks === true) {
                const r = await buildRawChunksContext(sb, data.projectId, q.question, useTopics, maxRawChunks);
                parts.push(r.text);
                Object.assign(meta, { raw: r.meta });
              }
              context = { text: parts.join("\n\n---\n\n") || "(sem contexto)", meta };
            }
          } catch (e) {
            await sb.from("test_runs").insert({
              question_id: q.id,
              project_id: data.projectId,
              test_batch_id: batch.id,
              mode,
              status: "error",
              error_message: e instanceof Error ? e.message : String(e),
              model_name: model,
            });
            stats.errors++;
            stats.total_runs++;
            continue;
          }

          try {
            const userPrompt = buildPrompt(q.question, context.text);
            const res = await callGateway({
              model,
              temperature,
              maxTokens: modelCfg.max_tokens,
              system: ANSWER_SYSTEM_PROMPT,
              user: userPrompt,
            });
            const cost = estimateCost(model, res.inputTokens, res.outputTokens);
            await sb.from("test_runs").insert({
              question_id: q.id,
              project_id: data.projectId,
              test_batch_id: batch.id,
              mode,
              answer: res.content,
              context_sent: { mode, topics: useTopics.map((t) => t.slug), ...context.meta, context: context.text } as never,
              input_tokens: res.inputTokens,
              output_tokens: res.outputTokens,
              estimated_cost: cost,
              latency_ms: res.latency,
              model_name: model,
              status: "success",
              model_configuration_id: modelCfg.id,
            });
            await sb.from("llm_calls").insert({
              prompt_type: `benchmark:${mode}`,
              model_name: model,
              input_tokens: res.inputTokens,
              output_tokens: res.outputTokens,
              latency: res.latency,
              estimated_cost: cost,
            });
            acc[mode].latency.push(res.latency);
            acc[mode].cost += cost;
            acc[mode].inputT.push(res.inputTokens);
            acc[mode].outputT.push(res.outputTokens);
            acc[mode].n++;
            stats.successes++;
          } catch (e) {
            await sb.from("test_runs").insert({
              question_id: q.id,
              project_id: data.projectId,
              test_batch_id: batch.id,
              mode,
              status: "error",
              error_message: e instanceof Error ? e.message : String(e),
              context_sent: { mode, topics: useTopics.map((t) => t.slug), ...context.meta } as never,
              model_name: model,
            });
            stats.errors++;
          }
          stats.total_runs++;
        }
      }

      const avg = (arr: number[]) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);
      for (const m of data.modes) {
        stats.avg_latency_by_mode[m] = Math.round(avg(acc[m].latency));
        stats.total_cost_by_mode[m] = Number(acc[m].cost.toFixed(6));
        stats.avg_tokens_by_mode[m] = {
          input: Math.round(avg(acc[m].inputT)),
          output: Math.round(avg(acc[m].outputT)),
        };
      }

      await sb.from("test_batches").update({
        status: "completed",
        finished_at: new Date().toISOString(),
        statistics: stats as never,
      }).eq("id", batch.id);

      return { batchId: batch.id, statistics: stats };
    } catch (e) {
      await sb.from("test_batches").update({
        status: "failed",
        finished_at: new Date().toISOString(),
        statistics: { ...stats, fatal_error: e instanceof Error ? e.message : String(e) } as never,
      }).eq("id", batch.id);
      throw e;
    }
  });
