import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";

type TopicDef = { id: string; slug: string; name: string };

export function QuestionsTab({ projectId }: { projectId: string }) {
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [expectedFacts, setExpectedFacts] = useState("");
  const [pinnedDefIds, setPinnedDefIds] = useState<string[]>([]);
  const [bulkText, setBulkText] = useState("");

  const { data: items } = useQuery({
    queryKey: ["test_questions", projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("test_questions").select("*").eq("project_id", projectId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const { data: topicDefs } = useQuery({
    queryKey: ["topic_defs_for_project", projectId],
    queryFn: async () => {
      const { data: topics } = await supabase
        .from("topics").select("topic_definition_id, topic_definitions(id, slug, name)")
        .eq("project_id", projectId);
      const defs: TopicDef[] = [];
      for (const t of topics ?? []) {
        const td = t.topic_definitions as TopicDef | null;
        if (td) defs.push(td);
      }
      return defs;
    },
  });
  const defById = new Map((topicDefs ?? []).map((d) => [d.id, d]));

  function parseFacts(text: string): string[] {
    return text.split(/\r?\n|,/).map((s) => s.trim()).filter(Boolean);
  }

  async function add() {
    if (!q.trim()) return;
    const facts = parseFacts(expectedFacts);
    const { error } = await supabase.from("test_questions").insert({
      project_id: projectId,
      question: q.trim(),
      expected_facts: facts as never,
      topic_definition_ids: pinnedDefIds as never,
      active: true,
    });
    if (error) { toast.error(error.message); return; }
    setQ(""); setExpectedFacts(""); setPinnedDefIds([]);
    qc.invalidateQueries({ queryKey: ["test_questions", projectId] });
  }

  async function bulkAdd() {
    const lines = bulkText.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    if (lines.length === 0) return;
    const rows = lines.map((line) => ({
      project_id: projectId,
      question: line,
      expected_facts: [] as never,
      topic_definition_ids: [] as never,
      active: true,
    }));
    const { error } = await supabase.from("test_questions").insert(rows);
    if (error) { toast.error(error.message); return; }
    setBulkText("");
    toast.success(`${rows.length} perguntas adicionadas`);
    qc.invalidateQueries({ queryKey: ["test_questions", projectId] });
  }

  async function toggleActive(id: string, current: boolean) {
    await supabase.from("test_questions").update({ active: !current }).eq("id", id);
    qc.invalidateQueries({ queryKey: ["test_questions", projectId] });
  }

  async function remove(id: string) {
    if (!confirm("Apagar pergunta?")) return;
    await supabase.from("test_questions").delete().eq("id", id);
    qc.invalidateQueries({ queryKey: ["test_questions", projectId] });
  }

  function togglePinned(id: string) {
    setPinnedDefIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader><CardTitle className="text-base">Nova pergunta</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <Input placeholder="Ex.: Qual o horário do café da manhã?" value={q} onChange={(e) => setQ(e.target.value)} />
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">Expected facts (1 por linha ou separados por vírgula — opcional)</label>
            <Textarea
              rows={3}
              placeholder={`horário do café da manhã\nlocal\nvalor\nse está incluso`}
              value={expectedFacts}
              onChange={(e) => setExpectedFacts(e.target.value)}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">Tópicos associados (opcional — força roteamento)</label>
            <div className="flex flex-wrap gap-2">
              {(topicDefs ?? []).map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => togglePinned(t.id)}
                  className={`rounded border px-2 py-1 text-xs ${pinnedDefIds.includes(t.id) ? "border-primary bg-primary/10" : "border-border"}`}
                >
                  {t.slug}
                </button>
              ))}
              {(topicDefs ?? []).length === 0 && (
                <span className="text-xs text-muted-foreground">Nenhum tópico ativo no projeto.</span>
              )}
            </div>
          </div>
          <Button onClick={add}>Adicionar</Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Bulk add (uma pergunta por linha)</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          <Textarea
            rows={5}
            placeholder={`Me dê informações sobre o café da manhã.\nQual o horário do check-in?\nO hotel aceita pets?`}
            value={bulkText}
            onChange={(e) => setBulkText(e.target.value)}
          />
          <Button variant="outline" onClick={bulkAdd}>Adicionar em massa</Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Perguntas ({items?.length ?? 0})</CardTitle></CardHeader>
        <CardContent>
          {!items || items.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhuma pergunta.</p>
          ) : (
            <div className="divide-y">
              {items.map((item) => {
                const facts = (item.expected_facts ?? []) as string[];
                const tids = (item.topic_definition_ids ?? []) as string[];
                return (
                  <div key={item.id} className="flex items-start justify-between gap-3 py-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className={`text-sm font-medium ${!item.active ? "text-muted-foreground line-through" : ""}`}>
                          {item.question}
                        </span>
                        {!item.active && <Badge variant="outline">inactive</Badge>}
                      </div>
                      {facts.length > 0 && (
                        <div className="mt-1 flex flex-wrap gap-1">
                          {facts.map((f, i) => (
                            <Badge key={i} variant="secondary" className="text-[10px]">{f}</Badge>
                          ))}
                        </div>
                      )}
                      {tids.length > 0 && (
                        <div className="mt-1 flex flex-wrap gap-1">
                          {tids.map((id) => (
                            <Badge key={id} variant="outline" className="text-[10px]">
                              {defById.get(id)?.slug ?? id.slice(0, 6)}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="flex gap-1">
                      <Button size="sm" variant="ghost" onClick={() => toggleActive(item.id, item.active)}>
                        {item.active ? "Desativar" : "Ativar"}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => remove(item.id)}>×</Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
