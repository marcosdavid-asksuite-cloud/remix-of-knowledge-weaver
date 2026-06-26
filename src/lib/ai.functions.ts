import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { z } from "zod";
import { getCoreSchema } from "./topic-core-schemas";

// --------- Pricing table (rough; per 1M tokens, USD) ----------
const PRICING: Record<string, { in: number; out: number }> = {
  "google/gemini-3-flash-preview": { in: 0.1, out: 0.4 },
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

type GatewayResult = {
  content: string;
  inputTokens: number;
  outputTokens: number;
  latency: number;
};

async function callGateway(opts: {
  model: string;
  temperature: number;
  maxTokens: number;
  system?: string;
  user: string;
  jsonMode?: boolean;
}): Promise<GatewayResult> {
  const apiKey = process.env.LOVABLE_API_KEY;
  if (!apiKey) throw new Error("LOVABLE_API_KEY not configured");

  const messages = [];
  if (opts.system) messages.push({ role: "system", content: opts.system });
  messages.push({ role: "user", content: opts.user });

  const body: Record<string, unknown> = {
    model: opts.model,
    messages,
    temperature: opts.temperature,
    max_tokens: opts.maxTokens,
  };
  if (opts.jsonMode) body.response_format = { type: "json_object" };

  const t0 = Date.now();
  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "Lovable-API-Key": apiKey,
    },
    body: JSON.stringify(body),
  });
  const latency = Date.now() - t0;

  if (!res.ok) {
    const text = await res.text();
    if (res.status === 429) throw new Error("Rate limit excedido. Tente novamente em instantes.");
    if (res.status === 402) throw new Error("Créditos de IA esgotados. Adicione créditos na workspace.");
    throw new Error(`Gateway error ${res.status}: ${text.slice(0, 300)}`);
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

function parseJsonLenient(text: string): unknown {
  let s = text.trim();
  if (s.startsWith("```")) {
    s = s.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  }
  // grab from first { to last }
  const first = s.indexOf("{");
  const last = s.lastIndexOf("}");
  if (first >= 0 && last > first) s = s.slice(first, last + 1);
  return JSON.parse(s);
}

const ExtractionSchema = z.object({
  fields: z
    .array(
      z.object({
        field_name: z.string(),
        field_type: z.enum(["string", "number", "time", "boolean", "money", "enum", "text"]),
        field_value: z.any(),
        field_origin: z.enum(["core", "dynamic"]),
        confidence: z.number().min(0).max(1).optional(),
        source_chunk_ids: z.array(z.string()).optional(),
      }),
    )
    .default([]),
  additional_info: z
    .array(
      z.object({
        content: z.string(),
        source_chunk_ids: z.array(z.string()).optional(),
      }),
    )
    .default([]),
});

// =====================================================
// runExtraction
// =====================================================
export const runExtraction = createServerFn({ method: "POST" })
  .inputValidator((input: { projectId: string; mode: "dry_run" | "persist"; topicIds?: string[] }) => input)
  .handler(async ({ data }) => {
    const sb = getSb();

    // Load project + raw sources + chunks
    const { data: project, error: projErr } = await sb
      .from("projects").select("id, name").eq("id", data.projectId).maybeSingle();
    if (projErr || !project) throw new Error("Projeto não encontrado");

    const { data: sources } = await sb
      .from("raw_sources").select("id").eq("project_id", data.projectId);
    const sourceIds = (sources ?? []).map((s) => s.id);
    if (sourceIds.length === 0) throw new Error("Nenhuma fonte bruta neste projeto. Faça upload de um CSV primeiro.");

    const { data: chunks } = await sb
      .from("raw_chunks").select("id, content").in("raw_source_id", sourceIds);
    if (!chunks || chunks.length === 0) throw new Error("Nenhum chunk encontrado.");

    // Load topics (filtered if requested)
    let topicsQ = sb
      .from("topics")
      .select("id, topic_definition_id, topic_definitions(slug, name, description)")
      .eq("project_id", data.projectId);
    if (data.topicIds && data.topicIds.length > 0) topicsQ = topicsQ.in("id", data.topicIds);
    const { data: topicsRaw } = await topicsQ;
    const topics = (topicsRaw ?? []).map((t) => ({
      id: t.id,
      slug: (t.topic_definitions as { slug: string } | null)?.slug ?? "",
      name: (t.topic_definitions as { name: string } | null)?.name ?? "",
    }));
    if (topics.length === 0) throw new Error("Nenhum tópico ativo. Ative tópicos na aba Topics.");

    // Load prompt template + model config
    const { data: tmpl } = await sb
      .from("prompt_templates").select("*").eq("type", "extraction").order("created_at", { ascending: false }).limit(1).maybeSingle();
    const { data: modelCfg } = await sb
      .from("model_configurations").select("*").eq("active", true).order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (!tmpl) throw new Error("Nenhum prompt de extração configurado.");
    if (!modelCfg) throw new Error("Nenhum modelo ativo configurado.");

    // Create extraction_run record
    const { data: run, error: runErr } = await sb
      .from("extraction_runs")
      .insert({
        project_id: data.projectId,
        raw_source_ids: sourceIds,
        mode: data.mode,
        prompt_template_id: tmpl.id,
        model_configuration_id: modelCfg.id,
        status: "running",
        started_at: new Date().toISOString(),
      })
      .select("*").single();
    if (runErr || !run) throw new Error(runErr?.message ?? "Falha ao criar run");

    const chunkList = chunks.map((c) => ({ id: c.id, content: c.content }));
    const chunkListBlock = chunkList
      .map((c) => `[${c.id}] ${c.content.replace(/\s+/g, " ").slice(0, 800)}`)
      .join("\n");

    const perTopicResults: Array<{
      topic_id: string;
      topic_slug: string;
      topic_name: string;
      fields: z.infer<typeof ExtractionSchema>["fields"];
      additional_info: z.infer<typeof ExtractionSchema>["additional_info"];
    }> = [];

    let totalIn = 0, totalOut = 0, totalCost = 0, totalLatency = 0;
    let totalFields = 0;

    try {
      for (const topic of topics) {
        const core = getCoreSchema(topic.slug);
        const coreBlock = core.length === 0
          ? "(sem schema core definido — extraia tudo como dynamic)"
          : core.map((f) => `- ${f.name} (${f.type}): ${f.description}`).join("\n");

        const userPrompt = `TÓPICO: ${topic.slug} — ${topic.name}

SCHEMA CORE:
${coreBlock}

TRECHOS DISPONÍVEIS (id seguido do conteúdo):
${chunkListBlock}

Responda em JSON conforme as instruções do sistema.`;

        const result = await callGateway({
          model: modelCfg.model_name,
          temperature: Number(modelCfg.temperature),
          maxTokens: modelCfg.max_tokens,
          system: tmpl.content,
          user: userPrompt,
          jsonMode: true,
        });

        let parsed: z.infer<typeof ExtractionSchema>;
        try {
          parsed = ExtractionSchema.parse(parseJsonLenient(result.content));
        } catch (e) {
          parsed = { fields: [], additional_info: [] };
          console.error("Parse fail for topic", topic.slug, e);
        }

        const cost = estimateCost(modelCfg.model_name, result.inputTokens, result.outputTokens);
        totalIn += result.inputTokens;
        totalOut += result.outputTokens;
        totalCost += cost;
        totalLatency += result.latency;
        totalFields += parsed.fields.length;

        // Log LLM call
        await sb.from("llm_calls").insert({
          prompt_type: `extraction:${topic.slug}:${data.mode}`,
          model_name: modelCfg.model_name,
          input_tokens: result.inputTokens,
          output_tokens: result.outputTokens,
          latency: result.latency,
          estimated_cost: cost,
          response: { content: result.content } as never,
          extraction_run_id: run.id,
        });

        perTopicResults.push({
          topic_id: topic.id,
          topic_slug: topic.slug,
          topic_name: topic.name,
          fields: parsed.fields,
          additional_info: parsed.additional_info,
        });

        // Persist if requested
        if (data.mode === "persist") {
          for (const f of parsed.fields) {
            await sb.from("knowledge_fields").insert({
              topic_id: topic.id,
              field_name: f.field_name,
              field_type: f.field_type,
              field_value: (f.field_value ?? null) as never,
              field_origin: f.field_origin,
              confidence: f.confidence ?? null,
              source_chunk_ids: (f.source_chunk_ids ?? []) as never,
              verified: false,
            });
          }
          for (const a of parsed.additional_info) {
            if (!a.content?.trim()) continue;
            await sb.from("additional_info").insert({
              topic_id: topic.id,
              content: a.content,
              source_chunk_ids: (a.source_chunk_ids ?? []) as never,
            });
          }
        }
      }

      const preview = { topics: perTopicResults };
      await sb.from("extraction_runs").update({
        status: "done",
        finished_at: new Date().toISOString(),
        preview_result: preview as never,
        stats: {
          chunks_processed: chunks.length,
          topics_processed: topics.length,
          fields_proposed: totalFields,
          input_tokens: totalIn,
          output_tokens: totalOut,
          estimated_cost: totalCost,
          latency_ms: totalLatency,
        } as never,
      }).eq("id", run.id);

      return {
        runId: run.id,
        mode: data.mode,
        preview,
        stats: {
          chunks_processed: chunks.length,
          topics_processed: topics.length,
          fields_proposed: totalFields,
          input_tokens: totalIn,
          output_tokens: totalOut,
          estimated_cost: totalCost,
          latency_ms: totalLatency,
        },
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await sb.from("extraction_runs").update({
        status: "failed",
        finished_at: new Date().toISOString(),
        error: msg,
      }).eq("id", run.id);
      throw err;
    }
  });

// =====================================================
// runTestAnswer
// =====================================================
export const runTestAnswer = createServerFn({ method: "POST" })
  .inputValidator((input: { questionId: string; mode: "structured" | "raw_chunks" }) => input)
  .handler(async ({ data }) => {
    const sb = getSb();

    const { data: q, error: qErr } = await sb
      .from("test_questions").select("*").eq("id", data.questionId).maybeSingle();
    if (qErr || !q) throw new Error("Pergunta não encontrada");

    const { data: tmpl } = await sb
      .from("prompt_templates").select("*").eq("type", "answer").order("created_at", { ascending: false }).limit(1).maybeSingle();
    const { data: modelCfg } = await sb
      .from("model_configurations").select("*").eq("active", true).order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (!tmpl || !modelCfg) throw new Error("Configuração de prompt/modelo ausente.");

    // Topic routing by alias keyword
    const { data: topicsRaw } = await sb
      .from("topics")
      .select("id, topic_definitions(slug, name, aliases)")
      .eq("project_id", q.project_id);
    type T = { id: string; slug: string; name: string; aliases: string[] };
    const topics: T[] = (topicsRaw ?? []).map((t) => {
      const td = t.topic_definitions as { slug: string; name: string; aliases: string[] } | null;
      return { id: t.id, slug: td?.slug ?? "", name: td?.name ?? "", aliases: td?.aliases ?? [] };
    });
    const qLower = q.question.toLowerCase();
    const matched = topics.filter((t) =>
      [t.slug, t.name.toLowerCase(), ...t.aliases.map((a) => a.toLowerCase())]
        .some((kw) => kw && qLower.includes(kw)),
    );
    const useTopics = matched.length > 0 ? matched : topics; // fallback: tudo

    let contextText = "";
    const contextSent: Record<string, unknown> = { mode: data.mode, matched_topics: useTopics.map((t) => t.slug) };

    if (data.mode === "structured") {
      const lines: string[] = [];
      for (const t of useTopics) {
        const { data: fields } = await sb
          .from("knowledge_fields").select("*").eq("topic_id", t.id);
        const { data: addl } = await sb
          .from("additional_info").select("content").eq("topic_id", t.id);
        if ((fields?.length ?? 0) === 0 && (addl?.length ?? 0) === 0) continue;
        lines.push(`# Tópico: ${t.name} (${t.slug})`);
        for (const f of fields ?? []) {
          const v = typeof f.field_value === "object" ? JSON.stringify(f.field_value) : String(f.field_value);
          const verified = f.verified ? " ✓" : "";
          lines.push(`- ${f.field_name}: ${v}${verified}`);
        }
        if ((addl?.length ?? 0) > 0) {
          lines.push(`Informações adicionais:`);
          for (const a of addl ?? []) lines.push(`- ${a.content}`);
        }
        lines.push("");
      }
      contextText = lines.join("\n") || "(base estruturada vazia)";
      contextSent.structured_context = contextText;
    } else {
      // raw_chunks baseline: pega chunks cujo conteúdo bate com alias dos tópicos matched (ou todos os chunks até um limite)
      const { data: sources } = await sb
        .from("raw_sources").select("id").eq("project_id", q.project_id);
      const sourceIds = (sources ?? []).map((s) => s.id);
      const { data: chunks } = await sb
        .from("raw_chunks").select("id, content").in("raw_source_id", sourceIds).limit(500);
      const keywords = useTopics.flatMap((t) => [t.slug, t.name.toLowerCase(), ...t.aliases.map((a) => a.toLowerCase())]);
      let filtered = (chunks ?? []).filter((c) =>
        keywords.some((kw) => kw && c.content.toLowerCase().includes(kw)),
      );
      if (filtered.length === 0) filtered = (chunks ?? []).slice(0, 30);
      filtered = filtered.slice(0, 40);
      contextText = filtered.map((c) => `[chunk ${c.id}] ${c.content}`).join("\n---\n") || "(sem chunks)";
      contextSent.raw_chunks_count = filtered.length;
    }

    const userPrompt = `CONTEXTO:\n${contextText}\n\nPERGUNTA: ${q.question}`;
    const result = await callGateway({
      model: modelCfg.model_name,
      temperature: Number(modelCfg.temperature),
      maxTokens: modelCfg.max_tokens,
      system: tmpl.content,
      user: userPrompt,
    });

    const cost = estimateCost(modelCfg.model_name, result.inputTokens, result.outputTokens);

    const { data: llmCall } = await sb.from("llm_calls").insert({
      prompt_type: `answer:${data.mode}`,
      model_name: modelCfg.model_name,
      input_tokens: result.inputTokens,
      output_tokens: result.outputTokens,
      latency: result.latency,
      estimated_cost: cost,
      response: { content: result.content } as never,
    }).select("id").single();

    const { data: testRun } = await sb.from("test_runs").insert({
      question_id: q.id,
      mode: data.mode,
      prompt_template_id: tmpl.id,
      model_configuration_id: modelCfg.id,
      context_sent: contextSent as never,
      answer: result.content,
      llm_call_id: llmCall?.id ?? null,
    }).select("*").single();

    if (llmCall?.id && testRun?.id) {
      await sb.from("llm_calls").update({ test_run_id: testRun.id }).eq("id", llmCall.id);
    }

    return {
      answer: result.content,
      latency: result.latency,
      input_tokens: result.inputTokens,
      output_tokens: result.outputTokens,
      estimated_cost: cost,
      test_run_id: testRun?.id,
      context_sent: contextSent,
    };
  });
