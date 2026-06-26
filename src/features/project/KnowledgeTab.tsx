import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

type TopicRow = {
  id: string;
  topic_definitions: { slug: string; name: string } | null;
};
type Field = {
  id: string;
  topic_id: string;
  field_name: string;
  field_type: string;
  field_value: unknown;
  field_origin: string;
  confidence: number | null;
  verified: boolean;
};
type Addl = { id: string; topic_id: string; content: string };

export function KnowledgeTab({ projectId }: { projectId: string }) {
  const qc = useQueryClient();

  const { data: topics } = useQuery({
    queryKey: ["topics_kn", projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("topics").select("id, topic_definitions(slug, name)").eq("project_id", projectId);
      if (error) throw error;
      return (data ?? []) as unknown as TopicRow[];
    },
  });

  const topicIds = (topics ?? []).map((t) => t.id);

  const { data: fields } = useQuery({
    queryKey: ["knowledge_fields", projectId, topicIds.join(",")],
    enabled: topicIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("knowledge_fields").select("*").in("topic_id", topicIds).order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Field[];
    },
  });

  const { data: addls } = useQuery({
    queryKey: ["additional_info", projectId, topicIds.join(",")],
    enabled: topicIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("additional_info").select("*").in("topic_id", topicIds).order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Addl[];
    },
  });

  function refresh() {
    qc.invalidateQueries({ queryKey: ["knowledge_fields", projectId] });
    qc.invalidateQueries({ queryKey: ["additional_info", projectId] });
  }

  if (!topics || topics.length === 0) {
    return <p className="text-sm text-muted-foreground">Ative tópicos na aba Topics primeiro.</p>;
  }

  return (
    <div className="space-y-6">
      {topics.map((t) => {
        const tFields = (fields ?? []).filter((f) => f.topic_id === t.id);
        const tAddl = (addls ?? []).filter((a) => a.topic_id === t.id);
        return (
          <Card key={t.id}>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                {t.topic_definitions?.name ?? "?"}
                <Badge variant="outline" className="font-mono text-[10px]">{t.topic_definitions?.slug}</Badge>
                <Badge variant="secondary" className="text-[10px]">{tFields.length} fields</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {tFields.length === 0 ? (
                <p className="text-sm text-muted-foreground">Sem campos extraídos.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left text-xs text-muted-foreground">
                        <th className="py-2 pr-3">Campo</th>
                        <th className="py-2 pr-3">Tipo</th>
                        <th className="py-2 pr-3">Valor</th>
                        <th className="py-2 pr-3">Origem</th>
                        <th className="py-2 pr-3">Conf.</th>
                        <th className="py-2 pr-3">Verificado</th>
                        <th className="py-2 pr-3"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {tFields.map((f) => (
                        <FieldRow key={f.id} field={f} onChange={refresh} />
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <div>
                <div className="mb-2 text-xs font-semibold text-muted-foreground">Informações adicionais</div>
                {tAddl.length === 0 ? (
                  <p className="text-sm text-muted-foreground">—</p>
                ) : (
                  <ul className="space-y-2">
                    {tAddl.map((a) => (
                      <li key={a.id} className="flex items-start justify-between gap-3 rounded border p-2 text-sm">
                        <span>{a.content}</span>
                        <Button size="sm" variant="ghost" onClick={async () => {
                          await supabase.from("additional_info").delete().eq("id", a.id);
                          refresh();
                        }}>×</Button>
                      </li>
                    ))}
                  </ul>
                )}
                <AddAdditional topicId={t.id} onAdded={refresh} />
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

function FieldRow({ field, onChange }: { field: Field; onChange: () => void }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(
    typeof field.field_value === "string" ? field.field_value : JSON.stringify(field.field_value ?? ""),
  );

  async function save() {
    let parsed: unknown = val;
    try { parsed = JSON.parse(val); } catch { /* keep as string */ }
    const { error } = await supabase.from("knowledge_fields").update({ field_value: parsed as never }).eq("id", field.id);
    if (error) toast.error(error.message);
    else { toast.success("Salvo"); setEditing(false); onChange(); }
  }

  async function toggleVerified() {
    const { error } = await supabase.from("knowledge_fields").update({ verified: !field.verified }).eq("id", field.id);
    if (error) toast.error(error.message); else onChange();
  }

  async function remove() {
    if (!confirm("Apagar campo?")) return;
    const { error } = await supabase.from("knowledge_fields").delete().eq("id", field.id);
    if (error) toast.error(error.message); else onChange();
  }

  return (
    <tr className="border-b last:border-0">
      <td className="py-2 pr-3 font-mono text-xs">{field.field_name}</td>
      <td className="py-2 pr-3 text-xs text-muted-foreground">{field.field_type}</td>
      <td className="py-2 pr-3">
        {editing ? (
          <Input value={val} onChange={(e) => setVal(e.target.value)} className="h-7 text-xs" />
        ) : (
          <span className="font-mono text-xs">
            {typeof field.field_value === "object" ? JSON.stringify(field.field_value) : String(field.field_value ?? "—")}
          </span>
        )}
      </td>
      <td className="py-2 pr-3">
        <Badge variant={field.field_origin === "core" ? "default" : "outline"} className="text-[10px]">{field.field_origin}</Badge>
      </td>
      <td className="py-2 pr-3 text-xs">{field.confidence != null ? field.confidence.toFixed(2) : "—"}</td>
      <td className="py-2 pr-3">
        <input type="checkbox" checked={field.verified} onChange={toggleVerified} />
      </td>
      <td className="py-2 pr-3 text-right whitespace-nowrap">
        {editing ? (
          <>
            <Button size="sm" variant="ghost" onClick={save}>Salvar</Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>×</Button>
          </>
        ) : (
          <>
            <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>Editar</Button>
            <Button size="sm" variant="ghost" onClick={remove}>Apagar</Button>
          </>
        )}
      </td>
    </tr>
  );
}

function AddAdditional({ topicId, onAdded }: { topicId: string; onAdded: () => void }) {
  const [text, setText] = useState("");
  return (
    <div className="mt-2 flex items-start gap-2">
      <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} placeholder="Adicionar informação..." className="text-sm" />
      <Button size="sm" onClick={async () => {
        if (!text.trim()) return;
        const { error } = await supabase.from("additional_info").insert({ topic_id: topicId, content: text.trim() });
        if (error) toast.error(error.message);
        else { setText(""); onAdded(); }
      }}>+</Button>
    </div>
  );
}
