## Causa raiz

Em `StructuredKnowledgeTab.tsx` (≈linha 218), o textarea "Informações adicionais" concatena:
- `additional_info` (texto livre)
- **+ todo `knowledge_field` com `field_origin = 'dynamic'`** renderizado como `chave: valor`

A extração (`src/lib/ai.functions.ts`, linha 459) só descarta um dynamic quando o `field_name` é **idêntico** a algum `data_point_definitions.field_name`. Como o LLM gera variantes (`check_in_time` em vez de `checkin_time`, `check out time`, etc.), elas escapam do filtro e viram dynamic — mesmo conceito do core, duplicado. Por isso `check in time: 14:00`, `check out time: 12:00` aparecem em "Informações adicionais" enquanto o core `Horário de check-in` já tem `14:00`.

Itens como `cleaning window`, `trabalha com meia diaria`, `visita gratuita hall` são dynamic legítimos (não têm core equivalente).

## Correções (decisões já aprovadas)

1. **Auto-promoção para Core**: durante a extração, antes de gravar um dynamic, tentar casar com um `data_point_definitions` do mesmo tópico via:
   - normalização (`lower`, sem acento, `_`/espaço/`-` colapsados),
   - match contra `field_name`, `field_label` e cada entrada de `aliases` (jsonb já existente em `data_point_definitions`).
   Se bater: virar `core_fields` (sujeito ao mesmo "deterministic wins"); senão, permanece dynamic.

2. **Limpeza no salvamento do tópico**: quando o usuário clicar "Salvar tópico" no `TopicEditor`, marcar todos os `knowledge_fields` dynamic daquele `topic_id` como rejeitados/excluídos. O textarea passa a ser fonte única do conteúdo não-core.

3. **Render inicial do textarea**: parar de concatenar dynamic. Mostrar apenas `additional_info`. Dynamic ainda existentes (ex.: extrações antigas) aparecem na primeira abertura para o usuário ter chance de revisar/manter como texto, mas com um aviso curto "X campos dinâmicos detectados — salve para consolidar".

## Mudanças por arquivo

**`src/lib/ai.functions.ts`** (extração)
- Criar `normalizeFieldName(s)` helper.
- Construir índice por tópico: `{ normalized -> dpd.field_name }` cobrindo `field_name`, `field_label`, `aliases[]`.
- No loop dynamic (linha 456-469): se o nome normalizado bater, empurrar para `bucket.core_fields` em vez de `dynamic_fields` (respeitando `resolvedCore` e `allowedCore`).
- Mesma normalização aplicada no loop `core_fields` (linha 443) para tolerar variações no nome devolvido pelo LLM e gravar com o `field_name` canônico.

**`src/features/project/StructuredKnowledgeTab.tsx`** (UI)
- No `useEffect` que monta `addlText`: remover o trecho `dynamicLines`. Mostrar só `addls`. Se existirem dynamic, montar uma linha de aviso (não persistente) acima do textarea.
- Em `save()`: após processar `additional_info`, deletar (ou marcar `approved_by_user=false` + `consolidation_status='rejected'`) todos os `knowledge_fields` com `topic_id = topic.id` e `field_origin = 'dynamic'`. Decisão: **deletar** (mais limpo; nenhuma outra tela depende deles agora que Consolidation/Analytics estão escondidos).
- Invalidate queries `sk_fields` para a UI refletir.

**Backfill opcional (uma vez)** via `supabase--insert`:
- Para cada `knowledge_fields.field_origin='dynamic'` cujo nome normalizado bate com algum `data_point_definitions` ativo do tópico, converter para `core` (preencher o core só se ainda estiver vazio); caso contrário, deletar. Isso limpa a base existente do projeto.

## Fora de escopo

- Nenhuma mudança em `consolidation.functions.ts`, schema, ou outras abas.
- Sem alterar prompts do LLM (a normalização no pós-processamento já resolve sem custo extra).
