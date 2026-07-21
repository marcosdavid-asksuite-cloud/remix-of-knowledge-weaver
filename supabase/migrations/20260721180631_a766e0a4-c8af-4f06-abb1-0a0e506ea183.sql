ALTER TABLE public.extraction_settings ADD COLUMN IF NOT EXISTS unified_prompt text;
UPDATE public.extraction_settings
  SET unified_prompt = coalesce(system_prompt,'') || E'\n\n' || coalesce(extraction_prompt,'')
  WHERE unified_prompt IS NULL OR unified_prompt = '';