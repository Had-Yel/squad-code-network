"use strict";
// Codex CLI app-server boundary. The application consumes its existing SSE event contract.
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { spawn, execFile } = require("node:child_process");
const { EventEmitter } = require("node:events");
const { PassThrough, Writable } = require("node:stream");
const { parse } = require("smol-toml");
const IS_WIN = process.platform === "win32";

async function resolveBin(bin = "codex") {
  let resolved = bin;
  if (!path.isAbsolute(bin) && !/[\\/]/.test(bin)) {
    resolved = await new Promise((resolve) =>
      execFile(
        IS_WIN ? "where.exe" : "which",
        [bin],
        { windowsHide: true },
        (e, out) => resolve(e ? null : String(out).trim().split(/\r?\n/)[0]),
      ),
    );
  }
  if (!resolved || !fs.existsSync(resolved)) return null;
  // npm Windows launchers: execute their JS entry with Node, never interpolate RPC or prompts in cmd.exe.
  if (
    (IS_WIN && /\.(cmd|ps1|bat)$/i.test(resolved)) ||
    (IS_WIN && !path.extname(resolved))
  ) {
    const entry = path.join(
      path.dirname(resolved),
      "node_modules",
      "@openai",
      "codex",
      "bin",
      "codex.js",
    );
    if (fs.existsSync(entry)) return entry;
    if (!/\.exe$/i.test(resolved))
      throw Error("Use codex.exe ou o launcher oficial npm do Codex.");
  }
  return path.resolve(resolved);
}
function launch(bin, args, options = {}) {
  return spawn(
    /\.[cm]?js$/i.test(bin) ? process.execPath : bin,
    /\.[cm]?js$/i.test(bin) ? [bin, ...args] : args,
    {
      windowsHide: true,
      detached: !IS_WIN,
      stdio: ["pipe", "pipe", "pipe"],
      ...options,
    },
  );
}
function killProcess(child) {
  if (!child?.pid || child.exitCode !== null) return;
  if (IS_WIN)
    execFile(
      "taskkill",
      ["/pid", String(child.pid), "/T", "/F"],
      { windowsHide: true },
      () => {},
    );
  else {
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {
      child.kill("SIGTERM");
    }
  }
}
function cleanEnv(env = process.env) {
  const out = { ...env };
  for (const key of Object.keys(out))
    if (
      key.startsWith("CODEX_") &&
      ![
        "CODEX_HOME",
        "CODEX_API_KEY",
        "CODEX_WINDOWS_SANDBOX_PACKAGE_FAMILY",
      ].includes(key)
    )
      delete out[key];
  for (const key of Object.keys(out))
    if (
      /TOKEN|SECRET|PASSWORD|API_KEY/i.test(key) &&
      !["CODEX_API_KEY", "OPENAI_API_KEY"].includes(key)
    )
      delete out[key];
  return out;
}
// Do not import the operator's connectors, hooks or plugins into project agents.
function isolatedConfig(cwd) {
  const result = {
    "features.multi_agent": false,
    "features.apps": false,
    "features.plugins": false,
    "features.remote_plugin": false,
    "features.memories": false,
    "features.shell_snapshot": false,
    "features.hooks": false,
    "shell_environment_policy.inherit": "core",
    "shell_environment_policy.ignore_default_excludes": false,
    web_search: "disabled",
  };
  const home = process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
  for (const file of [
    path.join(home, "config.toml"),
    path.join(cwd, ".codex", "config.toml"),
  ]) {
    if (!fs.existsSync(file)) continue;
    const config = parse(fs.readFileSync(file, "utf8"));
    for (const name of Object.keys(config.mcp_servers || {}))
      result[`mcp_servers.${name}.enabled`] = false;
    for (const name of Object.keys(config.plugins || {}))
      result[`plugins.${name}.enabled`] = false;
  }
  return result;
}
function tomlValue(value) {
  if (Array.isArray(value)) return "[" + value.map(tomlValue).join(",") + "]";
  if (value && typeof value === "object")
    return (
      "{" +
      Object.entries(value)
        .map(([k, v]) => JSON.stringify(k) + "=" + tomlValue(v))
        .join(",") +
      "}"
    );
  return JSON.stringify(value);
}
class Rpc extends EventEmitter {
  constructor(bin, cwd, env, overrides = {}) {
    super();
    this.seq = 0;
    this.pending = new Map();
    this.buffer = "";
    this.closed = false;
    this.child = launch(
      bin,
      [
        "app-server",
        "--listen",
        "stdio://",
        ...Object.entries(overrides).flatMap(([key, value]) => [
          "-c",
          key + "=" + tomlValue(value),
        ]),
      ],
      { cwd, env: cleanEnv(env) },
    );
    this.child.stdout.setEncoding("utf8");
    this.child.stderr.setEncoding("utf8");
    this.child.stdout.on("data", (chunk) => {
      this.buffer += chunk;
      if (this.buffer.length > 8 * 1024 * 1024)
        return this.abort(Error("Evento Codex excedeu o limite."));
      let end;
      while ((end = this.buffer.indexOf("\n")) >= 0) {
        const line = this.buffer.slice(0, end);
        this.buffer = this.buffer.slice(end + 1);
        if (!line.trim()) continue;
        let msg;
        try {
          msg = JSON.parse(line);
        } catch {
          this.abort(Error("JSON-RPC inválido recebido do Codex."));
          return;
        }
        if (msg.id !== undefined && !msg.method) {
          const p = this.pending.get(msg.id);
          if (p) {
            clearTimeout(p.timer);
            this.pending.delete(msg.id);
            msg.error
              ? p.reject(Error(msg.error.message))
              : p.resolve(msg.result);
          }
        } else this.emit("message", msg);
      }
    });
    this.child.stderr.on("data", (text) => this.emit("diagnostic", text));
    this.child.on("error", (e) => this.abort(e));
    this.child.on("close", (code) => {
      this.closed = true;
      this.rejectAll(Error(`Codex app-server encerrado (${code}).`));
      this.emit("closed", code);
    });
    this.child.stdin.on("error", (e) => this.abort(e));
  }
  send(msg) {
    if (this.closed) throw Error("Codex desconectado.");
    this.child.stdin.write(JSON.stringify(msg) + "\n");
  }
  request(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.seq;
      const timer = setTimeout(
        () => {
          this.pending.delete(id);
          reject(Error(`Codex: tempo limite em ${method}.`));
        },
        method === "thread/start" ? 90000 : 30000,
      );
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.send({ id, method, params });
      } catch (e) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(e);
      }
    });
  }
  async init() {
    await this.request("initialize", {
      clientInfo: { name: "squad_code", title: "SQUAD/CODE", version: "3.0.0" },
      capabilities: { experimentalApi: true },
    });
    this.send({ method: "initialized", params: {} });
  }
  rejectAll(e) {
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(e);
    }
    this.pending.clear();
  }
  abort(e) {
    this.rejectAll(e);
    this.emit("failure", e);
    this.close();
  }
  close() {
    this.closed = true;
    this.rejectAll(Error("Codex encerrado."));
    killProcess(this.child);
  }
}
async function probe(bin) {
  const resolved = await resolveBin(bin);
  if (!resolved)
    return {
      resolved: null,
      version: null,
      error: `Executável "${bin}" não encontrado.`,
    };
  const version = await new Promise((resolve, reject) => {
    const c = launch(resolved, ["--version"]);
    let out = "";
    const timer = setTimeout(() => {
      killProcess(c);
      reject(Error("Codex --version excedeu o tempo limite."));
    }, 10000);
    c.stdout.on("data", (d) => (out += d));
    c.on("error", reject);
    c.on("close", (code) => {
      clearTimeout(timer);
      code === 0
        ? resolve(out.trim())
        : reject(Error("Falha ao consultar versão do Codex."));
    });
  });
  const rpc = new Rpc(
    resolved,
    os.tmpdir(),
    undefined,
    isolatedConfig(os.tmpdir()),
  );
  rpc.on("failure", () => {});
  try {
    await rpc.init();
    const account = await rpc.request("account/read", { refreshToken: false });
    const catalog = await rpc.request("model/list", {
      limit: 100,
      includeHidden: false,
    });
    return {
      resolved,
      version,
      error: null,
      authenticated: !!account.account,
      authType: account.account?.type || null,
      models: catalog.data || [],
    };
  } finally {
    rpc.close();
  }
}
const assistant = (content, parent) => ({
  type: "assistant",
  message: { content },
  ...(parent ? { parent_tool_use_id: parent } : {}),
});
const toolResult = (id, text, error = false, parent) => ({
  type: "user",
  message: {
    content: [
      { type: "tool_result", tool_use_id: id, content: text, is_error: error },
    ],
  },
  ...(parent ? { parent_tool_use_id: parent } : {}),
});
function profileFor(opts) {
  const tools = opts.tools;
  const writable =
    opts.permissionMode === "workspace-write" &&
    (tools === null ||
      tools === undefined ||
      tools.some((t) => ["Edit", "Write", "NotebookEdit", "Bash"].includes(t)));
  const filesystem = {
    glob_scan_max_depth: 8,
    ":minimal": "read",
    ":workspace_roots": {
      ".": writable ? "write" : "read",
      "**/.env": "deny",
      "**/.env.*": "deny",
      "**/.codex/auth.json": "deny",
    },
  };

  return { filesystem, network: { enabled: false } };
}
function dynamicSpecs(opts) {
  const defs = [];
  if (
    opts.agents &&
    Object.keys(opts.agents).length &&
    (!opts.tools || opts.tools.includes("Agent"))
  )
    defs.push({
      type: "function",
      name: "squad_call",
      description:
        "Peça a um colega da squad uma decisão ou revisão. Colegas: " +
        Object.entries(opts.agents)
          .map(([k, v]) => k + ": " + v.description)
          .join("; "),
      inputSchema: {
        type: "object",
        properties: {
          subagent_type: { type: "string", enum: Object.keys(opts.agents) },
          prompt: { type: "string" },
        },
        required: ["subagent_type", "prompt"],
        additionalProperties: false,
      },
    });
  // Codex normally reads through its shell. Restricted agents get a path-checked read tool without shell access.
  if (
    opts.tools?.some((t) => ["Read", "Glob", "Grep"].includes(t)) &&
    !opts.tools.includes("Bash")
  )
    defs.push({
      type: "function",
      name: "project_read",
      description:
        'Leia arquivo ou liste arquivos dentro do projeto. Use path "." para listar. Sem acesso a secrets.',
      inputSchema: {
        type: "object",
        properties: { path: { type: "string" }, query: { type: "string" } },
        required: ["path"],
        additionalProperties: false,
      },
    });
  if (
    opts.permissionMode === "workspace-write" &&
    opts.tools?.some((t) => ["Edit", "Write", "NotebookEdit"].includes(t)) &&
    !opts.tools.includes("Bash")
  )
    defs.push({
      type: "function",
      name: "project_write",
      description:
        "Crie ou atualize um arquivo textual dentro da pasta do projeto, sem terminal. Nunca use para credenciais.",
      inputSchema: {
        type: "object",
        properties: { path: { type: "string" }, text: { type: "string" } },
        required: ["path", "text"],
        additionalProperties: false,
      },
    });
  return defs;
}
function projectRead(cwd, args) {
  if (typeof args.path !== "string" || args.path.length > 1000)
    throw Error("Caminho inválido.");
  const root = fs.realpathSync(cwd),
    target = fs.realpathSync(path.resolve(root, args.path));
  const relative = path.relative(root, target);
  if (
    relative.startsWith("..") ||
    path.isAbsolute(relative) ||
    /(^|[\\/])(?:\.env(?:\.[^\\/]*)?|auth\.json|\.git|\.codex|node_modules)(?:[\\/]|$)/i.test(
      relative,
    )
  )
    throw Error("Leitura fora do escopo autorizado.");
  if (fs.statSync(target).isDirectory())
    return fs
      .readdirSync(target, { withFileTypes: true })
      .filter((x) => !/^\.(git|env|codex)/.test(x.name))
      .slice(0, 300)
      .map((x) => x.name + (x.isDirectory() ? "/" : ""))
      .join("\n");
  if (fs.statSync(target).size > 1024 * 1024)
    throw Error("Arquivo excede 1 MB.");
  const text = fs.readFileSync(target, "utf8");
  return (
    args.query
      ? text
          .split("\n")
          .filter((l) => l.includes(String(args.query)))
          .join("\n")
      : text
  ).slice(0, 60000);
}
function projectWrite(cwd, args) {
  if (
    typeof args.path !== "string" ||
    typeof args.text !== "string" ||
    Buffer.byteLength(args.text) > 1024 * 1024
  )
    throw Error("Arquivo textual inválido ou maior que 1 MB.");
  const root = fs.realpathSync(cwd),
    target = path.resolve(root, args.path),
    relative = path.relative(root, target);
  if (
    !relative ||
    relative.startsWith("..") ||
    path.isAbsolute(relative) ||
    /(^|[\\/])(?:\.env(?:\.[^\\/]*)?|auth\.json|\.git|\.codex|node_modules)(?:[\\/]|$)/i.test(
      relative,
    )
  )
    throw Error("Escrita fora do escopo autorizado.");
  let ancestor = target;
  while (!fs.existsSync(ancestor)) ancestor = path.dirname(ancestor);
  const real = fs.realpathSync(ancestor),
    rel = path.relative(root, real);
  if (
    rel.startsWith("..") ||
    path.isAbsolute(rel) ||
    (fs.existsSync(target) && fs.lstatSync(target).isSymbolicLink())
  )
    throw Error("Escrita por link fora do escopo.");
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, args.text, {
    encoding: "utf8",
    flag: fs.existsSync(target) ? "w" : "wx",
  });
  return "Arquivo salvo: " + relative;
}
function createExecution(bin, opts, systemPrompt, env) {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.exitCode = null;
  child.killed = false;
  const baseConfig = {
    ...isolatedConfig(opts.cwd),
    default_permissions: "squad",
    "permissions.squad": profileFor(opts),
    "permissions.squad-read": profileFor({
      ...opts,
      permissionMode: "read-only",
    }),
  };
  if (IS_WIN) {
    delete baseConfig.default_permissions;
    delete baseConfig["permissions.squad"];
    delete baseConfig["permissions.squad-read"];
    baseConfig["windows.sandbox"] = "unelevated";
  }
  const rpc = new Rpc(bin, opts.cwd, env, baseConfig);
  child.pid = rpc.child.pid;
  const threads = new Map();
  let ended = false,
    mainId = null,
    calls = 0,
    catalog = [];
  const started = Date.now();
  const emit = (e) => {
    if (!ended) child.stdout.write(JSON.stringify(e) + "\n");
  };
  function finish(code, error) {
    if (ended) return;
    if (error) child.stderr.write(error.message || String(error));
    ended = true;
    for (const t of threads.values())
      t.reject(error || Error("Execução encerrada."));
    threads.clear();
    child.exitCode = code;
    rpc.close();
    child.stdout.end();
    child.stderr.end();
    child.emit("close", code);
  }
  child.cancel = () => {
    if (ended) return;
    child.killed = true;
    for (const [id, t] of threads)
      if (t.turnId)
        rpc
          .request("turn/interrupt", { threadId: id, turnId: t.turnId })
          .catch(() => {});
    finish(1);
  };
  child.kill = child.cancel;
  rpc.on("failure", (e) => finish(1, e));
  rpc.on("closed", (code) => {
    if (!ended)
      finish(code || 1, Error("Codex encerrou antes de concluir a tarefa."));
  });
  rpc.on("diagnostic", (text) => {
    if (!ended) child.stderr.write(text.slice(0, 4000));
  });
  async function runAgent(options, prompt, instructions, parent) {
    options = { ...options };
    const local = path.join(options.cwd, ".codex", "squad.local.toml");
    const preferences = fs.existsSync(local)
      ? parse(fs.readFileSync(local, "utf8"))
      : {};
    options.model ||=
      preferences.model ||
      (catalog.find((m) => m.isDefault) || catalog[0])?.model;
    options.effort ||=
      preferences.model_reasoning_effort ||
      catalog.find((m) => m.model === options.model)?.defaultReasoningEffort;
    const supported = catalog.find(
      (m) => m.model === options.model,
    )?.supportedReasoningEfforts;
    if (
      options.effort &&
      supported?.length &&
      !supported.some((x) => x.reasoningEffort === options.effort)
    )
      throw Error(
        "Esforço " +
          options.effort +
          " não disponível para " +
          options.model +
          ".",
      );
    const config = isolatedConfig(options.cwd);

    if (IS_WIN) {
      config["windows.sandbox"] = "unelevated";
      config["sandbox_workspace_write.writable_roots"] = options.addDirs || [];
      config["sandbox_workspace_write.network_access"] = false;
      config["sandbox_workspace_write.exclude_tmpdir_env_var"] = true;
      config["sandbox_workspace_write.exclude_slash_tmp"] = true;
    }
    config["features.shell_tool"] =
      !options.tools || options.tools.includes("Bash");
    config.web_search =
      !options.tools ||
      options.tools.some((t) => ["WebSearch", "WebFetch"].includes(t))
        ? "cached"
        : "disabled";
    const response = await rpc.request("thread/start", {
      cwd: options.cwd,
      model: options.model || null,
      approvalPolicy: "never",
      ...(IS_WIN
        ? {
            sandbox:
              profileFor(options).filesystem[":workspace_roots"]["."] ===
              "write"
                ? "workspace-write"
                : "read-only",
          }
        : {
            permissions:
              profileFor(options).filesystem[":workspace_roots"]["."] ===
              "write"
                ? "squad"
                : "squad-read",
          }),
      runtimeWorkspaceRoots: [options.cwd, ...(options.addDirs || [])],
      developerInstructions:
        instructions +
        "\n\nTrabalhe somente na pasta autorizada. Nunca acesse credenciais, expanda permissões ou execute operações destrutivas. Peça aprovação humana no relatório quando necessário. Para chamar colegas use squad_call; não use subagentes internos.",
      config,
      dynamicTools: dynamicSpecs(options),
      ephemeral: true,
    });
    const id = response.thread.id;
    const result = new Promise((resolve, reject) =>
      threads.set(id, {
        resolve,
        reject,
        options,
        parent,
        text: "",
        usage: null,
        turnId: null,
      }),
    );
    result.catch(() => {}); // notifications may arrive before the turn/start response
    if (!parent) {
      mainId = id;
      emit({
        type: "system",
        subtype: "init",
        session_id: id,
        model: response.model,
        permissionMode: options.permissionMode,
        tools: options.tools || [],
        cwd: options.cwd,
      });
    }
    const turn = await rpc.request("turn/start", {
      threadId: id,
      input: [{ type: "text", text: prompt, text_elements: [] }],
      ...(options.effort ? { effort: options.effort } : {}),
    });
    const t = threads.get(id);
    if (t) t.turnId = turn.turn.id;
    return result;
  }
  async function request(msg) {
    const p = msg.params || {},
      t = threads.get(p.threadId);
    if (msg.method === "item/tool/call") {
      let text,
        success = true;
      try {
        if (!t) throw Error("Thread desconhecida.");
        const args =
          typeof p.arguments === "string"
            ? JSON.parse(p.arguments)
            : p.arguments;
        if (p.tool === "project_read" || p.tool === "project_write") {
          if (!dynamicSpecs(t.options).some((d) => d.name === p.tool))
            throw Error("Capacidade não autorizada.");
          emit(
            assistant(
              [
                {
                  type: "tool_use",
                  id: p.callId,
                  name: p.tool === "project_read" ? "Read" : "Write",
                  input: { file_path: args.path },
                },
              ],
              t.parent,
            ),
          );
          text =
            p.tool === "project_read"
              ? projectRead(t.options.cwd, args)
              : projectWrite(t.options.cwd, args);
          emit(toolResult(p.callId, text, false, t.parent));
        } else if (p.tool === "squad_call") {
          if (t.parent || ++calls > 8)
            throw Error("Limite de chamadas entre colegas atingido.");
          const def = t.options.agents?.[args.subagent_type];
          if (
            !def ||
            typeof args.prompt !== "string" ||
            !args.prompt.trim() ||
            args.prompt.length > 60000
          )
            throw Error("Chamada de colega inválida.");
          emit(
            assistant([
              { type: "tool_use", id: p.callId, name: "Agent", input: args },
            ]),
          );
          const allowed = t.options.tools;
          const tools = def.tools
            ? def.tools.filter((x) => !allowed || allowed.includes(x))
            : allowed;
          const res = await runAgent(
            {
              ...t.options,
              tools,
              agents: null,
              model: def.model || t.options.model,
              effort: def.effort || t.options.effort,
            },
            args.prompt,
            def.prompt || "",
            p.callId,
          );
          text = res.text;
          emit(toolResult(p.callId, text, false));
        } else throw Error("Ferramenta dinâmica não autorizada.");
      } catch (e) {
        success = false;
        text = e.message;
        if (p.tool === "squad_call") emit(toolResult(p.callId, text, true));
      }
      if (!ended)
        rpc.send({
          id: msg.id,
          result: {
            contentItems: [{ type: "inputText", text: String(text || "") }],
            success,
          },
        });
    } else {
      // No implicit elevation, including MCP elicitation, filesystem/network grants and tool approvals.
      emit({
        type: "bridge",
        subtype: "permission-denied",
        method: msg.method,
        reason: "Requer aprovação humana; execução sem elevação automática.",
      });
      if (msg.method === "item/permissions/requestApproval")
        rpc.send({ id: msg.id, result: { permissions: {}, scope: "turn" } });
      else if (msg.method.includes("requestApproval"))
        rpc.send({ id: msg.id, result: { decision: "decline" } });
      else if (
        msg.method === "item/tool/requestUserInput" ||
        msg.method === "tool/requestUserInput"
      )
        rpc.send({ id: msg.id, result: { answers: {} } });
      else
        rpc.send({
          id: msg.id,
          error: {
            code: -32601,
            message: "Solicitação não suportada pelo SQUAD/CODE.",
          },
        });
    }
  }
  rpc.on("message", (msg) => {
    if (msg.id !== undefined) {
      request(msg).catch((e) => finish(1, e));
      return;
    }
    const p = msg.params || {},
      t = threads.get(p.threadId);
    if (!t) return;
    const item = p.item;
    if (msg.method === "turn/started") t.turnId = p.turn.id;
    else if (msg.method === "item/agentMessage/delta" && t.options.partial)
      emit({
        type: "stream_event",
        event: {
          type: "content_block_delta",
          delta: { type: "text_delta", text: p.delta },
        },
        ...(t.parent ? { parent_tool_use_id: t.parent } : {}),
      });
    else if (msg.method === "item/completed" && item?.type === "agentMessage") {
      if (item.phase === "final_answer" || !item.phase)
        t.text = item.text || t.text;
      emit(assistant([{ type: "text", text: item.text || "" }], t.parent));
    } else if (
      msg.method === "item/started" &&
      item?.type === "commandExecution"
    )
      emit(
        assistant(
          [
            {
              type: "tool_use",
              id: item.id,
              name: "Bash",
              input: { command: item.command },
            },
          ],
          t.parent,
        ),
      );
    else if (
      msg.method === "item/completed" &&
      item?.type === "commandExecution"
    )
      emit(
        toolResult(
          item.id,
          item.aggregatedOutput || "",
          item.exitCode !== 0,
          t.parent,
        ),
      );
    else if (msg.method === "item/completed" && item?.type === "fileChange")
      for (const change of item.changes || [])
        emit(
          assistant(
            [
              {
                type: "tool_use",
                id: item.id,
                name: "Edit",
                input: { file_path: change.path },
              },
            ],
            t.parent,
          ),
        );
    else if (msg.method === "item/completed" && item?.type === "webSearch")
      emit(
        assistant(
          [
            {
              type: "tool_use",
              id: item.id,
              name: "WebSearch",
              input: { query: item.query },
            },
          ],
          t.parent,
        ),
      );
    else if (msg.method === "thread/tokenUsage/updated")
      t.usage = p.tokenUsage?.total || p.tokenUsage;
    else if (msg.method === "turn/completed") {
      const failed = p.turn.status !== "completed";
      const value = { text: t.text, usage: t.usage };
      if (failed)
        t.reject(
          Error(p.turn.error?.message || `Turno Codex ${p.turn.status}.`),
        );
      else t.resolve(value);
      threads.delete(p.threadId);
    }
  });
  let prompt = "";
  child.stdin = new Writable({
    write(chunk, encoding, cb) {
      prompt += chunk.toString();
      cb();
    },
    final(cb) {
      cb();
      (async () => {
        await rpc.init();
        const account = await rpc.request("account/read", {
          refreshToken: false,
        });
        if (!account.account && account.requiresOpenaiAuth !== false)
          throw Error(
            "Codex não autenticado. Execute codex login no terminal.",
          );
        catalog =
          (
            await rpc.request("model/list", {
              limit: 100,
              includeHidden: false,
            })
          ).data || [];
        const r = await runAgent(opts, prompt, systemPrompt);
        emit({
          type: "result",
          result: r.text,
          is_error: false,
          session_id: mainId,
          duration_ms: Date.now() - started,
          total_cost_usd: null,
          num_turns: 1,
          usage: r.usage,
        });
        finish(0);
      })().catch((e) => finish(1, e));
    },
  });
  return child;
}
module.exports = {
  resolveBin,
  launch,
  killProcess,
  probe,
  createExecution,
  profileFor,
  projectRead,
  projectWrite,
  Rpc,
};
