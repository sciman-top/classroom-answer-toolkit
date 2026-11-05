import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { compileResolvedSnapshot } from "../rule-compiler/merge-rules.mjs";
import { writeDeliveryManifest } from "./write-delivery-manifest.mjs";

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
    fs.writeFileSync(path.join(root, "answer.pdf"), createSinglePagePdf(), "utf8");

    const reviewDir = path.join(root, "answer.review");
    fs.mkdirSync(reviewDir, { recursive: true });
    const reviewRun = await runTool(path.join(toolDir, "review-source-pdf.mjs"), [
      path.join(root, "answer.pdf"), "--out", reviewDir, "--pages", "all"
    ]);
    assert.equal(reviewRun.status, 0, `review stderr: ${reviewRun.stderr}`);

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

    // The writer must never emit absolute page paths: they would silently pin
    // the package to the machine it was built on (2026-08-27 portability
    // contract). Assert this before relocation so a regression fails here
    // with the offending value instead of a foreign-CWD validation error.
    const writtenReviewManifest = JSON.parse(
      fs.readFileSync(path.join(root, "answer.review", "manifest.json"), "utf8")
    );
    assert.equal(path.normalize(writtenReviewManifest.inputPath), path.normalize("../answer.pdf"));
    for (const page of writtenReviewManifest.pages) {
      assert.equal(
        path.isAbsolute(page.imagePath),
        false,
        `pages[].imagePath must be package-relative, got ${page.imagePath}`
      );
    }

    // Relocate the package, then validate with a CWD outside both copies.
    // Exercise the asynchronous copy path used by deliver-answer.mjs. This is
    // intentionally not fs.cpSync: that Node API has crashed on Windows when
    // a real delivery directory contains CJK path segments.
    // No hand-patching here: a relocated delivery must validate exactly as
    // the writer produced it, review manifest and integrity hashes included.
    await fs.promises.cp(root, relocatedRoot, { recursive: true });
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

test("writer emits a valid no-review manifest and packages external input", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "delivery-no-review-"));
  const externalRoot = fs.mkdtempSync(path.join(os.tmpdir(), "delivery-external-input-"));
  const relocatedRoot = `${root}-moved`;
  try {
    const snapshotPath = path.join(root, "answer.snapshot.json");
    writeJson(snapshotPath, compileResolvedSnapshot({
      subjectPack: "junior-physics-answer",
      profileName: "classroom"
    }));
    const externalInputPath = path.join(externalRoot, "answer.md");
    fs.writeFileSync(externalInputPath, "# 外部输入\n", "utf8");
    fs.writeFileSync(path.join(root, "answer.pdf"), "pdf fixture", "utf8");
    const manifestPath = path.join(root, "answer.delivery-manifest.json");

    const written = await runTool("write-delivery-manifest.mjs", [
      "--input", externalInputPath,
      "--output", path.join(root, "answer.pdf"),
      "--snapshot-path", snapshotPath,
      "--out", manifestPath
    ]);
    assert.equal(written.status, 0, `writer stderr: ${written.stderr}`);
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    assert.equal(manifest.status.reviewArtifactReady, false);
    assert.equal(manifest.review.outputDir, "");
    assert.equal(manifest.review.manifestPath, "");
    assert.equal(manifest.input, "answer.delivery-input.md");
    assert.equal(fs.existsSync(path.join(root, manifest.input)), true);

    await fs.promises.cp(root, relocatedRoot, { recursive: true });
    const validated = await runTool("validate-delivery-manifest.mjs", [
      "--manifest", path.join(relocatedRoot, "answer.delivery-manifest.json")
    ], { cwd: os.tmpdir() });
    assert.equal(validated.status, 0,
      `validator stderr: ${validated.stderr}\nstdout: ${validated.stdout}`);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(externalRoot, { recursive: true, force: true });
    fs.rmSync(relocatedRoot, { recursive: true, force: true });
  }
});

test("delivery-owned review is relocatable instead of depending on .pdf-review debug cache", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "delivery-owned-review-"));
  const outputRoot = fs.mkdtempSync(path.join(os.tmpdir(), "delivery-owned-output-"));
  try {
    const answerPath = path.join(root, "answer.md");
    const pdfPath = path.join(outputRoot, "answer.pdf");
    const snapshotPath = path.join(outputRoot, "answer.snapshot.json");
    fs.writeFileSync(answerPath, "# 参考答案\n");
    fs.writeFileSync(pdfPath, createSinglePagePdf());
    writeJson(snapshotPath, compileResolvedSnapshot({
      subjectPack: "junior-physics-answer",
      profileName: "classroom"
    }));
    const delivered = await runTool("deliver-answer.mjs", [
      answerPath, pdfPath,
      "--subject-pack", "junior-physics-answer",
      "--snapshot-path", snapshotPath,
      "--skip-validate"
    ]);
    assert.equal(delivered.status, 0, delivered.stderr);
    const manifestPath = path.join(outputRoot, "answer.delivery-manifest.json");
    const validated = await runTool("validate-delivery-manifest.mjs", [
      "--manifest", manifestPath
    ]);
    assert.equal(validated.status, 0, validated.stderr);
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    assert.equal(manifest.status.reviewArtifactReady, true);
    const reviewManifest = JSON.parse(fs.readFileSync(
      path.join(outputRoot, "answer.review", "manifest.json"),
      "utf8"
    ));
    assert.equal(path.normalize(reviewManifest.inputPath), path.normalize("../answer.pdf"));
    assert.equal(
      path.isAbsolute(reviewManifest.pages[0].imagePath),
      false,
      `packaged pages[].imagePath must be package-relative, got ${reviewManifest.pages[0].imagePath}`
    );
    assert.ok(fs.existsSync(path.join(outputRoot, "answer.review", reviewManifest.pages[0].imagePath)));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outputRoot, { recursive: true, force: true });
  }
});

test("writer packages external answer graphics and validates after relocation", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "delivery-graphic-input-"));
  const externalRoot = fs.mkdtempSync(path.join(os.tmpdir(), "delivery-graphic-source-"));
  const relocatedRoot = `${root}-moved`;
  try {
    const snapshotPath = path.join(root, "answer.snapshot.json");
    writeJson(snapshotPath, compileResolvedSnapshot({
      subjectPack: "junior-physics-answer",
      profileName: "classroom"
    }));
    const sourceAssets = path.join(externalRoot, "assets");
    fs.mkdirSync(sourceAssets, { recursive: true });
    fs.writeFileSync(path.join(externalRoot, "answer.md"),
      "# 参考答案\n<!-- answer-graphic: assets/placement.json -->\n", "utf8");
    writeJson(path.join(sourceAssets, "placement.json"), {
      schemaVersion: "1.0",
      kind: "placed-answer-graphic",
      placedGraphicId: "external-placed",
      graphicId: "external-graphic",
      artifactId: "external-artifact",
      questionRef: "1",
      placementMode: "inline-medium",
      targetBlock: "answer-body",
      figureWidthMm: 120,
      captionMode: "inline",
      pageBreakPolicy: "avoid",
      previewPath: "preview.svg"
    });
    fs.writeFileSync(path.join(sourceAssets, "preview.svg"), "<svg></svg>\n", "utf8");
    fs.writeFileSync(path.join(root, "answer.pdf"), "pdf fixture", "utf8");
    const manifestPath = path.join(root, "answer.delivery-manifest.json");

    const written = await runTool("write-delivery-manifest.mjs", [
      "--input", path.join(externalRoot, "answer.md"),
      "--output", path.join(root, "answer.pdf"),
      "--snapshot-path", snapshotPath,
      "--out", manifestPath
    ]);
    assert.equal(written.status, 0, `writer stderr: ${written.stderr}`);
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    assert.deepEqual(manifest.graphics.items.map((item) => item.graphicId), ["external-graphic"]);
    assert.equal(manifest.graphics.items[0].placementPath, "assets/placement.json");
    assert.equal(manifest.graphics.items[0].previewPath, "assets/preview.svg");
    assert.ok(fs.existsSync(path.join(root, "assets", "placement.json")));
    assert.ok(fs.existsSync(path.join(root, "assets", "preview.svg")));

    await fs.promises.cp(root, relocatedRoot, { recursive: true });
    const validated = await runTool("validate-delivery-manifest.mjs", [
      "--manifest", path.join(relocatedRoot, "answer.delivery-manifest.json")
    ], { cwd: os.tmpdir() });
    assert.equal(validated.status, 0,
      `validator stderr: ${validated.stderr}\nstdout: ${validated.stdout}`);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(externalRoot, { recursive: true, force: true });
    fs.rmSync(relocatedRoot, { recursive: true, force: true });
  }
});

test("deliver refuses to silently replace an existing delivery built from different input", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "delivery-overwrite-"));
  const outputRoot = fs.mkdtempSync(path.join(os.tmpdir(), "delivery-overwrite-out-"));
  try {
    const answerPath = path.join(root, "answer.md");
    const pdfPath = path.join(outputRoot, "answer.pdf");
    const snapshotPath = path.join(outputRoot, "answer.snapshot.json");
    const manifestPath = path.join(outputRoot, "answer.delivery-manifest.json");
    fs.writeFileSync(answerPath, "# 参考答案\n");
    writeJson(snapshotPath, compileResolvedSnapshot({
      subjectPack: "junior-physics-answer",
      profileName: "classroom"
    }));

    const deliverArgs = [
      answerPath, pdfPath,
      "--subject-pack", "junior-physics-answer",
      "--snapshot-path", snapshotPath,
      "--skip-validate"
    ];
    const first = await runTool("deliver-answer.mjs", deliverArgs);
    assert.equal(first.status, 0, first.stderr);
    const firstInputSha256 = JSON.parse(fs.readFileSync(manifestPath, "utf8")).integrity.input.sha256;

    // Same input bytes: an idempotent refresh stays allowed without --force.
    const refresh = await runTool("deliver-answer.mjs", deliverArgs);
    assert.equal(refresh.status, 0, refresh.stderr);

    // Different input bytes: the guard must fail closed and leave the bound
    // delivery untouched — this is exactly the wrong-target accident.
    fs.writeFileSync(answerPath, "# 参考答案（修订）\n");
    const refused = await runTool("deliver-answer.mjs", deliverArgs);
    assert.notEqual(refused.status, 0);
    assert.ok(refused.stderr.includes("Refusing to replace"), `stderr: ${refused.stderr}`);
    assert.ok(refused.stderr.includes("--force"), `stderr: ${refused.stderr}`);
    const manifestAfterRefusal = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    assert.equal(manifestAfterRefusal.integrity.input.sha256, firstInputSha256);

    // Explicit --force documents the intentional replacement.
    const forced = await runTool("deliver-answer.mjs", [...deliverArgs, "--force"]);
    assert.equal(forced.status, 0, forced.stderr);
    const manifestAfterForce = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    assert.notEqual(manifestAfterForce.integrity.input.sha256, firstInputSha256);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outputRoot, { recursive: true, force: true });
  }
});

test("writer rejects answer-graphic markers that escape the delivery package", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "delivery-graphic-boundary-"));
  const deliveryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "delivery-graphic-target-"));
  try {
    const inputPath = path.join(root, "answer.md");
    const outputPath = path.join(deliveryRoot, "answer.pdf");
    const snapshotPath = path.join(deliveryRoot, "answer.snapshot.json");
    const manifestPath = path.join(deliveryRoot, "answer.delivery-manifest.json");
    fs.writeFileSync(inputPath, "# 参考答案\n\n<!-- answer-graphic: ../outside/placement.json -->\n", "utf8");
    fs.writeFileSync(outputPath, createSinglePagePdf(), "utf8");
    writeJson(snapshotPath, compileResolvedSnapshot({
      subjectPack: "junior-physics-answer",
      profileName: "classroom"
    }));

    assert.throws(() => writeDeliveryManifest({
      inputPath,
      outputPath,
      snapshotPath,
      manifestPath,
      force: true
    }), /answer-graphic marker must stay inside the delivery package/);
    assert.equal(fs.existsSync(path.join(deliveryRoot, "outside", "placement.json")), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(deliveryRoot, { recursive: true, force: true });
  }
});

test("writer rejects answer-graphic markers targeting reserved delivery artifacts", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "delivery-graphic-reserved-"));
  const deliveryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "delivery-graphic-target-"));
  try {
    const inputPath = path.join(root, "answer.md");
    const sourcePlacementPath = path.join(root, "answer.pdf");
    const outputPath = path.join(deliveryRoot, "answer.pdf");
    const snapshotPath = path.join(deliveryRoot, "answer.snapshot.json");
    const manifestPath = path.join(deliveryRoot, "answer.delivery-manifest.json");
    fs.writeFileSync(inputPath, "# 参考答案\n\n<!-- answer-graphic: answer.pdf -->\n", "utf8");
    fs.writeFileSync(sourcePlacementPath, "{}", "utf8");
    fs.writeFileSync(outputPath, createSinglePagePdf(), "utf8");
    writeJson(snapshotPath, compileResolvedSnapshot({
      subjectPack: "junior-physics-answer",
      profileName: "classroom"
    }));

    assert.throws(() => writeDeliveryManifest({
      inputPath,
      outputPath,
      snapshotPath,
      manifestPath,
      force: true
    }), /Answer graphic placement would overwrite a delivery artifact/);
    assert.equal(fs.readFileSync(outputPath, "utf8"), createSinglePagePdf());
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(deliveryRoot, { recursive: true, force: true });
  }
});

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function fileHash(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function createSinglePagePdf() {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Resources << >> /Contents 4 0 R >>",
    "<< /Length 0 >>\nstream\n\nendstream"
  ];
  let output = "%PDF-1.4\n";
  const offsets = [];
  for (const [index, body] of objects.entries()) {
    offsets.push(Buffer.byteLength(output));
    output += `${index + 1} 0 obj\n${body}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(output);
  output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  output += offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  output += `trailer << /Root 1 0 R /Size ${objects.length + 1} >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return output;
}

function runTool(scriptName, args, options = {}) {
  return new Promise((resolve, reject) => {
  const child = spawn(process.execPath, [
      path.isAbsolute(scriptName) ? scriptName : path.join(toolDir, scriptName),
      ...args
    ], {
      cwd: toolDir,
      env: {
        ...process.env,
        INIT_CWD: options.cwd ?? toolDir
      }
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
