
-- External agents (OpenAI-compatible or custom endpoints)
CREATE TABLE public.external_agents (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID REFERENCES public.projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  auth_type TEXT NOT NULL DEFAULT 'bearer', -- bearer | header | none
  auth_header_name TEXT,
  api_key TEXT, -- stored as-is (lab tool); UI will mask
  custom_headers JSONB NOT NULL DEFAULT '{}'::jsonb,
  model TEXT,
  temperature NUMERIC DEFAULT 0.2,
  timeout_ms INTEGER DEFAULT 30000,
  -- payload shape mapping
  payload_template JSONB, -- optional override; null = openai-chat default
  response_path TEXT DEFAULT 'choices.0.message.content', -- dot-path to assistant text
  -- context builder defaults
  context_options JSONB NOT NULL DEFAULT '{"structured":true,"additional":true,"raw_chunks":false,"dynamic":true,"source_metadata":false,"topic_metadata":true}'::jsonb,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.external_agents TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.external_agents TO anon;
GRANT ALL ON public.external_agents TO service_role;
ALTER TABLE public.external_agents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "open external_agents" ON public.external_agents FOR ALL USING (true) WITH CHECK (true);
CREATE TRIGGER trg_external_agents_updated BEFORE UPDATE ON public.external_agents FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Lab settings (one row per project)
CREATE TABLE public.lab_settings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL UNIQUE REFERENCES public.projects(id) ON DELETE CASCADE,
  settings JSONB NOT NULL DEFAULT '{
    "regex_enabled": true,
    "keyword_enabled": true,
    "llm_enabled": true,
    "dynamic_fields_enabled": true,
    "additional_info_enabled": true,
    "schema_evolution_enabled": true,
    "health_score_enabled": true,
    "consolidation_enabled": true,
    "prompt_version": "v1",
    "model_version": "google/gemini-3-flash-preview",
    "chunk_size": 800,
    "top_chunks": 20
  }'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.lab_settings TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.lab_settings TO anon;
GRANT ALL ON public.lab_settings TO service_role;
ALTER TABLE public.lab_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "open lab_settings" ON public.lab_settings FOR ALL USING (true) WITH CHECK (true);
CREATE TRIGGER trg_lab_settings_updated BEFORE UPDATE ON public.lab_settings FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Experiment snapshots
CREATE TABLE public.experiment_snapshots (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  overall_score NUMERIC,
  payload JSONB NOT NULL, -- {lab_settings, health, benchmark, schema_summary, model, prompt_version}
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.experiment_snapshots TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.experiment_snapshots TO anon;
GRANT ALL ON public.experiment_snapshots TO service_role;
ALTER TABLE public.experiment_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "open snapshots" ON public.experiment_snapshots FOR ALL USING (true) WITH CHECK (true);

-- Link test_runs to external_agent
ALTER TABLE public.test_runs ADD COLUMN IF NOT EXISTS external_agent_id UUID REFERENCES public.external_agents(id) ON DELETE SET NULL;
ALTER TABLE public.test_runs ADD COLUMN IF NOT EXISTS request_payload JSONB;
