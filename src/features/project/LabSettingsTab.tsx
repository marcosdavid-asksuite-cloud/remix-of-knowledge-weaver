import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

type LabSettings = {
  regex_enabled: boolean;
  keyword_enabled: boolean;
  llm_enabled: boolean;
  dynamic_fields_enabled: boolean;
  additional_info_enabled: boolean;
  schema_evolution_enabled: boolean;
  health_score_enabled: boolean;
  consolidation_enabled: boolean;
  prompt_version: string;
  model_version: string;
  chunk_size: number;
  top_chunks: number;
};

const DEFAULTS: LabSettings = {
  regex_enabled: true, keyword_enabled: true, llm_enabled: true,
  dynamic_fields_enabled: true, additional_info_enabled: true,
  schema_evolution_enabled: true, health_score_enabled: true,
  consolidation_enabled: true,
  prompt_version: "v1", model_version: "google/gemini-3-flash-preview",
  chunk_size: 800, top_chunks: 20,
};

export function LabSettingsTab({ projectId }: { projectId: string }) {
  const qc = useQueryClient();
  const [s, setS] = useState<LabSettings>(DEFAULTS);

  const { data: row } = useQuery({
    queryKey: ["lab-settings", projectId],
    queryFn: async () => {
      const { data } = await supabase.from("lab_settings").select("*").eq("project_id", projectId).maybeSingle();
      return data;
    },
  });

  useEffect(() => {
    if (row?.settings) setS({ ...DEFAULTS, ...(row.settings as Partial<LabSettings>) });
  }, [row]);

  const saveMut = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("lab_settings")
        .upsert({ project_id: projectId, settings: s as never }, { onConflict: "project_id" });
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Configurações salvas."); qc.invalidateQueries({ queryKey: ["lab-settings", projectId] }); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Falha"),
  });

  function toggle(key: keyof LabSettings) {
    setS((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  const toggles: Array<[keyof LabSettings, string]> = [
    ["regex_enabled", "Regex extraction"],
    ["keyword_enabled", "Keyword extraction"],
    ["llm_enabled", "LLM extraction"],
    ["dynamic_fields_enabled", "Dynamic fields"],
    ["additional_info_enabled", "Additional information"],
    ["schema_evolution_enabled", "Schema evolution"],
    ["health_score_enabled", "Health score"],
    ["consolidation_enabled", "Consolidation"],
  ];

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Lab Settings</CardTitle>
          <p className="text-sm text-muted-foreground">
            Ligue/desligue componentes do pipeline para reproduzir experimentos.
            Essas flags são lidas pelas rotinas que respeitam <code>lab_settings</code>.
          </p>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid gap-3 md:grid-cols-2">
            {toggles.map(([key, label]) => (
              <div key={key} className="flex items-center justify-between rounded border p-3">
                <Label>{label}</Label>
                <Switch checked={Boolean(s[key])} onCheckedChange={() => toggle(key)} />
              </div>
            ))}
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <Label>Prompt version</Label>
              <Input value={s.prompt_version} onChange={(e) => setS({ ...s, prompt_version: e.target.value })} />
            </div>
            <div>
              <Label>Model version</Label>
              <Input value={s.model_version} onChange={(e) => setS({ ...s, model_version: e.target.value })} />
            </div>
            <div>
              <Label>Chunk size</Label>
              <Input type="number" value={s.chunk_size} onChange={(e) => setS({ ...s, chunk_size: Number(e.target.value) })} />
            </div>
            <div>
              <Label>Top chunks</Label>
              <Input type="number" value={s.top_chunks} onChange={(e) => setS({ ...s, top_chunks: Number(e.target.value) })} />
            </div>
          </div>

          <Button onClick={() => saveMut.mutate()} disabled={saveMut.isPending}>
            Salvar
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
