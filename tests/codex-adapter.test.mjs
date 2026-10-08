import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import adapter from "../codex-adapter.js";
test("project_read contains paths, symlinks, secrets and oversized files", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "squad-read-"));
  try {
    fs.writeFileSync(path.join(root, "ok.txt"), "alpha\nbeta");
    fs.writeFileSync(path.join(root, ".env"), "secret");
    assert.equal(
      adapter.projectRead(root, { path: "ok.txt", query: "beta" }),
      "beta",
    );
    assert.throws(() => adapter.projectRead(root, { path: ".env" }), /escopo/);
    assert.throws(() => adapter.projectRead(root, { path: ".." }), /escopo/);
    fs.writeFileSync(
      path.join(root, "large.txt"),
      Buffer.alloc(1024 * 1024 + 1),
    );
    assert.throws(
      () => adapter.projectRead(root, { path: "large.txt" }),
      /1 MB/,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
test("read-only remains read-only even when an agent requests write tools", () => {
  const p = adapter.profileFor({
    cwd: process.cwd(),
    permissionMode: "read-only",
    tools: ["Bash", "Write"],
  });
  assert.equal(p.filesystem[":workspace_roots"]["."], "read");
  assert.equal(p.network.enabled, false);
});

test("project_write rejects secret paths and escapes, writes only project text", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "squad-write-"));
  try {
    assert.throws(
      () => adapter.projectWrite(root, { path: "../escape.txt", text: "x" }),
      /escopo/,
    );
    assert.throws(
      () => adapter.projectWrite(root, { path: ".env", text: "x" }),
      /escopo/,
    );
    assert.throws(
      () =>
        adapter.projectWrite(root, { path: ".codex/config.toml", text: "x" }),
      /escopo/,
    );
    adapter.projectWrite(root, { path: "src/check.txt", text: "OK" });
    assert.equal(
      fs.readFileSync(path.join(root, "src/check.txt"), "utf8"),
      "OK",
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
