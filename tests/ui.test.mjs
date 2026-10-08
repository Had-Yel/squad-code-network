import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test(
  "browser: Codex settings, export, SSE and console",
  { timeout: 120000 },
  async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "squad-browser-")),
      port = 4800 + Math.floor(Math.random() * 500);
    const proc = spawn(
      process.execPath,
      [path.join(root, "server.js"), "--port", String(port)],
      {
        cwd: root,
        env: {
          ...process.env,
          SQUAD_PRINT_TOKEN: "1",
          SQUAD_HOME: tmp, CODEX_HOME: path.join(tmp,"codex"),
          SQUAD_DATA_DIR: path.join(tmp, "data"),
          SQUAD_PROJECTS_DIR: path.join(tmp, "projects"),
          SQUAD_CODEX_BIN: path.join(root, "tests", "fake-codex.mjs"),
        },
        windowsHide: true,
      },
    );
    let browser;
    try {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(
          () => reject(Error("Bridge startup timeout")),
          10000,
        );
        proc.stdout.on("data", (d) => {
          if (String(d).includes("TOKEN=")) {
            clearTimeout(timer);
            resolve();
          }
        });
        proc.on("error", reject);
        proc.on("exit", (c) => {
          if (c) reject(Error("Bridge exited " + c));
        });
      });
      browser = await chromium.launch({
        headless: true,
        args: ["--disable-gpu", "--disable-software-rasterizer"],
        ...(process.env.CHROMIUM_EXECUTABLE
          ? { executablePath: process.env.CHROMIUM_EXECUTABLE }
          : {}),
      });
      const page = await browser.newPage({
          viewport: { width: 1400, height: 900 }, reducedMotion: "reduce",
        }),
        errors = [];
      page.on("pageerror", (e) => (errors.push(e.message), console.error("Browser error:", e.message)));
      await page.goto("http://127.0.0.1:" + port);
      await page.locator('[data-action="db-setup-demo"]').click();
      await page.waitForFunction(
        () =>
          window.SquadCode && document.querySelector("#dbSetupForm") === null,
      );
      await page.waitForFunction(() => SquadCode.bridge().online);
      const snapshot = () => page.evaluate(() => SquadCode.getSnapshot());
      assert.ok((await snapshot()).agents.length >= 6);
      await page.locator("#modeIndicator").click();
      assert.equal(await page.locator("#rtMode").inputValue(), "codex");
      assert.deepEqual(
        await page
          .locator("#rtPerm option")
          .evaluateAll((x) => x.map((i) => i.value)),
        ["workspace-write", "read-only"],
      );
      assert.ok(
        await page.locator('#rtModels option[value="test-model"]').count(),
      );
      await page
        .locator('[data-action="settings-tab"][data-tab="settingsjson"]')
        .click();
      await page.locator("#sjText").fill("model = [");
      await page.locator('[data-action="settings-validate"]').click();
      await page.waitForFunction(() =>
        document
          .querySelector("#sjStatus")
          ?.textContent.includes("TOML inválido"),
      );
      await page.keyboard.press("Escape");
      const exported = await page.evaluate(() =>
        projectExportFiles(project()).map((f) => ({
          name: f.name,
          data: f.data,
        })),
      );
      assert.ok(exported.some((f) => f.name === "AGENTS.md"));
      assert.ok(exported.some((f) => f.name === ".codex/config.toml"));
      assert.ok(exported.some((f) => f.name.startsWith("docs/agents/")));
      assert.ok(!exported.some((f) => f.name.startsWith(".claude/")));
      const lines = await page.evaluate(async () => {
        state.settings.runtime.mode = "codex";
        const r = await bridgeFetch("/api/runs", {
          method: "POST",
          body: JSON.stringify({
            prompt: "browser integration",
            options: {
              project: project().folder,
              tools: [],
              partial: true,
              permissionMode: "read-only",
            },
          }),
        });
        const c = newConsole({ runId: r.runId });
        await streamRun(r.runId, (e) => handleRunEvent(c, e));
        openConsole();
        return c.lines.map((l) => l.text);
      });
      assert.ok(lines.some((x) => x.includes("browser integration")));
      assert.ok(lines.some((x) => x.includes("CONCLUÍDO")));
      fs.mkdirSync(path.join(root, "previews"), { recursive: true });
      await page.screenshot({
        path: path.join(root, "previews", "ui-codex.png"),
      });
      assert.deepEqual(errors, []);
      console.log(
        "UI: Codex setup, model catalog, TOML validation, export, SSE and console passed.",
      );
    } finally {
      await browser?.close();
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
  },
);
