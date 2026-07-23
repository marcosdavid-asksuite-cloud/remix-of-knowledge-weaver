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

export const generateExecutiveSummary = createServerFn({ method: "POST" })
  .inputValidator((input: { projectId: string; metrics: Record<string, unknown> }) => input)
  .handler(async ({ data }) => {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) throw new Error("OPENROUTER_API_KEY não configurada");

    const sb = getSb();
    const { data: modelCfg } = await sb
      .from("model_configurations")
      .select("*")
      .eq("active", true)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const model = modelCfg?.model_name ?? "deepseek/deepseek-v4-flash";

    const system = `Você é um analista sênior gerando relatórios executivos sobre experimentos de IA.
Escreva em português, formal, direto, no máximo 500 palavras.
Use APENAS os indicadores fornecidos. Não invente nada.
Estruture em seções markdown: Estado atual, Pontos fortes, Problemas, Recomendações.`;

    const user = `Indicadores do experimento:\n\n${JSON.stringify(data.metrics, null, 2)}`;

    const t0 = Date.now();
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", "Authorization": `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        temperature: 0.3,
        max_tokens: 2000,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
    });
    const latency = Date.now() - t0;
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Gateway ${res.status}: ${text.slice(0, 300)}`);
    }
    const json = (await res.json()) as {
      choices: Array<{ message: { content: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const summary = json.choices[0]?.message?.content ?? "";

    await sb.from("llm_calls").insert({
      prompt_type: "executive_summary",
      model_name: model,
      input_tokens: json.usage?.prompt_tokens ?? 0,
      output_tokens: json.usage?.completion_tokens ?? 0,
      latency,
      estimated_cost: 0,
    });

    return { summary, model, latency };
  });
