
-- 1. knowledge_conflicts
CREATE TABLE public.knowledge_conflicts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  topic_definition_id uuid NOT NULL REFERENCES public.topic_definitions(id) ON DELETE CASCADE,
  field_name text NOT NULL,
  field_type text NOT NULL,
  conflict_type text NOT NULL DEFAULT 'different_values',
  status text NOT NULL DEFAULT 'pending',
  candidate_ids uuid[] NOT NULL DEFAULT '{}',
  selected_candidate_id uuid REFERENCES public.knowledge_candidates(id) ON DELETE SET NULL,
  manual_value jsonb,
  resolution_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  CONSTRAINT knowledge_conflicts_status_check CHECK (status IN ('pending','resolved','ignored')),
  CONSTRAINT knowledge_conflicts_type_check CHECK (conflict_type IN
    ('different_values','contradictory_boolean','different_time','different_price','duplicate_uncertain'))
);
CREATE INDEX knowledge_conflicts_project_idx ON public.knowledge_conflicts(project_id);
CREATE UNIQUE INDEX knowledge_conflicts_unique_pending_idx
  ON public.knowledge_conflicts(project_id, topic_definition_id, field_name)
  WHERE status = 'pending';

GRANT SELECT, INSERT, UPDATE, DELETE ON public.knowledge_conflicts TO anon, authenticated;
GRANT ALL ON public.knowledge_conflicts TO service_role;
ALTER TABLE public.knowledge_conflicts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "lab open access" ON public.knowledge_conflicts USING (true) WITH CHECK (true);

-- 2. knowledge_fields: consolidation columns
ALTER TABLE public.knowledge_fields
  ADD COLUMN IF NOT EXISTS source_of_truth text NOT NULL DEFAULT 'auto_single_candidate',
  ADD COLUMN IF NOT EXISTS consolidation_status text NOT NULL DEFAULT 'consolidated',
  ADD COLUMN IF NOT EXISTS approved_by_user boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS candidate_ids uuid[] NOT NULL DEFAULT '{}';

ALTER TABLE public.knowledge_fields
  DROP CONSTRAINT IF EXISTS knowledge_fields_source_of_truth_check;
ALTER TABLE public.knowledge_fields
  ADD CONSTRAINT knowledge_fields_source_of_truth_check CHECK (source_of_truth IN
    ('auto_single_candidate','auto_merged_candidates','manually_selected_candidate','manually_edited','imported'));

ALTER TABLE public.knowledge_fields
  DROP CONSTRAINT IF EXISTS knowledge_fields_consolidation_status_check;
ALTER TABLE public.knowledge_fields
  ADD CONSTRAINT knowledge_fields_consolidation_status_check CHECK (consolidation_status IN
    ('consolidated','needs_review'));

CREATE UNIQUE INDEX IF NOT EXISTS knowledge_fields_topic_fieldname_idx
  ON public.knowledge_fields(topic_id, field_name);

-- 3. additional_info: approval status
ALTER TABLE public.additional_info
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS approved_at timestamptz;
ALTER TABLE public.additional_info
  DROP CONSTRAINT IF EXISTS additional_info_status_check;
ALTER TABLE public.additional_info
  ADD CONSTRAINT additional_info_status_check CHECK (status IN ('pending','approved','rejected'));

-- 4. knowledge_candidates: allow 'superseded' status
ALTER TABLE public.knowledge_candidates
  DROP CONSTRAINT IF EXISTS knowledge_candidates_status_check;
ALTER TABLE public.knowledge_candidates
  ADD CONSTRAINT knowledge_candidates_status_check CHECK (status IN ('pending','approved','rejected','superseded'));
