## Objetivo

Transformar o Hybrid KB Lab em um MVP focado em uma única hipótese: **base híbrida estruturada vs. RAG bruto produz respostas melhores?**

Toda a lógica de backend (pipeline de extração, regex/keyword/LLM, data points, dynamic fields, consolidação, etc.) é **preservada**. O refactor é majoritariamente de **interface e fluxo**.

---

## Nova navegação (5 telas)

```text
Upload  →  Raw Knowledge  →  Structured Knowledge  →  Compare Responses  →  Settings
```

Remover das tabs do projeto: Topics, Extractions, Consolidation, Knowledge (antiga), Questions, Playground, Benchmark, External Agent, Health, Extraction Analytics, Executive Report, Snapshots, Lab Settings.

Também remover `ProjectSummaryCards` do topo (muito "engineering-ish").

---

## Tela 1 — Upload

Arquivo: `src/features/project/UploadTab.tsx` (novo, derivado do atual `SourcesTab`).

- Mantém os 4 importadores (CSV, PDF, URL, Fast Content) exatamente como hoje.
- Lista de fontes com contagem de chunks.
- Botão único **Process Knowledge** no rodapé:
  - Internamente chama `runExtraction({ projectId, mode: "persist" })` seguido de `consolidateKnowledge({ projectId })`.
  - Mostra um progress simples ("Classificando tópicos… Extraindo campos… Consolidando…") com toast no fim.
- Esconder: Dry Run, Persist toggles, histórico de runs, settings de extração.

---

## Tela 2 — Raw Knowledge

Arquivo: `src/features/project/RawKnowledgeTab.tsx` (novo).

Tabela read-only listando `raw_chunks` joinados com `raw_sources`:

| Chunk ID | Source | Topic detectado | Texto (truncado) | Metadata |

- Topic detectado = `raw_chunks.classified_topic_slug` (ou similar — confirmar na coluna existente; se não houver, derivar do último `knowledge_candidates` por chunk).
- Busca por texto + filtro por source e por topic.
- Botão **View JSON** abre dialog mostrando o array de chunks no formato que iria para um RAG (`{id, content, metadata, source}`).
- Sem edição.

---

## Tela 3 — Structured Knowledge (principal do MVP)

Arquivo: `src/features/project/StructuredKnowledgeTab.tsx` (novo, substitui a antiga `KnowledgeTab`).

Layout: lista de tópicos (accordion ou sidebar + painel).

Para cada tópico:

1. **Core Information** — formulário com inputs para cada `data_point_definition` core do tópico, populado a partir dos `knowledge_fields` aprovados (`field_origin = core`). Inputs adequados ao `field_type` (text, time, boolean, number, currency).
2. **Additional Information** — `<Textarea>` com texto livre. Conteúdo inicial = concatenação textual de:
   - todos os `knowledge_fields` com `field_origin = dynamic` no formato `"Nome do campo: valor"` (sem expor o termo "dynamic field");
   - registros de `additional_info` daquele tópico.
   - Salvar tudo de volta em um único registro `additional_info` por tópico (ver "Modelo de persistência" abaixo).
3. Botões por tópico:
   - **View JSON** → dialog com `{ core_fields, additional_information, sources }`.
   - **Source Chunks** → modal listando os `raw_chunks` referenciados em `knowledge_fields.source_chunk_ids` para esse tópico.

### Modelo de persistência (sem migration)

- Core fields → continuam em `knowledge_fields` (origin=core). Edição via update direto, marcando `verified=true`, `approval_status='approved'`.
- Additional Information editado pelo usuário → gravado como um único `additional_info` row por (project, topic) com flag tipo `metadata.source = 'user_edit'`; os dynamic fields originais permanecem em `knowledge_fields` para auditoria, mas a UI mostra apenas o texto consolidado.

Nada de novo schema. Compatível com pipeline existente: reprocessar regenera os fields, mas o texto consolidado do usuário permanece (não sobrescrever `additional_info` com source=user_edit ao reprocessar — pequeno ajuste em `consolidation.functions.ts`).

---

## Tela 4 — Compare Responses

Arquivo: `src/features/project/CompareResponsesTab.tsx` (novo, substitui Playground/Benchmark).

Topo — configuração do modelo (persistida em `localStorage` por projeto):
- Provider: OpenAI, Anthropic, Google, OpenRouter, Custom Endpoint.
- API Key, Model, Temperature, Max Tokens, System Prompt opcional.
- Endpoint URL (quando Custom).

Meio:
- Textarea **Pergunta** + botão **Run Comparison**.

Execução:
- Duas chamadas independentes em paralelo:
  - **A — Raw Knowledge**: contexto = top-N raw chunks (reusar lógica existente de `benchmark.functions.ts` modo `raw_chunks`).
  - **B — Structured Knowledge**: contexto = JSON estruturado por tópico (core_fields + additional_information). Reusar modo `structured`.
- Chamada direta ao provider via `fetch` em um novo `src/lib/llm-providers.functions.ts` (server fn) que aceita `{provider, apiKey, model, temperature, maxTokens, system, messages}` e normaliza a resposta para `{text, latencyMs, promptTokens, completionTokens}`.

Saída lado a lado:
- Cards **Raw Knowledge** e **Structured Knowledge** com: Resposta, Tempo, Tokens, Tamanho do contexto (chars), Itens utilizados (n chunks / n campos).
- **Winner** no topo decidido por score simples: menor tempo + menos tokens + menos contexto (regra: 1 ponto por categoria onde venceu; empate possível).
- Botões **View Prompt** e **View Context** em cada lado (dialog com `<pre>`).

API keys: armazenadas só em `localStorage` (MVP, sem secret manager). Adicionar aviso visual.

---

## Tela 5 — Settings

Arquivo: `src/features/project/SettingsTab.tsx` (novo, mescla `ExtractionSettingsTab` + `DataPointsTab`).

Seções:
1. **LLM Defaults** (espelha config do Compare, mesmo localStorage).
2. **Extraction Pipeline**:
   - Toggles: Regex / Keyword / LLM (persistir em `extraction_settings`).
   - Chunk Size.
   - Prompt de extração (textarea, vinculado ao `prompt_templates` ativo).
3. **Data Point Definitions** (reuso direto da UI atual de `DataPointsTab`):
   - CRUD com campos: name, type, required, description, regex_pattern, keywords.

Remover do menu: Schema Evolution (continua existindo, sem link).

---

## Mudanças de roteamento

`src/routes/projects.$projectId.tsx`:
- Tabs reduzidas para: `upload`, `raw`, `structured`, `compare`, `settings`.
- Default tab = `upload`.
- Remover `ProjectSummaryCards`.

`src/routes/settings.tsx` (global):
- Manter apenas se ainda fizer sentido como tela global; caso contrário, remover do header. **A confirmar com você** (ver pergunta abaixo).

---

## Backend — o que muda e o que NÃO muda

**Não muda**: tabelas, server functions de extração/consolidação/benchmark, pipeline regex→keyword→LLM, data point definitions, dynamic fields.

**Muda (pequeno)**:
- `consolidation.functions.ts`: respeitar `additional_info` editado pelo usuário (não sobrescrever quando `metadata.source = 'user_edit'`).
- Novo `src/lib/llm-providers.functions.ts` para chamadas multi-provider no Compare.
- Pequeno helper para serializar Structured Knowledge em JSON/texto consumido pelo Compare.

---

## Arquivos a criar

- `src/features/project/UploadTab.tsx`
- `src/features/project/RawKnowledgeTab.tsx`
- `src/features/project/StructuredKnowledgeTab.tsx`
- `src/features/project/CompareResponsesTab.tsx`
- `src/features/project/SettingsTab.tsx`
- `src/lib/llm-providers.functions.ts`

## Arquivos a remover do menu (código preservado no repo por enquanto)

`HealthTab`, `ExtractionAnalyticsTab`, `ExecutiveReportTab`, `SnapshotsTab`, `BenchmarkTab`, `QuestionsTab`, `ConsolidationTab`, `ExternalAgentTab`, `LabSettingsTab`, `ExtractionsTab`, `TopicsTab`, `KnowledgeTab` (antiga), `PlaygroundTab`, `ProjectSummaryCards`.

Mantidos no disco para não quebrar imports residuais, mas desconectados do router. (Limpeza completa pode ser uma segunda passada se você preferir.)

---

## Perguntas antes de implementar

1. **API keys de providers** — OK guardar só em `localStorage` (MVP), ou prefere salvar via `add_secret` no backend?
2. **Limpeza de código** — apago de vez os arquivos das telas removidas, ou prefere manter no repo (mais seguro para rollback)?
3. **Tela global `/settings`** — remover do header e deixar tudo dentro do projeto, ou manter espelhada?
