// Preços em USD por 1M tokens (input, output). Estimativas — atualize conforme necessário.
type Provider = "lovable" | "openai" | "anthropic" | "google" | "openrouter" | "custom";

type Price = { input: number; output: number };

// Chave: `${provider}:${model}` (lowercase). Fallback por provider abaixo.
const PRICES: Record<string, Price> = {
  // Lovable AI Gateway
  "lovable:google/gemini-3-flash-preview": { input: 0.3, output: 2.5 },
  "lovable:google/gemini-2.5-flash": { input: 0.3, output: 2.5 },
  "lovable:google/gemini-2.5-flash-lite": { input: 0.1, output: 0.4 },
  "lovable:google/gemini-2.5-pro": { input: 1.25, output: 10 },
  "lovable:openai/gpt-5-mini": { input: 0.25, output: 2 },
  "lovable:openai/gpt-5-nano": { input: 0.05, output: 0.4 },
  "lovable:openai/gpt-5": { input: 1.25, output: 10 },

  // OpenAI direto
  "openai:gpt-4o-mini": { input: 0.15, output: 0.6 },
  "openai:gpt-4o": { input: 2.5, output: 10 },
  "openai:gpt-4.1-mini": { input: 0.4, output: 1.6 },
  "openai:gpt-4.1": { input: 2, output: 8 },

  // Anthropic
  "anthropic:claude-3-5-sonnet-latest": { input: 3, output: 15 },
  "anthropic:claude-3-5-haiku-latest": { input: 0.8, output: 4 },

  // Google Gemini API
  "google:gemini-1.5-flash": { input: 0.075, output: 0.3 },
  "google:gemini-1.5-pro": { input: 1.25, output: 5 },
  "google:gemini-2.0-flash": { input: 0.1, output: 0.4 },

  // OpenRouter (roteia; usa preços do modelo subjacente quando conhecido)
  "openrouter:openai/gpt-4o-mini": { input: 0.15, output: 0.6 },
  "openrouter:anthropic/claude-3.5-sonnet": { input: 3, output: 15 },
};

export function estimateCostUsd(params: {
  provider: Provider;
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
}): number | null {
  const { provider, model, inputTokens, outputTokens } = params;
  if (inputTokens == null && outputTokens == null) return null;
  const key = `${provider}:${model.toLowerCase()}`;
  const price = PRICES[key];
  if (!price) return null;
  const inTok = inputTokens ?? 0;
  const outTok = outputTokens ?? 0;
  return (inTok / 1_000_000) * price.input + (outTok / 1_000_000) * price.output;
}

export function formatUsd(usd: number | null): string {
  if (usd == null) return "—";
  if (usd === 0) return "$0";
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}
