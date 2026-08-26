import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { checkAssemblyOutputs, generateAssemblyOutputs, writeAssemblyOutputs } from "./assemble-human-spec.mjs";

function writeWorkspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "assemble-spec-"));
  const write = (relativePath, content) => {
    const filePath = path.join(root, relativePath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content, "utf8");
    return filePath;
  };

  write("specs/platform/platform-rules-v1.0.md", "# 平台总则规范\n\n平台正文。\n");
  write("specs/subjects/subject-source-v2.1.md", "# 学科源规范\n\n学科正文。\n");
  write("specs/subjects/subject-entry-v2.1.md", "# 学科调用版\n\n调用版正文。\n");

  const assemblyPath = write("specs/assemblies/test-answer.json", `${JSON.stringify({
    schemaVersion: "1.0",
    assemblyId: "test-answer",
    subjectPack: "test-answer",
    subjectLabel: "测试学科",
    outputVersion: "v2.2",
    sourceLayers: [
      { label: "平台总则", path: "../platform/platform-rules-v1.0.md" },
      { label: "学科特异", path: "../subjects/subject-source-v2.1.md" }
    ],
    entrySource: "../subjects/subject-entry-v2.1.md",
    fullOutput: "../compiled/test-full-v2.2.md",
    entryOutput: "../compiled/test-entry-v2.2.md"
  }, null, 2)}\n`);
  return { root, assemblyPath };
}

test("generateAssemblyOutputs composes the documented full and entry shapes", () => {
  const { root, assemblyPath } = writeWorkspace();
  try {
    const { outputs } = generateAssemblyOutputs(assemblyPath);
    const [fullOutput, entryOutput] = outputs;

    const full = fullOutput.content;
    assert.match(full, /^# 试卷参考答案交付规范-测试学科-完整版 v2\.2\n/);
    assert.match(full, /> 生成方式：自动汇编生成，禁止手改。/);
    assert.match(full, /> 目标 subject-pack：`test-answer`。/);
    assert.match(full, /> 汇编层：平台总则\(v1\.0\)、学科特异\(v2\.1\)。/);
    assert.match(full, /> 输出版本：v2\.2。/);
    assert.ok(full.indexOf("## 平台总则") < full.indexOf("## 学科特异"));
    assert.ok(full.includes("平台正文。") && full.includes("学科正文。"));
    // Layer bodies drop their own H1 titles; only section labels remain.
    assert.ok(!full.includes("# 平台总则规范"));

    const entry = entryOutput.content;
    assert.match(entry, /^# 试卷参考答案交付规范-测试学科-调用版 v2\.2\n/);
    assert.match(entry, /> 产物类型：调用版。/);
    assert.ok(entry.includes("调用版正文。"));
    assert.ok(!entry.includes("学科正文。"));
    assert.ok(entry.endsWith("\n"));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("checkAssemblyOutputs reports drift and missing outputs", () => {
  const { root, assemblyPath } = writeWorkspace();
  try {
    const missing = checkAssemblyOutputs(assemblyPath);
    assert.equal(missing.length, 2);
    assert.ok(missing.every((message) => /^Missing generated file: .*(compiled[\\/])?test-(full|entry)-v2\.2\.md$/.test(message)));

    writeAssemblyOutputs(assemblyPath);
    assert.deepEqual(checkAssemblyOutputs(assemblyPath), []);

    const fullOutputPath = path.join(root, "specs/compiled/test-full-v2.2.md");
    fs.writeFileSync(fullOutputPath, "# tampered\n", "utf8");
    const mismatches = checkAssemblyOutputs(assemblyPath);
    assert.equal(mismatches.length, 1);
    assert.match(mismatches[0], /Generated file drift/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("layer sources must start with a first-level heading", () => {
  const { root, assemblyPath } = writeWorkspace();
  try {
    fs.writeFileSync(path.join(root, "specs/platform/platform-rules-v1.0.md"), "no heading\n", "utf8");
    assert.throws(() => generateAssemblyOutputs(assemblyPath), /missing first-level heading/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
