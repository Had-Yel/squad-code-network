// Deterministic app-server JSON-RPC fixture; never contacts an AI provider.
import readline from "node:readline";
import { randomUUID } from "node:crypto";
const send = (x) => process.stdout.write(JSON.stringify(x) + "\n");
if (process.argv.includes("--version")) {
  console.log("codex-cli 0.157.1-test");
  process.exit(0);
}
const threads = new Map(),
  calls = new Map();
let sequence = 1000;
const notify = (method, params) => send({ method, params });
const complete = (id, prompt) => {
  const t = threads.get(id),
    tid = t.turn;
  if (prompt.includes("SLEEP")) return;
  if (prompt.includes("FAIL")) {
    notify("turn/completed", {
      threadId: id,
      turn: {
        id: tid,
        status: "failed",
        error: { message: "Controlled Codex failure" },
      },
    });
    return;
  }
  const text =
    "ECHO:" +
    prompt +
    "|SYS:" +
    t.developerInstructions.split("\n\nTrabalhe somente")[0];
  notify("item/agentMessage/delta", {
    threadId: id,
    turnId: tid,
    itemId: "msg-" + tid,
    delta: "working",
  });
  notify("item/completed", {
    threadId: id,
    turnId: tid,
    item: { type: "agentMessage", id: "msg-" + tid, text },
  });
  notify("thread/tokenUsage/updated", {
    threadId: id,
    tokenUsage: {
      total: { inputTokens: 100, outputTokens: 20, totalTokens: 120 },
    },
  });
  notify("turn/completed", {
    threadId: id,
    turn: { id: tid, status: "completed" },
  });
};
readline.createInterface({ input: process.stdin }).on("line", (line) => {
  const m = JSON.parse(line),
    p = m.params || {};
  if (!m.method) {
    const c = calls.get(m.id);
    if (c) {
      calls.delete(m.id);
      complete(c.id, "COLLEAGUE:" + m.result.contentItems[0].text);
    }
    return;
  }
  const ok = (result) => send({ id: m.id, result });
  switch (m.method) {
    case "initialize":
      ok({ userAgent: "fake-codex" });
      break;
    case "initialized":
      break;
    case "account/read":
      ok({ account: { type: "chatgpt" }, requiresOpenaiAuth: true });
      break;
    case "model/list":
      ok({
        data: [
          {
            id: "test-model",
            model: "test-model",
            displayName: "Test model",
            description: "Fixture",
            isDefault: true,
            supportedReasoningEfforts: [{ reasoningEffort: "low" }],
            defaultReasoningEffort: "low",
          },
        ],
        nextCursor: null,
      });
      break;
    case "thread/start": {
      const id = randomUUID();
      threads.set(id, p);
      ok({ thread: { id }, model: p.model || "test-model" });
      break;
    }
    case "turn/start": {
      const t = threads.get(p.threadId);
      t.turn = randomUUID();
      ok({ turn: { id: t.turn, status: "inProgress" } });
      notify("turn/started", { threadId: p.threadId, turn: { id: t.turn } });
      const prompt = p.input[0].text;
      // Expose only fixture settings so integration tests assert the protocol actually sent by the adapter.
      notify("item/completed", {
        threadId: p.threadId,
        item: {
          type: "agentMessage",
          id: "config",
          text:
            "CONFIG:" +
            JSON.stringify({
              cwd: t.cwd,
              sandbox: t.sandbox,
              permissions: t.permissions,
              config: t.config,
              tools: t.dynamicTools,
              developerInstructions: t.developerInstructions,
            }),
        },
      });
      if (prompt === "CALL_COLLEAGUE") {
        const cid = ++sequence;
        calls.set(cid, { id: p.threadId });
        send({
          id: cid,
          method: "item/tool/call",
          params: {
            threadId: p.threadId,
            turnId: t.turn,
            callId: "call-1",
            tool: "squad_call",
            arguments: { subagent_type: "argus", prompt: "review" },
          },
        });
      } else setTimeout(() => complete(p.threadId, prompt), 30);
      break;
    }
    case "turn/interrupt":
      ok({});
      notify("turn/completed", {
        threadId: p.threadId,
        turn: { id: p.turnId, status: "interrupted" },
      });
      break;
    default:
      send({
        id: m.id,
        error: { code: -32601, message: "Unknown fixture method " + m.method },
      });
  }
});
