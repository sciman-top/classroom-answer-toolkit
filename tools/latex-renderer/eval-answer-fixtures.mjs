import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { getDefaultSubjectPackName, normalizeSubjectPackName } from "../rule-compiler/shared.mjs";
import { resolveProfileSnapshotRelativePath } from "../rule-compiler/subject-pack-registry.mjs";
import { fail, parseArgvFlags, readJsonFile, repositoryRoot as repoRoot } from "../shared.mjs";
import { writeTextFileAtomic } from "../atomic-write.mjs";
import { resolveLocalBrowserPath } from "./lib/browser-candidates.mjs";

const toolDir = path.dirname(fileURLToPath(import.meta.url));
// Generous per-tool ceiling: visual pipelines run a full browser render, but a
// wedged tool must not stall the eval suite indefinitely.
const TOOL_TIMEOUT_MS = 5 * 60_000;
let sharedBrowserWsEndpoint = null;

function parseArgs(argv) {
  return parseArgvFlags(argv, {
    stringFlags: { "subject-pack": true, dataset: true },
    defaults: { subjectPack: getDefaultSubjectPackName(), dataset: null }
  });
}

function runValidator(relativeInputPath, profile, snapshotRelativePath, subjectPack) {
  return runNodeTool("validate-answer-markdown.mjs", [
    relativeInputPath,
    "--subject-pack",
    subjectPack,
    "--profile",
    profile,
    "--snapshot",
    snapshotRelativePath
  ]);
}

function runNodeTool(scriptFileName, args, options = {}) {
  const scriptPath = path.isAbsolute(scriptFileName)
    ? scriptFileName
    : path.join(toolDir, scriptFileName);

  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath, ...args], {
      cwd: options.cwd ?? toolDir,
      windowsHide: true,
      env: {
        ...process.env,
        INIT_CWD: repoRoot,
        ...(sharedBrowserWsEndpoint
          ? { CLASSROOM_TOOLKIT_BROWSER_WS_ENDPOINT: sharedBrowserWsEndpoint }
          : {}),
        ...(options.env ?? {})
      }
    });
    let stdout = "";
    let stderr = "";

    // A hung render/review must not stall the whole eval suite forever.
    const timer = setTimeout(() => {
      child.removeAllListeners("close");
      child.kill();
      reject(new Error(`Tool ${scriptFileName} exceeded the ${TOOL_TIMEOUT_MS / 1000}s eval timeout and was killed.`));
    }, options.timeoutMs ?? TOOL_TIMEOUT_MS);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", (status) => {
      clearTimeout(timer);
      resolve({
        status: status ?? 2,
        stdout,
        stderr
      });
    });
  });
}

function sameStringSet(expectedValues, actualValues) {
  if (expectedValues.length !== actualValues.length) {
    return false;
  }

  const expected = [...expectedValues].sort();
  const actual = [...actualValues].sort();
  return expected.every((value, index) => value === actual[index]);
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

function deliverySnapshotMatches(compiledSnapshot, deliverySnapshot, snapshotMode) {
  if (!deliverySnapshot) {
    return false;
  }

  if (snapshotMode === "compiled") {
    return JSON.stringify(deliverySnapshot) === JSON.stringify(compiledSnapshot);
  }

  const { generatedAt: _compiledAt, ...compiledStable } = compiledSnapshot;
  const { generatedAt: _deliveryAt, ...deliveryStable } = deliverySnapshot;
  return JSON.stringify(deliveryStable) === JSON.stringify(compiledStable);
}

function loadSubjectPackManifest(subjectPack) {
  const manifestPath = path.join(repoRoot, "prompts", subjectPack, "manifest.json");
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Subject pack manifest not found: ${manifestPath}`);
  }

  return {
    manifest: readJsonFile(manifestPath),
    manifestPath
  };
}

function resolveManifestRelativePath(manifestPath, relativePath) {
  return path.resolve(path.dirname(manifestPath), relativePath);
}

function removePathWithRetry(targetPath, attempts = 5) {
  let lastError = null;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      fs.rmSync(targetPath, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 100
      });
      return;
    } catch (error) {
      lastError = error;
      if (!error || !["ENOTEMPTY", "EBUSY", "EPERM"].includes(error.code) || attempt === attempts - 1) {
        break;
      }
    }
  }

  if (lastError) {
    throw lastError;
  }
}

function makeCaseWorkDir(evalWorkRoot, subjectPack, caseId, profile) {
  return path.join(evalWorkRoot, subjectPack, caseId, profile);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  options.subjectPack = normalizeSubjectPackName(options.subjectPack, getDefaultSubjectPackName());
  const { manifest, manifestPath } = loadSubjectPackManifest(options.subjectPack);
  const evalWorkRoot = path.join(repoRoot, ".eval-work", `${options.subjectPack}-${process.pid}`);
  const compiledSnapshots = new Map();
  let profileExecutions = 0;
  let snapshotCompileCount = 0;
  let browserServerLaunchCount = 0;
  let visualPipelineCount = 0;
  let deliveryPipelineCount = 0;
  let browserServer = null;
  removePathWithRetry(evalWorkRoot);
  let runSucceeded = false;
  try {
    const datasetPath = options.dataset
      ? path.resolve(repoRoot, options.dataset)
      : typeof manifest.evaluation?.dataset === "string"
      ? resolveManifestRelativePath(manifestPath, manifest.evaluation.dataset)
      : path.resolve(repoRoot, "eval", options.subjectPack, "dataset.json");
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
        profileExecutions += 1;
        const workDir = makeCaseWorkDir(evalWorkRoot, options.subjectPack, caseEntry.id, profile);
        removePathWithRetry(workDir);
        fs.mkdirSync(workDir, { recursive: true });

        let snapshotEntry = compiledSnapshots.get(profile);
        if (!snapshotEntry) {
          // Gates, bootstrap, and eval must land on the same snapshot file the
          // delivery consumes (subject-pack-registry is the single source for
          // that name); a locally invented pattern drifts onto duplicate files.
          const snapshotRelativePath = resolveProfileSnapshotRelativePath(options.subjectPack, profile, repoRoot);
          const snapshotCompile = await runNodeTool(
            path.resolve(toolDir, "..", "rule-compiler", "compile-snapshot.mjs"),
            [
              "--subject-pack",
              options.subjectPack,
              "--profile",
              profile,
              "--out",
              snapshotRelativePath
            ],
            { cwd: repoRoot }
          );

          if (snapshotCompile.status !== 0) {
            throw new Error(snapshotCompile.stderr || snapshotCompile.stdout || `Snapshot compile failed for profile ${profile}.`);
          }

          const compiledSnapshotPath = path.resolve(repoRoot, snapshotRelativePath);
          snapshotEntry = {
            snapshotRelativePath,
            compiledSnapshotPath,
            compiledSnapshot: readJsonFile(compiledSnapshotPath)
          };
          compiledSnapshots.set(profile, snapshotEntry);
          snapshotCompileCount += 1;
        }

        const { snapshotRelativePath, compiledSnapshotPath, compiledSnapshot } = snapshotEntry;
        const snapshotTrace = {
          snapshotId: compiledSnapshot.snapshotId,
          snapshotPath: snapshotRelativePath,
          subjectPack: compiledSnapshot.subjectPack?.assetId ?? null,
          version: compiledSnapshot.subjectPack?.version ?? null,
          profile: compiledSnapshot.activeProfile?.name ?? null
        };

        const expectation = expected.profiles[profile];
        const run = await runValidator(
          path.relative(repoRoot, path.resolve(datasetDir, caseEntry.input)),
          profile,
          snapshotRelativePath,
          options.subjectPack
        );
        // Only exit 1 with the validator's "Errors (n):" report counts as a content
        // rejection; usage errors (exit 2), crashes, or killed processes are
        // infrastructure failures that must not masquerade as expected rejections.
        const rejectedWithFindings = run.status === 1 && /Errors \(\d+\):/.test(run.stderr);
        if (!expectation.shouldPass && !rejectedWithFindings) {
          throw new Error(
            `Validator did not reject case ${caseEntry.id}/${profile} for document reasons `
            + `(status ${run.status}); treat this as an infrastructure failure.\n`
            + `stderr: ${run.stderr}\nstdout: ${run.stdout}`
          );
        }
        const passed = run.status === 0;
        if (!passed && !rejectedWithFindings) {
          throw new Error(
            `Validator exited with status ${run.status} for passing case ${caseEntry.id}/${profile}; `
            + "treat this as an infrastructure failure.\n"
            + `stderr: ${run.stderr}\nstdout: ${run.stdout}`
          );
        }
        const warningMatches = [...(run.stderr + run.stdout).matchAll(/Warnings \((\d+)\):/g)];
        const warningCount = warningMatches.length > 0 ? Number(warningMatches.at(-1)[1]) : 0;
        let visual = null;
        let visualOk = true;

        if ((expectation.visualBaseline || expectation.delivery) && !browserServer) {
          const browserPath = resolveLocalBrowserPath();
          if (!browserPath) {
            throw new Error("No local Chromium, Chrome, or Edge executable found for answer eval.");
          }
          browserServer = await chromium.launchServer({
            executablePath: browserPath,
            headless: true
          });
          sharedBrowserWsEndpoint = browserServer.wsEndpoint();
          browserServerLaunchCount += 1;
        }

        if (expectation.visualBaseline) {
          visualPipelineCount += 1;
          const pdfPath = path.join(workDir, `${caseEntry.id}.${profile}.pdf`);
          const reviewDir = path.join(workDir, "review");
          const renderRun = await runNodeTool("render-md-latex.mjs", [
            path.relative(repoRoot, path.resolve(datasetDir, caseEntry.input)),
            path.relative(repoRoot, pdfPath),
            "--profile",
            profile,
            "--subject-pack",
            options.subjectPack,
            "--snapshot",
            snapshotRelativePath
          ]);

          if (renderRun.status !== 0) {
            throw new Error(renderRun.stderr || renderRun.stdout || `Render failed for case ${caseEntry.id}/${profile}.`);
          }

          const reviewRun = await runNodeTool("review-source-pdf.mjs", [
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
          const visualRun = await runNodeTool("visual-regression.mjs", [
            path.relative(repoRoot, actualImagePath),
            path.relative(repoRoot, baselineImagePath)
          ]);

          visualOk = visualRun.status === 0;
          // Record the measured margin even on success: without it a run that
          // passes at 0.49% of a 0.5% budget looks identical to one at 0.00%,
          // so cross-environment drift is invisible until it suddenly fails.
          const diffRatioMatch = /Diff ratio:\s*([0-9.]+)/u.exec(visualRun.stdout ?? "");
          visual = {
            baseline: expectation.visualBaseline,
            actualImage: path.relative(repoRoot, actualImagePath),
            passed: visualOk,
            status: visualRun.status,
            diffRatio: diffRatioMatch ? Number(diffRatioMatch[1]) : null,
            stdout: visualRun.stdout || undefined,
            stderr: visualRun.stderr || undefined
          };

          if (!visualOk) {
            console.warn(`[eval] ${caseEntry.id}/${profile} visual compare failed`);
            if (visualRun.stdout) {
              console.warn(visualRun.stdout.trimEnd());
            }
            if (visualRun.stderr) {
              console.warn(visualRun.stderr.trimEnd());
            }
          }
        }

        let delivery = null;
        let deliveryOk = true;

        if (expectation.delivery) {
          deliveryPipelineCount += 1;
          const deliverPdfPath = path.join(workDir, `${caseEntry.id}.${profile}.deliver.pdf`);
          const snapshotMode = expectation.delivery.snapshotMode === "default" ? "default" : "compiled";
          const snapshotArgs = snapshotMode === "default"
            ? []
            : [
                "--snapshot-path",
                path.relative(repoRoot, path.resolve(repoRoot, snapshotRelativePath)),
                "--skip-validate"
              ];
          const deliverRun = await runNodeTool("deliver-answer.mjs", [
            path.relative(repoRoot, path.resolve(datasetDir, caseEntry.input)),
            path.relative(repoRoot, deliverPdfPath),
            "--profile",
            profile,
            "--subject-pack",
            options.subjectPack,
            ...snapshotArgs,
            ...(expectation.delivery.keepReview ? ["--keep-review"] : [])
          ]);

          deliveryOk = deliverRun.status === 0;
          const deliveryManifestPath = path.resolve(
            workDir,
            `${caseEntry.id}.${profile}.deliver.delivery-manifest.json`
          );

          if (deliveryOk) {
            if (!fs.existsSync(deliveryManifestPath)) {
              throw new Error(`Delivery manifest not found: ${deliveryManifestPath}`);
            }

            const deliveryManifest = readJsonFile(deliveryManifestPath);
            // Manifest paths may be relative to the manifest itself (2026-08-27
            // portability contract); resolve against the manifest directory.
            const deliverySnapshotPath = typeof deliveryManifest.snapshotPath === "string"
              ? path.resolve(path.dirname(deliveryManifestPath), deliveryManifest.snapshotPath)
              : null;
            const expectedDeliverySnapshotPath = path.resolve(
              path.dirname(deliverPdfPath),
              `${path.basename(deliverPdfPath, path.extname(deliverPdfPath))}.snapshot.json`
            );
            const expectedDeliveryReviewDir = path.resolve(
              path.dirname(deliverPdfPath),
              `${path.basename(deliverPdfPath, path.extname(deliverPdfPath))}.review`
            );
            const deliveryReviewDir = typeof deliveryManifest.review?.outputDir === "string"
              ? path.resolve(path.dirname(deliveryManifestPath), deliveryManifest.review.outputDir)
              : null;
            const deliveryReviewManifestPath = typeof deliveryManifest.review?.manifestPath === "string"
              ? path.resolve(path.dirname(deliveryManifestPath), deliveryManifest.review.manifestPath)
              : null;
            const reviewPackageMatch = deliveryReviewDir === expectedDeliveryReviewDir
              && deliveryReviewManifestPath === path.join(expectedDeliveryReviewDir, "manifest.json")
              && fs.existsSync(expectedDeliveryReviewDir)
              && fs.existsSync(deliveryReviewManifestPath)
              && Array.isArray(deliveryManifest.integrity?.reviewFiles)
              && deliveryManifest.integrity.reviewFiles.length > 0;
            const deliverySnapshot = deliverySnapshotPath && fs.existsSync(deliverySnapshotPath)
              ? readJsonFile(deliverySnapshotPath)
              : null;
            const snapshotMatch = deliveryManifest.snapshotId === compiledSnapshot.snapshotId
              && deliveryManifest.snapshot?.id === compiledSnapshot.snapshotId
              && deliveryManifest.snapshot?.version === compiledSnapshot.subjectPack?.version
              && deliveryManifest.snapshot?.profile === profile
              && deliverySnapshotPath === expectedDeliverySnapshotPath
              && deliverySnapshotMatches(compiledSnapshot, deliverySnapshot, snapshotMode);
            const expectedGraphics = expectation.delivery.expectedGraphics ?? [];
            const actualGraphics = (deliveryManifest.graphics?.items ?? [])
              .map((item) => item?.graphicId)
              .filter((graphicId) => typeof graphicId === "string");
            const graphicsMatch = sameStringSet(expectedGraphics, actualGraphics);
            const expectedStatus = expectation.delivery.expectedStatus ?? {
              toolchainPassed: true,
              deliveryComplete: true,
              reviewArtifactReady: true
            };
            const actualStatus = deliveryManifest.status ?? {};
            const statusMatch =
              actualStatus.toolchainPassed === expectedStatus.toolchainPassed
              && actualStatus.deliveryComplete === expectedStatus.deliveryComplete
              && actualStatus.reviewArtifactReady === expectedStatus.reviewArtifactReady;
            const expectedOcr = expectation.delivery.expectedOcr ?? { status: "not-requested" };
            const actualOcr = deliveryManifest.ocr ?? {};
            const ocrMatch = Object.entries(expectedOcr)
              .every(([key, value]) => actualOcr[key] === value);

            deliveryOk = snapshotMatch && reviewPackageMatch && graphicsMatch && statusMatch && ocrMatch;
            delivery = {
              manifestPath: path.relative(repoRoot, deliveryManifestPath),
              pdfPath: path.relative(repoRoot, deliverPdfPath),
              snapshotId: deliveryManifest.snapshotId,
              snapshotPath: deliveryManifest.snapshotPath,
              snapshotMatch,
              expectedSnapshotPath: path.relative(repoRoot, expectedDeliverySnapshotPath),
              reviewPackageMatch,
              expectedReviewDir: path.relative(repoRoot, expectedDeliveryReviewDir),
              expectedGraphics,
              actualGraphics,
              graphicsMatch,
              expectedStatus,
              actualStatus,
              statusMatch,
              expectedOcr,
              actualOcr,
              ocrMatch,
              snapshotMode,
              keepReview: Boolean(expectation.delivery.keepReview)
            };
          } else {
            delivery = {
              manifestPath: path.relative(repoRoot, deliveryManifestPath),
              pdfPath: path.relative(repoRoot, deliverPdfPath),
              snapshotId: null,
              snapshotPath: null,
              snapshotMatch: false,
              expectedSnapshotPath: path.relative(
                repoRoot,
                path.resolve(
                  path.dirname(deliverPdfPath),
                  `${path.basename(deliverPdfPath, path.extname(deliverPdfPath))}.snapshot.json`
                )
              ),
              expectedGraphics: expectation.delivery.expectedGraphics ?? [],
              actualGraphics: [],
              graphicsMatch: false,
              expectedStatus: expectation.delivery.expectedStatus ?? null,
              actualStatus: null,
              statusMatch: false,
              expectedOcr: expectation.delivery.expectedOcr ?? null,
              actualOcr: null,
              ocrMatch: false,
              snapshotMode,
              keepReview: Boolean(expectation.delivery.keepReview)
            };
          }
        }

        const profileOk =
          passed === Boolean(expectation.shouldPass)
          && warningCount <= (expectation.maxWarnings ?? Number.POSITIVE_INFINITY)
          && visualOk
          && deliveryOk;

        caseResult.profiles[profile] = {
          expected: expectation,
          actual: {
            snapshot: snapshotTrace,
            passed,
            warningCount,
            status: run.status,
            visual,
            delivery
          },
          ok: profileOk
        };

        if (!profileOk) {
          caseResult.ok = false;
          ok = false;
        }
      }

      caseResults.push(caseResult);
      const visualMargins = Object.values(caseResult.profiles ?? {})
        .map((entry) => entry?.actual?.visual)
        .filter((entry) => entry && typeof entry.diffRatio === "number");
      const visualSummary = visualMargins.length > 0
        ? ` (visual diff max ${Math.max(...visualMargins.map((entry) => entry.diffRatio)).toFixed(4)})`
        : "";
      console.log(`[eval] ${caseResult.id}: ${caseResult.ok ? "passed" : "failed"}${visualSummary}`);
    }

    const output = {
      suiteId: dataset.suiteId ?? options.subjectPack,
      subjectPack: options.subjectPack,
      assetVersion: dataset.assetVersion ?? manifest.version ?? "unknown",
      generatedAt: new Date().toISOString(),
      ok,
      // Every case records `actualImage` relative to the repo root. Keep the
      // work root visible so a failure can be reproduced and diffed instead of
      // pointing at files that were already deleted.
      workRoot: path.relative(repoRoot, evalWorkRoot),
      cases: caseResults
    };

    // workspace-health parses this file; a crash mid-write must not leave a
    // torn JSON that reads as a failed regression until the next eval run.
    writeTextFileAtomic(resultsPath, `${JSON.stringify(output, null, 2)}\n`);
    console.log(`[eval] results: ${path.relative(repoRoot, resultsPath)}`);
    console.log(
      `[eval] runtime: profiles=${profileExecutions}; snapshot-compiles=${snapshotCompileCount}; browser-server-launches=${browserServerLaunchCount}; visual-pipelines=${visualPipelineCount}; delivery-pipelines=${deliveryPipelineCount}`
    );

    runSucceeded = ok;
    if (!ok) {
      process.exitCode = 1;
    }
  } finally {
    if (browserServer) {
      await browserServer.close();
      sharedBrowserWsEndpoint = null;
    }
    // A failed run must keep its rendered pages: they are the only evidence for
    // why a visual comparison failed, and deleting them turned every such
    // failure into an unactionable "Diff ratio exceeded" line.
    if (runSucceeded) {
      removePathWithRetry(evalWorkRoot);
    } else {
      console.log(`[eval] failing run kept its work directory for diagnosis: ${path.relative(repoRoot, evalWorkRoot)}`);
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exit(2);
});
