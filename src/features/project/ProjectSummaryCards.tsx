import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { calculateKnowledgeHealth } from "@/lib/health.functions";
import { Card, CardContent } from "@/components/ui/card";

export function ProjectSummaryCards({ projectId }: { projectId: string }) {
  const runCalc = useServerFn(calculateKnowledgeHealth);
  const { data: health } = useQuery({
    queryKey: ["health", projectId],
    queryFn: () => runCalc({ data: { projectId, persistSnapshot: false } }),
    staleTime: 60_000,
  });

  const { data: consolidatedCount } = useQuery({
    queryKey: ["project-consolidated-count", projectId],
    queryFn: async () => {
      const { data: topics } = await supabase
        .from("topics").select("id").eq("project_id", projectId);
      const ids = (topics ?? []).map((t) => t.id);
      if (ids.length === 0) return 0;
      const { count } = await supabase
        .from("knowledge_fields")
        .select("id", { count: "exact", head: true })
        .in("topic_id", ids)
        .eq("consolidation_status", "consolidated");
      return count ?? 0;
    },
  });

  const { data: lastBatch } = useQuery({
    queryKey: ["project-last-batch", projectId],
    queryFn: async () => {
      const { data } = await supabase
        .from("test_batches")
        .select("id, created_at, status, statistics")
        .eq("project_id", projectId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      return data;
    },
  });

  const score = health?.overall_health_score ?? 0;
  const scoreColor =
    score >= 80 ? "text-emerald-600" : score >= 60 ? "text-amber-600" : "text-red-600";

  return (
    <div className="grid gap-3 md:grid-cols-5">
      <Card>
        <CardContent className="py-3">
          <div className="text-xs text-muted-foreground">Knowledge Health</div>
          <div className={`text-2xl font-semibold ${scoreColor}`}>
            {health ? `${score}` : "—"}
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="py-3">
          <div className="text-xs text-muted-foreground">Consolidated Fields</div>
          <div className="text-2xl font-semibold">{consolidatedCount ?? "—"}</div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="py-3">
          <div className="text-xs text-muted-foreground">Pending Conflicts</div>
          <div className="text-2xl font-semibold">{health?.total_pending_conflicts ?? "—"}</div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="py-3">
          <div className="text-xs text-muted-foreground">Missing Required</div>
          <div className="text-2xl font-semibold">{health?.total_missing_required ?? "—"}</div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="py-3">
          <div className="text-xs text-muted-foreground">Last Benchmark</div>
          <div className="text-sm font-medium">
            {lastBatch ? new Date(lastBatch.created_at).toLocaleDateString() : "Nunca"}
          </div>
          <div className="text-xs text-muted-foreground">
            {lastBatch ? lastBatch.status : "—"}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
