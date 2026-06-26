Diagnóstico do problema atual

O fluxo está correto em conceito, mas a extração estruturada está perdendo informação que existe nos chunks. No projeto atual, o tópico Café da Manhã só tem dois campos extraídos:

- `breakfast_location = "3º andar com linda vista para o mar"` (core)
- `elevator_availability = false` (dynamic — nem deveria estar aqui)

Faltou extrair `breakfast_start_time`, `breakfast_end_time`, `breakfast_available`, `breakfast_price`, `breakfast_diets`. E não há `Informações adicionais` salvas, então a Structured Knowledge responde menos do que a Raw.

Causas identificadas:

1. A extração processa chunk por chunk e classifica para no máximo um tópico. Quando um chunk tem só parte da informação (ex.: cardápio do café) e outro chunk tem o horário, cada um só preenche o que enxergou e nada consolida o tópico inteiro.
2. As definições de Data Points para Café da Manhã não têm `keywords` nem `regex_pattern`, então a etapa determinística (regex/keywords) nunca dispara — tudo cai na LLM, que erra por falta de contexto agregado.
3. Não há fallback para "informações adicionais": quando o LLM extrai narrativa rica (lista de itens do café, observações), isso é descartado em vez de virar `additional_info` aprovada.
4. A consolidação não popula `additional_info` automaticamente — fica vazio até o usuário escrever.

Plano de ajuste em 4 passos pequenos

Passo 1 — Reforçar extração agregando chunks por tópico
- Mudar `runExtraction` em `src/lib/ai.functions.ts` para, após classificar chunks por tópico, fazer 1 chamada LLM por tópico passando todos os chunks classificados juntos (não 1 por chunk).
- Prompt curto e barato: "extraia estes campos JSON a partir do texto abaixo; deixe nulo o que não souber; tudo que sobrar e for relevante coloque em `additional_info` como texto livre."
- Saída esperada: `{ core_fields: {...}, dynamic_fields: {...}, additional_info: "..." }`.
- Persistir `additional_info` automaticamente como entrada `status='approved'` (origem `extraction`) em `additional_info` table. O usuário pode editar depois no editor.
- Resultado: Café da Manhã ganha horário, incluso, lista de itens vai para Informações adicionais.

Passo 2 — Adicionar keywords/regex padrão aos tópicos hoteleiros
- Atualizar `data_point_definitions` via migração para preencher `keywords` e `regex_pattern` faltantes nos campos óbvios:
  - `breakfast_start_time` / `breakfast_end_time`: regex de horário `\b(\d{1,2})[h:](\d{0,2})?\b`, keywords `["café da manhã","breakfast"]`.
  - `breakfast_available`: keywords `["incluso","incluído","grátis","gratuito"]`.
  - `checkin_time` / `checkout_time`: regex de horário com keywords `["check-in","check in","checkin"]` e `["check-out","checkout"]`.
  - `wifi_available`, `parking_available`, `pool_available`, `pets_allowed`: keywords e regra booleana.
- Roda determinístico antes da LLM. Reduz custo e melhora cobertura.

Passo 3 — Limpar falsos dinâmicos
- No pipeline, descartar campos dinâmicos cujo `field_name` claramente pertence a outro tópico (ex.: `elevator_availability` no tópico Café da Manhã). Regra simples: se o nome não combina nem com o slug do tópico nem com aliases conhecidos, mover para `additional_info` em vez de salvar como `knowledge_field` dinâmico.

Passo 4 — Reextração sob demanda + indicador na UI
- Botão "Re-extrair tópico" no card de cada tópico em `StructuredKnowledgeTab.tsx`. Dispara o Passo 1 só para aquele tópico, usando todos os chunks já classificados.
- Mostrar `Cobertura: X/Y campos preenchidos` no header do tópico para deixar visível onde a extração ficou fraca.
- Botão "Re-extrair tudo" no topo da aba.

Sem mudanças

- Compare Responses continua igual (2 chamadas LLM reais lado a lado). O que vai melhorar é a base estruturada, então a resposta dela passará a ter horário + incluso + itens, e o experimento passa a ser justo.
- Configuração de provider/modelo/chave externa (OpenAI, OpenRouter, etc.) já existe na aba Compare Responses e atende sua exigência.

Arquivos afetados

- `src/lib/ai.functions.ts` — novo modo de extração agregada por tópico, persistência de `additional_info` automática, filtro de dinâmicos.
- `src/features/project/StructuredKnowledgeTab.tsx` — botões de re-extrair e badge de cobertura.
- `src/lib/llm-providers.functions.ts` — sem mudanças.
- Migração SQL — preencher `keywords` e `regex_pattern` para os tópicos hoteleiros principais.

Resultado esperado

- Café da Manhã passará a mostrar horário 07:00–10:00, incluso = sim, local = 3º andar, e a Informações adicionais virá pré-preenchida com a lista de itens.
- Comparação Raw vs Structured passa a ser justa, e Structured deve ficar igual ou melhor em qualidade e bem melhor em latência/tokens.