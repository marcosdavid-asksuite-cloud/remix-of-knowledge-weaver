import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";


export function ExtractionSettingsTab() {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ["extraction_settings"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("extraction_settings").select("*").eq("singleton", true).maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const [chunkSize, setChunkSize] = useState("");
  const [maxChunks, setMaxChunks] = useState("");
  const [temperature, setTemperature] = useState("");
  const [unifiedPrompt, setUnifiedPrompt] = useState("");
  const [useLlmForDynamic, setUseLlmForDynamic] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!data) return;
    setChunkSize(String(data.chunk_size));
    setMaxChunks(String(data.max_chunks));
    setTemperature(String(data.temperature));
    const d = data as typeof data & { unified_prompt?: string | null; use_llm_for_dynamic?: boolean };
    setUnifiedPrompt(
      d.unified_prompt && d.unified_prompt.trim().length > 0
        ? d.unified_prompt
        : `${data.system_prompt ?? ""}\n\n${data.extraction_prompt ?? ""}`.trim(),
    );
    setUseLlmForDynamic(d.use_llm_for_dynamic ?? true);
  }, [data]);

  async function save() {
    if (!data) return;
    setSaving(true);
    const { error } = await supabase.from("extraction_settings").update({
      chunk_size: Number(chunkSize),
      max_chunks: Number(maxChunks),
      temperature: Number(temperature),
      unified_prompt: unifiedPrompt,
      use_llm_for_dynamic: useLlmForDynamic,
      updated_at: new Date().toISOString(),
    } as never).eq("id", data.id);
    setSaving(false);
    if (error) toast.error(error.message);
    else {
      toast.success("Configuração salva");
      qc.invalidateQueries({ queryKey: ["extraction_settings"] });
    }
  }


  if (!data) return <p className="text-sm text-muted-foreground">Carregando…</p>;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Modelo LLM</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            O modelo, provider e temperatura usados na extração são os mesmos configurados em{" "}
            <strong>Settings → LLM Config</strong>. Ajuste-os por lá — vale tanto para a extração
            quanto para a aba <strong>Compare Responses</strong>.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Parâmetros</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-3 gap-3">
          <div>
            <Label>Chunk size (chars)</Label>
            <Input type="number" value={chunkSize} onChange={(e) => setChunkSize(e.target.value)} />
          </div>
          <div>
            <Label>Max chunks por execução</Label>
            <Input type="number" value={maxChunks} onChange={(e) => setMaxChunks(e.target.value)} />
          </div>
          <div>
            <Label>Temperature (fallback)</Label>
            <Input type="number" step="0.05" value={temperature} onChange={(e) => setTemperature(e.target.value)} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">LLM usage</CardTitle>
        </CardHeader>
        <CardContent>
          <label className="flex items-start gap-3 text-sm">
            <Switch checked={useLlmForDynamic} onCheckedChange={setUseLlmForDynamic} />
            <span>
              <span className="font-medium">Use LLM for dynamic fields and additional information</span>
              <span className="block text-xs text-muted-foreground">
                Quando desligado, a extração tenta resolver tudo via regex/keyword. A LLM só é chamada
                para data points não resolvidos cuja estratégia explicitamente exige LLM (hybrid/llm).
              </span>
            </span>
          </label>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Prompt de extração (unificado)</CardTitle>
          <p className="text-xs text-muted-foreground">
            Prompt único enviado à LLM para extrair os data points. Inclua tanto as instruções gerais
            (papel do agente, regras de plausibilidade, formato de saída) quanto o template por
            tópico/chunk. Variáveis disponíveis:{" "}
            <code className="font-mono">{`{{topic_slug}}`}</code>,{" "}
            <code className="font-mono">{`{{topic_name}}`}</code>,{" "}
            <code className="font-mono">{`{{topic_description}}`}</code>,{" "}
            <code className="font-mono">{`{{data_points}}`}</code>,{" "}
            <code className="font-mono">{`{{chunk}}`}</code>.
          </p>
        </CardHeader>
        <CardContent>
          <Textarea
            rows={22}
            className="font-mono text-xs"
            value={unifiedPrompt}
            onChange={(e) => setUnifiedPrompt(e.target.value)}
          />
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button onClick={save} disabled={saving}>{saving ? "Salvando…" : "Salvar"}</Button>
      </div>
    </div>
  );
}
