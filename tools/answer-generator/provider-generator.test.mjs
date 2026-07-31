import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { runProviderGeneration } from "./provider-generator.mjs";

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "provider-generation-test-"));
  const workspace = path.join(root, "workspace");
  const instructions = path.join(root, "instructions");
  fs.mkdirSync(workspace);
  fs.mkdirSync(path.join(instructions, "prompts", "math-answer"), { recursive: true });
  const problem = Buffer.from("# Problem\n\nSolve `2x + 3 = 11`.\n", "utf8");
  const spec = Buffer.from("# Math answer rules\n\nShow the calculation and final answer.\n", "utf8");
  fs.writeFileSync(path.join(workspace, "problem.md"), problem);
  fs.writeFileSync(path.join(instructions, "prompts", "math-answer", "spec.md"), spec);
  const request = {
    schemaVersion: "1.0",
    kind: "answer-generation-request",
    requestId: "provider-linear-equation",
    subjectPack: "math-answer",
    problemArtifactRef: "problem.md",
    problemArtifactSha256: sha256(problem),
    dataClassification: { level: "public", notes: "Public test problem." },
    instructionAuthority: {
      artifactRef: "prompts/math-answer/spec.md",
      rawByteSha256: sha256(spec)
    },
    egressPolicy: { allowCloud: true }
  };
  const requestPath = path.join(workspace, "request.json");
  fs.writeFileSync(requestPath, `${JSON.stringify(request, null, 2)}\n`);
  return { root, workspace, instructions, requestPath, request };
}

function config() {
  return {
    cloudEgressEnabled: true,
    providers: [
      { lane: "ai", role: "primary", kind: "openai_compatible", baseUrl: "https://primary.example/v1", apiKey: "p", textModel: "model-a", textSurface: "responses" },
      { lane: "ai", role: "fallback_1", kind: "openai_compatible", baseUrl: "https://fallback.example/v1", apiKey: "f", textModel: "model-b", textSurface: "chat_completions" }
    ]
  };
}

test("provider generation uses failover and writes a fail-closed answer candidate atomically", async () => {
  const f = fixture();
  const output = path.join(f.root, "output");
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), body: JSON.parse(init.body) });
    if (String(url).includes("primary")) {
      return new Response(JSON.stringify({ error: "temporary" }), { status: 502 });
    }
    return new Response(JSON.stringify({ choices: [{ message: { content: "# Answer\n\n`x = 4`" } }] }), { status: 200 });
  };
  try {
    const result = await runProviderGeneration({
      requestPath: f.requestPath,
      workspaceRoot: f.workspace,
      instructionRoot: f.instructions,
      outputDir: output,
      config: config(),
      allowCloudEgress: true,
      timeoutMs: 1000,
      maxOutputTokens: 4096
    });
    assert.equal(result.result.provenance.providerId, "fallback_1");
    assert.equal(result.result.provenance.providerVersion, "model-b");
    assert.equal(result.result.provenance.attemptCount, 2);
    assert.deepEqual(result.result.generationDisposition, {
      reviewRequired: true,
      trusted: false,
      acceptanceDisposition: "pending_review",
      workflowDisposition: "not_integrated"
    });
    assert.equal(fs.readFileSync(path.join(output, "answer.md"), "utf8"), "# Answer\n\n`x = 4`\n");
    assert.equal(calls[0].body.max_output_tokens, 4096);
    assert.equal(calls[1].body.max_tokens, 4096);
    assert.match(calls[0].body.input, /Solve `2x \+ 3 = 11`/);
    assert.match(calls[0].body.input, /Show the calculation/);
  } finally {
    globalThis.fetch = originalFetch;
    fs.rmSync(f.root, { recursive: true, force: true });
  }
});

test("provider generation requires public data and dual egress authorization", async () => {
  const cases = [
    { mutate: (f) => { f.request.egressPolicy.allowCloud = false; }, allow: true, message: /request egress policy/ },
    { mutate: () => {}, allow: false, message: /explicit runtime cloud-egress authorization/ },
    { mutate: (f) => { f.request.dataClassification.level = "restricted"; }, allow: true, message: /public data/ }
  ];
  for (const item of cases) {
    const f = fixture();
    item.mutate(f);
    fs.writeFileSync(f.requestPath, `${JSON.stringify(f.request, null, 2)}\n`);
    await assert.rejects(runProviderGeneration({
      requestPath: f.requestPath,
      workspaceRoot: f.workspace,
      instructionRoot: f.instructions,
      outputDir: path.join(f.root, "output"),
      config: config(),
      allowCloudEgress: item.allow,
      timeoutMs: 1000,
      maxOutputTokens: 4096
    }), item.message);
    assert.equal(fs.existsSync(path.join(f.root, "output")), false);
    fs.rmSync(f.root, { recursive: true, force: true });
  }
});

test("provider generation rejects authority drift and output inside the workspace", async () => {
  const f = fixture();
  f.request.instructionAuthority.rawByteSha256 = "0".repeat(64);
  fs.writeFileSync(f.requestPath, `${JSON.stringify(f.request, null, 2)}\n`);
  await assert.rejects(runProviderGeneration({
    requestPath: f.requestPath,
    workspaceRoot: f.workspace,
    instructionRoot: f.instructions,
    outputDir: path.join(f.root, "output"),
    config: config(), allowCloudEgress: true, timeoutMs: 1000, maxOutputTokens: 4096
  }), /instruction authority drifted/i);
  f.request.instructionAuthority.rawByteSha256 = sha256(fs.readFileSync(path.join(f.instructions, "prompts", "math-answer", "spec.md")));
  fs.writeFileSync(f.requestPath, `${JSON.stringify(f.request, null, 2)}\n`);
  await assert.rejects(runProviderGeneration({
    requestPath: f.requestPath,
    workspaceRoot: f.workspace,
    instructionRoot: f.instructions,
    outputDir: path.join(f.workspace, "output"),
    config: config(), allowCloudEgress: true, timeoutMs: 1000, maxOutputTokens: 4096
  }), /outside workspace and repository authority/);
  fs.rmSync(f.root, { recursive: true, force: true });
});

test("provider generation rejects input drift before output promotion", async () => {
  const f = fixture();
  const output = path.join(f.root, "output");
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    fs.writeFileSync(path.join(f.workspace, "problem.md"), "changed during request\n");
    return new Response(JSON.stringify({ output_text: "# Answer\n\n`x = 4`" }), { status: 200 });
  };
  try {
    await assert.rejects(runProviderGeneration({
      requestPath: f.requestPath,
      workspaceRoot: f.workspace,
      instructionRoot: f.instructions,
      outputDir: output,
      config: { ...config(), providers: [config().providers[0]] },
      allowCloudEgress: true,
      timeoutMs: 1000,
      maxOutputTokens: 4096
    }), /input drifted during execution/);
    assert.equal(fs.existsSync(output), false);
  } finally {
    globalThis.fetch = originalFetch;
    fs.rmSync(f.root, { recursive: true, force: true });
  }
});
