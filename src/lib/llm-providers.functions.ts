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

type Provider = "lovable" | "openai" | "anthropic" | "google" | "openrouter" | "custom";

type CallResult = {
  answer: string;
  inputTokens: number | null;
  outputTokens: number | null;
  latencyMs: number;
};

type LlmConfig = {
  provider: Provider;
  apiKey?: string;
  model: string;
  temperature: number;
  maxTokens: number;
  system?: string;
  endpoint?: string;
};

const DEFAULT_SYSTEM =
  "Você é um assistente de hotel. Responda APENAS com base no contexto fornecido. Se a informação não estiver no contexto, diga que não encontrou. Não invente.";

function buildUserPrompt(question: string, context: string) {
  return `CONTEXTO:\n${context}\n\nPERGUNTA:\n${question}`;
}

async function callOpenAICompat(cfg: LlmConfig, userPrompt: string, endpoint: string, headers: Record<string, string>): Promise<CallResult> {
  const t0 = Date.now();
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify({
      model: cfg.model,
      temperature: cfg.temperature,
      max_tokens: cfg.maxTokens,
      messages: [
        { role: "system", content: cfg.system || DEFAULT_SYSTEM },
        { role: "user", content: userPrompt },
      ],
    }),
  });
  const latency = Date.now() - t0;
  const text = await res.text();
  if (!res.ok) throw new Error(`Provider ${res.status}: ${text.slice(0, 400)}`);
  const json = JSON.parse(text) as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  return {
    answer: json.choices?.[0]?.message?.content ?? "",
    inputTokens: json.usage?.prompt_tokens ?? null,
    outputTokens: json.usage?.completion_tokens ?? null,
    latencyMs: latency,
  };
}

async function callAnthropic(cfg: LlmConfig, userPrompt: string): Promise<CallResult> {
  if (!cfg.apiKey) throw new Error("API key obrigatória para Anthropic");
  const t0 = Date.now();
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": cfg.apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: cfg.model,
      max_tokens: cfg.maxTokens,
      temperature: cfg.temperature,
      system: cfg.system || DEFAULT_SYSTEM,
      messages: [{ role: "user", content: userPrompt }],
    }),
  });
  const latency = Date.now() - t0;
  const text = await res.text();
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${text.slice(0, 400)}`);
  const json = JSON.parse(text) as {
    content?: Array<{ text?: string }>;
    usage?: { input_tokens?: number; output_tokens?: number };
  };
  return {
    answer: (json.content ?? []).map((c) => c.text ?? "").join(""),
    inputTokens: json.usage?.input_tokens ?? null,
    outputTokens: json.usage?.output_tokens ?? null,
    latencyMs: latency,
  };
}

async function callGoogle(cfg: LlmConfig, userPrompt: string): Promise<CallResult> {
  if (!cfg.apiKey) throw new Error("API key obrigatória para Google");
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(cfg.model)}:generateContent?key=${encodeURIComponent(cfg.apiKey)}`;
  const t0 = Date.now();
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: cfg.system || DEFAULT_SYSTEM }] },
      contents: [{ role: "user", parts: [{ text: userPrompt }] }],
      generationConfig: { temperature: cfg.temperature, maxOutputTokens: cfg.maxTokens },
    }),
  });
  const latency = Date.now() - t0;
  const text = await res.text();
  if (!res.ok) throw new Error(`Google ${res.status}: ${text.slice(0, 400)}`);
  const json = JSON.parse(text) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
  };
  return {
    answer: (json.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? "").join(""),
    inputTokens: json.usageMetadata?.promptTokenCount ?? null,
    outputTokens: json.usageMetadata?.candidatesTokenCount ?? null,
    latencyMs: latency,
  };
}

async function callProvider(cfg: LlmConfig, userPrompt: string): Promise<CallResult> {
  switch (cfg.provider) {
    case "lovable": {
      const apiKey = process.env.LOVABLE_API_KEY;
      if (!apiKey) throw new Error("LOVABLE_API_KEY não configurada no servidor.");
      return callOpenAICompat(cfg, userPrompt, "https://ai.gateway.lovable.dev/v1/chat/completions", {
        "Lovable-API-Key": apiKey,
      });
    }
    case "openai":
      if (!cfg.apiKey) throw new Error("API key obrigatória para OpenAI");
      return callOpenAICompat(cfg, userPrompt, "https://api.openai.com/v1/chat/completions", {
        Authorization: `Bearer ${cfg.apiKey}`,
      });
    case "openrouter":
      if (!cfg.apiKey) throw new Error("API key obrigatória para OpenRouter");
      return callOpenAICompat(cfg, userPrompt, "https://openrouter.ai/api/v1/chat/completions", {
        Authorization: `Bearer ${cfg.apiKey}`,
      });
    case "custom": {
      if (!cfg.endpoint) throw new Error("Endpoint obrigatório para Custom");
      const headers: Record<string, string> = {};
      if (cfg.apiKey) headers["Authorization"] = `Bearer ${cfg.apiKey}`;
      return callOpenAICompat(cfg, userPrompt, cfg.endpoint, headers);
    }
    case "anthropic":
      return callAnthropic(cfg, userPrompt);
    case "google":
      return callGoogle(cfg, userPrompt);
  }
}

// ===== Context builders =====

function normalizeText(s: string) {
  return s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

async function buildRawContext(
  sb: ReturnType<typeof getSb>,
  projectId: string,
  question: string,
  maxChunks: number,
): Promise<{ text: string; chunksUsed: number; chunks: Array<{ id: string; source: string }> }> {
  const { data: sources } = await sb
    .from("raw_sources").select("id, filename").eq("project_id", projectId);
  const sourceIds = (sources ?? []).map((s) => s.id);
  if (sourceIds.length === 0) return { text: "(sem fontes)", chunksUsed: 0, chunks: [] };
  const nameById = new Map((sources ?? []).map((s) => [s.id, s.filename ?? "?"]));

  const { data: chunks } = await sb
    .from("raw_chunks").select("id, content, raw_source_id, position")
    .in("raw_source_id", sourceIds).order("position").limit(1000);
  const all = chunks ?? [];
  if (all.length === 0) return { text: "(sem chunks)", chunksUsed: 0, chunks: [] };

  const qTokens = normalizeText(question)
    .replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w.length >= 4);
  const scored = all.map((c) => {
    const norm = normalizeText(c.content);
    let score = 0;
    for (const t of qTokens) if (norm.includes(t)) score += t.length >= 5 ? 2 : 1;
    return { id: c.id, content: c.content, source: nameById.get(c.raw_source_id) ?? "?", score };
  });
  let selected = scored.filter((s) => s.score > 0).sort((a, b) => b.score - a.score);
  if (selected.length === 0) selected = scored.slice(0, maxChunks);
  selected = selected.slice(0, maxChunks);

  const text = selected.map((s) => `# Fonte: ${s.source}\n${s.content}`).join("\n---\n");
  return {
    text,
    chunksUsed: selected.length,
    chunks: selected.map((s) => ({ id: s.id, source: s.source })),
  };
}

async function buildStructuredContext(
  sb: ReturnType<typeof getSb>,
  projectId: string,
): Promise<{ text: string; fieldsUsed: number; topicsUsed: number }> {
  const { data: topics } = await sb
    .from("topics")
    .select("id, topic_definitions(slug, name)")
    .eq("project_id", projectId);
  const topicList = (topics ?? []) as unknown as Array<{
    id: string;
    topic_definitions: { slug: string; name: string } | null;
  }>;
  if (topicList.length === 0) return { text: "(sem tópicos)", fieldsUsed: 0, topicsUsed: 0 };

  const topicIds = topicList.map((t) => t.id);
  const { data: fields } = await sb
    .from("knowledge_fields").select("topic_id, field_name, field_value, field_origin")
    .in("topic_id", topicIds)
    .eq("consolidation_status", "consolidated");
  const { data: addl } = await sb
    .from("additional_info").select("topic_id, content")
    .in("topic_id", topicIds).eq("status", "approved");

  type Payload = {
    topic: string;
    core_fields: Record<string, unknown>;
    additional_information: string;
  };
  const payloads: Payload[] = [];
  let totalFields = 0;
  for (const t of topicList) {
    const slug = t.topic_definitions?.slug ?? "?";
    const tFields = (fields ?? []).filter((f) => f.topic_id === t.id);
    const tAddl = (addl ?? []).filter((a) => a.topic_id === t.id);
    if (tFields.length === 0 && tAddl.length === 0) continue;
    const core: Record<string, unknown> = {};
    for (const f of tFields.filter((f) => f.field_origin === "core")) {
      core[f.field_name] = f.field_value;
      totalFields++;
    }
    // dynamic fields fold into additional_information text if no curated addl present
    const dynamicTexts = tFields
      .filter((f) => f.field_origin === "dynamic")
      .map((f) => {
        const v = typeof f.field_value === "object" ? JSON.stringify(f.field_value) : String(f.field_value);
        return `${f.field_name}: ${v}`;
      });
    totalFields += dynamicTexts.length;
    const addlText = [...tAddl.map((a) => a.content), ...dynamicTexts].join("\n");
    payloads.push({ topic: slug, core_fields: core, additional_information: addlText });
  }
  if (payloads.length === 0) {
    return { text: "(base estruturada vazia)", fieldsUsed: 0, topicsUsed: 0 };
  }
  return {
    text: JSON.stringify(payloads, null, 2),
    fieldsUsed: totalFields,
    topicsUsed: payloads.length,
  };
}

// ===== Public server fn =====

export const runCompare = createServerFn({ method: "POST" })
  .inputValidator((input: {
    projectId: string;
    question: string;
    provider: Provider;
    apiKey?: string;
    model: string;
    temperature: number;
    maxTokens: number;
    system?: string;
    endpoint?: string;
    maxChunks?: number;
  }) => input)
  .handler(async ({ data }) => {
    const sb = getSb();
    const maxChunks = Math.max(1, Math.min(80, data.maxChunks ?? 20));

    const [rawCtx, structCtx] = await Promise.all([
      buildRawContext(sb, data.projectId, data.question, maxChunks),
      buildStructuredContext(sb, data.projectId),
    ]);

    const cfg: LlmConfig = {
      provider: data.provider,
      apiKey: data.apiKey,
      model: data.model,
      temperature: data.temperature,
      maxTokens: data.maxTokens,
      system: data.system,
      endpoint: data.endpoint,
    };

    const rawPrompt = buildUserPrompt(data.question, rawCtx.text);
    const structPrompt = buildUserPrompt(data.question, structCtx.text);

    const [rawSettled, structSettled] = await Promise.allSettled([
      callProvider(cfg, rawPrompt),
      callProvider(cfg, structPrompt),
    ]);

    return {
      raw: {
        ok: rawSettled.status === "fulfilled",
        error: rawSettled.status === "rejected" ? String(rawSettled.reason?.message ?? rawSettled.reason) : null,
        ...(rawSettled.status === "fulfilled" ? rawSettled.value : { answer: "", inputTokens: null, outputTokens: null, latencyMs: 0 }),
        context: rawCtx.text,
        prompt: rawPrompt,
        chunksUsed: rawCtx.chunksUsed,
        chunks: rawCtx.chunks,
        contextChars: rawCtx.text.length,
      },
      structured: {
        ok: structSettled.status === "fulfilled",
        error: structSettled.status === "rejected" ? String(structSettled.reason?.message ?? structSettled.reason) : null,
        ...(structSettled.status === "fulfilled" ? structSettled.value : { answer: "", inputTokens: null, outputTokens: null, latencyMs: 0 }),
        context: structCtx.text,
        prompt: structPrompt,
        fieldsUsed: structCtx.fieldsUsed,
        topicsUsed: structCtx.topicsUsed,
        contextChars: structCtx.text.length,
      },
    };
  });
