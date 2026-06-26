
-- Breakfast
UPDATE public.data_point_definitions SET extraction_strategy='hybrid', regex_pattern='(\d{1,2})\s*[:hH]\s*(\d{0,2})'
WHERE field_name IN ('breakfast_start_time','breakfast_end_time','checkin_time','checkout_time') AND (regex_pattern IS NULL OR regex_pattern='');

UPDATE public.data_point_definitions SET extraction_strategy='hybrid',
keywords='{"positive":["incluso","incluído","incluido","grátis","gratis","gratuito","oferecido","cortesia","sem custo"],"negative":["não incluso","nao incluso","não incluído","nao incluido","não oferece","nao oferece","cobrado","pago à parte","pago a parte","extra"]}'::jsonb
WHERE field_name IN ('breakfast_available','breakfast_included','wifi_available','wifi_included','parking_available','pool_available','gym_available','restaurant_available','transfer_available')
AND (keywords IS NULL OR keywords='{}'::jsonb);

UPDATE public.data_point_definitions SET extraction_strategy='hybrid',
keywords='{"positive":["aceita pets","permite pets","pet friendly","pet-friendly","aceita animais","permite animais"],"negative":["não aceita pets","nao aceita pets","não permite pets","nao permite pets","proibido pets","sem pets"]}'::jsonb
WHERE field_name IN ('pets_allowed','allow_pets')
AND (keywords IS NULL OR keywords='{}'::jsonb);
