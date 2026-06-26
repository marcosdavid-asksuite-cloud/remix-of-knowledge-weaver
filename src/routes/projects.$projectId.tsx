import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/AppShell";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { UploadTab } from "@/features/project/UploadTab";
import { RawKnowledgeTab } from "@/features/project/RawKnowledgeTab";
import { StructuredKnowledgeTab } from "@/features/project/StructuredKnowledgeTab";
import { CompareResponsesTab } from "@/features/project/CompareResponsesTab";
import { SettingsTab } from "@/features/project/SettingsTab";
import { Button } from "@/components/ui/button";

type Search = { tab?: string };

export const Route = createFileRoute("/projects/$projectId")({
  head: () => ({ meta: [{ title: "Project — Hybrid KB Lab" }] }),
  validateSearch: (s: Record<string, unknown>): Search => ({
    tab: typeof s.tab === "string" ? s.tab : undefined,
  }),
  component: ProjectDetail,
});

function ProjectDetail() {
  const { projectId } = Route.useParams();
  const { tab } = Route.useSearch();
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
      <div className="mb-6">
        <Link to="/" className="text-xs text-muted-foreground hover:text-foreground">← Projects</Link>
        <h1 className="mt-1 text-2xl font-semibold">{project.name}</h1>
        {project.description && (
          <p className="text-sm text-muted-foreground">{project.description}</p>
        )}
      </div>

      <Tabs defaultValue={tab ?? "upload"}>
        <TabsList>
          <TabsTrigger value="upload">Upload</TabsTrigger>
          <TabsTrigger value="raw">Raw Knowledge</TabsTrigger>
          <TabsTrigger value="structured">Structured Knowledge</TabsTrigger>
          <TabsTrigger value="compare">Compare Responses</TabsTrigger>
          <TabsTrigger value="settings">Settings</TabsTrigger>
        </TabsList>
        <TabsContent value="upload" className="mt-6"><UploadTab projectId={projectId} /></TabsContent>
        <TabsContent value="raw" className="mt-6"><RawKnowledgeTab projectId={projectId} /></TabsContent>
        <TabsContent value="structured" className="mt-6"><StructuredKnowledgeTab projectId={projectId} /></TabsContent>
        <TabsContent value="compare" className="mt-6"><CompareResponsesTab projectId={projectId} /></TabsContent>
        <TabsContent value="settings" className="mt-6"><SettingsTab /></TabsContent>
      </Tabs>
    </AppShell>
  );
}
