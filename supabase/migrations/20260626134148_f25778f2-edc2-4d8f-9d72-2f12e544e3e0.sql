
ALTER TABLE public.data_point_definitions
  ADD COLUMN IF NOT EXISTS extraction_strategy TEXT NOT NULL DEFAULT 'llm'
    CHECK (extraction_strategy IN ('regex','keyword','hybrid','llm')),
  ADD COLUMN IF NOT EXISTS regex_pattern TEXT,
  ADD COLUMN IF NOT EXISTS keywords JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS negative_keywords JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS extraction_examples JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.knowledge_candidates
  ADD COLUMN IF NOT EXISTS extraction_method TEXT NOT NULL DEFAULT 'llm'
    CHECK (extraction_method IN ('regex','keyword','llm'));

ALTER TABLE public.extraction_settings
  ADD COLUMN IF NOT EXISTS use_llm_for_dynamic BOOLEAN NOT NULL DEFAULT true;

-- Strategy defaults by field_type for rows still at the column default
UPDATE public.data_point_definitions SET extraction_strategy = 'hybrid'
  WHERE extraction_strategy = 'llm'
    AND field_type IN ('time','time_range','currency','number','boolean','enum');

-- Per-field overrides per Etapa 3 spec
UPDATE public.data_point_definitions SET extraction_strategy = 'keyword'
  WHERE field_name IN (
    'breakfast_available','checkin_self','checkin_early_allowed','luggage_storage',
    'parking_available','restaurant_available',
    'has_pool','heated_pool','pool_towel','pool_paid',
    'gym_available','gym_instructor','gym_class',
    'pets_allowed','transfer_available'
  );

UPDATE public.data_point_definitions SET extraction_strategy = 'hybrid'
  WHERE field_name IN (
    'breakfast_start_time','breakfast_end_time','breakfast_price',
    'checkin_time','luggage_storage_price','checkout_time',
    'parking_price','restaurant_count',
    'pool_temperature','pool_price',
    'gym_price','pets_price','transfer_price'
  );

UPDATE public.data_point_definitions SET extraction_strategy = 'llm'
  WHERE field_name IN (
    'breakfast_diets','breakfast_location',
    'parking_area','restaurant_diets','transfer_contact'
  );

-- Default boolean keywords
UPDATE public.data_point_definitions
  SET keywords = jsonb_build_object(
        'positive', to_jsonb(ARRAY['sim','possui','disponível','disponivel','incluso','incluído','incluido','gratuito','permitido','aceita','oferece','conta com']),
        'negative', to_jsonb(ARRAY['não possui','nao possui','indisponível','indisponivel','não disponível','nao disponivel','não incluso','nao incluso','não incluído','nao incluido','proibido','não aceita','nao aceita','não oferece','nao oferece','sem'])
      )
  WHERE field_type = 'boolean' AND extraction_strategy = 'keyword' AND (keywords = '{}'::jsonb OR keywords IS NULL);
