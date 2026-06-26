import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/AppShell";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SourcesTab } from "@/features/project/SourcesTab";
import { TopicsTab } from "@/features/project/TopicsTab";
import { KnowledgeTab } from "@/features/project/KnowledgeTab";
import { ExtractionsTab } from "@/features/project/ExtractionsTab";
import { ConsolidationTab } from "@/features/project/ConsolidationTab";
import { QuestionsTab } from "@/features/project/QuestionsTab";
import { PlaygroundTab } from "@/features/project/PlaygroundTab";
import { BenchmarkTab } from "@/features/project/BenchmarkTab";
import { HealthTab } from "@/features/project/HealthTab";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/projects/$projectId")({
  head: () => ({ meta: [{ title: "Project — Hybrid KB Lab" }] }),
  component: ProjectDetail,
});

function ProjectDetail() {
  const { projectId } = Route.useParams();
  const { data: project, isLoading } = useQuery({
    queryKey: ["project", projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("projects").select("*").eq("id", projectId).maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  if (isLoading) return <AppShell><p>Carregando...</p></AppShell>;
  if (!project) return (
    <AppShell>
      <p className="text-sm">Projeto não encontrado.</p>
      <Link to="/"><Button variant="outline" className="mt-3">Voltar</Button></Link>
    </AppShell>
  );

  return (
    <AppShell>
      <div className="mb-6 flex items-end justify-between">
        <div>
          <Link to="/" className="text-xs text-muted-foreground hover:text-foreground">← Projects</Link>
          <h1 className="mt-1 text-2xl font-semibold">{project.name}</h1>
          {project.description && (
            <p className="text-sm text-muted-foreground">{project.description}</p>
          )}
        </div>
      </div>

      <Tabs defaultValue="sources">
        <TabsList>
          <TabsTrigger value="sources">Sources</TabsTrigger>
          <TabsTrigger value="topics">Topics</TabsTrigger>
          <TabsTrigger value="extractions">Extractions</TabsTrigger>
          <TabsTrigger value="consolidation">Consolidation</TabsTrigger>
          <TabsTrigger value="knowledge">Knowledge</TabsTrigger>
          <TabsTrigger value="questions">Questions</TabsTrigger>
          <TabsTrigger value="playground">Playground</TabsTrigger>
          <TabsTrigger value="benchmark">Benchmark</TabsTrigger>
          <TabsTrigger value="health">Health</TabsTrigger>
        </TabsList>
        <TabsContent value="sources" className="mt-6"><SourcesTab projectId={projectId} /></TabsContent>
        <TabsContent value="topics" className="mt-6"><TopicsTab projectId={projectId} /></TabsContent>
        <TabsContent value="extractions" className="mt-6"><ExtractionsTab projectId={projectId} /></TabsContent>
        <TabsContent value="consolidation" className="mt-6"><ConsolidationTab projectId={projectId} /></TabsContent>
        <TabsContent value="knowledge" className="mt-6"><KnowledgeTab projectId={projectId} /></TabsContent>
        <TabsContent value="questions" className="mt-6"><QuestionsTab projectId={projectId} /></TabsContent>
        <TabsContent value="playground" className="mt-6"><PlaygroundTab projectId={projectId} /></TabsContent>
        <TabsContent value="benchmark" className="mt-6"><BenchmarkTab projectId={projectId} /></TabsContent>
        <TabsContent value="health" className="mt-6"><HealthTab projectId={projectId} /></TabsContent>
      </Tabs>
    </AppShell>
  );
}
