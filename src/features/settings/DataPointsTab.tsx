import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Plus, Pencil, Trash2 } from "lucide-react";

const FIELD_TYPES = [
  "text",
  "boolean",
  "number",
  "currency",
  "time",
  "time_range",
  "enum",
  "multi_select",
] as const;
type FieldType = (typeof FIELD_TYPES)[number];

const STRATEGIES = ["regex", "keyword", "hybrid", "llm"] as const;
type Strategy = (typeof STRATEGIES)[number];

type Dpd = {
  id: string;
  topic_definition_id: string;
  field_name: string;
  field_label: string;
  field_type: FieldType;
  description: string | null;
  required: boolean;
  active: boolean;
  extraction_strategy: Strategy;
  regex_pattern: string | null;
  keywords: unknown;
  negative_keywords: unknown;
};

const TOPIC_EMOJI: Record<string, string> = {
  breakfast: "☕",
  checkin: "🛎️",
  checkout: "🧳",
  parking: "🚗",
  restaurant: "🍽",
  pool: "🏊",
  gym: "🏋️",
  pets: "🐶",
  transfer: "🚐",
  amenities: "✨",
  rooms: "🛏",
  wifi: "📶",
};

export function DataPointsTab() {
  const qc = useQueryClient();
  const [selectedTopicId, setSelectedTopicId] = useState<string | null>(null);

  const { data: topics } = useQuery({
    queryKey: ["topic_definitions"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("topic_definitions")
        .select("*")
        .order("name");
      if (error) throw error;
      return data;
    },
  });

  const { data: dps } = useQuery({
    queryKey: ["data_point_definitions"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("data_point_definitions")
        .select("*")
        .order("field_name");
      if (error) throw error;
      return data as Dpd[];
    },
  });

  const currentTopicId =
    selectedTopicId ?? topics?.[0]?.id ?? null;
  const currentTopic = topics?.find((t) => t.id === currentTopicId);
  const topicDps = (dps ?? []).filter(
    (d) => d.topic_definition_id === currentTopicId,
  );

  function refresh() {
    qc.invalidateQueries({ queryKey: ["data_point_definitions"] });
  }

  return (
    <div className="grid gap-4 md:grid-cols-[260px_1fr]">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Tópicos</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1">
          {(topics ?? []).map((t) => {
            const count = (dps ?? []).filter(
              (d) => d.topic_definition_id === t.id,
            ).length;
            const active = t.id === currentTopicId;
            return (
              <button
                key={t.id}
                onClick={() => setSelectedTopicId(t.id)}
                className={`flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm transition-colors ${
                  active ? "bg-accent text-accent-foreground" : "hover:bg-muted"
                }`}
              >
                <span className="flex items-center gap-2">
                  <span>{TOPIC_EMOJI[t.slug] ?? "📁"}</span>
                  <span>{t.name}</span>
                </span>
                <Badge variant="outline" className="text-[10px]">
                  {count}
                </Badge>
              </button>
            );
          })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-base">
              {currentTopic
                ? `Data Points · ${currentTopic.name}`
                : "Data Points"}
            </CardTitle>
            {currentTopic && (
              <p className="mt-1 font-mono text-xs text-muted-foreground">
                {currentTopic.slug}
              </p>
            )}
          </div>
          {currentTopicId && (
            <EditDialog
              topicId={currentTopicId}
              onSaved={refresh}
              trigger={
                <Button size="sm">
                  <Plus className="size-4" /> Novo
                </Button>
              }
            />
          )}
        </CardHeader>
        <CardContent>
          {topicDps.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nenhum data point neste tópico.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="py-2 pr-3">Label</th>
                  <th className="py-2 pr-3">Field</th>
                  <th className="py-2 pr-3">Type</th>
                  <th className="py-2 pr-3">Strategy</th>
                  <th className="py-2 pr-3">Required</th>
                  <th className="py-2 pr-3">Active</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {topicDps.map((d) => (
                  <tr key={d.id} className="border-b last:border-0">
                    <td className="py-2 pr-3">{d.field_label}</td>
                    <td className="py-2 pr-3 font-mono text-xs">
                      {d.field_name}
                    </td>
                    <td className="py-2 pr-3">
                      <Badge variant="secondary" className="text-[10px]">
                        {d.field_type}
                      </Badge>
                    </td>
                    <td className="py-2 pr-3">
                      <Badge variant="outline" className="text-[10px]">
                        {d.extraction_strategy}
                      </Badge>
                    </td>
                    <td className="py-2 pr-3">
                      {d.required ? (
                        <Badge>req</Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="py-2 pr-3">
                      <Switch
                        checked={d.active}
                        onCheckedChange={async (v) => {
                          const { error } = await supabase
                            .from("data_point_definitions")
                            .update({ active: v })
                            .eq("id", d.id);
                          if (error) toast.error(error.message);
                          else refresh();
                        }}
                      />
                    </td>
                    <td className="py-2 pr-3 text-right">
                      <div className="flex justify-end gap-1">
                        <EditDialog
                          topicId={currentTopicId!}
                          existing={d}
                          onSaved={refresh}
                          trigger={
                            <Button size="icon" variant="ghost">
                              <Pencil className="size-4" />
                            </Button>
                          }
                        />
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={async () => {
                            if (!confirm(`Excluir "${d.field_name}"?`)) return;
                            const { error } = await supabase
                              .from("data_point_definitions")
                              .delete()
                              .eq("id", d.id);
                            if (error) toast.error(error.message);
                            else refresh();
                          }}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function EditDialog({
  topicId,
  existing,
  onSaved,
  trigger,
}: {
  topicId: string;
  existing?: Dpd;
  onSaved: () => void;
  trigger: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [fieldName, setFieldName] = useState(existing?.field_name ?? "");
  const [fieldLabel, setFieldLabel] = useState(existing?.field_label ?? "");
  const [fieldType, setFieldType] = useState<FieldType>(
    existing?.field_type ?? "text",
  );
  const [description, setDescription] = useState(existing?.description ?? "");
  const [required, setRequired] = useState(existing?.required ?? false);
  const [active, setActive] = useState(existing?.active ?? true);
  const [strategy, setStrategy] = useState<Strategy>(existing?.extraction_strategy ?? "llm");
  const [regexPattern, setRegexPattern] = useState(existing?.regex_pattern ?? "");
  const [keywordsJson, setKeywordsJson] = useState(
    existing?.keywords ? JSON.stringify(existing.keywords, null, 2) : "{}",
  );
  const [negativeJson, setNegativeJson] = useState(
    existing?.negative_keywords ? JSON.stringify(existing.negative_keywords, null, 2) : "[]",
  );
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!fieldName.trim() || !fieldLabel.trim()) {
      toast.error("Preencha field name e label");
      return;
    }
    let keywordsParsed: unknown = {};
    let negativeParsed: unknown = [];
    try { keywordsParsed = JSON.parse(keywordsJson || "{}"); }
    catch { toast.error("Keywords não é JSON válido"); return; }
    try { negativeParsed = JSON.parse(negativeJson || "[]"); }
    catch { toast.error("Negative keywords não é JSON válido"); return; }
    setSaving(true);
    const payload = {
      topic_definition_id: topicId,
      field_name: fieldName.trim(),
      field_label: fieldLabel.trim(),
      field_type: fieldType,
      description: description.trim() || null,
      required,
      active,
      extraction_strategy: strategy,
      regex_pattern: regexPattern.trim() || null,
      keywords: keywordsParsed,
      negative_keywords: negativeParsed,
    };
    const { error } = existing
      ? await supabase
          .from("data_point_definitions")
          .update(payload as never)
          .eq("id", existing.id)
      : await supabase.from("data_point_definitions").insert(payload as never);
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(existing ? "Atualizado" : "Criado");
    setOpen(false);
    onSaved();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {existing ? "Editar Data Point" : "Novo Data Point"}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Field name</Label>
            <Input
              placeholder="ex.: breakfast_price"
              value={fieldName}
              onChange={(e) => setFieldName(e.target.value)}
              className="font-mono"
            />
          </div>
          <div>
            <Label>Label</Label>
            <Input
              placeholder="ex.: Preço do café"
              value={fieldLabel}
              onChange={(e) => setFieldLabel(e.target.value)}
            />
          </div>
          <div>
            <Label>Tipo</Label>
            <select
              className="w-full rounded border bg-background p-2 text-sm"
              value={fieldType}
              onChange={(e) => setFieldType(e.target.value as FieldType)}
            >
              {FIELD_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label>Descrição</Label>
            <Textarea
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <div className="flex items-center gap-6">
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={required} onCheckedChange={setRequired} />
              Required
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={active} onCheckedChange={setActive} />
              Active
            </label>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancelar
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving ? "Salvando…" : "Salvar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
