import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/AppShell";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { DataPointsTab } from "@/features/settings/DataPointsTab";
import { ExtractionSettingsTab } from "@/features/settings/ExtractionSettingsTab";
import { SchemaEvolutionTab } from "@/features/settings/SchemaEvolutionTab";

export const Route = createFileRoute("/settings")({
  head: () => ({ meta: [{ title: "Settings — Hybrid KB Lab" }] }),
  component: Settings,
});

function Settings() {
  return (
    <AppShell>
      <h1 className="mb-6 text-2xl font-semibold">Settings</h1>
      <Tabs defaultValue="data_points">
        <TabsList>
          <TabsTrigger value="data_points">Data Points</TabsTrigger>
          <TabsTrigger value="schema_evolution">Schema Evolution</TabsTrigger>
          <TabsTrigger value="extraction">Extraction</TabsTrigger>
          <TabsTrigger value="prompts">Prompt Templates</TabsTrigger>
          <TabsTrigger value="models">Model Configurations</TabsTrigger>
          <TabsTrigger value="llm">LLM Calls</TabsTrigger>
        </TabsList>
        <TabsContent value="data_points" className="mt-6"><DataPointsTab /></TabsContent>
        <TabsContent value="schema_evolution" className="mt-6"><SchemaEvolutionTab /></TabsContent>
        <TabsContent value="extraction" className="mt-6"><ExtractionSettingsTab /></TabsContent>
        <TabsContent value="prompts" className="mt-6"><Prompts /></TabsContent>
        <TabsContent value="models" className="mt-6"><Models /></TabsContent>
        <TabsContent value="llm" className="mt-6"><LLMCalls /></TabsContent>
      </Tabs>
    </AppShell>
  );
}



function Prompts() {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [type, setType] = useState<"extraction" | "answer" | "topic_routing">("extraction");
  const [content, setContent] = useState("");

  const { data } = useQuery({
    queryKey: ["prompt_templates"],
    queryFn: async () => {
      const { data, error } = await supabase.from("prompt_templates").select("*").order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  async function add() {
    if (!name.trim() || !content.trim()) return;
    const { error } = await supabase.from("prompt_templates").insert({ name, type, content, version: 1 });
    if (error) toast.error(error.message);
    else { setName(""); setContent(""); qc.invalidateQueries({ queryKey: ["prompt_templates"] }); }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader><CardTitle className="text-base">Novo template</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          <Input placeholder="Nome" value={name} onChange={(e) => setName(e.target.value)} />
          <select className="w-full rounded border bg-background p-2 text-sm" value={type} onChange={(e) => setType(e.target.value as never)}>
            <option value="extraction">extraction</option>
            <option value="answer">answer</option>
            <option value="topic_routing">topic_routing</option>
          </select>
          <Textarea rows={8} placeholder="Conteúdo do prompt" value={content} onChange={(e) => setContent(e.target.value)} />
          <Button onClick={add}>Adicionar</Button>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-base">Templates</CardTitle></CardHeader>
        <CardContent>
          <div className="space-y-3">
            {(data ?? []).map((t) => (
              <details key={t.id} className="rounded border p-3">
                <summary className="cursor-pointer text-sm font-medium">
                  {t.name} <Badge variant="outline" className="ml-2">{t.type}</Badge> <span className="text-xs text-muted-foreground">v{t.version}</span>
                </summary>
                <pre className="mt-2 whitespace-pre-wrap text-xs">{t.content}</pre>
              </details>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function Models() {
  const qc = useQueryClient();
  const [provider, setProvider] = useState("lovable_ai");
  const [modelName, setModelName] = useState("google/gemini-3-flash-preview");
  const [temperature, setTemperature] = useState("0.2");
  const [maxTokens, setMaxTokens] = useState("4096");

  const { data } = useQuery({
    queryKey: ["model_configurations"],
    queryFn: async () => {
      const { data, error } = await supabase.from("model_configurations").select("*").order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  async function add() {
    const { error } = await supabase.from("model_configurations").insert({
      provider, model_name: modelName, temperature: Number(temperature), max_tokens: Number(maxTokens), active: false,
    });
    if (error) toast.error(error.message);
    else qc.invalidateQueries({ queryKey: ["model_configurations"] });
  }

  async function activate(id: string) {
    await supabase.from("model_configurations").update({ active: false }).neq("id", "00000000-0000-0000-0000-000000000000");
    await supabase.from("model_configurations").update({ active: true }).eq("id", id);
    qc.invalidateQueries({ queryKey: ["model_configurations"] });
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader><CardTitle className="text-base">Nova configuração</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-2 gap-2">
          <Input placeholder="provider" value={provider} onChange={(e) => setProvider(e.target.value)} />
          <Input placeholder="model_name" value={modelName} onChange={(e) => setModelName(e.target.value)} />
          <Input placeholder="temperature" type="number" step="0.1" value={temperature} onChange={(e) => setTemperature(e.target.value)} />
          <Input placeholder="max_tokens" type="number" value={maxTokens} onChange={(e) => setMaxTokens(e.target.value)} />
          <div className="col-span-2"><Button onClick={add}>Adicionar</Button></div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-base">Modelos</CardTitle></CardHeader>
        <CardContent>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th className="py-2 pr-3">Provider</th>
                <th className="py-2 pr-3">Modelo</th>
                <th className="py-2 pr-3">Temp</th>
                <th className="py-2 pr-3">Max</th>
                <th className="py-2 pr-3">Ativo</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {(data ?? []).map((m) => (
                <tr key={m.id} className="border-b last:border-0">
                  <td className="py-2 pr-3">{m.provider}</td>
                  <td className="py-2 pr-3 font-mono text-xs">{m.model_name}</td>
                  <td className="py-2 pr-3">{Number(m.temperature)}</td>
                  <td className="py-2 pr-3">{m.max_tokens}</td>
                  <td className="py-2 pr-3">{m.active ? <Badge>ativo</Badge> : <Badge variant="outline">—</Badge>}</td>
                  <td className="py-2 pr-3 text-right">
                    {!m.active && <Button size="sm" variant="outline" onClick={() => activate(m.id)}>Ativar</Button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}

function LLMCalls() {
  const { data } = useQuery({
    queryKey: ["llm_calls"],
    queryFn: async () => {
      const { data, error } = await supabase.from("llm_calls").select("*").order("created_at", { ascending: false }).limit(100);
      if (error) throw error;
      return data;
    },
  });

  const totalCost = (data ?? []).reduce((s, r) => s + Number(r.estimated_cost ?? 0), 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">LLM Calls (100 mais recentes)</CardTitle>
        <p className="text-xs text-muted-foreground">Custo acumulado nesta janela: ~${totalCost.toFixed(4)}</p>
      </CardHeader>
      <CardContent>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-xs text-muted-foreground">
              <th className="py-2 pr-3">Quando</th>
              <th className="py-2 pr-3">Tipo</th>
              <th className="py-2 pr-3">Modelo</th>
              <th className="py-2 pr-3">In</th>
              <th className="py-2 pr-3">Out</th>
              <th className="py-2 pr-3">ms</th>
              <th className="py-2 pr-3">Custo</th>
            </tr>
          </thead>
          <tbody>
            {(data ?? []).map((r) => (
              <tr key={r.id} className="border-b last:border-0">
                <td className="py-2 pr-3 text-xs">{new Date(r.created_at).toLocaleString()}</td>
                <td className="py-2 pr-3 text-xs font-mono">{r.prompt_type}</td>
                <td className="py-2 pr-3 text-xs font-mono">{r.model_name}</td>
                <td className="py-2 pr-3 text-xs">{r.input_tokens ?? "—"}</td>
                <td className="py-2 pr-3 text-xs">{r.output_tokens ?? "—"}</td>
                <td className="py-2 pr-3 text-xs">{r.latency ?? "—"}</td>
                <td className="py-2 pr-3 text-xs">${Number(r.estimated_cost ?? 0).toFixed(5)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}
