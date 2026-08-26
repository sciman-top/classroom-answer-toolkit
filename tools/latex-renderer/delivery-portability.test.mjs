import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { compileResolvedSnapshot } from "../rule-compiler/merge-rules.mjs";

const toolDir = path.dirname(fileURLToPath(import.meta.url));

// End-to-end portability regression (2026-08-27 closeout): run the real
// writer, relocate the whole delivery package, then validate from a foreign
// CWD. Hand-built relative fixtures cannot catch the writer silently writing
// absolute integrity.reviewFiles paths again — only this relocation does.
test("writer output survives package relocation and foreign-CWD validation", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "delivery-portability-"));
  const relocatedRoot = `${root}-moved`;
  try {
    const snapshotPath = path.join(root, "answer.snapshot.json");
    writeJson(snapshotPath, compileResolvedSnapshot({
      subjectPack: "junior-physics-answer",
      profileName: "classroom"
    }));
    fs.writeFileSync(path.join(root, "answer.md"), "# 参考答案\n", "utf8");
    fs.writeFileSync(path.join(root, "answer.pdf"), "pdf fixture", "utf8");

    const reviewDir = path.join(root, "answer.review");
    fs.mkdirSync(reviewDir, { recursive: true });
    writeJson(path.join(reviewDir, "manifest.json"), {
      version: "1",
      scale: "2",
      pages: [],
      ocrStatus: "not-requested"
    });
    fs.writeFileSync(path.join(reviewDir, "page-001.png"), "png fixture", "utf8");

    const manifestPath = path.join(root, "answer.delivery-manifest.json");
    const written = await runTool("write-delivery-manifest.mjs", [
      "--input", path.join(root, "answer.md"),
      "--output", path.join(root, "answer.pdf"),
      "--snapshot-path", snapshotPath,
      "--review-dir", reviewDir,
      "--review-manifest", path.join(reviewDir, "manifest.json"),
      "--review-scale", "2",
      "--out", manifestPath
    ]);
    assert.equal(written.status, 0, `writer stderr: ${written.stderr}`);

    // Relocate the package, then validate with a CWD outside both copies.
    fs.cpSync(root, relocatedRoot, { recursive: true });
    const foreignCwd = path.join(os.tmpdir(), "delivery-portability-cwd");
    fs.mkdirSync(foreignCwd, { recursive: true });
    const relocatedManifest = path.join(relocatedRoot, "answer.delivery-manifest.json");
    const validated = await runTool("validate-delivery-manifest.mjs", [
      "--manifest", relocatedManifest
    ], { cwd: foreignCwd });

    assert.equal(validated.status, 0,
      `validator stderr: ${validated.stderr}\nstdout: ${validated.stdout}`);
    assert.ok(validated.stdout.includes("Validated delivery manifest"));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(relocatedRoot, { recursive: true, force: true });
  }
});

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function runTool(scriptName, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [
      path.join(toolDir, scriptName), ...args
    ], {
      cwd: options.cwd ?? toolDir,
      env: { ...process.env, INIT_CWD: options.cwd ?? toolDir }
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`${scriptName} did not exit within 60 seconds.`));
    }, 60_000);
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.once("error", reject);
    child.once("close", (status) => {
      clearTimeout(timer);
      resolve({ status, stdout, stderr });
    });
  });
}
