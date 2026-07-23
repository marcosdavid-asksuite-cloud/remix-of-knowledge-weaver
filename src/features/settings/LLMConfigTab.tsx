import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";

type Provider = "lovable" | "openai" | "anthropic" | "google" | "openrouter" | "custom";

const PROVIDER_DEFAULTS: Record<Provider, { model: string; needsKey: boolean; needsEndpoint: boolean }> = {
  lovable: { model: "google/gemini-3-flash-preview", needsKey: false, needsEndpoint: false },
  openai: { model: "gpt-4o-mini", needsKey: true, needsEndpoint: false },
  anthropic: { model: "claude-3-5-sonnet-latest", needsKey: true, needsEndpoint: false },
  google: { model: "gemini-1.5-flash", needsKey: true, needsEndpoint: false },
  openrouter: { model: "deepseek/deepseek-v4-flash", needsKey: true, needsEndpoint: false },
  custom: { model: "gpt-4o-mini", needsKey: false, needsEndpoint: true },
};

export function lsKey(projectId: string) {
  return `hkb-compare-cfg:${projectId}`;
}

/**
 * Returns a model override safe to pass to server-side extraction.
 * Extraction runs through OpenRouter, so we only forward overrides when the
 * user picked the OpenRouter provider — other providers use the project's
 * active model_configuration on the server.
 */
export function getExtractionModelOverride(projectId: string):
  | { model?: string; temperature?: number; maxTokens?: number }
  | undefined {
  try {
    const raw = localStorage.getItem(lsKey(projectId));
    if (!raw) return undefined;
    const c = JSON.parse(raw) as {
      provider?: Provider; model?: string; temperature?: string; maxTokens?: string;
    };
    if (c.provider && c.provider !== "openrouter") return undefined;
    const t = c.temperature ? Number(c.temperature) : undefined;
    const m = c.maxTokens ? Number(c.maxTokens) : undefined;
    return {
      model: c.model?.trim() || undefined,
      temperature: Number.isFinite(t) ? t : undefined,
      maxTokens: Number.isFinite(m) ? m : undefined,
    };
  } catch {
    return undefined;
  }
}

export function LLMConfigTab({ projectId }: { projectId: string }) {
  const [provider, setProvider] = useState<Provider>("openrouter");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState(PROVIDER_DEFAULTS.openrouter.model);
  const [temperature, setTemperature] = useState("0.2");
  const [maxTokens, setMaxTokens] = useState("1024");
  const [system, setSystem] = useState("");
  const [endpoint, setEndpoint] = useState("");

  useEffect(() => {
    try {
      const raw = localStorage.getItem(lsKey(projectId));
      if (!raw) return;
      const c = JSON.parse(raw);
      setProvider(c.provider ?? "openrouter");
      setApiKey(c.apiKey ?? "");
      setModel(c.model ?? PROVIDER_DEFAULTS.openrouter.model);
      setTemperature(c.temperature ?? "0.2");
      setMaxTokens(c.maxTokens ?? "1024");
      setSystem(c.system ?? "");
      setEndpoint(c.endpoint ?? "");
    } catch { /* ignore */ }
  }, [projectId]);

  function saveConfig(next: Partial<{
    provider: Provider; apiKey: string; model: string; temperature: string; maxTokens: string; system: string; endpoint: string;
  }>) {
    const current = { provider, apiKey, model, temperature, maxTokens, system, endpoint, ...next };
    localStorage.setItem(lsKey(projectId), JSON.stringify(current));
  }

  function onProviderChange(p: Provider) {
    setProvider(p);
    setModel(PROVIDER_DEFAULTS[p].model);
    saveConfig({ provider: p, model: PROVIDER_DEFAULTS[p].model });
  }

  const defs = PROVIDER_DEFAULTS[provider];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Configuração do modelo</CardTitle>
        <p className="text-xs text-muted-foreground">
          Usado pela aba <strong>Compare Responses</strong> e também pela{" "}
          <strong>extração</strong> (quando o provider for <em>OpenRouter</em>).
          Suas credenciais ficam apenas no navegador (localStorage). Não armazenamos no servidor.
        </p>
      </CardHeader>
      <CardContent className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <div>
          <Label>Provider</Label>
          <select
            className="w-full rounded border bg-background p-2 text-sm"
            value={provider}
            onChange={(e) => onProviderChange(e.target.value as Provider)}
          >
            <option value="lovable">Lovable AI Gateway</option>
            <option value="openai">OpenAI</option>
            <option value="anthropic">Anthropic</option>
            <option value="google">Google Gemini</option>
            <option value="openrouter">OpenRouter</option>
            <option value="custom">Custom (OpenAI-compat)</option>
          </select>
        </div>
        <div>
          <Label>Model</Label>
          <Input value={model} onChange={(e) => { setModel(e.target.value); saveConfig({ model: e.target.value }); }} />
        </div>
        <div>
          <Label>Temperature</Label>
          <Input
            type="number"
            step="0.05"
            value={temperature}
            onChange={(e) => { setTemperature(e.target.value); saveConfig({ temperature: e.target.value }); }}
          />
        </div>
        <div>
          <Label>Max tokens</Label>
          <Input
            type="number"
            value={maxTokens}
            onChange={(e) => { setMaxTokens(e.target.value); saveConfig({ maxTokens: e.target.value }); }}
          />
        </div>
        {defs.needsKey || provider === "custom" ? (
          <div className="col-span-2">
            <Label>API Key {defs.needsKey ? "*" : "(opcional)"}</Label>
            <Input
              type="password"
              value={apiKey}
              onChange={(e) => { setApiKey(e.target.value); saveConfig({ apiKey: e.target.value }); }}
              placeholder="sk-…"
            />
          </div>
        ) : null}
        {provider === "custom" && (
          <div className="col-span-2">
            <Label>Endpoint *</Label>
            <Input
              value={endpoint}
              onChange={(e) => { setEndpoint(e.target.value); saveConfig({ endpoint: e.target.value }); }}
              placeholder="https://meu-endpoint/v1/chat/completions"
            />
          </div>
        )}
        <div className="col-span-2 md:col-span-4">
          <Label>System prompt (opcional)</Label>
          <Textarea
            rows={3}
            value={system}
            onChange={(e) => { setSystem(e.target.value); saveConfig({ system: e.target.value }); }}
            placeholder="Você é um assistente de hotel…"
          />
        </div>
      </CardContent>
    </Card>
  );
}
