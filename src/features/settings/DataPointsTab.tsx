import { useMemo, useRef, useState } from "react";
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
import { Plus, Pencil, Trash2, Upload } from "lucide-react";

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

// Default strategy for all new data points: keyword-first with LLM fallback.
// The fallback behavior is specified in the extraction prompt.
const DEFAULT_STRATEGY = "hybrid" as const;

type Dpd = {
  id: string;
  topic_definition_id: string;
  field_name: string;
  field_label: string;
  field_type: FieldType;
  description: string | null;
  required: boolean;
  active: boolean;
  extraction_strategy: string;
  regex_pattern: string | null;
  keywords: unknown;
  negative_keywords: unknown;
};

type TopicRow = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
};

type PreviewRow = {
  topic_slug: string;
  topic_name?: string;
  field_name: string;
  field_label: string;
  field_type: FieldType;
  description: string | null;
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
  const [preview, setPreview] = useState<PreviewRow[] | null>(null);
  const [previewTopicSlug, setPreviewTopicSlug] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const { data: topics } = useQuery({
    queryKey: ["topic_definitions"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("topic_definitions")
        .select("*")
        .order("name");
      if (error) throw error;
      return data as TopicRow[];
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

  const currentTopicId = selectedTopicId ?? topics?.[0]?.id ?? null;
  const currentTopic = topics?.find((t) => t.id === currentTopicId);
  const topicDps = (dps ?? []).filter(
    (d) => d.topic_definition_id === currentTopicId,
  );

  function refresh() {
    qc.invalidateQueries({ queryKey: ["data_point_definitions"] });
  }

  async function handleFile(file: File) {
    try {
      const text = await file.text();
      let rows: PreviewRow[] = [];
      if (file.name.toLowerCase().endsWith(".json")) {
        rows = parseJsonInput(text);
      } else {
        rows = parseCsvInput(text);
      }
      if (rows.length === 0) {
        toast.error("Nenhum campo válido encontrado no arquivo");
        return;
      }
      setPreview(rows);
      setPreviewTopicSlug(rows[0].topic_slug);
      toast.success(`${rows.length} campo(s) carregado(s) do arquivo`);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(`Falha ao ler arquivo: ${msg}`);
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function importPreview() {
    if (!preview || !topics) return;
    setImporting(true);
    const topicBySlug = new Map(topics.map((t) => [t.slug, t] as const));
    const topicByName = new Map(topics.map((t) => [t.name.toLowerCase(), t] as const));
    const payload = preview
      .map((r) => {
        const topic =
          topicBySlug.get(r.topic_slug) ??
          (r.topic_name ? topicByName.get(r.topic_name.toLowerCase()) : undefined);
        if (!topic) return null;
        return {
          topic_definition_id: topic.id,
          field_name: r.field_name,
          field_label: r.field_label,
          field_type: r.field_type,
          description: r.description,
          required: false,
          active: true,
          extraction_strategy: DEFAULT_STRATEGY,
          regex_pattern: null,
          keywords: {},
          negative_keywords: [],
        };
      })
      .filter(Boolean) as Array<Record<string, unknown>>;

    if (payload.length === 0) {
      setImporting(false);
      toast.error("Nenhum tópico correspondente encontrado para os campos importados");
      return;
    }

    const skipped = preview.length - payload.length;
    const { error } = await supabase
      .from("data_point_definitions")
      .insert(payload as never);
    setImporting(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(
      `Importados ${payload.length} campo(s)${skipped ? ` · ${skipped} ignorado(s) por tópico inexistente` : ""}`,
    );
    setPreview(null);
    setPreviewTopicSlug(null);
    refresh();
  }

  const previewTopics = useMemo(() => {
    if (!preview) return [] as Array<{ slug: string; name: string; count: number }>;
    const bySlug = new Map<string, { slug: string; name: string; count: number }>();
    for (const r of preview) {
      const key = r.topic_slug;
      const existing = bySlug.get(key);
      if (existing) existing.count++;
      else bySlug.set(key, { slug: key, name: r.topic_name ?? r.topic_slug, count: 1 });
    }
    return Array.from(bySlug.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [preview]);

  const previewRows = preview?.filter((r) => r.topic_slug === previewTopicSlug) ?? [];

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-base">Importar Data Points</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">
              Suba um <code>.json</code> ou <code>.csv</code> com campos para adicionar em lote.
              Colunas esperadas: <code>topic_slug</code>, <code>field_name</code>,{" "}
              <code>field_label</code>, <code>field_type</code>, <code>description</code>{" "}
              (opcional).
            </p>
          </div>
          <div>
            <input
              ref={fileRef}
              type="file"
              accept=".json,.csv,application/json,text/csv"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleFile(f);
              }}
            />
            <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()}>
              <Upload className="size-4" /> Escolher arquivo
            </Button>
          </div>
        </CardHeader>
      </Card>

      {preview && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-base">
                Pré-visualização · {preview.length} campo(s)
              </CardTitle>
              <p className="mt-1 text-xs text-muted-foreground">
                Confira os campos encontrados no arquivo e importe. Campos com tópico inexistente
                serão ignorados.
              </p>
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setPreview(null);
                  setPreviewTopicSlug(null);
                }}
              >
                Cancelar
              </Button>
              <Button size="sm" onClick={importPreview} disabled={importing}>
                {importing ? "Importando…" : `Importar ${preview.length}`}
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 md:grid-cols-[260px_1fr]">
              <div className="space-y-1">
                {previewTopics.map((t) => {
                  const active = t.slug === previewTopicSlug;
                  const known = topics?.some((x) => x.slug === t.slug);
                  return (
                    <button
                      key={t.slug}
                      onClick={() => setPreviewTopicSlug(t.slug)}
                      className={`flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm transition-colors ${
                        active ? "bg-accent text-accent-foreground" : "hover:bg-muted"
                      }`}
                    >
                      <span className="flex items-center gap-2">
                        <span>{TOPIC_EMOJI[t.slug] ?? "📁"}</span>
                        <span>{t.name}</span>
                        {!known && (
                          <Badge variant="destructive" className="text-[9px]">
                            novo
                          </Badge>
                        )}
                      </span>
                      <Badge variant="outline" className="text-[10px]">
                        {t.count}
                      </Badge>
                    </button>
                  );
                })}
              </div>
              <div>
                {previewRows.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Selecione um tópico.</p>
                ) : (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left text-xs text-muted-foreground">
                        <th className="py-2 pr-3">Label</th>
                        <th className="py-2 pr-3">Field</th>
                        <th className="py-2 pr-3">Type</th>
                        <th className="py-2 pr-3">Descrição</th>
                      </tr>
                    </thead>
                    <tbody>
                      {previewRows.map((r, i) => (
                        <tr key={i} className="border-b last:border-0">
                          <td className="py-2 pr-3">{r.field_label}</td>
                          <td className="py-2 pr-3 font-mono text-xs">{r.field_name}</td>
                          <td className="py-2 pr-3">
                            <Badge variant="secondary" className="text-[10px]">
                              {r.field_type}
                            </Badge>
                          </td>
                          <td className="py-2 pr-3 text-xs text-muted-foreground">
                            {r.description ?? "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

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
                {currentTopic ? `Data Points · ${currentTopic.name}` : "Data Points"}
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
                    <th className="py-2 pr-3">Active</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {topicDps.map((d) => (
                    <tr key={d.id} className="border-b last:border-0">
                      <td className="py-2 pr-3">{d.field_label}</td>
                      <td className="py-2 pr-3 font-mono text-xs">{d.field_name}</td>
                      <td className="py-2 pr-3">
                        <Badge variant="secondary" className="text-[10px]">
                          {d.field_type}
                        </Badge>
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
    </div>
  );
}

// -------- parsing helpers --------

function coerceFieldType(v: string | undefined): FieldType {
  const s = (v ?? "text").trim().toLowerCase();
  return (FIELD_TYPES as readonly string[]).includes(s) ? (s as FieldType) : "text";
}

function slugify(v: string): string {
  return v
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function normalizeRow(raw: Record<string, unknown>): PreviewRow | null {
  const get = (k: string) => {
    for (const key of Object.keys(raw)) {
      if (key.toLowerCase().trim() === k) return raw[key];
    }
    return undefined;
  };
  const topic_slug =
    (get("topic_slug") as string) ??
    (get("topic") as string) ??
    (get("topico") as string) ??
    (get("tópico") as string) ??
    (get("topic_id") as string);
  const topic_name =
    (get("topic_name") as string) ??
    (get("topic_label") as string) ??
    (topic_slug as string);
  const field_name =
    (get("field_name") as string) ??
    (get("field") as string) ??
    (get("name") as string) ??
    (get("key") as string) ??
    (get("slug") as string);
  const field_label =
    (get("field_label") as string) ??
    (get("label") as string) ??
    (get("title") as string) ??
    (field_name as string);
  const field_type = coerceFieldType(
    (get("field_type") as string) ?? (get("type") as string) ?? (get("kind") as string),
  );
  const description =
    ((get("description") as string) ??
      (get("desc") as string) ??
      (get("help") as string) ??
      null) || null;
  if (!topic_slug || !field_name) return null;
  return {
    topic_slug: slugify(String(topic_slug)),
    topic_name: topic_name ? String(topic_name) : undefined,
    field_name: slugify(String(field_name)),
    field_label: String(field_label ?? field_name),
    field_type,
    description: description ? String(description) : null,
  };
}

function extractFieldsFromTopicNode(
  topicSlug: string,
  topicName: string | undefined,
  node: Record<string, unknown>,
): PreviewRow[] {
  const fieldsRaw =
    (node.fields as unknown) ??
    (node.data_points as unknown) ??
    (node.datapoints as unknown) ??
    (node.items as unknown) ??
    (node.core_fields as unknown);
  const out: PreviewRow[] = [];
  if (Array.isArray(fieldsRaw)) {
    for (const item of fieldsRaw) {
      if (item && typeof item === "object") {
        const r = normalizeRow({
          topic_slug: topicSlug,
          topic_name: topicName,
          ...(item as Record<string, unknown>),
        });
        if (r) out.push(r);
      }
    }
  } else if (fieldsRaw && typeof fieldsRaw === "object") {
    for (const [fname, fval] of Object.entries(fieldsRaw as Record<string, unknown>)) {
      const base =
        fval && typeof fval === "object" ? (fval as Record<string, unknown>) : { type: fval };
      const r = normalizeRow({
        topic_slug: topicSlug,
        topic_name: topicName,
        field_name: fname,
        ...base,
      });
      if (r) out.push(r);
    }
  }
  return out;
}

function parseJsonInput(text: string): PreviewRow[] {
  const data = JSON.parse(text);
  const rows: PreviewRow[] = [];

  const pushFromArray = (arr: unknown[]) => {
    for (const item of arr) {
      if (!item || typeof item !== "object") continue;
      const obj = item as Record<string, unknown>;
      const maybeSlug = (obj.slug ?? obj.topic_slug ?? obj.topic) as string | undefined;
      const hasFields =
        Array.isArray(obj.fields) ||
        Array.isArray(obj.data_points) ||
        Array.isArray(obj.datapoints) ||
        Array.isArray(obj.items) ||
        Array.isArray(obj.core_fields) ||
        (obj.fields && typeof obj.fields === "object");
      if (maybeSlug && hasFields) {
        rows.push(
          ...extractFieldsFromTopicNode(
            String(maybeSlug),
            (obj.name as string) ?? (obj.topic_name as string),
            obj,
          ),
        );
        continue;
      }
      const r = normalizeRow(obj);
      if (r) rows.push(r);
    }
  };

  if (Array.isArray(data)) {
    pushFromArray(data);
  } else if (data && typeof data === "object") {
    const root = data as Record<string, unknown>;
    if (Array.isArray(root.topics)) {
      pushFromArray(root.topics as unknown[]);
    } else if (Array.isArray(root.data_points) || Array.isArray(root.fields)) {
      pushFromArray((root.data_points ?? root.fields) as unknown[]);
    } else {
      for (const [key, val] of Object.entries(root)) {
        if (Array.isArray(val)) {
          for (const item of val) {
            if (item && typeof item === "object") {
              const r = normalizeRow({
                topic_slug: key,
                ...(item as Record<string, unknown>),
              });
              if (r) rows.push(r);
            }
          }
        } else if (val && typeof val === "object") {
          const node = val as Record<string, unknown>;
          rows.push(
            ...extractFieldsFromTopicNode(
              key,
              (node.name as string) ?? (node.topic_name as string),
              node,
            ),
          );
        }
      }
    }
  }
  return rows;
}


function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') quoted = false;
      else cur += c;
    } else {
      if (c === '"') quoted = true;
      else if (c === ",") { out.push(cur); cur = ""; }
      else cur += c;
    }
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

function parseCsvInput(text: string): PreviewRow[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];
  const headers = parseCsvLine(lines[0]).map((h) => h.toLowerCase());
  const rows: PreviewRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = parseCsvLine(lines[i]);
    const obj: Record<string, unknown> = {};
    headers.forEach((h, idx) => (obj[h] = cells[idx]));
    const r = normalizeRow(obj);
    if (r) rows.push(r);
  }
  return rows;
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
  const [active, setActive] = useState(existing?.active ?? true);
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!fieldName.trim() || !fieldLabel.trim()) {
      toast.error("Preencha field name e label");
      return;
    }
    setSaving(true);
    const payload = {
      topic_definition_id: topicId,
      field_name: fieldName.trim(),
      field_label: fieldLabel.trim(),
      field_type: fieldType,
      description: description.trim() || null,
      required: existing?.required ?? false,
      active,
      extraction_strategy: existing?.extraction_strategy ?? DEFAULT_STRATEGY,
      regex_pattern: existing?.regex_pattern ?? null,
      keywords: existing?.keywords ?? {},
      negative_keywords: existing?.negative_keywords ?? [],
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
              <Switch checked={active} onCheckedChange={setActive} />
              Active
            </label>
          </div>
          <p className="text-[11px] text-muted-foreground">
            A extração usa <strong>keyword</strong> como estratégia padrão, com fallback para LLM
            definido no prompt de extração (Settings → Extraction Pipeline).
          </p>
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
