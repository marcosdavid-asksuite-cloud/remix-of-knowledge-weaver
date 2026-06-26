import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { testExternalAgent } from "@/lib/external-agent.functions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { toast } from "sonner";

type Agent = {
  id: string;
  project_id: string | null;
  name: string;
  endpoint: string;
  auth_type: string;
  auth_header_name: string | null;
  api_key: string | null;
  custom_headers: Record<string, string> | null;
  model: string | null;
  temperature: number | null;
  timeout_ms: number | null;
  payload_template: unknown;
  response_path: string | null;
  context_options: { structured?: boolean; additional?: boolean; raw_chunks?: boolean; dynamic?: boolean; source_metadata?: boolean; topic_metadata?: boolean } | null;
  active: boolean;
  created_at: string;
};

const emptyForm: Partial<Agent> = {
  name: "",
  endpoint: "https://api.openai.com/v1/chat/completions",
  auth_type: "bearer",
  api_key: "",
  model: "gpt-4o-mini",
  temperature: 0.2,
  timeout_ms: 30000,
  response_path: "choices.0.message.content",
  context_options: { structured: true, additional: true, raw_chunks: false, dynamic: true, source_metadata: false, topic_metadata: true },
  custom_headers: {},
  active: true,
};

export function ExternalAgentTab({ projectId }: { projectId: string }) {
  const qc = useQueryClient();
  const runTest = useServerFn(testExternalAgent);
  const [form, setForm] = useState<Partial<Agent>>(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [headersText, setHeadersText] = useState("{}");
  const [payloadText, setPayloadText] = useState("");

  const { data: agents } = useQuery({
    queryKey: ["external-agents", projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("external_agents")
        .select("*")
        .or(`project_id.eq.${projectId},project_id.is.null`)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as Agent[];
    },
  });

  const { data: history } = useQuery({
    queryKey: ["external-agent-history", projectId],
    queryFn: async () => {
      const { data } = await supabase
        .from("test_runs")
        .select("id, external_agent_id, created_at, model_name, estimated_cost, mode, test_batch_id")
        .eq("project_id", projectId)
        .not("external_agent_id", "is", null)
        .order("created_at", { ascending: false })
        .limit(200);
      return data ?? [];
    },
  });

  const saveMut = useMutation({
    mutationFn: async () => {
      let custom_headers: Record<string, string> = {};
      try { custom_headers = JSON.parse(headersText || "{}"); }
      catch { throw new Error("Custom headers JSON inválido"); }
      let payload_template: unknown = null;
      if (payloadText.trim()) {
        try { payload_template = JSON.parse(payloadText); }
        catch { throw new Error("Payload template JSON inválido"); }
      }
      const row = {
        project_id: projectId,
        name: form.name ?? "",
        endpoint: form.endpoint ?? "",
        auth_type: form.auth_type ?? "bearer",
        auth_header_name: form.auth_header_name ?? null,
        api_key: form.api_key ?? null,
        custom_headers,
        model: form.model ?? null,
        temperature: form.temperature ?? 0.2,
        timeout_ms: form.timeout_ms ?? 30000,
        payload_template,
        response_path: form.response_path ?? "choices.0.message.content",
        context_options: form.context_options ?? {},
        active: form.active ?? true,
      };
      if (editingId) {
        const { error } = await supabase.from("external_agents").update(row as never).eq("id", editingId);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("external_agents").insert(row as never);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success("Agente salvo.");
      setForm(emptyForm); setEditingId(null); setHeadersText("{}"); setPayloadText("");
      qc.invalidateQueries({ queryKey: ["external-agents", projectId] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Falha ao salvar"),
  });

  const deleteMut = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("external_agents").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["external-agents", projectId] }); toast.success("Removido."); },
  });

  const testMut = useMutation({
    mutationFn: async (id: string) => await runTest({ data: { agentId: id } }),
    onSuccess: (r) => toast.success(`OK em ${r.latency}ms — ${r.content.slice(0, 80)}`),
    onError: (e) => toast.error(e instanceof Error ? e.message : "Falha no teste"),
  });

  function startEdit(a: Agent) {
    setEditingId(a.id);
    setForm(a);
    setHeadersText(JSON.stringify(a.custom_headers ?? {}, null, 2));
    setPayloadText(a.payload_template ? JSON.stringify(a.payload_template, null, 2) : "");
  }

  function toggleCtx(key: keyof NonNullable<Agent["context_options"]>) {
    setForm((f) => ({ ...f, context_options: { ...(f.context_options ?? {}), [key]: !(f.context_options ?? {})[key] } }));
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>{editingId ? "Editar agente externo" : "Novo agente externo"}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <Label>Nome</Label>
              <Input value={form.name ?? ""} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div>
              <Label>Endpoint</Label>
              <Input value={form.endpoint ?? ""} onChange={(e) => setForm({ ...form, endpoint: e.target.value })} />
            </div>
            <div>
              <Label>Auth type</Label>
              <Select value={form.auth_type ?? "bearer"} onValueChange={(v) => setForm({ ...form, auth_type: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="bearer">Bearer (Authorization)</SelectItem>
                  <SelectItem value="header">Header customizado</SelectItem>
                  <SelectItem value="none">Nenhuma</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {form.auth_type === "header" && (
              <div>
                <Label>Nome do header</Label>
                <Input value={form.auth_header_name ?? ""} onChange={(e) => setForm({ ...form, auth_header_name: e.target.value })} placeholder="x-api-key" />
              </div>
            )}
            <div>
              <Label>API Key</Label>
              <Input type="password" value={form.api_key ?? ""} onChange={(e) => setForm({ ...form, api_key: e.target.value })} />
            </div>
            <div>
              <Label>Model</Label>
              <Input value={form.model ?? ""} onChange={(e) => setForm({ ...form, model: e.target.value })} />
            </div>
            <div>
              <Label>Temperature</Label>
              <Input type="number" step="0.1" value={String(form.temperature ?? 0.2)} onChange={(e) => setForm({ ...form, temperature: Number(e.target.value) })} />
            </div>
            <div>
              <Label>Timeout (ms)</Label>
              <Input type="number" value={String(form.timeout_ms ?? 30000)} onChange={(e) => setForm({ ...form, timeout_ms: Number(e.target.value) })} />
            </div>
            <div className="md:col-span-2">
              <Label>Response path (dot-path para extrair a resposta)</Label>
              <Input value={form.response_path ?? ""} onChange={(e) => setForm({ ...form, response_path: e.target.value })} placeholder="choices.0.message.content" />
            </div>
          </div>

          <div>
            <Label>Custom headers (JSON)</Label>
            <Textarea rows={3} value={headersText} onChange={(e) => setHeadersText(e.target.value)} />
          </div>

          <div>
            <Label>Payload template (opcional, JSON com {`{{question}} {{context}} {{system}} {{model}}`})</Label>
            <Textarea rows={5} value={payloadText} onChange={(e) => setPayloadText(e.target.value)}
              placeholder='Deixe vazio para usar o formato OpenAI Chat Completions padrão.' />
          </div>

          <div>
            <Label className="mb-2 block">Context Builder (o que enviar)</Label>
            <div className="flex flex-wrap gap-4 text-sm">
              {([
                ["structured", "Structured Knowledge"],
                ["additional", "Additional Information"],
                ["raw_chunks", "Raw Chunks"],
                ["dynamic", "Dynamic Fields"],
                ["source_metadata", "Source Metadata"],
                ["topic_metadata", "Topic Metadata"],
              ] as const).map(([k, label]) => (
                <label key={k} className="flex items-center gap-2">
                  <Checkbox checked={(form.context_options ?? {})[k] ?? false} onCheckedChange={() => toggleCtx(k)} />
                  {label}
                </label>
              ))}
            </div>
          </div>

          <div className="flex gap-2">
            <Button onClick={() => saveMut.mutate()} disabled={saveMut.isPending}>
              {editingId ? "Atualizar" : "Criar"} agente
            </Button>
            {editingId && (
              <Button variant="outline" onClick={() => { setEditingId(null); setForm(emptyForm); setHeadersText("{}"); setPayloadText(""); }}>
                Cancelar
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Agentes cadastrados</CardTitle></CardHeader>
        <CardContent>
          {(agents ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum agente. Crie um acima.</p>
          ) : (
            <ul className="space-y-2">
              {(agents ?? []).map((a) => (
                <li key={a.id} className="flex items-center justify-between rounded border p-3">
                  <div>
                    <div className="font-medium">{a.name} {a.active ? <Badge variant="secondary">ativo</Badge> : <Badge variant="outline">inativo</Badge>}</div>
                    <div className="text-xs text-muted-foreground">{a.model ?? "?"} • {a.endpoint}</div>
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => testMut.mutate(a.id)} disabled={testMut.isPending}>Test</Button>
                    <Button size="sm" variant="outline" onClick={() => startEdit(a)}>Editar</Button>
                    <Button size="sm" variant="destructive" onClick={() => deleteMut.mutate(a.id)}>Remover</Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Histórico de chamadas</CardTitle></CardHeader>
        <CardContent>
          {(history ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhuma execução com agente externo ainda. Rode um benchmark no modo <code>external_agent</code>.</p>
          ) : (
            <ul className="text-sm space-y-1">
              {(history ?? []).slice(0, 30).map((r) => (
                <li key={r.id} className="flex items-center justify-between border-b py-1">
                  <div>
                    <span className="text-muted-foreground">{new Date(r.created_at).toLocaleString("pt-BR")}</span>{" "}
                    — {r.model_name}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">US$ {Number(r.estimated_cost ?? 0).toFixed(6)}</span>
                    <RequestViewer runId={r.id} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function RequestViewer({ runId }: { runId: string }) {
  const [open, setOpen] = useState(false);
  const { data: run } = useQuery({
    enabled: open,
    queryKey: ["test-run-detail", runId],
    queryFn: async () => {
      const { data } = await supabase.from("test_runs").select("*").eq("id", runId).maybeSingle();
      return data;
    },
  });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="ghost">View</Button>
      </DialogTrigger>
      <DialogContent className="max-w-3xl">
        <DialogHeader><DialogTitle>Test Run</DialogTitle></DialogHeader>
        {!run ? <p>Carregando...</p> : (
          <div className="space-y-3 text-sm">
            <div><b>Latência:</b> {run.latency_ms}ms • <b>Tokens:</b> {run.input_tokens}/{run.output_tokens}</div>
            <div>
              <b>Request payload:</b>
              <pre className="mt-1 max-h-48 overflow-auto rounded bg-muted p-2 text-xs">{JSON.stringify(run.request_payload ?? "—", null, 2)}</pre>
            </div>
            <div>
              <b>Contexto enviado:</b>
              <pre className="mt-1 max-h-48 overflow-auto rounded bg-muted p-2 text-xs">{JSON.stringify(run.context_sent ?? "—", null, 2)}</pre>
            </div>
            <div>
              <b>Resposta:</b>
              <pre className="mt-1 max-h-48 overflow-auto rounded bg-muted p-2 text-xs whitespace-pre-wrap">{run.answer ?? "—"}</pre>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
