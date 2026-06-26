
-- =========================================================
-- Lab de validação de base de conhecimento híbrida (MVP v2)
-- Sem auth / multi-tenancy. Acesso público anon para tudo.
-- =========================================================

-- PROJECTS
CREATE TABLE public.projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.projects TO anon, authenticated;
GRANT ALL ON public.projects TO service_role;
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
CREATE POLICY "lab open access" ON public.projects FOR ALL USING (true) WITH CHECK (true);

-- RAW SOURCES
CREATE TABLE public.raw_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN ('csv','text')),
  filename text,
  uploaded_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX raw_sources_project_idx ON public.raw_sources(project_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.raw_sources TO anon, authenticated;
GRANT ALL ON public.raw_sources TO service_role;
ALTER TABLE public.raw_sources ENABLE ROW LEVEL SECURITY;
CREATE POLICY "lab open access" ON public.raw_sources FOR ALL USING (true) WITH CHECK (true);

-- RAW CHUNKS
CREATE TABLE public.raw_chunks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  raw_source_id uuid NOT NULL REFERENCES public.raw_sources(id) ON DELETE CASCADE,
  content text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX raw_chunks_source_idx ON public.raw_chunks(raw_source_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.raw_chunks TO anon, authenticated;
GRANT ALL ON public.raw_chunks TO service_role;
ALTER TABLE public.raw_chunks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "lab open access" ON public.raw_chunks FOR ALL USING (true) WITH CHECK (true);

-- TOPIC DEFINITIONS (catálogo)
CREATE TABLE public.topic_definitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  description text,
  aliases text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.topic_definitions TO anon, authenticated;
GRANT ALL ON public.topic_definitions TO service_role;
ALTER TABLE public.topic_definitions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "lab open access" ON public.topic_definitions FOR ALL USING (true) WITH CHECK (true);

-- TOPICS (instância por projeto)
CREATE TABLE public.topics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  topic_definition_id uuid NOT NULL REFERENCES public.topic_definitions(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, topic_definition_id)
);
CREATE INDEX topics_project_idx ON public.topics(project_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.topics TO anon, authenticated;
GRANT ALL ON public.topics TO service_role;
ALTER TABLE public.topics ENABLE ROW LEVEL SECURITY;
CREATE POLICY "lab open access" ON public.topics FOR ALL USING (true) WITH CHECK (true);

-- KNOWLEDGE FIELDS (DataPoint + DynamicAttribute unificados)
CREATE TABLE public.knowledge_fields (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  topic_id uuid NOT NULL REFERENCES public.topics(id) ON DELETE CASCADE,
  field_name text NOT NULL,
  field_type text NOT NULL CHECK (field_type IN ('string','number','time','boolean','money','enum','text')),
  field_value jsonb,
  field_origin text NOT NULL CHECK (field_origin IN ('core','dynamic')),
  confidence numeric(4,3),
  source_chunk_ids uuid[] NOT NULL DEFAULT '{}',
  verified boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX knowledge_fields_topic_idx ON public.knowledge_fields(topic_id);
CREATE INDEX knowledge_fields_topic_origin_idx ON public.knowledge_fields(topic_id, field_origin);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.knowledge_fields TO anon, authenticated;
GRANT ALL ON public.knowledge_fields TO service_role;
ALTER TABLE public.knowledge_fields ENABLE ROW LEVEL SECURITY;
CREATE POLICY "lab open access" ON public.knowledge_fields FOR ALL USING (true) WITH CHECK (true);

-- ADDITIONAL INFO (texto livre por tópico)
CREATE TABLE public.additional_info (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  topic_id uuid NOT NULL REFERENCES public.topics(id) ON DELETE CASCADE,
  content text NOT NULL,
  source_chunk_ids uuid[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX additional_info_topic_idx ON public.additional_info(topic_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.additional_info TO anon, authenticated;
GRANT ALL ON public.additional_info TO service_role;
ALTER TABLE public.additional_info ENABLE ROW LEVEL SECURITY;
CREATE POLICY "lab open access" ON public.additional_info FOR ALL USING (true) WITH CHECK (true);

-- PROMPT TEMPLATES
CREATE TABLE public.prompt_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  type text NOT NULL CHECK (type IN ('extraction','answer','topic_routing')),
  content text NOT NULL,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.prompt_templates TO anon, authenticated;
GRANT ALL ON public.prompt_templates TO service_role;
ALTER TABLE public.prompt_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "lab open access" ON public.prompt_templates FOR ALL USING (true) WITH CHECK (true);

-- MODEL CONFIGURATIONS
CREATE TABLE public.model_configurations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  model_name text NOT NULL,
  api_key text,
  temperature numeric(3,2) NOT NULL DEFAULT 0.2,
  max_tokens integer NOT NULL DEFAULT 2048,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.model_configurations TO anon, authenticated;
GRANT ALL ON public.model_configurations TO service_role;
ALTER TABLE public.model_configurations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "lab open access" ON public.model_configurations FOR ALL USING (true) WITH CHECK (true);

-- EXTRACTION RUNS
CREATE TABLE public.extraction_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  raw_source_ids uuid[] NOT NULL DEFAULT '{}',
  mode text NOT NULL CHECK (mode IN ('dry_run','persist')),
  prompt_template_id uuid REFERENCES public.prompt_templates(id),
  model_configuration_id uuid REFERENCES public.model_configurations(id),
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','done','failed')),
  preview_result jsonb,
  stats jsonb NOT NULL DEFAULT '{}'::jsonb,
  error text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX extraction_runs_project_idx ON public.extraction_runs(project_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.extraction_runs TO anon, authenticated;
GRANT ALL ON public.extraction_runs TO service_role;
ALTER TABLE public.extraction_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "lab open access" ON public.extraction_runs FOR ALL USING (true) WITH CHECK (true);

-- LLM CALLS (auditoria + custo)
CREATE TABLE public.llm_calls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prompt_type text NOT NULL,
  model_name text NOT NULL,
  input_tokens integer,
  output_tokens integer,
  latency integer,
  estimated_cost numeric(10,6),
  response jsonb,
  extraction_run_id uuid REFERENCES public.extraction_runs(id) ON DELETE SET NULL,
  test_run_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX llm_calls_created_idx ON public.llm_calls(created_at DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.llm_calls TO anon, authenticated;
GRANT ALL ON public.llm_calls TO service_role;
ALTER TABLE public.llm_calls ENABLE ROW LEVEL SECURITY;
CREATE POLICY "lab open access" ON public.llm_calls FOR ALL USING (true) WITH CHECK (true);

-- TEST QUESTIONS
CREATE TABLE public.test_questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  question text NOT NULL,
  expected_answer text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX test_questions_project_idx ON public.test_questions(project_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.test_questions TO anon, authenticated;
GRANT ALL ON public.test_questions TO service_role;
ALTER TABLE public.test_questions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "lab open access" ON public.test_questions FOR ALL USING (true) WITH CHECK (true);

-- TEST RUNS
CREATE TABLE public.test_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id uuid NOT NULL REFERENCES public.test_questions(id) ON DELETE CASCADE,
  mode text NOT NULL CHECK (mode IN ('structured','raw_chunks')),
  prompt_template_id uuid REFERENCES public.prompt_templates(id),
  model_configuration_id uuid REFERENCES public.model_configurations(id),
  context_sent jsonb,
  answer text,
  llm_call_id uuid REFERENCES public.llm_calls(id) ON DELETE SET NULL,
  human_score integer,
  human_notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX test_runs_question_idx ON public.test_runs(question_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.test_runs TO anon, authenticated;
GRANT ALL ON public.test_runs TO service_role;
ALTER TABLE public.test_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "lab open access" ON public.test_runs FOR ALL USING (true) WITH CHECK (true);
