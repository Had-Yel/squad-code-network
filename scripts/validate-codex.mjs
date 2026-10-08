// Explicit integration check. Consumes the authenticated Codex account only when opted in.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
if (process.env.SQUAD_REAL_CODEX !== "1")
  throw Error(
    "Defina SQUAD_REAL_CODEX=1 para autorizar o consumo da conta neste teste.",
  );
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."),
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "squad-real-")),
  port = 5400 + Math.floor(Math.random() * 300);
const proc = spawn(
  process.execPath,
  [path.join(root, "server.js"), "--port", String(port)],
  {
    cwd: root,
    env: {
      ...process.env,
      SQUAD_PRINT_TOKEN: "1",
      SQUAD_DATA_DIR: path.join(tmp, "data"),
      SQUAD_PROJECTS_DIR: path.join(tmp, "projects"),
    },
    windowsHide: true,
  },
);
let token,
  log = "";
try {
  token = await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(Error("Bridge startup timeout")),
      10000,
    );
    proc.stdout.on("data", (d) => {
      log += d;
      const m = log.match(/TOKEN=(\w+)/);
      if (m) {
        clearTimeout(timer);
        resolve(m[1]);
      }
    });
    proc.on("error", reject);
  });
  const api = async (p, body) => {
    const r = await fetch("http://127.0.0.1:" + port + p, {
      method: body ? "POST" : "GET",
      headers: { "content-type": "application/json", "x-squad-token": token },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const b = await r.json();
    assert.ok(r.ok, b.error);
    return b;
  };
  const health = await api("/api/health");
  assert.equal(health.authenticated, true);
  const model = process.env.CODEX_TEST_MODEL || "gpt-6-luna";
  await api("/api/setup", {
    version: 2,
    agents: [],
    squads: [],
    projects: [{ id: "validation", name: "Validação controlada" }],
  });
  async function run(prompt, options, systemPrompt, onEvent = () => {}) {
    const r = await api("/api/runs", {
      prompt,
      systemPrompt,
      meta: { projectId: "validation", kind: "step" },
      options: {
        project: "controlled",
        model,
        effort: "low",
        timeoutSec: 150,
        ...options,
      },
    });
    const res = await fetch(
        `http://127.0.0.1:${port}/api/runs/${r.runId}/events`,
        { headers: { "x-squad-token": token } },
      ),
      reader = res.body.getReader(),
      decoder = new TextDecoder(),
      events = [];
    let buffer = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let at;
      while ((at = buffer.indexOf("\n\n")) >= 0) {
        const block = buffer.slice(0, at);
        buffer = buffer.slice(at + 2);
        const line = block.split("\n").find((l) => l.startsWith("data: "));
        if (line) {
          const event = JSON.parse(line.slice(6));
          events.push(event);
          await onEvent(event, r.runId, api);
        }
      }
    }
    return {
      events,
      exit: events.findLast((e) => e.type === "exit"),
      cwd: r.cwd,
    };
  }
  const written = await run(
    "Use project_write para criar somente validation.txt com o texto exato CODEX_OK. Depois use project_read para confirmar. Retorne CODEX_OK.",
    {
      tools: ["Read", "Write"],
      permissionMode: "workspace-write",
      partial: true,
    },
    "Você é o implementador. Execute somente a tarefa controlada na pasta atual.",
  );
  assert.equal(written.exit.status, "done", written.exit.error);
  assert.equal(
    fs.readFileSync(path.join(written.cwd, "validation.txt"), "utf8"),
    "CODEX_OK",
  );
  assert.ok(written.events.some((e) => e.type === "stream_event"));
  assert.ok(
    written.events.some(
      (e) =>
        e.type === "assistant" &&
        e.message.content.some((b) => b.name === "Write"),
    ),
  );
  console.log(
    "REAL write/read + SSE:",
    health.codexVersion,
    model,
    written.exit.status,
  );
  const squad = await run(
    "Você é o comandante. Chame obrigatoriamente squad_call com subagent_type argus e peça para ler validation.txt com project_read e retornar REVIEW_OK se contiver CODEX_OK. Aguarde o colega e consolide a resposta incluindo REVIEW_OK.",
    {
      tools: ["Read", "Agent"],
      permissionMode: "read-only",
      agents: {
        argus: {
          description: "Revisor da squad",
          prompt:
            "Você é ARGUS, revisor. Use project_read para verificar o arquivo solicitado. Não modifique arquivos. Responda REVIEW_OK se correto.",
          tools: ["Read"],
          model,
          effort: "low",
        },
      },
      forwardSubagents: true,
    },
    "Você é o comandante da validação. Coordene o colega disponível usando a ferramenta dinâmica.",
  );
  assert.equal(squad.exit.status, "done", squad.exit.error);
  assert.match(squad.exit.result, /REVIEW_OK/);
  assert.ok(squad.events.some((e) => e.parent_tool_use_id));
  assert.ok(
    squad.events.some(
      (e) =>
        e.type === "assistant" &&
        e.message.content.some((b) => b.name === "Agent"),
    ),
  );
  console.log("REAL commander → reviewer → commander:", squad.exit.status);
  let cancelled = false;
  const cancelledRun = await run(
    "Execute somente um comando que aguarde 30 segundos, sem escrever arquivos. Use Start-Sleep -Seconds 30 no PowerShell ou sleep 30 no shell. Depois responda OK.",
    { tools: ["Bash"], permissionMode: "read-only" },
    "Você é um executor de teste de cancelamento. Execute apenas a espera solicitada.",
    async (e, id, api) => {
      if (
        !cancelled &&
        e.type === "assistant" &&
        e.message.content.some((b) => b.name === "Bash")
      ) {
        cancelled = true;
        await api("/api/runs/" + id + "/cancel", {});
      }
    },
  );
  assert.ok(cancelled, "A tarefa não abriu o comando de espera.");
  assert.equal(cancelledRun.exit.status, "cancelled");
  console.log("REAL cancellation:", cancelledRun.exit.status);
  const history = await api("/api/runs?projectId=validation");
  assert.equal(history.runs.length, 3);
  const summary = {
    at: new Date().toISOString(),
    version: health.codexVersion,
    model,
    platform: process.platform,
    write: written.exit.status,
    squad: squad.exit.status,
    cancel: cancelledRun.exit.status,
    history: history.runs.length,
    usage: [written.exit.usage, squad.exit.usage],
  };
  fs.mkdirSync(path.join(root, "previews"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "previews", "real-codex.json"),
    JSON.stringify(summary, null, 2) + "\n",
  );
  console.log(
    "REAL SQLite history: 3 runs. Evidence: previews/real-codex.json",
  );
} finally {
  if (proc.exitCode === null) {
    const exited = new Promise((r) => proc.once("exit", r));
    proc.kill();
    await exited;
  }
  fs.rmSync(tmp, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 200,
  });
}
