import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const toolDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(toolDir, "..", "..");

function fail(message, code = 2) {
  console.error(message);
  process.exit(code);
}

function parseArgs(argv) {
  const options = {
    subjectPack: "physics-answer",
    dataset: null
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--subject-pack") {
      options.subjectPack = argv[++index];
      continue;
    }
    if (arg.startsWith("--subject-pack=")) {
      options.subjectPack = arg.slice("--subject-pack=".length);
      continue;
    }
    if (arg === "--dataset") {
      options.dataset = argv[++index];
      continue;
    }
    if (arg.startsWith("--dataset=")) {
      options.dataset = arg.slice("--dataset=".length);
      continue;
    }
  }

  return options;
}

function runValidator(relativeInputPath, profile, snapshotRelativePath, subjectPack) {
  const result = spawnSync(
    process.execPath,
    [
      path.join(toolDir, "validate-answer-markdown.mjs"),
      relativeInputPath,
      "--subject-pack",
      subjectPack,
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

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function loadSubjectPackManifest(subjectPack) {
  const manifestPath = path.join(repoRoot, "prompts", subjectPack, "manifest.json");
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Subject pack manifest not found: ${manifestPath}`);
  }

  return {
    manifest: readJson(manifestPath),
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

function main() {
  const options = parseArgs(process.argv.slice(2));
  const { manifest, manifestPath } = loadSubjectPackManifest(options.subjectPack);
  const evalWorkRoot = path.join(repoRoot, ".eval-work", `${options.subjectPack}-${process.pid}`);
  removePathWithRetry(evalWorkRoot);
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
        const workDir = makeCaseWorkDir(evalWorkRoot, options.subjectPack, caseEntry.id, profile);
        removePathWithRetry(workDir);
        fs.mkdirSync(workDir, { recursive: true });

        const snapshotFileName = options.subjectPack === "physics-answer"
          ? `resolved-snapshot.${profile}.json`
          : `resolved-snapshot.${options.subjectPack}.${profile}.json`;
        const snapshotRelativePath = path.join(".snapshot-cache", snapshotFileName);
        const snapshotCompile = spawnSync(
          process.execPath,
          [
            path.resolve(toolDir, "..", "rule-compiler", "compile-snapshot.mjs"),
            "--subject-pack",
            options.subjectPack,
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

        const compiledSnapshot = readJson(path.resolve(repoRoot, snapshotRelativePath));

        const expectation = expected.profiles[profile];
        const run = runValidator(
          path.relative(repoRoot, path.resolve(datasetDir, caseEntry.input)),
          profile,
          snapshotRelativePath,
          options.subjectPack
        );
        const passed = run.status === 0;
        const warningMatches = [...(run.stderr + run.stdout).matchAll(/Warnings \((\d+)\):/g)];
        const warningCount = warningMatches.length > 0 ? Number(warningMatches.at(-1)[1]) : 0;
        let visual = null;
        let visualOk = true;

        if (expectation.visualBaseline) {
          const pdfPath = path.join(workDir, `${caseEntry.id}.${profile}.pdf`);
          const reviewDir = path.join(workDir, "review");
          const renderRun = runNodeTool("render-md-latex.mjs", [
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
            status: visualRun.status,
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
          const deliverPdfPath = path.join(workDir, `${caseEntry.id}.${profile}.deliver.pdf`);
        const deliverRun = runNodeTool("deliver-answer.mjs", [
          path.relative(repoRoot, path.resolve(datasetDir, caseEntry.input)),
          path.relative(repoRoot, deliverPdfPath),
          "--profile",
          profile,
          "--subject-pack",
          options.subjectPack,
          "--snapshot-path",
          path.relative(repoRoot, path.resolve(repoRoot, snapshotRelativePath)),
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

            const deliveryManifest = readJson(deliveryManifestPath);
            const snapshotMatch = deliveryManifest.snapshotId === compiledSnapshot.snapshotId
              && deliveryManifest.snapshot?.id === compiledSnapshot.snapshotId
              && deliveryManifest.snapshot?.version === compiledSnapshot.subjectPack?.version
              && deliveryManifest.snapshot?.profile === profile;
            const expectedGraphics = expectation.delivery.expectedGraphics ?? [];
            const actualGraphics = (deliveryManifest.graphics?.items ?? [])
              .map((item) => item?.graphicId)
              .filter((graphicId) => typeof graphicId === "string");
            const graphicsMatch = sameStringSet(expectedGraphics, actualGraphics);
            const expectedStatus = expectation.delivery.expectedStatus ?? {
              toolchainPassed: true,
              deliveryComplete: true,
              reviewArtifactReady: Boolean(expectation.delivery.keepReview),
              visualReviewPassed: null,
              trusted: false
            };
            const actualStatus = deliveryManifest.status ?? {};
            const statusMatch =
              actualStatus.toolchainPassed === expectedStatus.toolchainPassed
              && actualStatus.deliveryComplete === expectedStatus.deliveryComplete
              && actualStatus.reviewArtifactReady === expectedStatus.reviewArtifactReady
              && actualStatus.visualReviewPassed === expectedStatus.visualReviewPassed
              && actualStatus.trusted === expectedStatus.trusted;
            const expectedOcr = expectation.delivery.expectedOcr ?? { status: "not-requested" };
            const actualOcr = deliveryManifest.ocr ?? {};
            const ocrMatch = Object.entries(expectedOcr)
              .every(([key, value]) => actualOcr[key] === value);

            deliveryOk = snapshotMatch && graphicsMatch && statusMatch && ocrMatch;
            delivery = {
              manifestPath: path.relative(repoRoot, deliveryManifestPath),
              pdfPath: path.relative(repoRoot, deliverPdfPath),
              snapshotId: deliveryManifest.snapshotId,
              snapshotMatch,
              expectedGraphics,
              actualGraphics,
              graphicsMatch,
              expectedStatus,
              actualStatus,
              statusMatch,
              expectedOcr,
              actualOcr,
              ocrMatch,
              keepReview: Boolean(expectation.delivery.keepReview)
            };
          } else {
            delivery = {
              manifestPath: path.relative(repoRoot, deliveryManifestPath),
              pdfPath: path.relative(repoRoot, deliverPdfPath),
              snapshotId: null,
              snapshotMatch: false,
              expectedGraphics: expectation.delivery.expectedGraphics ?? [],
              actualGraphics: [],
              graphicsMatch: false,
              expectedStatus: expectation.delivery.expectedStatus ?? null,
              actualStatus: null,
              statusMatch: false,
              expectedOcr: expectation.delivery.expectedOcr ?? null,
              actualOcr: null,
              ocrMatch: false,
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
      console.log(`[eval] ${caseResult.id}: ${caseResult.ok ? "passed" : "failed"}`);
    }

    const output = {
      suiteId: dataset.suiteId ?? options.subjectPack,
      subjectPack: options.subjectPack,
      assetVersion: dataset.assetVersion ?? manifest.version ?? "unknown",
      generatedAt: new Date().toISOString(),
      ok,
      cases: caseResults
    };

    fs.writeFileSync(resultsPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
    console.log(`[eval] results: ${path.relative(repoRoot, resultsPath)}`);

    if (!ok) {
      process.exitCode = 1;
    }
  } finally {
    removePathWithRetry(evalWorkRoot);
  }
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.stack : error);
  process.exit(2);
}
