# SQUAD/CODE — Development Network com OpenAI Codex

Interface local para organizar squads de desenvolvimento: comandante, reconhecedores de produto e arquitetura e especialistas. O comandante planeja; você aprova; os agentes executam nas pastas das operações. O escritório, a cidade 3D, os chats, handoffs, revisões humanas e SQLite foram preservados.

Este fork de [felipeAguiarCode/squad-code-network](https://github.com/felipeAguiarCode/squad-code-network) migra o motor de Claude Code para **OpenAI Codex CLI**, com orquestração pela aplicação. Créditos do projeto e dos assets originais permanecem nos arquivos. O upstream consultado não contém arquivo LICENSE; esta migração não concede uma licença nova.

## Instalar e iniciar

Requisitos: Node.js 22+, Git, navegador com WebGL e Codex CLI autenticado. Integração validada no Windows com Node 24.21.0 e Codex 0.157.1; outras versões do protocolo precisam de validação.

```sh
git clone https://github.com/Had-Yel/squad-code-network.git
cd squad-code-network
git checkout codex/openai-codex-migration
npm ci --ignore-scripts
npm install -g @openai/codex
codex --version
codex login
codex login status
npm start
```

Abra [127.0.0.1:4317](http://127.0.0.1:4317) e escolha como criar o banco inicial. A autenticação permanece no Codex; o bridge não copia tokens. A instalação com scripts ignorados foi validada com o binário SQLite fornecido pelo pacote neste ambiente. Se não houver binário para seu sistema/Node, instale os requisitos de compilação de better-sqlite3 antes de reinstalar normalmente.

Na primeira operação, confira **Configurações → OpenAI Codex → Testar conexão**. Configure o modelo a partir do catálogo da conta e mantenha o sandbox. Cada operação usa `projects/<pasta>/`, com seu próprio repositório Git. Para experimentar a interface sem consumir a conta, selecione explicitamente o modo demo. Abrir `index.html` diretamente oferece somente a demonstração.

## Integração

```text
Interface / squads / aprovação humana
    → HTTP local autenticado → server.js → codex-adapter.js
    → codex app-server (JSON-RPC por stdio)
    → thread por agente → eventos SSE → interface e SQLite
```

O adaptador envia o perfil do agente em `developerInstructions`, inicia um turno, traduz mensagens, ferramentas, tokens e término para o contrato SSE existente e encerra a árvore de processos no cancelamento/timeout. A ferramenta dinâmica `squad_call` inicia um colega em outra thread, com suas instruções e capacidades, e devolve a resposta ao solicitante. Chamadas aninhadas são bloqueadas; há limite de oito consultas por execução. Não depende dos subagentes internos de outro provedor.

Chats reapresentam o histórico mantido pelo SQUAD/CODE. As threads são efêmeras: IDs são rastreáveis no histórico, mas não representam sessões retomáveis do CLI. Planejamento e revisão humana continuam na aplicação. Solicitações de elevação ou permissões do CLI são recusadas e reportadas; não existe autorização silenciosa.

## Configuração e segurança

| Opção | Comportamento |
|---|---|
| Modelo / esforço | Catálogo nativo da conta; seleção explícita por runtime ou agente. Sem seleção, usa o padrão disponível. |
| `read-only` | Sem escrita; capacidades do agente continuam aplicadas. |
| `workspace-write` | Escrita na operação e pastas adicionais autorizadas explicitamente. |
| Ferramentas | Terminal nativo quando Bash é permitido; agentes sem terminal usam ferramentas de leitura/escrita com verificação de caminho. Pesquisa usa o recurso nativo do Codex. |
| Timeout / concorrência | Limites de duração e processos no bridge. |
| `config.toml` | Editor de configuração de usuário/projeto, validação TOML e backup `.bak`. |
| `squad.local.toml` | Preferências locais `model` e `model_reasoning_effort`, ignoradas pelo Git. |

O bridge escuta somente em loopback, valida Host/Origin e exige token por início em `/api`. Prompts e argumentos de ferramentas seguem por JSON, sem interpolação em shell. MCPs, apps, plugins, hooks e delegação nativa do usuário são desativados nas execuções da aplicação. Configurações de segurança do adaptador prevalecem sobre preferências do operador.

**Limitação do Windows:** nesta máquina, os perfis com bloqueios de leitura exigem o sandbox elevado, que falhou com `helper_sandbox_lock_failed` / `SetNamedSecurityInfoW ... 5`. O adaptador seleciona explicitamente o sandbox nativo `unelevated`, que restringe escrita e rede de comandos, mas permite leitura mais ampla do sistema. As ferramentas próprias `project_read`/`project_write` rejeitam escapes, links externos e `.env`; comandos de terminal não oferecem a mesma restrição de leitura. Para material sensível, use agentes sem Bash ou um ambiente isolado, como WSL/container. Não foi declarada validação de isolamento completo de leitura no Windows. Linux/macOS usam perfis restritos; precisam de ensaio real nessas plataformas. Os globs de secrets são expandidos até oito níveis; arquivos novos durante um turno podem não entrar no snapshot do sandbox.

**Consumo:** o Codex informa tokens, sem custo em dólares ou teto monetário por execução. A interface não inventa preço. Execuções usam os limites/cobrança da conta OpenAI. O antigo parâmetro `maxBudgetUsd` positivo é rejeitado com explicação.

Variáveis: `SQUAD_PORT`, `SQUAD_CODEX_BIN`, `SQUAD_PROJECTS_DIR`, `SQUAD_DATA_DIR`. No Windows, o launcher npm oficial é resolvido para o JS e iniciado com Node; também aceita `codex.exe`. Launchers `.cmd` arbitrários são rejeitados.

## Desenvolvimento e validação

```sh
npm run dev       # build e observação de src/, server, db e adaptador
npm run build     # gera index.html a partir de src/, sem Python
npm test          # contrato JSON-RPC/SSE, segurança, SQLite e regressões
npx playwright install chromium
npm run test:ui   # interface em Chromium; CLI simulado, sem consumo
```

`python build.py` continua disponível para regenerar avatares, com Pillow. Edite `src/`, nunca somente o HTML gerado. Os testes automatizados usam um app-server determinístico; não substituem a validação real. Evidências reais, resultados e limitações ficam em [LOG.md](LOG.md). Para repetir o ensaio real de forma explícita, defina `SQUAD_REAL_CODEX=1` e execute `node scripts/validate-codex.mjs`; isso consome sua conta.

## Dados, operação e diagnóstico

- `data/squad.db`: workspace, snapshots, salas, chats e histórico. Faça backup antes de mover dados. JSONs antigos são migrados uma vez e preservados em `data/legacy-json/`.
- `projects/`: arquivos produzidos por agentes, fora do Git da plataforma.
- `previews/`: evidências reconstruíveis de desenvolvimento, ignoradas.
- Token inválido: recarregue a página após reiniciar o bridge.
- Codex ausente: confira `codex --version`, PATH ou `SQUAD_CODEX_BIN`.
- Sem autenticação: execute `codex login` no terminal; a UI não solicita credenciais.
- Modelo/esforço indisponível: selecione uma combinação anunciada pela conta.
- Porta ocupada: `npm start -- --port 4318`.
- Permissão recusada: revise a tarefa/capacidades; o adaptador nunca muda para acesso irrestrito.

[Guia de uso](docs/GUIA.md) · [Contexto e checkpoint do projeto](PROJETO.md) · [Histórico e evidências](LOG.md) · [Instruções de desenvolvimento](AGENTS.md).

Fontes oficiais: [app-server](https://developers.openai.com/codex/app-server/), [modo não interativo](https://developers.openai.com/codex/noninteractive/), [configuração](https://developers.openai.com/codex/config-reference/).
