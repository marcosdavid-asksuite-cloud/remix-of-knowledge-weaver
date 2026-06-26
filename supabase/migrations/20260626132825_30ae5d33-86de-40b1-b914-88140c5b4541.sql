
-- Table
CREATE TABLE IF NOT EXISTS public.data_point_definitions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  topic_definition_id UUID NOT NULL REFERENCES public.topic_definitions(id) ON DELETE CASCADE,
  field_name TEXT NOT NULL,
  field_label TEXT NOT NULL,
  field_type TEXT NOT NULL CHECK (field_type IN ('text','boolean','number','currency','time','time_range','enum','multi_select')),
  description TEXT,
  required BOOLEAN NOT NULL DEFAULT false,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (topic_definition_id, field_name)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.data_point_definitions TO anon, authenticated;
GRANT ALL ON public.data_point_definitions TO service_role;

ALTER TABLE public.data_point_definitions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "lab open access" ON public.data_point_definitions FOR ALL USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.update_updated_at_column() RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql SET search_path = public;

DROP TRIGGER IF EXISTS update_dpd_updated_at ON public.data_point_definitions;
CREATE TRIGGER update_dpd_updated_at BEFORE UPDATE ON public.data_point_definitions
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Normalize existing topic slugs
UPDATE public.topic_definitions SET slug='checkin'  WHERE slug='check_in';
UPDATE public.topic_definitions SET slug='checkout' WHERE slug='check_out';

-- Seed/refresh topic definitions
INSERT INTO public.topic_definitions (slug, name, description, aliases) VALUES
  ('breakfast','Café da Manhã','Informações sobre o café da manhã do hotel', ARRAY['café da manhã','cafe da manha','breakfast','pequeno almoço','buffet','desjejum']),
  ('checkin','Check-in','Horários e regras de entrada', ARRAY['checkin','check-in','check in','entrada','chegada']),
  ('checkout','Check-out','Horários e regras de saída', ARRAY['checkout','check-out','check out','saída','saida']),
  ('parking','Estacionamento','Disponibilidade, preço e localização do estacionamento', ARRAY['estacionamento','garagem','parking','valet']),
  ('restaurant','Restaurante','Restaurantes do hotel', ARRAY['restaurante','restaurant','jantar','almoço','dining']),
  ('pool','Piscina','Piscinas e regras de uso', ARRAY['piscina','pool','swimming pool']),
  ('gym','Academia','Academia e fitness center', ARRAY['academia','fitness','gym','fitness center']),
  ('pets','Pets','Política de animais de estimação', ARRAY['pets','animais','pet friendly','cachorro','gato']),
  ('transfer','Transfer','Serviço de traslado', ARRAY['transfer','transporte','traslado','aeroporto','shuttle'])
ON CONFLICT (slug) DO UPDATE
  SET name = EXCLUDED.name,
      description = EXCLUDED.description,
      aliases = EXCLUDED.aliases;

-- Helper to insert data points
DO $$
DECLARE
  t RECORD;
  rows JSONB := '[
    {"t":"breakfast","f":"breakfast_available","l":"Café da manhã disponível","ty":"enum"},
    {"t":"breakfast","f":"breakfast_start_time","l":"Início do café","ty":"time"},
    {"t":"breakfast","f":"breakfast_end_time","l":"Fim do café","ty":"time"},
    {"t":"breakfast","f":"breakfast_price","l":"Preço do café","ty":"currency"},
    {"t":"breakfast","f":"breakfast_diets","l":"Dietas atendidas","ty":"multi_select"},
    {"t":"breakfast","f":"breakfast_location","l":"Local do café","ty":"text"},

    {"t":"checkin","f":"checkin_time","l":"Horário de check-in","ty":"time"},
    {"t":"checkin","f":"checkin_self","l":"Self check-in","ty":"boolean"},
    {"t":"checkin","f":"checkin_early_allowed","l":"Permite early check-in","ty":"boolean"},
    {"t":"checkin","f":"luggage_storage","l":"Guarda-volumes","ty":"boolean"},
    {"t":"checkin","f":"luggage_storage_price","l":"Preço do guarda-volumes","ty":"currency"},

    {"t":"checkout","f":"checkout_time","l":"Horário de check-out","ty":"time"},

    {"t":"parking","f":"parking_available","l":"Estacionamento disponível","ty":"enum"},
    {"t":"parking","f":"parking_price","l":"Preço do estacionamento","ty":"currency"},
    {"t":"parking","f":"parking_area","l":"Localização do estacionamento","ty":"text"},

    {"t":"restaurant","f":"restaurant_available","l":"Possui restaurante","ty":"boolean"},
    {"t":"restaurant","f":"restaurant_count","l":"Quantidade de restaurantes","ty":"number"},
    {"t":"restaurant","f":"restaurant_diets","l":"Dietas atendidas","ty":"multi_select"},

    {"t":"pool","f":"has_pool","l":"Possui piscina","ty":"boolean"},
    {"t":"pool","f":"heated_pool","l":"Piscina aquecida","ty":"boolean"},
    {"t":"pool","f":"pool_temperature","l":"Temperatura da piscina","ty":"text"},
    {"t":"pool","f":"pool_towel","l":"Fornece toalha de piscina","ty":"boolean"},
    {"t":"pool","f":"pool_paid","l":"Uso da piscina é pago","ty":"boolean"},
    {"t":"pool","f":"pool_price","l":"Preço da piscina","ty":"currency"},

    {"t":"gym","f":"gym_available","l":"Academia disponível","ty":"enum"},
    {"t":"gym","f":"gym_price","l":"Preço da academia","ty":"currency"},
    {"t":"gym","f":"gym_instructor","l":"Possui instrutor","ty":"boolean"},
    {"t":"gym","f":"gym_class","l":"Possui aulas","ty":"boolean"},

    {"t":"pets","f":"pets_allowed","l":"Aceita pets","ty":"enum"},
    {"t":"pets","f":"pets_price","l":"Taxa para pets","ty":"currency"},

    {"t":"transfer","f":"transfer_available","l":"Transfer disponível","ty":"enum"},
    {"t":"transfer","f":"transfer_price","l":"Preço do transfer","ty":"currency"},
    {"t":"transfer","f":"transfer_contact","l":"Contato do transfer","ty":"text"}
  ]'::jsonb;
  r JSONB;
  topic_id UUID;
BEGIN
  FOR r IN SELECT * FROM jsonb_array_elements(rows) LOOP
    SELECT id INTO topic_id FROM public.topic_definitions WHERE slug = r->>'t';
    IF topic_id IS NOT NULL THEN
      INSERT INTO public.data_point_definitions (topic_definition_id, field_name, field_label, field_type)
      VALUES (topic_id, r->>'f', r->>'l', r->>'ty')
      ON CONFLICT (topic_definition_id, field_name) DO NOTHING;
    END IF;
  END LOOP;
END $$;
