import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";

type Chunk = {
  id: string;
  content: string;
  metadata: unknown;
  raw_source_id: string;
  position: number;
};
type Source = { id: string; filename: string | null; type: string };
type CandidateLite = {
  source_chunk_ids: string[];
  topic_definitions: { slug: string; name: string } | null;
};

export function RawKnowledgeTab({ projectId }: { projectId: string }) {
  const [search, setSearch] = useState("");
  const [sourceFilter, setSourceFilter] = useState<string>("");
  const [topicFilter, setTopicFilter] = useState<string>("");
  const [jsonOpen, setJsonOpen] = useState(false);

  const { data: sources } = useQuery({
    queryKey: ["raw_sources_list", projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("raw_sources").select("id, filename, type").eq("project_id", projectId);
      if (error) throw error;
      return (data ?? []) as Source[];
    },
  });

  const sourceIds = (sources ?? []).map((s) => s.id);

  const { data: chunks } = useQuery({
    queryKey: ["raw_chunks_list", projectId, sourceIds.join(",")],
    enabled: sourceIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("raw_chunks")
        .select("id, content, metadata, raw_source_id, position")
        .in("raw_source_id", sourceIds)
        .order("position")
        .limit(2000);
      if (error) throw error;
      return (data ?? []) as Chunk[];
    },
  });

  // Topic detection per chunk via knowledge_candidates
  const { data: chunkTopicMap } = useQuery({
    queryKey: ["chunk_topic_map", projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("knowledge_candidates")
        .select("source_chunk_ids, topic_definitions(slug, name)")
        .eq("project_id", projectId);
      if (error) throw error;
      const rows = (data ?? []) as unknown as CandidateLite[];
      const map = new Map<string, Set<string>>();
      for (const r of rows) {
        const slug = r.topic_definitions?.slug;
        if (!slug) continue;
        for (const id of r.source_chunk_ids ?? []) {
          const set = map.get(id) ?? new Set<string>();
          set.add(slug);
          map.set(id, set);
        }
      }
      return map;
    },
  });

  const sourceById = useMemo(() => new Map((sources ?? []).map((s) => [s.id, s])), [sources]);
  const allTopics = useMemo(() => {
    const set = new Set<string>();
    if (chunkTopicMap) for (const v of chunkTopicMap.values()) v.forEach((t) => set.add(t));
    return Array.from(set).sort();
  }, [chunkTopicMap]);

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    return (chunks ?? []).filter((c) => {
      if (sourceFilter && c.raw_source_id !== sourceFilter) return false;
      if (topicFilter) {
        const ts = chunkTopicMap?.get(c.id);
        if (!ts || !ts.has(topicFilter)) return false;
      }
      if (s && !c.content.toLowerCase().includes(s)) return false;
      return true;
    });
  }, [chunks, search, sourceFilter, topicFilter, chunkTopicMap]);

  const rawJson = useMemo(
    () =>
      filtered.map((c) => ({
        id: c.id,
        content: c.content,
        metadata: c.metadata,
        source: sourceById.get(c.raw_source_id)?.filename ?? "?",
      })),
    [filtered, sourceById],
  );

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Raw Knowledge</CardTitle>
          <p className="text-xs text-muted-foreground">
            Esta é a base que seria enviada diretamente para um RAG tradicional. Sem edição.
          </p>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              placeholder="Buscar texto…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="max-w-xs"
            />
            <select
              value={sourceFilter}
              onChange={(e) => setSourceFilter(e.target.value)}
              className="rounded-md border bg-background px-2 py-1.5 text-sm"
            >
              <option value="">Todas as fontes</option>
              {(sources ?? []).map((s) => (
                <option key={s.id} value={s.id}>{s.filename ?? s.id}</option>
              ))}
            </select>
            <select
              value={topicFilter}
              onChange={(e) => setTopicFilter(e.target.value)}
              className="rounded-md border bg-background px-2 py-1.5 text-sm"
            >
              <option value="">Todos os tópicos</option>
              {allTopics.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
            <div className="ml-auto flex items-center gap-2">
              <span className="text-xs text-muted-foreground">{filtered.length} chunks</span>
              <Button variant="outline" size="sm" onClick={() => setJsonOpen(true)}>View JSON</Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {filtered.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">Nenhum chunk para mostrar.</p>
          ) : (
            <div className="max-h-[70vh] overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-background">
                  <tr className="border-b text-left text-[11px] text-muted-foreground">
                    <th className="px-3 py-2">Chunk</th>
                    <th className="px-3 py-2">Fonte</th>
                    <th className="px-3 py-2">Tópicos detectados</th>
                    <th className="px-3 py-2">Texto</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((c) => {
                    const topics = Array.from(chunkTopicMap?.get(c.id) ?? []);
                    return (
                      <tr key={c.id} className="border-b align-top last:border-0">
                        <td className="px-3 py-2 font-mono text-[10px] text-muted-foreground">
                          {c.id.slice(0, 8)}
                        </td>
                        <td className="px-3 py-2 text-xs">
                          {sourceById.get(c.raw_source_id)?.filename ?? "?"}
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex flex-wrap gap-1">
                            {topics.length === 0 ? (
                              <span className="text-xs text-muted-foreground">—</span>
                            ) : (
                              topics.map((t) => (
                                <Badge key={t} variant="secondary" className="text-[10px]">{t}</Badge>
                              ))
                            )}
                          </div>
                        </td>
                        <td className="px-3 py-2">
                          <div className="max-w-[640px] whitespace-pre-wrap text-xs">
                            {c.content.length > 400 ? c.content.slice(0, 400) + "…" : c.content}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={jsonOpen} onOpenChange={setJsonOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Raw Knowledge — JSON ({rawJson.length} chunks)</DialogTitle>
          </DialogHeader>
          <pre className="max-h-[60vh] overflow-auto rounded bg-muted p-3 text-xs">
            {JSON.stringify(rawJson, null, 2)}
          </pre>
          <DialogFooter>
            <Button variant="outline" onClick={() => setJsonOpen(false)}>Fechar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
