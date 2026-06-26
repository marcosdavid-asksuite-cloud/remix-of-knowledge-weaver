import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { TOPIC_CORE_SCHEMAS } from "@/lib/topic-core-schemas";

export function TopicsTab({ projectId }: { projectId: string }) {
  const qc = useQueryClient();

  const { data: defs } = useQuery({
    queryKey: ["topic_definitions"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("topic_definitions").select("*").order("name");
      if (error) throw error;
      return data;
    },
  });

  const { data: active } = useQuery({
    queryKey: ["topics", projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("topics").select("*").eq("project_id", projectId);
      if (error) throw error;
      return data;
    },
  });

  const activeMap = new Map<string, string>(); // defId -> topicId
  for (const t of active ?? []) activeMap.set(t.topic_definition_id, t.id);

  async function toggle(defId: string, checked: boolean) {
    if (checked) {
      const { error } = await supabase.from("topics").insert({ project_id: projectId, topic_definition_id: defId });
      if (error) { toast.error(error.message); return; }
    } else {
      const topicId = activeMap.get(defId);
      if (!topicId) return;
      if (!confirm("Desativar este tópico vai apagar os campos e infos associados. Continuar?")) return;
      const { error } = await supabase.from("topics").delete().eq("id", topicId);
      if (error) { toast.error(error.message); return; }
    }
    qc.invalidateQueries({ queryKey: ["topics", projectId] });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Tópicos ativos no projeto</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid gap-3 sm:grid-cols-2">
          {(defs ?? []).map((d) => {
            const isActive = activeMap.has(d.id);
            const coreCount = (TOPIC_CORE_SCHEMAS[d.slug] ?? []).length;
            return (
              <label key={d.id} className="flex items-start gap-3 rounded-md border p-3">
                <Checkbox
                  checked={isActive}
                  onCheckedChange={(v) => toggle(d.id, Boolean(v))}
                  className="mt-1"
                />
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{d.name}</span>
                    <Badge variant="outline" className="font-mono text-[10px]">{d.slug}</Badge>
                    {coreCount > 0 && <Badge variant="secondary" className="text-[10px]">{coreCount} core fields</Badge>}
                  </div>
                  <p className="text-xs text-muted-foreground">{d.description}</p>
                </div>
              </label>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
