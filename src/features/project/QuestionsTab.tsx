import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

export function QuestionsTab({ projectId }: { projectId: string }) {
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [expected, setExpected] = useState("");

  const { data: items } = useQuery({
    queryKey: ["test_questions", projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("test_questions").select("*").eq("project_id", projectId).order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  async function add() {
    if (!q.trim()) return;
    const { error } = await supabase.from("test_questions").insert({
      project_id: projectId, question: q.trim(), expected_answer: expected.trim() || null,
    });
    if (error) { toast.error(error.message); return; }
    setQ(""); setExpected("");
    qc.invalidateQueries({ queryKey: ["test_questions", projectId] });
  }

  async function remove(id: string) {
    if (!confirm("Apagar pergunta?")) return;
    await supabase.from("test_questions").delete().eq("id", id);
    qc.invalidateQueries({ queryKey: ["test_questions", projectId] });
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader><CardTitle className="text-base">Nova pergunta</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          <Input placeholder="Ex.: Qual o horário do café da manhã?" value={q} onChange={(e) => setQ(e.target.value)} />
          <Textarea placeholder="Resposta esperada (opcional, gabarito)" rows={2} value={expected} onChange={(e) => setExpected(e.target.value)} />
          <Button onClick={add}>Adicionar</Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Perguntas</CardTitle></CardHeader>
        <CardContent>
          {!items || items.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhuma pergunta.</p>
          ) : (
            <div className="divide-y">
              {items.map((item) => (
                <div key={item.id} className="flex items-start justify-between gap-3 py-3">
                  <div>
                    <div className="text-sm font-medium">{item.question}</div>
                    {item.expected_answer && (
                      <div className="text-xs text-muted-foreground">Esperado: {item.expected_answer}</div>
                    )}
                  </div>
                  <Button size="sm" variant="ghost" onClick={() => remove(item.id)}>×</Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
