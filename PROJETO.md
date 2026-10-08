# SQUAD/CODE — contexto corrente

## Identificação e fontes
- Responsável: Had-Yel. Finalidade: organizar squads e executar desenvolvimento com OpenAI Codex, preservando a plataforma original.
- Fonte técnica: https://github.com/Had-Yel/squad-code-network (origin).
- Referência: https://github.com/felipeAguiarCode/squad-code-network (upstream; push desabilitado).
- Cópia local: `C:\Users\User\Documents\Obsidian Vault\Outros Projetos\Pessoal\squad-code-network`.
- Branch: `codex/openai-codex-migration`, base `4bfa888ed62a74d9bd87b8731082b3b0fc5a3c4c`.
- Norma: [DÔBLA Forge V0](../DÔBLA%20forge%20-%20Framework/DÔBLA%20Forge%20V0/DOBLA_FORGE_V0_DOCUMENTO_OFICIAL.md). Framework consultado sem alterações.
- Índice geral local: [PROJETOS.md](../PROJETOS.md).

## Arquitetura implementada
- Frontend: SPA em `src/app.js`; cidade/escritório Three.js em `src/city.js`; fontes e assets incorporados em `index.html`. Frontend coordena squads, tarefas, rotas, handoffs, chats e aprovações humanas.
- Bridge Node.js: loopback, token por início, Host/Origin, SSE, limites de concorrência/tempo e cancelamento.
- Codex: `codex-adapter.js` usa JSON-RPC de `codex app-server` por stdio. Autenticação permanece no CLI. Modelo/esforço são consultados no catálogo da conta. Cada agente tem thread efêmera própria; `squad_call` coordena colegas sem delegação interna recursiva.
- Capacidades: terminal nativo dentro do sandbox; agentes sem terminal usam leitura/escrita com validação de caminhos. Aprovações operacionais continuam na interface; pedidos de elevação do CLI são recusados.
- Persistência: `db.js`, better-sqlite3, SQLite/WAL/transações/snapshots; conserva estrutura anterior. Chats/histórico fornecem contexto para novos turnos.
- Configuração: TOML nativo, smol-toml, backups; preferências locais de modelo/esforço. Exportação para AGENTS.md + docs de agentes/workflows, sem pressupor equivalência com configurações de subagentes de outro provedor.
- Build: Node, sem Python obrigatório. Python/Pillow continuam opcionais para regenerar avatares.

## Decisões e limites
- Contrato interno SSE preservado; peculiaridades Codex ficam no adaptador. UI/3D, SQLite e fluxos existentes não foram reconstruídos.
- Codex validado: 0.157.1, Node 24.21.0, Windows, autenticação ChatGPT; ensaio real com gpt-6-luna. Documentação oficial e schemas do CLI consultados.
- Windows usa sandbox nativo `unelevated`, com escrita/rede restritas e leitura mais ampla. Perfis de bloqueio de leitura no modo elevado falharam por acesso negado ao helper. Não há alegação de isolamento completo de leitura; preferir ferramentas sem Bash para material sensível. Linux/macOS usam perfis; ainda sem ensaio real.
- Codex não oferece custo/teto monetário por execução: tokens, timeout e concorrência são reportados; `maxBudgetUsd` positivo é rejeitado.
- Threads são efêmeras, sem retomada pelo ID. Máximo de oito consultas de colegas, sem chamadas aninhadas. MCPs/apps/plugins/hooks/delegação nativa do operador ficam desativados.
- Autoridade: GitHub para código e histórico técnico; este master para contexto corrente; LOG.md para auditoria; checkpoint abaixo para retomada; `src/` prevalece sobre HTML derivado.
- Organização mínima Forge: master + log + índice local. Sem `.dobla/` ou cache artificial. `data/`, `projects/`, `node_modules/`, `previews/` e configurações locais não são fonte técnica versionada.
- Empower: fork local, testes, branch, push e PR autorizados. Sem merge, push no upstream, mudanças no Forge ou em outros projetos.

## Estado e checkpoint — 2026-10-08
- Concluído: localização, normas, clone/remotes/branch, análise, instalação, adaptador, ajustes operacionais, documentação e 19 testes de backend.
- Validação real concluída: escrita/leitura + SSE; comandante → revisor → comandante; cancelamento; histórico SQLite com três execuções. Evidências em [LOG.md](LOG.md).
- Integração na interface verificada em Chromium: inicialização, configuração/modelos, TOML, exportação, SSE e console. A plataforma já foi validada pelo operador; sem revalidação ampla.
- Em conclusão: revisão final, commits e publicação da branch/PR no fork.
- Limitações conhecidas acima permanecem explícitas. O PR não será mesclado automaticamente.
