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
  const [systemPrompt, setSystemPrompt] = useState("");
  const [extractionPrompt, setExtractionPrompt] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!data) return;
    setChunkSize(String(data.chunk_size));
    setMaxChunks(String(data.max_chunks));
    setTemperature(String(data.temperature));
    setSystemPrompt(data.system_prompt);
    setExtractionPrompt(data.extraction_prompt);
  }, [data]);

  async function save() {
    if (!data) return;
    setSaving(true);
    const { error } = await supabase.from("extraction_settings").update({
      chunk_size: Number(chunkSize),
      max_chunks: Number(maxChunks),
      temperature: Number(temperature),
      system_prompt: systemPrompt,
      extraction_prompt: extractionPrompt,
      updated_at: new Date().toISOString(),
    }).eq("id", data.id);
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
            <Label>Temperature</Label>
            <Input type="number" step="0.05" value={temperature} onChange={(e) => setTemperature(e.target.value)} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">System prompt</CardTitle>
        </CardHeader>
        <CardContent>
          <Textarea rows={6} value={systemPrompt} onChange={(e) => setSystemPrompt(e.target.value)} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Extraction prompt</CardTitle>
          <p className="text-xs text-muted-foreground">
            Variáveis disponíveis: <code className="font-mono">{`{{topic_slug}}`}</code>,{" "}
            <code className="font-mono">{`{{topic_name}}`}</code>,{" "}
            <code className="font-mono">{`{{topic_description}}`}</code>,{" "}
            <code className="font-mono">{`{{data_points}}`}</code>,{" "}
            <code className="font-mono">{`{{chunk}}`}</code>.
          </p>
        </CardHeader>
        <CardContent>
          <Textarea rows={14} className="font-mono text-xs" value={extractionPrompt} onChange={(e) => setExtractionPrompt(e.target.value)} />
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button onClick={save} disabled={saving}>{saving ? "Salvando…" : "Salvar"}</Button>
      </div>
    </div>
  );
}
