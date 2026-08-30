import assert from "node:assert/strict";
import { createServer } from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { normalizeConfig } from "./validate-config.mjs";
import { requestAnswerWithFailover } from "./answer-transport.mjs";
import { validateValueAgainstSchema } from "../rule-compiler/schema-validator.mjs";

const toolDir = path.dirname(fileURLToPath(import.meta.url));
const summarySchemaPath = path.join(
  toolDir, "..", "..", "prompts", "shared", "schemas", "live-answer-generation-summary.schema.json");

function startChatServer(handler) {
  const server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      handler(request, response, body);
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

async function withServer(handler, run) {
  const server = await startChatServer(handler);
  try {
    return await run(`http://127.0.0.1:${server.address().port}/v1`);
  } finally {
    server.close();
  }
}

const ANSWER_MARKDOWN = "# 参考答案\n\n15．电压为 $U$。\n1-5：ABCDA\n6-10：BADCA\n";

function chatCompletion(markdown) {
  return JSON.stringify({
    choices: [{ message: { content: markdown }, finish_reason: "stop" }],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
  });
}

function providerEnv(baseUrl, roleSuffix, apiKey) {
  const prefix = `CLASSROOM_TOOLKIT_AI_${roleSuffix}`;
  return Object.fromEntries([
    [`${prefix}_BASE_URL`, baseUrl],
    [`${prefix}_API_KEY`, apiKey],
    [`${prefix}_TEXT_MODEL`, "gpt-5.6-sol"],
    [`${prefix}_VISION_MODEL`, "gpt-5.6-sol"],
    [`${prefix}_REASONING_EFFORT`, "high"],
    [`${prefix}_TEXT_SURFACE`, "chat_completions"],
    [`${prefix}_VISION_SURFACE`, "chat_completions"]
  ]);
}

// normalizeConfig reads the egress switch from the same env object it parses
// providers from, so every in-process config must carry it explicitly.
const EGRESS_ENV = { CLASSROOM_TOOLKIT_CLOUD_EGRESS_ENABLED: "true" };

const FAILover_OPTIONS = {
  mode: "answer",
  prompt: "p",
  provider: "all",
  qualityProfile: "sol-high",
  visualDetailMode: "original",
  maxOutputTokens: 2000,
  timeoutMs: 20000,
  allowCloudEgress: true,
  imagePaths: [],
  imageEvidenceLabels: [],
  auditImagePaths: [],
  referenceImagePaths: []
};

test("requestAnswerWithFailover continues to fallback after a provider-local 401", async () => {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "gateway-e2e-"));
  try {
  await withServer((request, response) => {
    if (request.headers.authorization === "Bearer primary-key") {
      response.writeHead(401, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: { message: "invalid api key" } }));
      return;
    }
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(chatCompletion(ANSWER_MARKDOWN));
  }, async (baseUrl) => {
    const config = normalizeConfig({
      ...EGRESS_ENV,
      CLASSROOM_TOOLKIT_AI_RUNTIME_DIRECTORY: workDir,
      ...providerEnv(baseUrl, "PRIMARY", "primary-key"),
      ...providerEnv(baseUrl, "FALLBACK_1", "fallback-key")
    });

    const result = await requestAnswerWithFailover(config, FAILover_OPTIONS);

    assert.equal(result.ok, true);
    assert.equal(result.provider, "fallback_1");
    assert.ok(result.attempts.some((attempt) => attempt.status === 401));
    assert.equal(result.answerMarkdown.trim(), ANSWER_MARKDOWN.trim());
  });
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
});

test("requestAnswerWithFailover still fails closed on a generic non-retryable status", async () => {
  let requests = 0;
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "gateway-e2e-"));
  try {
  await withServer((_request, response) => {
    requests += 1;
    response.writeHead(400, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ error: { message: "bad request shape" } }));
  }, async (baseUrl) => {
    const config = normalizeConfig({
      ...EGRESS_ENV,
      CLASSROOM_TOOLKIT_AI_RUNTIME_DIRECTORY: workDir,
      ...providerEnv(baseUrl, "PRIMARY", "primary-key"),
      ...providerEnv(baseUrl, "FALLBACK_1", "fallback-key")
    });

    const result = await requestAnswerWithFailover(config, FAILover_OPTIONS);

    assert.equal(result.ok, false);
    assert.equal(requests, 1);
    assert.equal(result.attempts.length, 1);
  });
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
});

test("main() success path writes answer and schema-valid summary through a fake gateway", async () => {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "gateway-e2e-"));
  try {
    await withServer((_request, response) => {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(chatCompletion(ANSWER_MARKDOWN));
    }, async (baseUrl) => {
      const envLines = [
        "CLASSROOM_TOOLKIT_CLOUD_EGRESS_ENABLED=true",
        `CLASSROOM_TOOLKIT_AI_RUNTIME_DIRECTORY=${workDir}`,
        ...Object.entries(providerEnv(baseUrl, "PRIMARY", "primary-key"))
          .map(([key, value]) => `${key}=${value}`)
      ];
      const envFile = path.join(workDir, "gateway.env");
      fs.writeFileSync(envFile, `${envLines.join("\n")}\n`);
      const outputPath = path.join(workDir, "answer.md");
      const summaryPath = path.join(workDir, "summary.json");
      // The CLI requires at least one source page; ship a 1x1 PNG.
      const imagesDir = path.join(workDir, "pages");
      fs.mkdirSync(imagesDir);
      fs.writeFileSync(
        path.join(imagesDir, "page-001.png"),
        Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64")
      );

      // Must be async spawn: spawnSync would block this process's event loop,
      // which is exactly where the fake gateway answers from.
      const result = await new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [
          path.join(toolDir, "answer-request.mjs"),
          "--config-env-file", envFile,
          "--images-dir", imagesDir,
          "--output", outputPath,
          "--summary-out", summaryPath,
          "--quality-profile", "sol-high",
          "--allow-cloud-egress",
          "--timeout-ms", "30000"
        ], {
          env: { ...process.env, INIT_CWD: workDir }
        });
        let stdout = "";
        let stderr = "";
        const timer = setTimeout(() => {
          child.kill();
          reject(new Error("answer-request.mjs did not exit within 120 seconds."));
        }, 120000);
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

      assert.equal(result.status, 0, `stderr: ${result.stderr}\nstdout: ${result.stdout}`);
      assert.equal(fs.readFileSync(outputPath, "utf8"), `${ANSWER_MARKDOWN.trim()}\n`);

      const summary = JSON.parse(fs.readFileSync(summaryPath, "utf8"));
      assert.deepEqual(validateValueAgainstSchema(summary, summarySchemaPath), []);
      assert.equal(summary.kind, "live-answer-generation-summary");
      assert.equal(summary.provider, "primary");
      assert.equal(summary.model, "gpt-5.6-sol");
      assert.equal(summary.reasoningEffort, "high");
      assert.equal(summary.mode, "blind_generation");
      assert.equal(summary.outputSha256.length, 64);
    });
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
});
