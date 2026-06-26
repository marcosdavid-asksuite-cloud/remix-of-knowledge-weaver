
## Objetivo
Transformar `KnowledgeCandidates` (fatos extraídos brutos) em uma base oficial confiável de `KnowledgeFields` consolidados, com gestão explícita de conflitos e aprovação manual. A base usada pelo Playground passa a vir só de fatos consolidados/aprovados.

## 1. Migrações de banco

### 1.1 Nova tabela `knowledge_conflicts`
Colunas: `id`, `project_id` (FK projects), `topic_definition_id` (FK), `field_name`, `field_type`, `conflict_type` (`different_values | contradictory_boolean | different_time | different_price | duplicate_uncertain`), `status` (`pending | resolved | ignored`, default `pending`), `candidate_ids uuid[]`, `selected_candidate_id` (FK knowledge_candidates, null), `manual_value jsonb`, `resolution_note text`, `created_at`, `resolved_at`.
GRANT padrão (anon RW por ser laboratório, mesmo padrão das demais tabelas) + RLS allow-all. Trigger `update_updated_at_column` não se aplica (sem `updated_at`).

### 1.2 Alterações em `knowledge_fields`
Adicionar: `source_of_truth text` (default `auto_single_candidate`, CHECK em 5 valores), `consolidation_status text` (default `consolidated`, CHECK em `consolidated|needs_review`), `approved_by_user boolean default false`, `approved_at timestamptz`, `candidate_ids uuid[] default '{}'`.

### 1.3 Alterações em `additional_info`
Adicionar: `status text` (default `pending`, CHECK em `pending|approved|rejected`), `approved_at timestamptz`. Persist da extração passa a inserir como `pending`.

### 1.4 Alterações em `knowledge_candidates`
Garantir que o `status` aceite `pending|approved|rejected|superseded`. Acrescentar `field_type` se já não existir (necessário para conflict_type).

## 2. Lib de normalização (`src/lib/value-normalizer.ts`)
Função `normalizeValue(fieldType, value)` retornando string canônica usada como chave de agrupamento. Reusa `extractTime`/`extractCurrency`/keywords booleanos. Casos:
- `time` → `HH:mm`
- `time_range` → `HH:mm-HH:mm`
- `currency` → `BRL:50.00`
- `number` → toString sem espaços
- `boolean` → `true`/`false` (mapeia "sim", "possui", "não", etc.)
- `text` / outros → trim, lowercase, collapse spaces
Também export `chooseConflictType(fieldType)`.

## 3. Server function `consolidateKnowledge` (`src/lib/consolidation.functions.ts`)
`createServerFn({ method:'POST' })` recebendo `{ projectId }`. Algoritmo:
1. Carrega candidates do projeto com status `pending` ou `approved` (não `rejected`/`superseded`).
2. Agrupa por `(topic_definition_id, field_name)`.
3. Para cada grupo, normaliza cada candidato e agrupa por valor canônico.
4. **Caso A/B**: um único valor canônico → upsert em `knowledge_fields` (match em `project_id+topic_id+field_name`):
   - `field_value` = valor original do candidato de maior confidence.
   - `source_chunk_ids` = união.
   - `candidate_ids` = união.
   - `confidence` = máximo.
   - `source_of_truth` = `auto_single_candidate` (1 candidato) ou `auto_merged_candidates` (>1).
   - `consolidation_status` = `consolidated`.
   - Marca candidates `approved`.
   - Se houver conflito anterior resolvido para esse field, mantém; se pendente, deixa.
5. **Caso C**: mais de um valor canônico → não toca o `knowledge_field`, cria/atualiza um `knowledge_conflicts` `pending` (`conflict_type` via `chooseConflictType`). Candidates permanecem `pending`.
6. Limpa conflitos `pending` que deixaram de existir (ex.: rejeições posteriores).
7. Retorna estatísticas: `consolidated_fields`, `merged_fields`, `new_conflicts`, `resolved_conflicts_cleared`, `pending_candidates`.

Função auxiliar `approveCandidate({candidateId})` e `rejectCandidate({candidateId})` para a UI da aba Consolidation.

## 4. Server function `resolveConflict` (`src/lib/consolidation.functions.ts`)
Entrada: `{ conflictId, action: 'select'|'edit'|'ignore', selectedCandidateId?, manualValue?, note? }`.
- `select`: upsert KF com valor do candidato escolhido, `source_of_truth=manually_selected_candidate`, `approved_by_user=true`, `approved_at=now`, `candidate_ids` = todos do conflito. Marca candidates do conflito `approved` (selected) / `superseded` (outros). Conflito → `resolved`.
- `edit`: idem com `source_of_truth=manually_edited`, `field_value=manualValue`, `manual_value` salvo no conflito.
- `ignore`: conflito → `ignored`, não muda KF. Candidates ficam `pending`.

## 5. Server function `approveAdditionalInfo` / `rejectAdditionalInfo`
Atualiza `additional_info.status` e `approved_at`.

## 6. Atualizar extração (`src/lib/ai.functions.ts`)
No modo `persist`, AdditionalInfo passa a entrar com `status='pending'`. KnowledgeCandidates continuam com `status='pending'`. **Não cria mais KnowledgeField diretamente no persist** — isso passa a ser responsabilidade de `consolidateKnowledge`. (Ajuste compatível: se já existe lógica que insere em `knowledge_fields` no persist, remover; preservar apenas inserção em `knowledge_candidates`.)

## 7. UI — nova aba `Consolidation` (`src/features/project/ConsolidationTab.tsx`)
Cards no topo: `pending candidates`, `consolidated fields`, `pending conflicts`, `resolved conflicts`.
Botão `Run Consolidation` (chama `consolidateKnowledge`) + `Re-run`.
Conteúdo agrupado por tópico:
- **Consolidated Fields**: tabela (`field_label`, `value`, `source_of_truth` badge, `confidence`, sources count, `approved_by_user`, ações Approve/Edit/View Sources).
- **Pending Candidates**: tabela com Approve/Reject/View Source.
- **Conflicts** (subseção ou tab interna "Conflicts"): card por conflito mostrando cada valor candidato (valor, confidence, extraction_method, chunks) com ações `Select this value`, `Edit manually` (input + save), `Ignore`.

## 8. UI — Knowledge tab refatorada (`src/features/project/KnowledgeTab.tsx`)
Três seções:
- **Official Knowledge**: KnowledgeFields `consolidated`, com badge de `source_of_truth`, botões `View JSON` (modal pretty) e `View Sources` (modal listando chunks: source name, content snippet, extraction_method, confidence, candidate id, run id).
- **Needs Review**: conflitos pendentes + candidates pendentes (links para a aba Consolidation).
- **Additional Information**: separa `approved` vs `pending`, com Approve/Reject inline.

## 9. UI — Playground
`runTestAnswer` (modo structured/hybrid) passa a ler apenas `knowledge_fields` com `consolidation_status='consolidated'` + `additional_info` com `status='approved'`. Se nenhum KF consolidado para o tópico selecionado: render aviso `"No consolidated knowledge found for this topic. Run consolidation first."` no UI antes mesmo da chamada.

## 10. Roteamento
Adicionar `Consolidation` aos tabs em `src/routes/projects/$projectId.tsx` (ou onde os tabs vivem) entre `Extractions` e `Knowledge`.

## 11. Fora de escopo (não implementar)
Benchmark automático, embeddings, PDF/URL, LLM-as-judge.

## Entregáveis
- 1 migração consolidada (tabelas + colunas + grants + RLS).
- `src/lib/value-normalizer.ts`.
- `src/lib/consolidation.functions.ts` (`consolidateKnowledge`, `approveCandidate`, `rejectCandidate`, `resolveConflict`, `approveAdditionalInfo`, `rejectAdditionalInfo`).
- Ajuste em `src/lib/ai.functions.ts` (persist sem KF direto, AdditionalInfo pending).
- `src/features/project/ConsolidationTab.tsx` (com seção Conflicts embutida).
- Refator `KnowledgeTab.tsx` (Official / Needs Review / Additional Info + modais View JSON e View Sources).
- Ajuste `PlaygroundTab.tsx` para usar só dados consolidados/aprovados.
- Registro da nova tab no router do projeto.

Aprove para eu executar a migração e a implementação.
