
CREATE TABLE public.knowledge_health_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  topic_definition_id uuid NOT NULL REFERENCES public.topic_definitions(id) ON DELETE CASCADE,
  health_score numeric NOT NULL DEFAULT 0,
  core_coverage numeric NOT NULL DEFAULT 0,
  required_coverage numeric NOT NULL DEFAULT 0,
  confidence_score numeric NOT NULL DEFAULT 0,
  approved_ratio numeric NOT NULL DEFAULT 0,
  dynamic_ratio numeric NOT NULL DEFAULT 0,
  additional_info_count integer NOT NULL DEFAULT 0,
  missing_required_fields jsonb NOT NULL DEFAULT '[]'::jsonb,
  missing_optional_fields jsonb NOT NULL DEFAULT '[]'::jsonb,
  pending_conflicts_count integer NOT NULL DEFAULT 0,
  pending_candidates_count integer NOT NULL DEFAULT 0,
  pending_additional_info_count integer NOT NULL DEFAULT 0,
  flags jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.knowledge_health_snapshots TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.knowledge_health_snapshots TO anon;
GRANT ALL ON public.knowledge_health_snapshots TO service_role;

ALTER TABLE public.knowledge_health_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "open read health" ON public.knowledge_health_snapshots FOR SELECT USING (true);
CREATE POLICY "open insert health" ON public.knowledge_health_snapshots FOR INSERT WITH CHECK (true);
CREATE POLICY "open update health" ON public.knowledge_health_snapshots FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "open delete health" ON public.knowledge_health_snapshots FOR DELETE USING (true);

CREATE INDEX idx_khs_project_topic_created ON public.knowledge_health_snapshots(project_id, topic_definition_id, created_at DESC);
