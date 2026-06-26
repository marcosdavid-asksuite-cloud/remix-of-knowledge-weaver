
CREATE TABLE public.suggested_data_points (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  topic_definition_id uuid REFERENCES public.topic_definitions(id) ON DELETE CASCADE,
  topic_slug text NOT NULL,
  suggested_field_name text NOT NULL,
  suggested_label text NOT NULL,
  suggested_type text NOT NULL DEFAULT 'text',
  occurrences integer NOT NULL DEFAULT 0,
  projects_count integer NOT NULL DEFAULT 0,
  consolidated_count integer NOT NULL DEFAULT 0,
  avg_confidence numeric NOT NULL DEFAULT 0,
  suggestion_score numeric NOT NULL DEFAULT 0,
  examples jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  resulting_data_point_id uuid REFERENCES public.data_point_definitions(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (topic_slug, suggested_field_name)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.suggested_data_points TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.suggested_data_points TO anon;
GRANT ALL ON public.suggested_data_points TO service_role;

ALTER TABLE public.suggested_data_points ENABLE ROW LEVEL SECURITY;

CREATE POLICY "open access suggested_data_points" ON public.suggested_data_points
  FOR ALL USING (true) WITH CHECK (true);

CREATE TRIGGER update_suggested_data_points_updated_at
  BEFORE UPDATE ON public.suggested_data_points
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
