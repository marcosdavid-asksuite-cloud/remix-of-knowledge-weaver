# Ajustes em Settings → Extraction Pipeline

## 1. Prompt único de extração

Hoje `extraction_settings` tem dois campos separados (`system_prompt` e `extraction_prompt`) e a extração envia ambos ao gateway (`system:` + `user:`). Vamos consolidar em **um único prompt** — pensando na evolução futura em que essa configuração vira o prompt do agente de extração no produto final.

Mudanças:
- **Banco (`extraction_settings`)**: adicionar coluna nova `unified_prompt` (text). Migração faz backfill concatenando o `system_prompt` + duas quebras de linha + `extraction_prompt` atual para não perder o que o usuário já editou. Manter `system_prompt` e `extraction_prompt` na tabela por enquanto (não dropar) para segurança, mas parar de lê-los.
- **UI (`ExtractionSettingsTab.tsx`)**: remover os dois cards "System prompt" e "Extraction prompt". Substituir por **um único card "Prompt de extração"** com um Textarea grande, mostrando as mesmas variáveis disponíveis (`{{topic_slug}}`, `{{topic_name}}`, `{{topic_description}}`, `{{data_points}}`, `{{chunk}}`) e uma nota de que o prompt inclui as instruções gerais (antigo system) + o template por tópico.
- **Extração (`src/lib/ai.functions.ts`)**: no loop por (chunk, tópico), renderizar `settings.unified_prompt` com as variáveis e enviar tudo como `user:` no `callGateway` (sem `system:` separado). Manter o restante do pipeline (classify por alias/LLM, deterministic pass, dry_run vs persist) intacto — este ajuste é só sobre qual prompt/texto é enviado.

Sem alteração no fluxo de chunks, na tabela `data_point_definitions`, nem no processamento determinístico.

## 2. Seleção compartilhada do modelo LLM

O modelo usado na extração vem hoje de `model_configurations` (banco), enquanto Compare Responses usa `localStorage` via `LLMConfigTab`. Você pediu para **compartilhar**. Vamos adotar o `LLMConfigTab` (Settings → LLM Config) como fonte única.

Mudanças:
- **`LLMConfigTab.tsx`**: manter como está (provider + model + temperature + apiKey persistidos em `localStorage`). Nenhuma UI nova em Extraction Pipeline — a instrução aparece como um aviso no topo da aba: *"O modelo usado na extração é o mesmo configurado em Settings → LLM Config."*
- **Extração (`runExtraction` em `src/lib/ai.functions.ts`)**: aceitar `modelOverride` opcional no input (model, temperature, provider) e usar isso em vez de `model_configurations` quando presente.
- **Chamada da extração (`ExtractionsTab.tsx` e onde `runProcess` dispara em `UploadTab.tsx`)**: ler a config do `localStorage` (mesma chave que `LLMConfigTab` grava) e passar como `modelOverride` na chamada do server fn. Se não houver config salva, cai no default de `model_configurations` (comportamento atual).
- **Custo/logs**: continuar registrando `estimated_cost` e `llm_calls` com o `model_name` efetivamente usado (o override).

Nenhuma migração de schema para esta parte.

## Detalhes técnicos

- Migração SQL:
  ```sql
  ALTER TABLE extraction_settings
    ADD COLUMN IF NOT EXISTS unified_prompt text;
  UPDATE extraction_settings
    SET unified_prompt = coalesce(system_prompt,'') || E'\n\n' || coalesce(extraction_prompt,'')
    WHERE unified_prompt IS NULL;
  ```
- Tipos gerados do Supabase (`src/integrations/supabase/types.ts`) serão regenerados automaticamente após a migração; onde há casts `as never` no `update`, manter o padrão atual.
- `renderPrompt` já suporta todas as variáveis — sem mudança nele.
- `callGateway` continua recebendo `system` opcional; passaremos string vazia ou omitiremos.

## Fora de escopo (não faremos nesta rodada)

- Dropar `system_prompt` / `extraction_prompt` do banco (mantidos como legado).
- Refatorar o pipeline para "uma única chamada por documento" — você deixou claro que a intenção é apenas juntar os dois prompts, não reescrever o loop.
- Mudar como o Compare Responses usa o modelo (permanece igual).
