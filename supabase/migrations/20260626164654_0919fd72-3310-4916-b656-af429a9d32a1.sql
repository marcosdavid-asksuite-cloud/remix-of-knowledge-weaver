
UPDATE public.data_point_definitions
SET field_type='boolean'
WHERE field_name IN ('breakfast_available','wifi_available','parking_available','pool_available','gym_available','restaurant_available','transfer_available');

UPDATE public.knowledge_fields
SET field_type='boolean',
    field_value = to_jsonb(true)
WHERE field_name IN ('breakfast_available','wifi_available','parking_available','pool_available','gym_available','restaurant_available','transfer_available')
  AND approved_by_user = false
  AND field_value::text NOT IN ('true','false');

-- Clean orphan dynamic fields polluting breakfast topic
DELETE FROM public.knowledge_fields kf
USING public.topics t, public.topic_definitions td
WHERE kf.topic_id = t.id
  AND t.topic_definition_id = td.id
  AND td.slug = 'breakfast'
  AND kf.approved_by_user = false
  AND kf.field_name IN ('elevator_availability','has_elevator','hotel_floors');
