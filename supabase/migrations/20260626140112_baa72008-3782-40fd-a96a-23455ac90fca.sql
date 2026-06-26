
-- Extend test_questions
ALTER TABLE public.test_questions
  ADD COLUMN IF NOT EXISTS expected_facts jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS topic_definition_ids uuid[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true;

-- Extend test_runs (benchmark-friendly fields)
ALTER TABLE public.test_runs
  ADD COLUMN IF NOT EXISTS input_tokens integer,
  ADD COLUMN IF NOT EXISTS output_tokens integer,
  ADD COLUMN IF NOT EXISTS estimated_cost numeric,
  ADD COLUMN IF NOT EXISTS latency_ms integer,
  ADD COLUMN IF NOT EXISTS model_name text,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'success',
  ADD COLUMN IF NOT EXISTS error_message text,
  ADD COLUMN IF NOT EXISTS test_batch_id uuid,
  ADD COLUMN IF NOT EXISTS project_id uuid;

-- Backfill project_id on existing test_runs from their question
UPDATE public.test_runs r
SET project_id = q.project_id
FROM public.test_questions q
WHERE r.project_id IS NULL AND r.question_id = q.id;

-- test_batches
CREATE TABLE IF NOT EXISTS public.test_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  name text NOT NULL,
  status text NOT NULL DEFAULT 'running',
  modes text[] NOT NULL DEFAULT '{}',
  question_count integer NOT NULL DEFAULT 0,
  model_name text,
  temperature numeric,
  options jsonb NOT NULL DEFAULT '{}'::jsonb,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  statistics jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.test_batches TO anon, authenticated;
GRANT ALL ON public.test_batches TO service_role;
ALTER TABLE public.test_batches ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Lab open access" ON public.test_batches FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE public.test_runs
  ADD CONSTRAINT test_runs_test_batch_id_fkey
  FOREIGN KEY (test_batch_id) REFERENCES public.test_batches(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_test_runs_batch ON public.test_runs(test_batch_id);
CREATE INDEX IF NOT EXISTS idx_test_runs_project ON public.test_runs(project_id);

-- test_evaluations
CREATE TABLE IF NOT EXISTS public.test_evaluations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  test_run_id uuid NOT NULL REFERENCES public.test_runs(id) ON DELETE CASCADE,
  precision_score smallint,
  completeness_score smallint,
  usefulness_score smallint,
  hallucination_score smallint,
  latency_score smallint,
  notes text,
  evaluator text NOT NULL DEFAULT 'human',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_test_evaluations_run_evaluator
  ON public.test_evaluations(test_run_id, evaluator);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.test_evaluations TO anon, authenticated;
GRANT ALL ON public.test_evaluations TO service_role;
ALTER TABLE public.test_evaluations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Lab open access" ON public.test_evaluations FOR ALL USING (true) WITH CHECK (true);
