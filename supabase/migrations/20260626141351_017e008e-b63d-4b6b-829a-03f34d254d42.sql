
ALTER TABLE public.raw_chunks
  ADD COLUMN IF NOT EXISTS extraction_status text NOT NULL DEFAULT 'not_processed';

ALTER TABLE public.raw_chunks
  DROP CONSTRAINT IF EXISTS raw_chunks_extraction_status_check;
ALTER TABLE public.raw_chunks
  ADD CONSTRAINT raw_chunks_extraction_status_check
  CHECK (extraction_status IN ('not_processed','extracted','no_knowledge_found','marked_irrelevant','retry_needed'));

CREATE INDEX IF NOT EXISTS raw_chunks_extraction_status_idx
  ON public.raw_chunks (extraction_status);
