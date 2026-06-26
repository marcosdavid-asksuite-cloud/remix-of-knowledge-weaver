
-- 1) Upsert topics (add new ones; keep existing slugs)
INSERT INTO public.topic_definitions (slug, name, description, aliases) VALUES
  ('hotel_info','Informações do Hotel','Identidade e moeda', ARRAY['hotel','nome','moeda','currency','identidade']),
  ('contact','Contatos','Canais e e-mails de contato', ARRAY['contato','contatos','email','telefone','whatsapp']),
  ('front_desk','Recepção','Recepção / front desk', ARRAY['recepcao','recepção','front desk','portaria']),
  ('luggage','Bagagem','Guarda-volumes', ARRAY['bagagem','mala','malas','guarda-volumes','luggage']),
  ('policies','Políticas','Políticas gerais: crianças, fumantes, voltagem', ARRAY['politicas','políticas','regras','crianças','criancas','fumar','fumantes','voltagem']),
  ('massage','Massagem','Serviço de massagem', ARRAY['massagem','spa','massage']),
  ('room_service','Room Service','Serviço de quarto', ARRAY['room service','serviço de quarto','servico de quarto']),
  ('laundry','Lavanderia','Lavanderia', ARRAY['lavanderia','laundry','roupa']),
  ('day_use','Day Use','Day use', ARRAY['day use','dayuse','uso diurno']),
  ('sauna','Sauna','Sauna', ARRAY['sauna']),
  ('events','Eventos','Espaços para eventos', ARRAY['eventos','evento','salão','salao','convenções','convencoes']),
  ('payment','Pagamento','Formas e políticas de pagamento', ARRAY['pagamento','pagamentos','cartão','cartao','pix','boleto','parcelamento','cancelamento']),
  ('address','Endereço','Endereço do hotel', ARRAY['endereço','endereco','localização','localizacao','address']),
  ('transport','Transporte','Aeroporto, rodoviária e distâncias', ARRAY['aeroporto','rodoviaria','rodoviária','onibus','ônibus','transporte público','transporte publico'])
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  aliases = EXCLUDED.aliases;

-- Expand aliases of existing topics to better match survey vocabulary
UPDATE public.topic_definitions SET aliases = ARRAY['checkin','check-in','check in','entrada','chegada','checkin antecipado','early check-in','self check-in'] WHERE slug='checkin';
UPDATE public.topic_definitions SET aliases = ARRAY['checkout','check-out','check out','saída','saida','late check-out'] WHERE slug='checkout';
UPDATE public.topic_definitions SET aliases = ARRAY['wifi','wi-fi','internet','rede','senha','wifi areas'] WHERE slug='wifi';
UPDATE public.topic_definitions SET aliases = ARRAY['quarto','quartos','apartamento','suite','berço','berco','cama extra','panel room'] WHERE slug='rooms';
UPDATE public.topic_definitions SET aliases = ARRAY['transfer','traslado','shuttle','translado'] WHERE slug='transfer';

-- 2) Clear current core fields and reseed from SurveyHotelData
DELETE FROM public.data_point_definitions;

-- Helper: insertion via subselect by slug
WITH td AS (SELECT slug, id FROM public.topic_definitions)
INSERT INTO public.data_point_definitions
  (topic_definition_id, field_name, field_label, field_type, description, required, extraction_strategy, regex_pattern, keywords, negative_keywords)
SELECT td.id, v.field_name, v.field_label, v.field_type, v.description, v.required, v.extraction_strategy, v.regex_pattern, v.keywords, v.negative_keywords
FROM td JOIN (VALUES
  -- hotel_info
  ('hotel_info','hotel_name','Nome do hotel','text','Nome oficial do hotel',true,'llm',NULL,'{}'::jsonb,'[]'::jsonb),
  ('hotel_info','ai_name','Nome da IA','text','Nome do assistente virtual',false,'llm',NULL,'{}'::jsonb,'[]'::jsonb),
  ('hotel_info','welcome_text','Texto de boas-vindas','text','Mensagem inicial ao hóspede',false,'llm',NULL,'{}'::jsonb,'[]'::jsonb),
  ('hotel_info','currency_code','Código da moeda','text','BRL, USD, EUR...',false,'llm',NULL,'{}'::jsonb,'[]'::jsonb),
  ('hotel_info','currency_display','Exibição da moeda','text','Símbolo/forma de exibir',false,'llm',NULL,'{}'::jsonb,'[]'::jsonb),

  -- contact
  ('contact','contact_channels','Canais de contato','text','Telefone, WhatsApp, email gerais',false,'llm',NULL,'{}'::jsonb,'[]'::jsonb),
  ('contact','email_general','E-mail geral','text','Endereço de e-mail principal',false,'llm','([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})','{}'::jsonb,'[]'::jsonb),
  ('contact','email_reservations','E-mail de reservas','text','Confirmação/alteração de reservas',false,'llm',NULL,'{}'::jsonb,'[]'::jsonb),
  ('contact','email_groups','E-mail para grupos','text','Solicitações de grupo',false,'llm',NULL,'{}'::jsonb,'[]'::jsonb),

  -- front_desk
  ('front_desk','front_desk_exists','Possui recepção?','boolean','Existe recepção física',false,'keyword',NULL,'{"positive":["recepcao","recepção","front desk","possui recepção"],"negative":["sem recepção","sem recepcao"]}'::jsonb,'[]'::jsonb),
  ('front_desk','front_desk_24h','Recepção 24h?','boolean','Atendimento 24 horas',false,'keyword',NULL,'{"positive":["24 horas","24h","sempre aberta","full time"],"negative":["horário limitado","horario limitado"]}'::jsonb,'[]'::jsonb),
  ('front_desk','front_desk_start_time','Abertura da recepção','time','Início do atendimento',false,'hybrid',NULL,'{}'::jsonb,'[]'::jsonb),
  ('front_desk','front_desk_end_time','Fechamento da recepção','time','Fim do atendimento',false,'hybrid',NULL,'{}'::jsonb,'[]'::jsonb),

  -- checkin
  ('checkin','checkin_time','Horário de check-in','time','Horário a partir do qual o check-in é permitido',true,'hybrid',NULL,'{}'::jsonb,'[]'::jsonb),
  ('checkin','checkin_self','Self check-in disponível?','boolean','Check-in autônomo',false,'keyword',NULL,'{"positive":["self check-in","self checkin","autoatendimento","totem"],"negative":["sem self check-in"]}'::jsonb,'[]'::jsonb),
  ('checkin','early_checkin_allowed','Check-in antecipado permitido?','boolean','Permite chegada antes do horário',false,'keyword',NULL,'{"positive":["early check-in","check-in antecipado","antecipado","mais cedo"],"negative":["não permite antecipado","nao permite antecipado"]}'::jsonb,'[]'::jsonb),
  ('checkin','late_checkin_policy','Política de check-in tardio','text','Procedimento para chegadas tardias',false,'llm',NULL,'{}'::jsonb,'[]'::jsonb),

  -- checkout
  ('checkout','checkout_time','Horário de check-out','time','Horário limite do check-out',true,'hybrid',NULL,'{}'::jsonb,'[]'::jsonb),
  ('checkout','late_checkout_allowed','Late check-out permitido?','boolean','Permite saída após o horário',false,'keyword',NULL,'{"positive":["late check-out","late checkout","check-out tardio","saida tardia"],"negative":["não permite late check-out"]}'::jsonb,'[]'::jsonb),
  ('checkout','late_checkout_fee','Taxa de late check-out','currency','Valor cobrado para saída tardia',false,'hybrid',NULL,'{}'::jsonb,'[]'::jsonb),

  -- luggage
  ('luggage','luggage_storage','Guarda-volumes disponível?','boolean','Guarda bagagem antes/depois do check-in',false,'keyword',NULL,'{"positive":["guarda-volumes","guarda volumes","guarda bagagem","bagageiro"],"negative":["sem guarda-volumes"]}'::jsonb,'[]'::jsonb),
  ('luggage','luggage_price','Preço do guarda-volumes','currency','Valor cobrado pelo serviço',false,'hybrid',NULL,'{}'::jsonb,'[]'::jsonb),

  -- policies
  ('policies','pets_allowed','Aceita pets?','boolean','Hotel aceita animais',false,'keyword',NULL,'{"positive":["aceita pets","pet friendly","permite animais","aceitamos pets"],"negative":["não aceita pets","nao aceita pets","sem pets"]}'::jsonb,'[]'::jsonb),
  ('policies','children_allowed','Aceita crianças?','boolean','Hotel aceita crianças',false,'keyword',NULL,'{"positive":["aceita crianças","family friendly","permite crianças"],"negative":["adults only","apenas adultos","sem crianças"]}'::jsonb,'[]'::jsonb),
  ('policies','children_age_policy','Política de idade infantil','text','Regras por faixa etária',false,'llm',NULL,'{}'::jsonb,'[]'::jsonb),
  ('policies','smoking_allowed','Permite fumar?','boolean','Permite fumar em alguma área',false,'keyword',NULL,'{"positive":["permite fumar","área de fumantes","fumódromo"],"negative":["proibido fumar","não fumantes","smoke free"]}'::jsonb,'[]'::jsonb),
  ('policies','smoking_areas','Áreas para fumantes','text','Locais onde fumar é permitido',false,'llm',NULL,'{}'::jsonb,'[]'::jsonb),
  ('policies','hotel_voltage','Voltagem do hotel','text','110V, 220V, bivolt',false,'keyword',NULL,'{"positive":["110v","220v","bivolt","127v"]}'::jsonb,'[]'::jsonb),

  -- pets (pricing detail)
  ('pets','pets_fee','Taxa para pets','currency','Valor cobrado por pet',false,'hybrid',NULL,'{}'::jsonb,'[]'::jsonb),
  ('pets','pets_restrictions','Restrições para pets','text','Porte, raça, quantidade',false,'llm',NULL,'{}'::jsonb,'[]'::jsonb),

  -- breakfast
  ('breakfast','breakfast_available','Café da manhã disponível?','boolean','Hotel serve café da manhã',false,'keyword',NULL,'{"positive":["café da manhã","cafe da manha","breakfast","buffet"],"negative":["sem café","não serve café"]}'::jsonb,'[]'::jsonb),
  ('breakfast','breakfast_included','Café incluso na diária?','boolean','Café incluso ou pago à parte',false,'keyword',NULL,'{"positive":["incluso","incluído","grátis","sem custo adicional"],"negative":["pago à parte","não incluso","cobrado à parte"]}'::jsonb,'[]'::jsonb),
  ('breakfast','breakfast_start_time','Início do café da manhã','time','Horário inicial',false,'hybrid',NULL,'{}'::jsonb,'[]'::jsonb),
  ('breakfast','breakfast_end_time','Fim do café da manhã','time','Horário final',false,'hybrid',NULL,'{}'::jsonb,'[]'::jsonb),
  ('breakfast','breakfast_price','Preço do café da manhã','currency','Valor avulso',false,'hybrid',NULL,'{}'::jsonb,'[]'::jsonb),
  ('breakfast','breakfast_location','Local do café','text','Onde é servido',false,'llm',NULL,'{}'::jsonb,'[]'::jsonb),
  ('breakfast','breakfast_diets','Opções de dieta','multi_select','Vegetariano, vegano, sem glúten...',false,'llm',NULL,'{}'::jsonb,'[]'::jsonb),

  -- parking
  ('parking','parking_available','Estacionamento disponível?','boolean','Possui estacionamento',false,'keyword',NULL,'{"positive":["estacionamento","garagem","valet","parking"],"negative":["sem estacionamento","não possui estacionamento"]}'::jsonb,'[]'::jsonb),
  ('parking','parking_price','Diária do estacionamento','currency','Valor por dia',false,'hybrid',NULL,'{}'::jsonb,'[]'::jsonb),
  ('parking','parking_area','Tipo/local','text','Coberto, descoberto, valet...',false,'llm',NULL,'{}'::jsonb,'[]'::jsonb),

  -- massage
  ('massage','massage_available','Massagem disponível?','boolean','Hotel oferece massagem',false,'keyword',NULL,'{"positive":["massagem","spa","massage"],"negative":["sem massagem"]}'::jsonb,'[]'::jsonb),
  ('massage','massage_price','Preço da massagem','currency','Valor do serviço',false,'hybrid',NULL,'{}'::jsonb,'[]'::jsonb),
  ('massage','massage_schedule_required','Precisa agendar?','boolean','Necessita reserva prévia',false,'keyword',NULL,'{"positive":["agendamento","reserva","schedule"],"negative":["sem agendamento"]}'::jsonb,'[]'::jsonb),
  ('massage','massage_start_time','Início do atendimento','time','Horário inicial',false,'hybrid',NULL,'{}'::jsonb,'[]'::jsonb),
  ('massage','massage_end_time','Fim do atendimento','time','Horário final',false,'hybrid',NULL,'{}'::jsonb,'[]'::jsonb),

  -- transfer
  ('transfer','transfer_available','Transfer disponível?','boolean','Oferece traslado',false,'keyword',NULL,'{"positive":["transfer","traslado","shuttle"],"negative":["sem transfer","não oferece transfer"]}'::jsonb,'[]'::jsonb),
  ('transfer','transfer_price','Preço do transfer','currency','Valor do serviço',false,'hybrid',NULL,'{}'::jsonb,'[]'::jsonb),
  ('transfer','transfer_contact','Contato para transfer','text','Telefone ou e-mail para reserva',false,'llm',NULL,'{}'::jsonb,'[]'::jsonb),

  -- wifi
  ('wifi','wifi_available','Wi-Fi disponível?','boolean','Hotel oferece wifi',false,'keyword',NULL,'{"positive":["wifi","wi-fi","internet"],"negative":["sem wifi","sem internet"]}'::jsonb,'[]'::jsonb),
  ('wifi','wifi_free','Wi-Fi gratuito?','boolean','Sem custo adicional',false,'keyword',NULL,'{"positive":["wifi gratuito","gratis","grátis","cortesia"],"negative":["wifi pago","cobrado"]}'::jsonb,'[]'::jsonb),
  ('wifi','wifi_price','Preço do Wi-Fi','currency','Valor cobrado se pago',false,'hybrid',NULL,'{}'::jsonb,'[]'::jsonb),
  ('wifi','wifi_areas','Áreas cobertas','text','Locais com sinal',false,'llm',NULL,'{}'::jsonb,'[]'::jsonb),
  ('wifi','wifi_device_limit','Limite de dispositivos','text','Quantos aparelhos por hóspede',false,'llm',NULL,'{}'::jsonb,'[]'::jsonb),

  -- room_service
  ('room_service','room_service_available','Room service disponível?','boolean','Oferece serviço de quarto',false,'keyword',NULL,'{"positive":["room service","serviço de quarto"],"negative":["sem room service"]}'::jsonb,'[]'::jsonb),
  ('room_service','room_service_24h','Room service 24h?','boolean','Disponível em tempo integral',false,'keyword',NULL,'{"positive":["24 horas","24h","full time"],"negative":["horário limitado"]}'::jsonb,'[]'::jsonb),
  ('room_service','room_service_start_time','Início do room service','time','Horário inicial',false,'hybrid',NULL,'{}'::jsonb,'[]'::jsonb),
  ('room_service','room_service_end_time','Fim do room service','time','Horário final',false,'hybrid',NULL,'{}'::jsonb,'[]'::jsonb),
  ('room_service','room_service_fee','Taxa do room service','currency','Taxa de serviço cobrada',false,'hybrid',NULL,'{}'::jsonb,'[]'::jsonb),

  -- laundry
  ('laundry','laundry_available','Lavanderia disponível?','boolean','Hotel oferece lavanderia',false,'keyword',NULL,'{"positive":["lavanderia","laundry"],"negative":["sem lavanderia"]}'::jsonb,'[]'::jsonb),
  ('laundry','laundry_price','Preço da lavanderia','currency','Valor do serviço',false,'hybrid',NULL,'{}'::jsonb,'[]'::jsonb),
  ('laundry','laundry_delivery','Entrega no quarto?','boolean','Entrega das roupas no quarto',false,'keyword',NULL,'{"positive":["entrega no quarto","delivery"],"negative":["retirar na recepção"]}'::jsonb,'[]'::jsonb),
  ('laundry','laundry_start_time','Início do atendimento','time','Horário inicial',false,'hybrid',NULL,'{}'::jsonb,'[]'::jsonb),
  ('laundry','laundry_end_time','Fim do atendimento','time','Horário final',false,'hybrid',NULL,'{}'::jsonb,'[]'::jsonb),

  -- day_use
  ('day_use','day_use_available','Day use disponível?','boolean','Hotel oferece day use',false,'keyword',NULL,'{"positive":["day use","uso diurno"],"negative":["sem day use","não oferece day use"]}'::jsonb,'[]'::jsonb),
  ('day_use','day_use_price','Preço do day use','currency','Valor cobrado',false,'hybrid',NULL,'{}'::jsonb,'[]'::jsonb),
  ('day_use','day_use_age_policy','Política de idade','text','Idade mínima permitida',false,'llm',NULL,'{}'::jsonb,'[]'::jsonb),
  ('day_use','day_use_breakfast_included','Café incluso no day use?','boolean','Day use inclui café da manhã',false,'keyword',NULL,'{"positive":["com café","café incluso"],"negative":["sem café"]}'::jsonb,'[]'::jsonb),
  ('day_use','day_use_start_time','Início do day use','time','Horário inicial',false,'hybrid',NULL,'{}'::jsonb,'[]'::jsonb),
  ('day_use','day_use_end_time','Fim do day use','time','Horário final',false,'hybrid',NULL,'{}'::jsonb,'[]'::jsonb),

  -- restaurant
  ('restaurant','restaurant_available','Restaurante disponível?','boolean','Possui restaurante próprio',false,'keyword',NULL,'{"positive":["restaurante","restaurant"],"negative":["sem restaurante","não possui restaurante"]}'::jsonb,'[]'::jsonb),
  ('restaurant','restaurant_count','Quantidade de restaurantes','number','Quantos restaurantes existem no hotel',false,'hybrid',NULL,'{}'::jsonb,'[]'::jsonb),
  ('restaurant','restaurant_suggestions','Sugestões fora do hotel','text','Recomendações próximas',false,'llm',NULL,'{}'::jsonb,'[]'::jsonb),
  ('restaurant','restaurant_diets','Opções de dieta','multi_select','Vegetariano, vegano...',false,'llm',NULL,'{}'::jsonb,'[]'::jsonb),

  -- pool
  ('pool','pool_available','Piscina disponível?','boolean','Hotel possui piscina',false,'keyword',NULL,'{"positive":["piscina","pool"],"negative":["sem piscina"]}'::jsonb,'[]'::jsonb),
  ('pool','pool_paid','Piscina paga?','boolean','Cobra acesso à piscina',false,'keyword',NULL,'{"positive":["piscina paga","cobrado"],"negative":["piscina gratuita","incluso"]}'::jsonb,'[]'::jsonb),
  ('pool','pool_price','Preço da piscina','currency','Valor avulso',false,'hybrid',NULL,'{}'::jsonb,'[]'::jsonb),
  ('pool','pool_heated','Piscina aquecida?','boolean','Aquecida ou natural',false,'keyword',NULL,'{"positive":["aquecida","heated"],"negative":["não aquecida","fria"]}'::jsonb,'[]'::jsonb),
  ('pool','pool_temperature','Temperatura da piscina','text','Temperatura típica',false,'llm',NULL,'{}'::jsonb,'[]'::jsonb),
  ('pool','pool_towel','Fornece toalhas?','boolean','Toalha de piscina inclusa',false,'keyword',NULL,'{"positive":["toalha","towel"],"negative":["sem toalha"]}'::jsonb,'[]'::jsonb),
  ('pool','pool_edge','Borda infinita?','boolean','Piscina com borda infinita',false,'keyword',NULL,'{"positive":["borda infinita","infinity"],"negative":[]}'::jsonb,'[]'::jsonb),
  ('pool','pool_area','Localização da piscina','text','Onde fica a piscina',false,'llm',NULL,'{}'::jsonb,'[]'::jsonb),
  ('pool','pool_start_time','Abertura da piscina','time','Horário de abertura',false,'hybrid',NULL,'{}'::jsonb,'[]'::jsonb),
  ('pool','pool_end_time','Fechamento da piscina','time','Horário de fechamento',false,'hybrid',NULL,'{}'::jsonb,'[]'::jsonb),

  -- gym
  ('gym','gym_available','Academia disponível?','boolean','Hotel possui academia',false,'keyword',NULL,'{"positive":["academia","gym","fitness"],"negative":["sem academia"]}'::jsonb,'[]'::jsonb),
  ('gym','gym_price','Preço da academia','currency','Valor avulso',false,'hybrid',NULL,'{}'::jsonb,'[]'::jsonb),
  ('gym','gym_start_time','Abertura da academia','time','Horário de abertura',false,'hybrid',NULL,'{}'::jsonb,'[]'::jsonb),
  ('gym','gym_end_time','Fechamento da academia','time','Horário de fechamento',false,'hybrid',NULL,'{}'::jsonb,'[]'::jsonb),
  ('gym','gym_instructor','Tem instrutor?','boolean','Possui personal/instrutor',false,'keyword',NULL,'{"positive":["instrutor","personal trainer"],"negative":[]}'::jsonb,'[]'::jsonb),
  ('gym','gym_classes','Oferece aulas?','boolean','Aulas em grupo',false,'keyword',NULL,'{"positive":["aulas","class"],"negative":[]}'::jsonb,'[]'::jsonb),

  -- sauna
  ('sauna','sauna_available','Sauna disponível?','boolean','Hotel possui sauna',false,'keyword',NULL,'{"positive":["sauna"],"negative":["sem sauna"]}'::jsonb,'[]'::jsonb),
  ('sauna','sauna_price','Preço da sauna','currency','Valor avulso',false,'hybrid',NULL,'{}'::jsonb,'[]'::jsonb),
  ('sauna','sauna_start_time','Abertura da sauna','time','Horário de abertura',false,'hybrid',NULL,'{}'::jsonb,'[]'::jsonb),
  ('sauna','sauna_end_time','Fechamento da sauna','time','Horário de fechamento',false,'hybrid',NULL,'{}'::jsonb,'[]'::jsonb),

  -- rooms
  ('rooms','room_crib_available','Berço disponível?','boolean','Hotel oferece berço',false,'keyword',NULL,'{"positive":["berço","berco","crib"],"negative":["sem berço"]}'::jsonb,'[]'::jsonb),
  ('rooms','room_crib_paid','Berço é pago?','boolean','Cobra taxa pelo berço',false,'keyword',NULL,'{"positive":["berço pago","cobrado"],"negative":["berço gratuito","sem custo"]}'::jsonb,'[]'::jsonb),
  ('rooms','room_crib_price','Preço do berço','currency','Valor do berço',false,'hybrid',NULL,'{}'::jsonb,'[]'::jsonb),
  ('rooms','room_types','Tipos de quarto','text','Categorias e tipos disponíveis',false,'llm',NULL,'{}'::jsonb,'[]'::jsonb),
  ('rooms','room_amenities','Comodidades padrão','text','Itens inclusos no quarto',false,'llm',NULL,'{}'::jsonb,'[]'::jsonb),

  -- events
  ('events','events_available','Possui espaços para eventos?','boolean','Hotel realiza eventos',false,'keyword',NULL,'{"positive":["eventos","salão","convenções"],"negative":["sem eventos","não realiza eventos"]}'::jsonb,'[]'::jsonb),
  ('events','events_capacity','Capacidade dos espaços','text','Pessoas por espaço',false,'llm',NULL,'{}'::jsonb,'[]'::jsonb),
  ('events','events_types','Tipos de evento atendidos','multi_select','Casamento, corporativo, social...',false,'llm',NULL,'{}'::jsonb,'[]'::jsonb),

  -- payment
  ('payment','payment_methods','Formas de pagamento aceitas','multi_select','Cartão, pix, boleto, dinheiro...',false,'llm',NULL,'{}'::jsonb,'[]'::jsonb),
  ('payment','card_flags','Bandeiras de cartão aceitas','multi_select','Visa, Master, Amex...',false,'llm',NULL,'{}'::jsonb,'[]'::jsonb),
  ('payment','card_installments','Parcelamento','text','Número de parcelas permitido',false,'llm',NULL,'{}'::jsonb,'[]'::jsonb),
  ('payment','installment_fee','Cobra juros no parcelamento?','boolean','Parcelamento com juros',false,'keyword',NULL,'{"positive":["com juros","cobra juros"],"negative":["sem juros","sem acréscimo"]}'::jsonb,'[]'::jsonb),
  ('payment','payment_delay','Prazo de pagamento','text','Quando deve ser pago',false,'llm',NULL,'{}'::jsonb,'[]'::jsonb),
  ('payment','pre_payment_required','Pré-pagamento obrigatório?','boolean','Exige sinal/depósito',false,'keyword',NULL,'{"positive":["pré-pagamento","sinal","depósito"],"negative":["sem pré-pagamento"]}'::jsonb,'[]'::jsonb),
  ('payment','pre_payment_value','Valor de pré-pagamento','text','Percentual ou valor fixo',false,'llm',NULL,'{}'::jsonb,'[]'::jsonb),
  ('payment','cancellation_policy','Política de cancelamento','text','Regras e prazos de cancelamento',false,'llm',NULL,'{}'::jsonb,'[]'::jsonb),
  ('payment','discount_available','Oferece desconto?','boolean','Há desconto em alguma condição',false,'keyword',NULL,'{"positive":["desconto","promoção","cupom"],"negative":["sem desconto"]}'::jsonb,'[]'::jsonb),
  ('payment','discount_percentage','Percentual de desconto','text','Valor do desconto',false,'llm',NULL,'{}'::jsonb,'[]'::jsonb),

  -- address
  ('address','address_street','Rua/Logradouro','text','Endereço da rua',false,'llm',NULL,'{}'::jsonb,'[]'::jsonb),
  ('address','address_district','Bairro','text','Bairro do hotel',false,'llm',NULL,'{}'::jsonb,'[]'::jsonb),
  ('address','address_city','Cidade','text','Cidade do hotel',false,'llm',NULL,'{}'::jsonb,'[]'::jsonb),
  ('address','address_zip','CEP','text','Código postal',false,'regex','(\d{5}-?\d{3})','{}'::jsonb,'[]'::jsonb),
  ('address','address_country','País','text','País do hotel',false,'llm',NULL,'{}'::jsonb,'[]'::jsonb),
  ('address','address_map_link','Link no mapa','text','URL Google Maps',false,'regex','(https?://[^\s]+)','{}'::jsonb,'[]'::jsonb),

  -- transport
  ('transport','airport_nearby','Possui aeroporto próximo?','boolean','Há aeroporto na região',false,'keyword',NULL,'{"positive":["aeroporto","airport"],"negative":["sem aeroporto"]}'::jsonb,'[]'::jsonb),
  ('transport','airport_name','Nome do aeroporto','text','Aeroporto mais próximo',false,'llm',NULL,'{}'::jsonb,'[]'::jsonb),
  ('transport','airport_distance','Distância ao aeroporto','text','Distância em km/min',false,'llm',NULL,'{}'::jsonb,'[]'::jsonb),
  ('transport','bus_nearby','Possui rodoviária próxima?','boolean','Há rodoviária na região',false,'keyword',NULL,'{"positive":["rodoviária","rodoviaria","ônibus"],"negative":["sem rodoviária"]}'::jsonb,'[]'::jsonb),
  ('transport','bus_name','Nome da rodoviária','text','Rodoviária mais próxima',false,'llm',NULL,'{}'::jsonb,'[]'::jsonb),
  ('transport','bus_distance','Distância à rodoviária','text','Distância em km/min',false,'llm',NULL,'{}'::jsonb,'[]'::jsonb)
) AS v(slug, field_name, field_label, field_type, description, required, extraction_strategy, regex_pattern, keywords, negative_keywords)
ON td.slug = v.slug;
