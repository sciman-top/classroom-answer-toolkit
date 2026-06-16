import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { loadRuntimeConfig, resolveRuntimeConfigRelativePath } from "./runtime-config.mjs";

const toolDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(toolDir, "..", "..");

function fail(message, code = 2) {
  console.error(message);
  process.exit(code);
}

function runValidator(relativeInputPath, profile) {
  const result = spawnSync(
    process.execPath,
    [path.join(toolDir, "validate-answer-markdown.mjs"), relativeInputPath, "--profile", profile],
    {
      cwd: toolDir,
      encoding: "utf8",
      env: {
        ...process.env,
        INIT_CWD: repoRoot
      }
    }
  );

  if (result.error) {
    throw result.error;
  }

  return {
    status: result.status ?? 2,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? ""
  };
}

function main() {
  const runtimeConfig = loadRuntimeConfig();
  const datasetPath = runtimeConfig.evaluation?.dataset
    ? resolveRuntimeConfigRelativePath(runtimeConfig.evaluation.dataset)
    : path.resolve(repoRoot, "eval", "physics-answer", "dataset.json");
  if (!fs.existsSync(datasetPath)) {
    fail(`Eval dataset not found: ${datasetPath}`);
  }

  const dataset = JSON.parse(fs.readFileSync(datasetPath, "utf8"));
  const datasetDir = path.dirname(datasetPath);
  const resultsPath = path.resolve(datasetDir, dataset.resultsFile ?? "results/latest.json");
  fs.mkdirSync(path.dirname(resultsPath), { recursive: true });

  const caseResults = [];
  let ok = true;

  for (const caseEntry of dataset.cases ?? []) {
    const expectedPath = path.resolve(datasetDir, caseEntry.expected);
    if (!fs.existsSync(expectedPath)) {
      fail(`Eval expectation not found: ${expectedPath}`);
    }

    const expected = JSON.parse(fs.readFileSync(expectedPath, "utf8"));
    const profiles = Object.keys(expected.profiles ?? {});
    const caseResult = {
      id: caseEntry.id,
      input: caseEntry.input,
      expected: caseEntry.expected,
      tags: caseEntry.tags ?? [],
      profiles: {},
      ok: true
    };

    for (const profile of profiles) {
      const expectation = expected.profiles[profile];
      const run = runValidator(path.relative(repoRoot, path.resolve(datasetDir, caseEntry.input)), profile);
      const passed = run.status === 0;
      const warningMatches = [...(run.stderr + run.stdout).matchAll(/Warnings \((\d+)\):/g)];
      const warningCount = warningMatches.length > 0 ? Number(warningMatches.at(-1)[1]) : 0;
      const profileOk = passed === Boolean(expectation.shouldPass) && warningCount <= (expectation.maxWarnings ?? Number.POSITIVE_INFINITY);

      caseResult.profiles[profile] = {
        expected: expectation,
        actual: {
          passed,
          warningCount,
          status: run.status
        },
        ok: profileOk
      };

      if (!profileOk) {
        caseResult.ok = false;
        ok = false;
      }
    }

    caseResults.push(caseResult);
    console.log(`[eval] ${caseResult.id}: ${caseResult.ok ? "passed" : "failed"}`);
  }

  const output = {
    suiteId: dataset.suiteId ?? "physics-answer",
    assetVersion: dataset.assetVersion ?? runtimeConfig.version ?? "unknown",
    generatedAt: new Date().toISOString(),
    ok,
    cases: caseResults
  };

  fs.writeFileSync(resultsPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  console.log(`[eval] results: ${path.relative(repoRoot, resultsPath)}`);

  if (!ok) {
    process.exit(1);
  }
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.stack : error);
  process.exit(2);
}
