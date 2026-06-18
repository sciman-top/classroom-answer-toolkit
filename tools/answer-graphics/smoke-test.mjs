import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { resolveAnswerGraphicsRoot } from "./workspace-root.mjs";

const toolDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(toolDir, "..", "..");
const require = createRequire(import.meta.url);
const { createCanvas, loadImage } = require(path.join(repoRoot, "tools", "latex-renderer", "node_modules", "@napi-rs", "canvas"));
const tempWorkspaceRoot = process.env.ANSWER_GRAPHICS_ROOT ? null : fs.mkdtempSync(path.join(os.tmpdir(), "ClassroomToolkit-answer-graphics-"));
const answerGraphicsRoot = tempWorkspaceRoot ?? resolveAnswerGraphicsRoot(repoRoot);

function buildEnv(extraEnv = {}) {
  return {
    ...process.env,
    INIT_CWD: repoRoot,
    ANSWER_GRAPHICS_ROOT: answerGraphicsRoot,
    ...extraEnv
  };
}

function runNode(scriptFile, args = [], options = {}) {
  const result = spawnSync(process.execPath, [path.join(toolDir, scriptFile), ...args], {
    cwd: options.cwd ?? toolDir,
    encoding: "utf8",
    env: buildEnv(options.env)
  });

  if (result.error) {
    throw result.error;
  }

  if ((result.status ?? 0) !== 0) {
    throw new Error(result.stderr || result.stdout || `${scriptFile} failed`);
  }
}

function runCommand(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? toolDir,
    encoding: "utf8",
    env: buildEnv(options.env)
  });

  if (result.error) {
    throw result.error;
  }

  if ((result.status ?? 0) !== 0) {
    throw new Error(result.stderr || result.stdout || `${command} failed`);
  }
}

async function main() {
  if (tempWorkspaceRoot) {
    fs.rmSync(answerGraphicsRoot, { recursive: true, force: true });
  }
  fs.mkdirSync(answerGraphicsRoot, { recursive: true });

  runNode("extract-figure.mjs");
  runNode("build-graphic-spec.mjs");
  runNode("render-graphic-overlay.mjs");
  runNode("compose-answer-graphic.mjs");

  const snapshotPath = path.join(answerGraphicsRoot, "resolved-snapshot.classroom.json");
  runNode(path.join("..", "rule-compiler", "compile-snapshot.mjs"), [
    "--profile",
    "classroom",
    "--out",
    snapshotPath
  ], {
    cwd: repoRoot
  });

  const demoMarkdownPath = path.join(answerGraphicsRoot, "graphic-placement.md");
  const demoPdfPath = path.join(answerGraphicsRoot, "graphic-placement.pdf");
  const reviewDir = path.join(answerGraphicsRoot, "graphic-placement.review");

  fs.writeFileSync(
    demoMarkdownPath,
    [
      "# 作图题答案图",
      "",
      "11．（1）作图略。",
      "<!-- answer-graphic: placed-answer-graphic.json -->",
      "（2）能量；频率越高。"
    ].join("\n"),
    "utf8"
  );

  runCommand(process.execPath, [
    path.join(repoRoot, "tools", "latex-renderer", "render-md-latex.mjs"),
    demoMarkdownPath,
    demoPdfPath,
    "--profile",
    "classroom",
    "--snapshot",
    snapshotPath
  ], {
    cwd: repoRoot
  });

  runCommand(process.execPath, [
    path.join(repoRoot, "tools", "latex-renderer", "review-source-pdf.mjs"),
    demoPdfPath,
    "--out",
    reviewDir,
    "--scale",
    "2"
  ], {
    cwd: repoRoot
  });

  const pngPath = fs
    .readdirSync(reviewDir)
    .filter((name) => name.endsWith(".page-001.png"))
    .map((name) => path.join(reviewDir, name))
    .sort()[0];

  if (!pngPath || !fs.existsSync(pngPath)) {
    throw new Error("Placed graphic review image not found.");
  }

  const image = await loadImage(pngPath);
  const canvas = createCanvas(image.width, image.height);
  const context = canvas.getContext("2d");
  context.drawImage(image, 0, 0, image.width, image.height);
  const imageData = context.getImageData(0, 0, image.width, image.height);

  function countRegion(x0, x1, y0, y1) {
    let count = 0;
    for (let y = y0; y < y1; y += 1) {
      for (let x = x0; x < x1; x += 1) {
        const index = (y * image.width + x) * 4;
        const red = imageData.data[index];
        const green = imageData.data[index + 1];
        const blue = imageData.data[index + 2];
        const alpha = imageData.data[index + 3];
        if (alpha > 0 && (red < 245 || green < 245 || blue < 245)) {
          count += 1;
        }
      }
    }
    return count;
  }

  const counts = {
    graphic: countRegion(120, 860, 140, 700),
    arrow: countRegion(500, 760, 180, 440),
    circle: countRegion(130, 280, 540, 680),
    label: countRegion(370, 520, 400, 520)
  };

  if (counts.graphic < 1500 || counts.arrow < 900 || counts.circle < 200 || counts.label < 100) {
    throw new Error(`Placed graphic pixel check failed: ${JSON.stringify(counts)}`);
  }

  const placed = path.join(answerGraphicsRoot, "placed-answer-graphic.json");
  if (!fs.existsSync(placed)) {
    throw new Error("Placed answer graphic not produced.");
  }

  console.log(placed);
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 2;
} finally {
  if (tempWorkspaceRoot) {
    fs.rmSync(tempWorkspaceRoot, { recursive: true, force: true });
  }
}
