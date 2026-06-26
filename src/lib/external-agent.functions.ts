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

function getByPath(obj: unknown, path: string): unknown {
  if (!path) return obj;
  return path.split(".").reduce<unknown>((acc, key) => {
    if (acc == null) return undefined;
    const k = /^\d+$/.test(key) ? Number(key) : key;
    return (acc as Record<string | number, unknown>)[k];
  }, obj);
}

export type CallExternalAgentResult = {
  content: string;
  latency: number;
  inputTokens: number | null;
  outputTokens: number | null;
  estimatedCost: number | null;
  rawResponse: unknown;
  requestPayload: unknown;
  requestHeaders: Record<string, string>; // already masked
};

export const callExternalAgent = createServerFn({ method: "POST" })
  .inputValidator(
    (input: { agentId: string; question: string; context: string; systemPrompt?: string }) =>
      input,
  )
  .handler(async ({ data }): Promise<CallExternalAgentResult> => {
    const sb = getSb();
    const { data: agent, error } = await sb
      .from("external_agents")
      .select("*")
      .eq("id", data.agentId)
      .maybeSingle();
    if (error || !agent) throw new Error("Agente externo não encontrado");

    const headers: Record<string, string> = {
      "content-type": "application/json",
      ...(agent.custom_headers as Record<string, string>),
    };

    if (agent.auth_type === "bearer" && agent.api_key) {
      headers["Authorization"] = `Bearer ${agent.api_key}`;
    } else if (agent.auth_type === "header" && agent.auth_header_name && agent.api_key) {
      headers[agent.auth_header_name] = agent.api_key;
    }

    const system = data.systemPrompt ?? "Responda somente com base no contexto fornecido.";
    const userContent = `Pergunta:\n${data.question}\n\nContexto:\n${data.context}`;

    let payload: unknown;
    if (agent.payload_template) {
      // Substitute {{question}} {{context}} {{system}} placeholders
      const tpl = JSON.stringify(agent.payload_template);
      const filled = tpl
        .replace(/\{\{question\}\}/g, JSON.stringify(data.question).slice(1, -1))
        .replace(/\{\{context\}\}/g, JSON.stringify(data.context).slice(1, -1))
        .replace(/\{\{system\}\}/g, JSON.stringify(system).slice(1, -1))
        .replace(/\{\{model\}\}/g, agent.model ?? "")
        .replace(/\{\{temperature\}\}/g, String(agent.temperature ?? 0.2));
      payload = JSON.parse(filled);
    } else {
      payload = {
        model: agent.model,
        temperature: Number(agent.temperature ?? 0.2),
        messages: [
          { role: "system", content: system },
          { role: "user", content: userContent },
        ],
      };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), agent.timeout_ms ?? 30000);
    const t0 = Date.now();
    let res: Response;
    try {
      res = await fetch(agent.endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }
    const latency = Date.now() - t0;

    const text = await res.text();
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      json = { raw: text };
    }
    if (!res.ok) {
      throw new Error(`Agente externo ${res.status}: ${text.slice(0, 300)}`);
    }

    const respPath = agent.response_path ?? "choices.0.message.content";
    const extracted = getByPath(json, respPath);
    const content =
      typeof extracted === "string"
        ? extracted
        : extracted == null
          ? JSON.stringify(json).slice(0, 2000)
          : JSON.stringify(extracted);

    const usage = (json as { usage?: { prompt_tokens?: number; completion_tokens?: number } }).usage;
    const inputTokens = usage?.prompt_tokens ?? null;
    const outputTokens = usage?.completion_tokens ?? null;

    // Mask api key in returned headers
    const maskedHeaders: Record<string, string> = {};
    for (const [k, v] of Object.entries(headers)) {
      if (/auth|key|token/i.test(k)) maskedHeaders[k] = "***";
      else maskedHeaders[k] = v;
    }

    return {
      content,
      latency,
      inputTokens,
      outputTokens,
      estimatedCost: null,
      rawResponse: json,
      requestPayload: payload,
      requestHeaders: maskedHeaders,
    };
  });

export const testExternalAgent = createServerFn({ method: "POST" })
  .inputValidator((input: { agentId: string }) => input)
  .handler(async ({ data }) => {
    return await callExternalAgent({
      data: {
        agentId: data.agentId,
        question: "Qual o horário do café da manhã?",
        context: "(teste de conexão — sem contexto real)",
      },
    });
  });
