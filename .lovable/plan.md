
## Ajustes na aba "Compare Responses"

### 1. Mover "Configuração do modelo" para Settings

- Extrair o card inteiro (Provider, Model, Temperature, Max tokens, API Key, Endpoint, System prompt) de `CompareResponsesTab.tsx` para um novo componente `LLMConfigTab.tsx` em `src/features/settings/`.
- Mantém a mesma persistência em `localStorage` sob a chave `hkb-compare-cfg:{projectId}` (nada muda no backend/servidor).
- Em `SettingsTab.tsx`, adicionar uma terceira aba "LLM Config" ao lado de "Extraction Pipeline" e "Data Point Definitions". Como o `SettingsTab` atual não recebe `projectId`, ajustar `projects.$projectId.tsx` para passar `projectId` ao `SettingsTab`, e este repassa ao novo `LLMConfigTab`.
- Em `CompareResponsesTab`, remover o card e ler a config direto do `localStorage` (mesma chave). Se estiver incompleta/faltando (ex.: provider precisa de API key), exibir aviso com link/botão "Configurar em Settings → LLM Config" em vez de rodar.

### 2. Modo Multi-perguntas

No card "Pergunta" da aba Compare Responses:

- Adicionar toggle `Switch` "Modo multi-perguntas".
- Quando **desligado**: comportamento atual (uma `Textarea`, um resultado).
- Quando **ligado**:
  - A `Textarea` passa a aceitar várias perguntas, uma por linha (placeholder explicando o formato).
  - Botão passa a ser "Run Comparison (N perguntas)".
  - Execução em série (sequencial) via `for…of` chamando `runFn` uma pergunta por vez — garantindo qualidade e evitando rate limit da LLM. Nada de `Promise.all`.
  - Indicador de progresso: "Executando 2/5…".
  - Resultados renderizados como lista, um `ResultPanel` por pergunta, cada um com título da pergunta acima. O `Winner` continua sendo calculado por pergunta.
  - Resumo agregado no topo: quantas vitórias Raw vs Structured vs empates.

Estado interno passa de `result: CompareResult | null` para `results: Array<{ question: string; result: CompareResult }>`.

### 3. Estimativa de custo por chamada

Adicionar métrica "Custo" ao lado de Tempo / Tokens / Contexto / Itens em cada `SideCard`.

- Criar `src/lib/llm-pricing.ts` com uma tabela simples de preços por 1M tokens (input/output) para os modelos mais comuns de cada provider (lovable gateway `google/gemini-3-flash-preview`, `openai/gpt-4o-mini`, `anthropic/claude-3-5-sonnet-latest`, `google/gemini-1.5-flash`, openrouter genérico, custom = 0/desconhecido). Fallback: se modelo desconhecido, mostrar "—".
- Função `estimateCost({ provider, model, inputTokens, outputTokens })` retorna `{ usd: number | null }`.
- Exibir como `$0.0012` (4 casas quando <1¢, senão 2). Se `null`, mostrar "—" com tooltip "Preço não catalogado".
- Cálculo puro no frontend a partir de `inputTokens`/`outputTokens` já retornados por `runCompare` — não precisa mexer em `llm-providers.functions.ts`.
- Somar no resumo agregado do modo multi-perguntas: "Custo total: $X" por lado.

### Detalhes técnicos

**Arquivos alterados:**
- `src/features/project/CompareResponsesTab.tsx` — remove card de config; adiciona toggle multi-perguntas, execução sequencial, lista de resultados, métrica de custo.
- `src/features/project/SettingsTab.tsx` — aceita `projectId`, adiciona aba "LLM Config".
- `src/routes/projects.$projectId.tsx` — passa `projectId` para `SettingsTab`.
- `src/features/settings/LLMConfigTab.tsx` — **novo**, contém o card movido.
- `src/lib/llm-pricing.ts` — **novo**, tabela de preços + `estimateCost`.

**Sem alterações em:** backend, `runCompare`, schema do banco, RLS.
