# SQUAD/CODE — histórico operacional

## 2026-10-08 — preparação e baseline
- Lidos documento oficial Forge V0, organização, Source of Truth, ciclo de tarefa e templates. Nenhuma modificação no framework.
- Busca local não encontrou clone nem pasta literal “Meus Projetos”; operador confirmou `Obsidian Vault/Outros Projetos/Pessoal`.
- Clone de Had-Yel/squad-code-network em pasta própria; upstream configurado com push desabilitado; branch `codex/openai-codex-migration` sobre `4bfa888`.
- Codex 0.157.1 / Node 24.21.0 / Windows. `codex login status`: autenticado via ChatGPT (sem leitura de credenciais).
- `npm ci` falhou tentando node-gyp sem Python; `npm ci --ignore-scripts` instalou o binário fornecido no pacote; SQLite 3.53.4 verificado em memória.
- `npm test`: 21 testes originais passaram, incluindo isolamento, streaming, cancelamento, SQLite, migração de dados, snapshots, restart e chats. Validade: baseline original, fake Claude, não comprova integração Codex.
- Documentação oficial consultada: https://learn.chatgpt.com/docs/app-server e https://learn.chatgpt.com/docs/non-interactive-mode. Schemas gerados pelo CLI instalado em diretório temporário, fora do repositório.
- Decisão: adaptador app-server por stdio com threads por agente e ferramenta dinâmica para comunicação entre colegas; preservar contrato SSE/SQLite e os fluxos visuais.

## 2026-10-08 — implementação e validação real
- Adaptador `codex-adapter.js`: app-server JSON-RPC, autenticação/catálogo, threads efêmeras, `squad_call`, capacidades de leitura/escrita, tradução SSE, tokens, erros e cancelamento da árvore de processos.
- Bridge mantém token/Host/Origin, concorrência, timeout, SQLite e histórico; editor TOML valida antes da gravação e guarda backup. Configurações locais limitam-se a modelo/esforço; conectores e plugins do operador são desativados para os agentes.
- Interface preservada em `src/`: modelos da conta, indicadores Codex, capacidades/sandbox, consumo sem preço inventado, configurações TOML e exportação `AGENTS.md` + perfis/procedimentos Markdown. Build Node sem Python; mapa, estilos e assets não reescritos.
- `npm test`: 19 testes passaram no Windows/Node 24.21.0, com fixture JSON-RPC determinística. Cobre token/origin, cwd, chamadas de colegas, erros/streaming/cancelamento, TOML, SQLite, migração, snapshots, restart e conversas, além de proteção de caminhos nas ferramentas próprias.
- Execução real: `SQUAD_REAL_CODEX=1 node scripts/validate-codex.mjs`, Codex 0.157.1, `gpt-6-luna`, ambiente temporário isolado. Arquivo `validation.txt` criado com `CODEX_OK` e lido; comandante chamou ARGUS em thread independente, que leu e confirmou `REVIEW_OK`; comando de espera cancelado; três execuções registradas no SQLite. Todos os asserts passaram. Evidência reconstruível em `previews/real-codex.json` (ignorada pelo Git).
- Ensaio adicional de terminal nativo criou/leu `projects/codex-validation/codex-ok.txt`, exit 0. Não houve alteração de outros projetos.
- Diagnóstico: perfis personalizados exigem `default_permissions`; a ausência causava a mensagem genérica de requisitos do workspace. Ajustado para plataformas que usam perfis.
- Limitação confirmada: sandbox Windows elevado com bloqueio de leitura falhou com `helper_sandbox_lock_failed`, `SetNamedSecurityInfoW ... 5`. No Windows foi adotado explicitamente o sandbox nativo `unelevated`, com restrição de escrita/rede, sem alegar isolamento completo de leitura. Agentes sem Bash usam ferramentas com verificação de caminho/secrets. Linux/macOS ainda precisam de ensaio real.
- Teste Chromium passou, incluindo inicialização, catálogo/configuração TOML, exportação, SSE e console, sem erros JavaScript. Detectada e corrigida referência `codexPanel` na tela inicial. Ensaio com renderização 2D de fallback; mapa/estilos originais não foram reimplementados.
- README, guia e AGENTS.md atualizados; documentação histórica Claude virou ponte para as instruções atuais. Fixture Claude substituída; testes/resultados anteriores de UI preservados como referência. Nenhuma licença nova imposta; origem e créditos preservados.

- Orientação do operador: objetivo restrito à adaptação Codex; plataforma já validada. Encerrada a ampliação de testes gerais. Guia detalhado anterior preservado nas seções da plataforma e atualizado somente nos pontos operacionais do motor.

## 2026-10-08 — versionamento
- Commit técnico `48b41516bfb774d58b1efccca87267253ff7e0af`: execução nativa Codex, integração na interface, build e testes específicos do adaptador.
- Documentação operacional, master, checkpoint e log reunidos em commit separado. Branch principal preservada; publicação destinada exclusivamente ao fork Had-Yel.
