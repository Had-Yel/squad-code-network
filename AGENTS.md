# Desenvolvimento do SQUAD/CODE

Leia README.md para instalação/limitações, PROJETO.md para decisões e checkpoint e LOG.md para evidências. Não modifique o DÔBLA Forge ou outros projetos. O fork de trabalho é Had-Yel/squad-code-network; upstream é referência e tem push desabilitado. Não faça merge automaticamente.

## Componentes

- src/app.js: SPA, agentes, squads, projetos, planejamento, aprovações, chats e handoffs. Há linhas extensas com templates; faça substituições exatas e verifique a sintaxe.
- src/city.js: escritório/cidade Three.js. Preserve apresentação e comportamento.
- server.js: HTTP local com Host/Origin/token, opções de execução, SSE, configuração TOML e ciclo dos processos.
- codex-adapter.js: JSON-RPC do Codex app-server, autenticação/catálogo, threads, capacidades, squad_call, cancelamento e tradução do contrato de eventos.
- db.js: SQLite, migração, snapshots, conversas e histórico. Não reestruture dados existentes sem necessidade.
- index.html: derivado de src/. Gere com npm run build e inclua o resultado na mesma alteração.

O frontend coordena tarefas e reapresenta contexto. Colegas têm threads independentes, sem delegação nativa recursiva. Mensagens assistant/user/result/system/stream_event/exit são o contrato interno de compatibilidade; não significam que Claude ainda executa.

## Validação

Execute npm test para os contratos e persistência. npm run test:ui usa Playwright/Chromium e um CLI simulado, sem consumo. Alterações no protocolo ou sandbox exigem também ensaio real controlado, opt-in, com arquivos descartáveis em projects/. Registre CLI/Node/OS, resultado e limitações em LOG.md. Nunca apresente fixture como execução real.

Use schemas gerados pela versão instalada (`codex app-server generate-json-schema --experimental --out <temporário>`) e documentação oficial. Não presuma equivalência de flags entre provedores. Não exponha credenciais em diagnósticos, testes ou commits. Não altere permissões para acesso irrestrito para contornar falhas.

Atualize README/guia quando mudar comportamento; mantenha PROJETO.md como contexto corrente e LOG.md como trilha histórica. Cache, dados, projetos gerados, configurações locais e evidências reconstruíveis permanecem ignorados pelo Git.
