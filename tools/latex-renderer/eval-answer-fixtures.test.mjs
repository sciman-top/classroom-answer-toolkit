import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const toolDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(toolDir, "..", "..");

test("eval reuses one snapshot per profile and avoids a browser for validator-only cases", () => {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "classroom-eval-runtime-"));

  try {
    const expectedPath = path.join(workDir, "expected.json");
    const datasetPath = path.join(workDir, "dataset.json");
    const inputPath = path.join(repoRoot, "eval", "math-answer", "cases", "linear-equation-smoke.md");

    fs.writeFileSync(expectedPath, `${JSON.stringify({
      profiles: {
        classroom: {
          shouldPass: true,
          maxWarnings: 0
        }
      }
    }, null, 2)}\n`, "utf8");
    fs.writeFileSync(datasetPath, `${JSON.stringify({
      suiteId: "eval-runtime-cache-test",
      resultsFile: "results.json",
      cases: [
        { id: "first", input: inputPath, expected: expectedPath },
        { id: "second", input: inputPath, expected: expectedPath }
      ]
    }, null, 2)}\n`, "utf8");

    const result = spawnSync(process.execPath, [
      path.join(toolDir, "eval-answer-fixtures.mjs"),
      "--subject-pack",
      "math-answer",
      "--dataset",
      datasetPath
    ], {
      cwd: repoRoot,
      encoding: "utf8"
    });

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(
      result.stdout,
      /\[eval\] runtime: profiles=2; snapshot-compiles=1; browser-server-launches=0; visual-pipelines=0; delivery-pipelines=0/u
    );
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
});
