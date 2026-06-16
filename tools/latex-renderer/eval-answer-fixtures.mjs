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

function runValidator(relativeInputPath, profile, snapshotRelativePath) {
  const result = spawnSync(
    process.execPath,
    [
      path.join(toolDir, "validate-answer-markdown.mjs"),
      relativeInputPath,
      "--profile",
      profile,
      "--snapshot",
      snapshotRelativePath
    ],
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

function runNodeTool(scriptFileName, args, options = {}) {
  const result = spawnSync(
    process.execPath,
    [path.join(toolDir, scriptFileName), ...args],
    {
      cwd: options.cwd ?? toolDir,
      encoding: "utf8",
      env: {
        ...process.env,
        INIT_CWD: repoRoot,
        ...(options.env ?? {})
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

function firstPageImagePath(reviewDir) {
  const candidates = fs
    .readdirSync(reviewDir)
    .filter((name) => name.endsWith(".page-001.png"))
    .sort();

  if (candidates.length === 0) {
    throw new Error(`No first-page review image found in ${reviewDir}`);
  }

  return path.join(reviewDir, candidates[0]);
}

function makeCaseWorkDir(caseId, profile) {
  return path.join(repoRoot, ".smoke-work", "eval", caseId, profile);
}

function main() {
  const runtimeConfig = loadRuntimeConfig();
  const evalWorkRoot = path.join(repoRoot, ".smoke-work", "eval");
  fs.rmSync(evalWorkRoot, { recursive: true, force: true });
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
      const snapshotRelativePath = path.join(".snapshot-cache", `resolved-snapshot.${profile}.json`);
      const snapshotCompile = spawnSync(
        process.execPath,
        [
          path.resolve(toolDir, "..", "rule-compiler", "compile-snapshot.mjs"),
          "--profile",
          profile,
          "--out",
          snapshotRelativePath
        ],
        {
          cwd: repoRoot,
          encoding: "utf8",
          env: {
            ...process.env,
            INIT_CWD: repoRoot
          }
        }
      );

      if (snapshotCompile.error) {
        throw snapshotCompile.error;
      }

      if ((snapshotCompile.status ?? 0) !== 0) {
        throw new Error(snapshotCompile.stderr || snapshotCompile.stdout || `Snapshot compile failed for profile ${profile}.`);
      }

      const expectation = expected.profiles[profile];
      const run = runValidator(path.relative(repoRoot, path.resolve(datasetDir, caseEntry.input)), profile, snapshotRelativePath);
      const passed = run.status === 0;
      const warningMatches = [...(run.stderr + run.stdout).matchAll(/Warnings \((\d+)\):/g)];
      const warningCount = warningMatches.length > 0 ? Number(warningMatches.at(-1)[1]) : 0;
      let visual = null;
      let visualOk = true;

      if (expectation.visualBaseline) {
        const workDir = makeCaseWorkDir(caseEntry.id, profile);
        fs.rmSync(workDir, { recursive: true, force: true });
        fs.mkdirSync(workDir, { recursive: true });

        const pdfPath = path.join(workDir, `${caseEntry.id}.${profile}.pdf`);
        const reviewDir = path.join(workDir, "review");
        const renderRun = runNodeTool("render-md-latex.mjs", [
          path.relative(repoRoot, path.resolve(datasetDir, caseEntry.input)),
          path.relative(repoRoot, pdfPath),
          "--profile",
          profile,
          "--snapshot",
          snapshotRelativePath
        ]);

        if (renderRun.status !== 0) {
          throw new Error(renderRun.stderr || renderRun.stdout || `Render failed for case ${caseEntry.id}/${profile}.`);
        }

        const reviewRun = runNodeTool("review-source-pdf.mjs", [
          path.relative(repoRoot, pdfPath),
          "--out",
          path.relative(repoRoot, reviewDir),
          "--scale",
          "2"
        ]);

        if (reviewRun.status !== 0) {
          throw new Error(reviewRun.stderr || reviewRun.stdout || `Review render failed for case ${caseEntry.id}/${profile}.`);
        }

        const actualImagePath = firstPageImagePath(reviewDir);
        const baselineImagePath = path.resolve(datasetDir, expectation.visualBaseline);
        const visualRun = runNodeTool("visual-regression.mjs", [
          path.relative(repoRoot, actualImagePath),
          path.relative(repoRoot, baselineImagePath)
        ]);

        visualOk = visualRun.status === 0;
        visual = {
          baseline: expectation.visualBaseline,
          actualImage: path.relative(repoRoot, actualImagePath),
          passed: visualOk,
          status: visualRun.status
        };
      }

      const profileOk =
        passed === Boolean(expectation.shouldPass)
        && warningCount <= (expectation.maxWarnings ?? Number.POSITIVE_INFINITY)
        && visualOk;

      caseResult.profiles[profile] = {
        expected: expectation,
        actual: {
          passed,
          warningCount,
          status: run.status,
          visual
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
