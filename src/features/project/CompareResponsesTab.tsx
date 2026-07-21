import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { runCompare } from "@/lib/llm-providers.functions";
import { estimateCostUsd, formatUsd, lsKey as _lsKey } from "@/lib/llm-pricing";
import { Trophy, AlertCircle, Settings2 } from "lucide-react";

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

type Config = {
  provider: Provider;
  apiKey: string;
  model: string;
  temperature: string;
  maxTokens: string;
  system: string;
  endpoint: string;
};

const PROVIDER_NEEDS: Record<Provider, { needsKey: boolean; needsEndpoint: boolean }> = {
  lovable: { needsKey: false, needsEndpoint: false },
  openai: { needsKey: true, needsEndpoint: false },
  anthropic: { needsKey: true, needsEndpoint: false },
  google: { needsKey: true, needsEndpoint: false },
  openrouter: { needsKey: true, needsEndpoint: false },
  custom: { needsKey: false, needsEndpoint: true },
};

function lsKey(projectId: string) {
  return `hkb-compare-cfg:${projectId}`;
}

function loadConfig(projectId: string): Config | null {
  try {
    const raw = localStorage.getItem(lsKey(projectId));
    if (!raw) return null;
    const c = JSON.parse(raw);
    return {
      provider: c.provider ?? "lovable",
      apiKey: c.apiKey ?? "",
      model: c.model ?? "google/gemini-3-flash-preview",
      temperature: c.temperature ?? "0.2",
      maxTokens: c.maxTokens ?? "1024",
      system: c.system ?? "",
      endpoint: c.endpoint ?? "",
    };
  } catch { return null; }
}

export function CompareResponsesTab({ projectId }: { projectId: string }) {
  const [cfg, setCfg] = useState<Config | null>(() => loadConfig(projectId));
  const [multi, setMulti] = useState(false);
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [results, setResults] = useState<Array<{ question: string; result: CompareResult }>>([]);
  const [viewing, setViewing] = useState<{ title: string; content: string } | null>(null);

  const runFn = useServerFn(runCompare);

  // Reload config when user switches back from Settings
  useEffect(() => {
    const onFocus = () => setCfg(loadConfig(projectId));
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [projectId]);

  function validateConfig(c: Config | null): string | null {
    if (!c) return "Configure o modelo em Settings → LLM Config.";
    const needs = PROVIDER_NEEDS[c.provider];
    if (needs.needsKey && !c.apiKey.trim()) return "API Key obrigatória para este provider (Settings → LLM Config).";
    if (needs.needsEndpoint && !c.endpoint.trim()) return "Endpoint obrigatório para Custom (Settings → LLM Config).";
    if (!c.model.trim()) return "Model não configurado (Settings → LLM Config).";
    return null;
  }

  async function run() {
    const current = loadConfig(projectId);
    setCfg(current);
    const err = validateConfig(current);
    if (err) { toast.error(err); return; }

    const questions = multi
      ? question.split("\n").map((q) => q.trim()).filter(Boolean)
      : [question.trim()].filter(Boolean);

    if (questions.length === 0) {
      toast.error(multi ? "Digite ao menos uma pergunta (uma por linha)." : "Digite uma pergunta.");
      return;
    }

    setBusy(true);
    setResults([]);
    setProgress({ done: 0, total: questions.length });

    const collected: Array<{ question: string; result: CompareResult }> = [];
    try {
      for (let i = 0; i < questions.length; i++) {
        const q = questions[i];
        try {
          const res = (await runFn({
            data: {
              projectId,
              question: q,
              provider: current!.provider,
              apiKey: current!.apiKey.trim() || undefined,
              model: current!.model.trim(),
              temperature: Number(current!.temperature),
              maxTokens: Number(current!.maxTokens),
              system: current!.system.trim() || undefined,
              endpoint: current!.endpoint.trim() || undefined,
            },
          })) as CompareResult;
          collected.push({ question: q, result: res });
          setResults([...collected]);
        } catch (e) {
          toast.error(`Pergunta "${q.slice(0, 40)}…": ${e instanceof Error ? e.message : String(e)}`);
        }
        setProgress({ done: i + 1, total: questions.length });
      }
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  const configError = validateConfig(cfg);
  const questionCount = multi
    ? question.split("\n").map((q) => q.trim()).filter(Boolean).length
    : (question.trim() ? 1 : 0);

  return (
    <div className="space-y-6">
      {configError ? (
        <Card className="border-amber-500/40 bg-amber-500/5">
          <CardContent className="flex items-center justify-between gap-3 p-4">
            <div className="flex items-start gap-2 text-sm">
              <Settings2 className="mt-0.5 size-4 text-amber-600" />
              <span>{configError}</span>
            </div>
            <Link to="/projects/$projectId" params={{ projectId }} search={{ tab: "settings" }}>
              <Button size="sm" variant="outline">Ir para Settings</Button>
            </Link>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="flex items-center justify-between p-4 text-xs text-muted-foreground">
            <span>
              Provider: <strong>{cfg!.provider}</strong> · Model: <strong>{cfg!.model}</strong>
            </span>
            <Link to="/projects/$projectId" params={{ projectId }} search={{ tab: "settings" }}>
              <Button size="sm" variant="ghost">Editar em Settings</Button>
            </Link>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Pergunta{multi ? "s" : ""}</CardTitle>
            <div className="flex items-center gap-2">
              <Label htmlFor="multi-mode" className="text-xs">Modo multi-perguntas</Label>
              <Switch id="multi-mode" checked={multi} onCheckedChange={setMulti} disabled={busy} />
            </div>
          </div>
          {multi && (
            <p className="text-xs text-muted-foreground">
              Uma pergunta por linha. Execução sequencial (uma por vez) para preservar qualidade das respostas.
            </p>
          )}
        </CardHeader>
        <CardContent className="space-y-3">
          <Textarea
            rows={multi ? 6 : 3}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder={multi
              ? "O café da manhã está incluído?\nQual o horário do check-in?\nAceitam pets?"
              : "Ex.: O café da manhã está incluído? Qual o horário?"}
          />
          <div className="flex items-center justify-between">
            <div className="text-xs text-muted-foreground">
              {progress
                ? `Executando ${progress.done}/${progress.total}…`
                : multi && questionCount > 0
                  ? `${questionCount} pergunta${questionCount > 1 ? "s" : ""} pronta${questionCount > 1 ? "s" : ""}`
                  : ""}
            </div>
            <Button onClick={run} disabled={busy || !!configError}>
              {busy
                ? "Executando…"
                : multi
                  ? `Run Comparison${questionCount > 0 ? ` (${questionCount})` : ""}`
                  : "Run Comparison"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {results.length > 0 && (
        <ResultsSection
          results={results}
          cfg={cfg!}
          onView={(t, c) => setViewing({ title: t, content: c })}
        />
      )}

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

function ResultsSection({
  results, cfg, onView,
}: {
  results: Array<{ question: string; result: CompareResult }>;
  cfg: Config;
  onView: (title: string, content: string) => void;
}) {
  // Aggregated summary (only useful when >1)
  let rawWins = 0, stWins = 0, ties = 0;
  let rawCostTotal = 0, stCostTotal = 0;
  let rawCostKnown = false, stCostKnown = false;

  for (const { result } of results) {
    const w = decideWinner(result);
    if (w.side === "raw") rawWins++;
    else if (w.side === "structured") stWins++;
    else ties++;

    const rc = estimateCostUsd({ provider: cfg.provider, model: cfg.model, inputTokens: result.raw.inputTokens, outputTokens: result.raw.outputTokens });
    const sc = estimateCostUsd({ provider: cfg.provider, model: cfg.model, inputTokens: result.structured.inputTokens, outputTokens: result.structured.outputTokens });
    if (rc != null) { rawCostTotal += rc; rawCostKnown = true; }
    if (sc != null) { stCostTotal += sc; stCostKnown = true; }
  }

  return (
    <div className="space-y-6">
      {results.length > 1 && (
        <Card>
          <CardContent className="grid grid-cols-2 gap-3 p-4 text-sm md:grid-cols-4">
            <Metric label="Perguntas" value={String(results.length)} />
            <Metric label="Wins Raw" value={String(rawWins)} />
            <Metric label="Wins Structured" value={String(stWins)} />
            <Metric label="Empates" value={String(ties)} />
            <Metric label="Custo total Raw" value={rawCostKnown ? formatUsd(rawCostTotal) : "—"} />
            <Metric label="Custo total Structured" value={stCostKnown ? formatUsd(stCostTotal) : "—"} />
          </CardContent>
        </Card>
      )}

      {results.map(({ question, result }, idx) => (
        <div key={idx} className="space-y-2">
          {results.length > 1 && (
            <div className="text-sm">
              <span className="text-xs uppercase text-muted-foreground">Pergunta {idx + 1}</span>
              <div className="font-medium">{question}</div>
            </div>
          )}
          <ResultPanel result={result} cfg={cfg} onView={onView} />
        </div>
      ))}
    </div>
  );
}

function ResultPanel({ result, cfg, onView }: {
  result: CompareResult;
  cfg: Config;
  onView: (title: string, content: string) => void;
}) {
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
          cfg={cfg}
          itemsLabel={`${result.raw.chunksUsed ?? 0} chunks`}
          isWinner={winner.side === "raw"}
          onView={onView}
        />
        <SideCard
          title="Structured Knowledge"
          subtitle="Base híbrida estruturada"
          color="border-emerald-500/40 bg-emerald-500/5"
          side={result.structured}
          cfg={cfg}
          itemsLabel={`${result.structured.topicsUsed ?? 0} tópicos · ${result.structured.fieldsUsed ?? 0} campos`}
          isWinner={winner.side === "structured"}
          onView={onView}
        />
      </div>
    </div>
  );
}

function SideCard({
  title, subtitle, color, side, cfg, itemsLabel, isWinner, onView,
}: {
  title: string;
  subtitle: string;
  color: string;
  side: SideResult;
  cfg: Config;
  itemsLabel: string;
  isWinner: boolean;
  onView: (title: string, content: string) => void;
}) {
  const totalTokens = (side.inputTokens ?? 0) + (side.outputTokens ?? 0);
  const cost = estimateCostUsd({
    provider: cfg.provider, model: cfg.model,
    inputTokens: side.inputTokens, outputTokens: side.outputTokens,
  });
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
        <div className="grid grid-cols-5 gap-2 text-xs">
          <Metric label="Tempo" value={`${side.latencyMs}ms`} />
          <Metric label="Tokens" value={String(totalTokens || "—")} />
          <Metric label="Contexto" value={`${side.contextChars}c`} />
          <Metric label="Itens" value={itemsLabel} />
          <Metric label="Custo est." value={formatUsd(cost)} title={cost == null ? "Preço não catalogado para este modelo" : undefined} />
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => onView(`Prompt · ${title}`, side.prompt)}>View Prompt</Button>
          <Button variant="outline" size="sm" onClick={() => onView(`Context · ${title}`, side.context)}>View Context</Button>
        </div>
      </CardContent>
    </Card>
  );
}

function Metric({ label, value, title }: { label: string; value: string; title?: string }) {
  return (
    <div className="rounded border bg-background p-2" title={title}>
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

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _unused = _lsKey;
