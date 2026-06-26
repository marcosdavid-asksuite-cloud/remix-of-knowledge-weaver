
-- Knowledge candidates
CREATE TABLE IF NOT EXISTS public.knowledge_candidates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  extraction_run_id UUID REFERENCES public.extraction_runs(id) ON DELETE SET NULL,
  topic_definition_id UUID NOT NULL REFERENCES public.topic_definitions(id) ON DELETE CASCADE,
  field_name TEXT NOT NULL,
  field_type TEXT NOT NULL CHECK (field_type IN ('text','boolean','number','currency','time','time_range','enum','multi_select')),
  field_value JSONB,
  field_origin TEXT NOT NULL CHECK (field_origin IN ('core','dynamic')),
  confidence NUMERIC(4,3),
  source_chunk_ids UUID[] NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS knowledge_candidates_project_idx ON public.knowledge_candidates(project_id);
CREATE INDEX IF NOT EXISTS knowledge_candidates_run_idx ON public.knowledge_candidates(extraction_run_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.knowledge_candidates TO anon, authenticated;
GRANT ALL ON public.knowledge_candidates TO service_role;
ALTER TABLE public.knowledge_candidates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "lab open access" ON public.knowledge_candidates FOR ALL USING (true) WITH CHECK (true);

-- Relax knowledge_fields type check to include new types
ALTER TABLE public.knowledge_fields DROP CONSTRAINT IF EXISTS knowledge_fields_field_type_check;
ALTER TABLE public.knowledge_fields ADD CONSTRAINT knowledge_fields_field_type_check
  CHECK (field_type IN ('text','boolean','number','currency','time','time_range','enum','multi_select','string','money'));

-- Extraction settings singleton
CREATE TABLE IF NOT EXISTS public.extraction_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  singleton BOOLEAN NOT NULL DEFAULT true UNIQUE,
  chunk_size INTEGER NOT NULL DEFAULT 800,
  max_chunks INTEGER NOT NULL DEFAULT 20,
  temperature NUMERIC(3,2) NOT NULL DEFAULT 0.1,
  system_prompt TEXT NOT NULL,
  extraction_prompt TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.extraction_settings TO anon, authenticated;
GRANT ALL ON public.extraction_settings TO service_role;
ALTER TABLE public.extraction_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "lab open access" ON public.extraction_settings FOR ALL USING (true) WITH CHECK (true);

INSERT INTO public.extraction_settings (singleton, system_prompt, extraction_prompt) VALUES (
  true,
  'Você é um extrator de fatos para uma base de conhecimento hoteleira. Regras absolutas:
1. NUNCA invente informações.
2. NUNCA preencha campos vazios.
3. NUNCA infira valores além do que está explícito no texto.
4. Extraia somente fatos literalmente presentes no texto.
5. Responda EXCLUSIVAMENTE com JSON válido conforme o formato pedido. Sem markdown, sem comentários.',
  'TÓPICO: {{topic_slug}} — {{topic_name}}
Descrição: {{topic_description}}

DATA POINTS OFICIAIS (core_fields permitidos):
{{data_points}}

TIPOS PERMITIDOS para dynamic_fields: text, boolean, number, currency, time, time_range, multi_select.

TEXTO:
"""
{{chunk}}
"""

Retorne EXCLUSIVAMENTE JSON neste formato:
{
  "core_fields": [ { "field_name": "...", "field_value": ..., "confidence": 0.0 } ],
  "dynamic_fields": [ { "field_name": "...", "field_type": "...", "field_value": ..., "confidence": 0.0 } ],
  "additional_information": [ "texto livre relevante ao tópico" ]
}
Se nada estiver explicitamente no texto, retorne arrays vazios.'
) ON CONFLICT (singleton) DO NOTHING;
