import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { deleteSnapshot } from "@/lib/snapshot.functions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";

type Snapshot = {
  id: string;
  project_id: string;
  name: string;
  description: string | null;
  overall_score: number | null;
  payload: Record<string, unknown>;
  created_at: string;
};

export function SnapshotsTab({ projectId }: { projectId: string }) {
  const qc = useQueryClient();
  const delFn = useServerFn(deleteSnapshot);
  const [a, setA] = useState<string>("");
  const [b, setB] = useState<string>("");

  const { data: snapshots } = useQuery({
    queryKey: ["snapshots", projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("experiment_snapshots")
        .select("*")
        .eq("project_id", projectId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as Snapshot[];
    },
  });

  const delMut = useMutation({
    mutationFn: async (id: string) => await delFn({ data: { id } }),
    onSuccess: () => { toast.success("Snapshot removido."); qc.invalidateQueries({ queryKey: ["snapshots", projectId] }); },
  });

  const snapA = snapshots?.find((s) => s.id === a);
  const snapB = snapshots?.find((s) => s.id === b);

  function val(s: Snapshot | undefined, path: string): string {
    if (!s) return "—";
    const parts = path.split(".");
    let v: unknown = s.payload;
    for (const p of parts) {
      if (v == null || typeof v !== "object") return "—";
      v = (v as Record<string, unknown>)[p];
    }
    if (v == null) return "—";
    if (typeof v === "number") return v.toLocaleString("pt-BR", { maximumFractionDigits: 2 });
    if (typeof v === "object") return JSON.stringify(v).slice(0, 60) + "…";
    return String(v);
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Snapshots</CardTitle>
          <p className="text-sm text-muted-foreground">
            Snapshots capturam configurações, prompts, modelo, health e benchmark de um experimento — para comparar execuções diferentes.
            Use o botão <b>Save Snapshot</b> no Executive Report.
          </p>
        </CardHeader>
        <CardContent>
          {(snapshots ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum snapshot ainda.</p>
          ) : (
            <ul className="space-y-2">
              {(snapshots ?? []).map((s) => (
                <li key={s.id} className="flex items-center justify-between rounded border p-3">
                  <div>
                    <div className="font-medium">
                      {s.name}{" "}
                      {s.overall_score != null && <Badge variant="secondary">Score {Math.round(s.overall_score)}</Badge>}
                    </div>
                    <div className="text-xs text-muted-foreground">{new Date(s.created_at).toLocaleString("pt-BR")}</div>
                  </div>
                  <Button size="sm" variant="destructive" onClick={() => delMut.mutate(s.id)}>Remover</Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Comparar dois snapshots</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <Select value={a} onValueChange={setA}>
                <SelectTrigger><SelectValue placeholder="Snapshot A" /></SelectTrigger>
                <SelectContent>
                  {(snapshots ?? []).map((s) => (
                    <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Select value={b} onValueChange={setB}>
                <SelectTrigger><SelectValue placeholder="Snapshot B" /></SelectTrigger>
                <SelectContent>
                  {(snapshots ?? []).map((s) => (
                    <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {(snapA || snapB) && (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="py-2 text-left">Métrica</th>
                  <th className="py-2 text-left">A — {snapA?.name ?? "?"}</th>
                  <th className="py-2 text-left">B — {snapB?.name ?? "?"}</th>
                </tr>
              </thead>
              <tbody>
                {[
                  ["Overall Score", "overall_score"],
                  ["Knowledge Health", "health.overall_health_score"],
                  ["Sources", "counts.sources"],
                  ["Raw Chunks", "counts.chunks"],
                  ["Consolidated", "counts.consolidated"],
                  ["Dynamic", "counts.dynamic"],
                  ["Conflicts", "counts.conflicts"],
                  ["Suggested DPs", "schema.suggested"],
                  ["Extraction Cost", "costs.extraction"],
                  ["Benchmark Cost", "costs.benchmark"],
                  ["Total LLM Cost", "costs.total"],
                ].map(([label, path]) => (
                  <tr key={path} className="border-b">
                    <td className="py-1">{label}</td>
                    <td className="py-1">{path === "overall_score" ? (snapA?.overall_score ?? "—") : val(snapA, path)}</td>
                    <td className="py-1">{path === "overall_score" ? (snapB?.overall_score ?? "—") : val(snapB, path)}</td>
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
