import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { runCompare } from "@/lib/llm-providers.functions";
import { Trophy, AlertCircle } from "lucide-react";

type Provider = "lovable" | "openai" | "anthropic" | "google" | "openrouter" | "custom";

type SideResult = {
  ok: boolean;
  error: string | null;
  answer: string;
  inputTokens: number | null;
  outputTokens: number | null;
  latencyMs: number;
  context: string;
  prompt: string;
  contextChars: number;
  chunksUsed?: number;
  fieldsUsed?: number;
  topicsUsed?: number;
};
type CompareResult = { raw: SideResult; structured: SideResult };

const PROVIDER_DEFAULTS: Record<Provider, { model: string; needsKey: boolean; needsEndpoint: boolean }> = {
  lovable: { model: "google/gemini-3-flash-preview", needsKey: false, needsEndpoint: false },
  openai: { model: "gpt-4o-mini", needsKey: true, needsEndpoint: false },
  anthropic: { model: "claude-3-5-sonnet-latest", needsKey: true, needsEndpoint: false },
  google: { model: "gemini-1.5-flash", needsKey: true, needsEndpoint: false },
  openrouter: { model: "openai/gpt-4o-mini", needsKey: true, needsEndpoint: false },
  custom: { model: "gpt-4o-mini", needsKey: false, needsEndpoint: true },
};

function lsKey(projectId: string) {
  return `hkb-compare-cfg:${projectId}`;
}

export function CompareResponsesTab({ projectId }: { projectId: string }) {
  const [provider, setProvider] = useState<Provider>("lovable");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState(PROVIDER_DEFAULTS.lovable.model);
  const [temperature, setTemperature] = useState("0.2");
  const [maxTokens, setMaxTokens] = useState("1024");
  const [system, setSystem] = useState("");
  const [endpoint, setEndpoint] = useState("");
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<CompareResult | null>(null);
  const [viewing, setViewing] = useState<{ title: string; content: string } | null>(null);

  const runFn = useServerFn(runCompare);

  // Load saved config from localStorage
  useEffect(() => {
    try {
      const raw = localStorage.getItem(lsKey(projectId));
      if (!raw) return;
      const c = JSON.parse(raw);
      setProvider(c.provider ?? "lovable");
      setApiKey(c.apiKey ?? "");
      setModel(c.model ?? PROVIDER_DEFAULTS.lovable.model);
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

  async function run() {
    if (!question.trim()) {
      toast.error("Digite uma pergunta.");
      return;
    }
    const defs = PROVIDER_DEFAULTS[provider];
    if (defs.needsKey && !apiKey.trim()) {
      toast.error("API Key obrigatória para este provider.");
      return;
    }
    if (defs.needsEndpoint && !endpoint.trim()) {
      toast.error("Endpoint obrigatório para Custom.");
      return;
    }
    setBusy(true);
    setResult(null);
    try {
      const res = (await runFn({
        data: {
          projectId,
          question: question.trim(),
          provider,
          apiKey: apiKey.trim() || undefined,
          model: model.trim(),
          temperature: Number(temperature),
          maxTokens: Number(maxTokens),
          system: system.trim() || undefined,
          endpoint: endpoint.trim() || undefined,
        },
      })) as CompareResult;
      setResult(res);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const defs = PROVIDER_DEFAULTS[provider];

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Configuração do modelo</CardTitle>
          <p className="text-xs text-muted-foreground">
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
              rows={2}
              value={system}
              onChange={(e) => { setSystem(e.target.value); saveConfig({ system: e.target.value }); }}
              placeholder="Você é um assistente de hotel…"
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Pergunta</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Textarea
            rows={3}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="Ex.: O café da manhã está incluído? Qual o horário?"
          />
          <div className="flex justify-end">
            <Button onClick={run} disabled={busy}>{busy ? "Executando duas chamadas…" : "Run Comparison"}</Button>
          </div>
        </CardContent>
      </Card>

      {result && <ResultPanel result={result} onView={(t, c) => setViewing({ title: t, content: c })} />}

      <Dialog open={viewing != null} onOpenChange={(v) => { if (!v) setViewing(null); }}>
        <DialogContent className="max-w-3xl">
          <DialogHeader><DialogTitle>{viewing?.title}</DialogTitle></DialogHeader>
          <pre className="max-h-[65vh] overflow-auto whitespace-pre-wrap rounded bg-muted p-3 text-xs">
            {viewing?.content}
          </pre>
          <DialogFooter><Button variant="outline" onClick={() => setViewing(null)}>Fechar</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ResultPanel({ result, onView }: { result: CompareResult; onView: (title: string, content: string) => void }) {
  const winner = decideWinner(result);

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="flex items-center justify-between p-4">
          <div className="flex items-center gap-3">
            <Trophy className="size-5 text-amber-500" />
            <div>
              <div className="text-xs uppercase text-muted-foreground">Winner</div>
              <div className="text-sm font-semibold">{winner.label}</div>
            </div>
          </div>
          <div className="text-xs text-muted-foreground">
            Critérios: menor tempo, menos tokens, menos contexto.
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <SideCard
          title="Raw Knowledge"
          subtitle="Apenas chunks brutos (RAG tradicional)"
          color="border-amber-500/40 bg-amber-500/5"
          side={result.raw}
          itemsLabel={`${result.raw.chunksUsed ?? 0} chunks`}
          isWinner={winner.side === "raw"}
          onView={onView}
        />
        <SideCard
          title="Structured Knowledge"
          subtitle="Base híbrida estruturada"
          color="border-emerald-500/40 bg-emerald-500/5"
          side={result.structured}
          itemsLabel={`${result.structured.topicsUsed ?? 0} tópicos · ${result.structured.fieldsUsed ?? 0} campos`}
          isWinner={winner.side === "structured"}
          onView={onView}
        />
      </div>
    </div>
  );
}

function SideCard({
  title, subtitle, color, side, itemsLabel, isWinner, onView,
}: {
  title: string;
  subtitle: string;
  color: string;
  side: SideResult;
  itemsLabel: string;
  isWinner: boolean;
  onView: (title: string, content: string) => void;
}) {
  const totalTokens = (side.inputTokens ?? 0) + (side.outputTokens ?? 0);
  return (
    <Card className={color}>
      <CardHeader>
        <div className="flex items-start justify-between">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              {title}
              {isWinner && <Badge className="bg-amber-500 text-white">winner</Badge>}
            </CardTitle>
            <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {side.ok ? (
          <div className="rounded border bg-background p-3 text-sm whitespace-pre-wrap">
            {side.answer || <em className="text-muted-foreground">Sem resposta</em>}
          </div>
        ) : (
          <div className="flex items-start gap-2 rounded border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
            <AlertCircle className="mt-0.5 size-4" />
            <span>{side.error ?? "Erro desconhecido"}</span>
          </div>
        )}
        <div className="grid grid-cols-4 gap-2 text-xs">
          <Metric label="Tempo" value={`${side.latencyMs}ms`} />
          <Metric label="Tokens" value={String(totalTokens || "—")} />
          <Metric label="Contexto" value={`${side.contextChars}c`} />
          <Metric label="Itens" value={itemsLabel} />
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => onView(`Prompt · ${title}`, side.prompt)}>View Prompt</Button>
          <Button variant="outline" size="sm" onClick={() => onView(`Context · ${title}`, side.context)}>View Context</Button>
        </div>
      </CardContent>
    </Card>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border bg-background p-2">
      <div className="text-[10px] uppercase text-muted-foreground">{label}</div>
      <div className="text-sm font-medium">{value}</div>
    </div>
  );
}

function decideWinner(r: CompareResult): { side: "raw" | "structured" | "tie"; label: string } {
  const raw = r.raw, st = r.structured;
  if (!raw.ok && !st.ok) return { side: "tie", label: "Ambos falharam" };
  if (!raw.ok) return { side: "structured", label: "Structured Knowledge (raw falhou)" };
  if (!st.ok) return { side: "raw", label: "Raw Knowledge (structured falhou)" };
  let rawPts = 0, stPts = 0;
  if (raw.latencyMs < st.latencyMs) rawPts++; else if (st.latencyMs < raw.latencyMs) stPts++;
  const rawTok = (raw.inputTokens ?? 0) + (raw.outputTokens ?? 0);
  const stTok = (st.inputTokens ?? 0) + (st.outputTokens ?? 0);
  if (rawTok && stTok) {
    if (rawTok < stTok) rawPts++; else if (stTok < rawTok) stPts++;
  }
  if (raw.contextChars < st.contextChars) rawPts++; else if (st.contextChars < raw.contextChars) stPts++;
  if (rawPts > stPts) return { side: "raw", label: "Raw Knowledge" };
  if (stPts > rawPts) return { side: "structured", label: "Structured Knowledge" };
  return { side: "tie", label: "Empate" };
}
