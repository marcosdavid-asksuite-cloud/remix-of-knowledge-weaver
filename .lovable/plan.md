# Laboratório de Validação — Base de Conhecimento Híbrida (v2, simplificada)

MVP enxuto: validar se uma base estruturada melhora as respostas da IA. Sem embeddings, sem RAG, sem multi-tenancy, sem avaliação automática.

Fluxo central:

```text
CSV → Extração (LLM) → Base Híbrida → Edição → Teste de Perguntas
```

---

## 1. Entidades

### Project
Substitui Hotel. Escopo de cada experimento.
- `id`, `name`, `description`, `created_at`

### RawSource
Origem do conteúdo bruto. MVP = CSV.
- `id`, `project_id`, `type` (csv | text), `filename`, `uploaded_at`

### RawChunk
Unidade atômica (linha do CSV ou bloco de texto).
- `id`, `raw_source_id`, `content`, `metadata` (jsonb), `position`

### TopicDefinitions
Catálogo de tópicos (seedado + extensível).
- `id`, `slug`, `name`, `description`, `aliases` (text[])

### Topic
Instância de tópico ativa em um projeto (permite ligar/desligar por projeto).
- `id`, `project_id`, `topic_definition_id`, `created_at`

### KnowledgeField
Tabela única que unifica DataPoint + DynamicAttribute.
- `id`
- `topic_id`
- `field_name`
- `field_type` (string | number | time | boolean | money | enum | text)
- `field_value` (jsonb)
- `field_origin` (`core` | `dynamic`)
- `confidence` (0–1)
- `source_chunk_ids` (uuid[])
- `verified` (bool)
- `created_at`

> `core` = campo previsto no schema padrão do tópico (ex.: breakfast.start_time).
> `dynamic` = campo descoberto pelo LLM que não estava no schema (ex.: vegan_options).
> O schema padrão por tópico fica embutido como seed/constante no código — não vira tabela própria nesta versão.

### AdditionalInfo
Texto livre que não cabe em campo estruturado.
- `id`, `topic_id`, `content`, `source_chunk_ids` (uuid[]), `created_at`

### ExtractionRun
Execução de uma rodada de extração. Suporta **Dry Run**.
- `id`, `project_id`, `raw_source_ids` (uuid[])
- `mode` (`dry_run` | `persist`)
- `prompt_template_id`, `model_configuration_id`
- `status` (queued | running | done | failed)
- `preview_result` (jsonb) — preenchido sempre; é o **único** output do dry run
- `stats` (jsonb: chunks_processed, fields_proposed, cost_estimated)
- `started_at`, `finished_at`

### PromptTemplates
- `id`, `name`, `type` (`extraction` | `answer` | `topic_routing`)
- `content`, `version`, `created_at`

### ModelConfigurations
- `id`, `provider`, `model_name`, `api_key`, `temperature`, `max_tokens`, `active`

> Em produção real `api_key` viria de secret; no lab fica no banco para troca rápida. Mascarar na UI.

### LLMCalls
Log de TODA chamada ao LLM (extração, teste, dry run). Auditoria + custo.
- `id`, `prompt_type`, `model_name`
- `input_tokens`, `output_tokens`, `latency`, `estimated_cost`
- `response` (jsonb/text), `created_at`
- (opcional) `extraction_run_id` / `test_run_id` para correlacionar

### TestQuestion
- `id`, `project_id`, `question`, `expected_answer` (text, opcional), `created_at`

### TestRun
Resposta de uma pergunta em um modo de contexto.
- `id`, `question_id`
- `mode` (`structured` | `raw_chunks`)  — `structured` usa a base híbrida; `raw_chunks` despeja chunks brutos relacionados, como baseline manual sem RAG/embeddings (filtro simples por tópico ou keyword)
- `prompt_template_id`, `model_configuration_id`
- `context_sent` (jsonb), `answer` (text)
- `llm_call_id`, `created_at`

Avaliação fica como anotação humana opcional no próprio TestRun (`human_score` int, `human_notes` text). Sem tabela de avaliação automática.

---

## 2. Relacionamentos

```text
Project 1—N RawSource 1—N RawChunk
Project 1—N Topic N—1 TopicDefinitions
Topic 1—N KnowledgeField
Topic 1—N AdditionalInfo
Project 1—N ExtractionRun
ExtractionRun N—1 PromptTemplate
ExtractionRun N—1 ModelConfiguration
Project 1—N TestQuestion 1—N TestRun
KnowledgeField/AdditionalInfo —[uuid[]]→ RawChunk  (rastreabilidade, sem FK formal)
LLMCalls — log transversal
```

---

## 3. Fluxo do Usuário

1. Criar **Project**.
2. Upload de **CSV** → vira RawSource + RawChunks.
3. Selecionar tópicos ativos do catálogo `TopicDefinitions`.
4. Escolher `PromptTemplate` de extração + `ModelConfiguration`.
5. **Dry Run** da extração → mostra JSON proposto + custo estimado. Nada é salvo (exceto o `ExtractionRun` com `mode=dry_run` e `preview_result`, e o `LLMCall` para auditoria de custo).
6. Se aprovar → rodar extração em modo `persist` → grava KnowledgeFields + AdditionalInfo.
7. **Edição/Curadoria** — usuário corrige valores, marca `verified`, adiciona/remove campos.
8. Cadastrar **TestQuestions**.
9. **Playground de teste** — roda a pergunta em `structured` e/ou `raw_chunks`, compara lado a lado.
10. Anotação humana opcional no TestRun.

---

## 4. Telas

1. **Projects** — lista/criar.
2. **Project detail** (abas):
   - **Sources** — upload CSV, lista de RawChunks.
   - **Topics** — ativar/desativar tópicos do catálogo.
   - **Knowledge** — por tópico: tabela única de KnowledgeFields (badge `core`/`dynamic`, confidence, verified) + AdditionalInfo. Edição inline.
   - **Extractions** — histórico; botão **Dry Run** e **Run**; visualizador de JSON do dry run com custo estimado.
   - **Questions** — CRUD de TestQuestions.
   - **Playground** — escolhe pergunta, roda nos 2 modos, vê respostas/latência/tokens/custo lado a lado.
3. **Settings** (global do lab):
   - **Prompt Templates** — CRUD com versionamento.
   - **Model Configurations** — CRUD, ativar/desativar.
   - **LLM Calls** — log com filtros (tipo, modelo, custo, período).

---

## 5. Modo Dry Run (detalhado)

Recomendação acatada. Comportamento:

- Mesmo pipeline de extração, mesmo prompt, mesmo modelo.
- Output em memória + `ExtractionRun.preview_result`:
  ```json
  {
    "topic": "breakfast",
    "fields": [
      { "field_name": "start_time", "field_type": "time", "field_value": "06:30", "field_origin": "core", "confidence": 0.92, "source_chunk_ids": ["..."] },
      { "field_name": "vegan_options", "field_type": "boolean", "field_value": true, "field_origin": "dynamic", "confidence": 0.78, "source_chunk_ids": ["..."] }
    ],
    "additional_info": ["Café servido no terraço aos domingos."]
  }
  ```
- **Nada** entra em `KnowledgeField` / `AdditionalInfo`.
- `LLMCall` é gravado (precisamos saber quanto custou o experimento).
- UI: botão "Promote to persist" reaproveita o `preview_result` sem chamar o LLM de novo → economia real.

---

## 6. Arquitetura do Banco

- Postgres (Lovable Cloud), sem pgvector.
- `field_value` e `preview_result` em `jsonb`.
- `source_chunk_ids` como `uuid[]`.
- Índices: `(project_id)` nas tabelas-filhas; `(topic_id, field_origin)` em KnowledgeField; `(created_at)` em LLMCalls.
- Seeds:
  - `TopicDefinitions` com catálogo hoteleiro (breakfast, check_in, pool, parking, restaurant, gym, wifi, transfer…).
  - Schema `core` por tópico embutido em código (constantes TS), usado pelo prompt de extração e pela UI para distinguir core vs dynamic.
  - `PromptTemplates` v1 para `extraction` e `answer`.
  - `ModelConfigurations` com 1 default ativo (Lovable AI Gateway).
- Sem RLS estrito (sem multi-tenancy); proteção só por auth do laboratório.

---

## 7. Pipeline (sem RAG)

**Extração**
1. Agrupa RawChunks (todos do source, ou por heurística simples de keyword/tópico).
2. Para cada tópico ativo: monta prompt com (schema core do tópico + chunks candidatos).
3. LLM devolve JSON com fields `core` preenchidos + propostas `dynamic` + additional_info.
4. Valida com Zod.
5. Se `mode=persist`: upsert em KnowledgeField/AdditionalInfo.
6. Sempre: registra LLMCall e atualiza ExtractionRun.stats.

**Teste**
- `structured`: serializa KnowledgeFields + AdditionalInfo do(s) tópico(s) relevantes como contexto compacto → LLM responde.
- `raw_chunks`: seleciona chunks por filtro simples (keyword/tópico marcado manualmente) → LLM responde. Baseline honesto sem precisar de embeddings.

---

## 8. Possíveis Problemas

- **Roteamento de tópico da pergunta** sem embeddings: vai por keyword/alias do `TopicDefinitions.aliases`. Pode errar; aceitável no MVP, logar quando errar.
- **Schema core embutido em código** acelera, mas mudanças exigem deploy. Trade-off consciente.
- **api_key em ModelConfigurations**: risco se exposto na UI. Mascarar e não retornar no client.
- **Custo da extração em CSVs grandes**: Dry Run mitiga; adicionar limite de chunks por run.
- **Conflito entre chunks** (preço antigo vs novo): mantém múltiplos KnowledgeFields com mesmo `field_name`; curadoria humana decide qual fica `verified`.
- **Comparação enviesada** no playground se o modo `raw_chunks` mandar contexto gigante: limitar nº de chunks por padrão.

---

## 9. Possíveis Melhorias (pós-MVP)

- Promover `dynamic` → `core` quando recorrente (vira sugestão de schema).
- Versionamento temporal de KnowledgeFields.
- Reaproveitar `preview_result` do Dry Run direto no persist (já previsto acima).
- LLM-as-judge opcional para escala (fora do MVP).
- Diff entre ExtractionRuns.
- Adicionar PDF/URL como RawSource.

---

Aprove para eu implementar nesta arquitetura, ou peça ajustes.