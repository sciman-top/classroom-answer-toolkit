import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  buildPrompt,
  buildAnswerRequestBody,
  applyReferenceChoiceAnswers,
  normalizeAnswerMarkdown,
  selectAnswerRoute,
  requestAnswerWithFailover
} from "./answer-request.mjs";
import { normalizeConfig } from "./validate-config.mjs";

test("live task prompt requires complete subquestion coverage and independent visual checks", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "classroom-answer-prompt-"));
  const promptPath = path.join(directory, "spec.md");
  try {
    writeFileSync(promptPath, "v8.14 production specification", "utf8");
    const prompt = buildPrompt(promptPath);

    assert.match(prompt, /逐题覆盖清单/);
    assert.match(prompt, /括号小问、圈号小问和每个待填空/);
    assert.match(prompt, /量程、接线柱、分度值和指针位置/);
    assert.match(prompt, /禁止仅凭题型惯例作答/);
    assert.match(prompt, /禁止照抄装置名称/);
    assert.match(prompt, /圈号小问编号/);
    assert.match(prompt, /选项字母、图中点名和中文标点/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("reference review prompt separates source pages, reference pages, and blind candidate", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "classroom-answer-review-prompt-"));
  const promptPath = path.join(directory, "spec.md");
  try {
    writeFileSync(promptPath, "v8.14 production specification", "utf8");
    const prompt = buildPrompt(promptPath, {
      candidateMarkdown: "# 参考答案\n\n1. C",
      referenceText: "BAADA CBBDD\n11. 机械 光 可再生 一次",
      sourcePageCount: 8,
      referencePageCount: 3
    });

    assert.match(prompt, /前 8 张图片是原卷，随后 3 张图片是权威参考答案/);
    assert.match(prompt, /参考答案是答案取值的权威来源/);
    assert.match(prompt, /BAADA CBBDD/);
    assert.match(prompt, /逐字符抄录完整答案串/);
    assert.match(prompt, /1\. C/);
    assert.match(prompt, /仅返回修正后的完整 Markdown/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("gateway config discovers ordered AI tiers and inherits primary connection settings", () => {
  const config = normalizeConfig({
    CLASSROOM_TOOLKIT_CLOUD_EGRESS_ENABLED: "true",
    CLASSROOM_TOOLKIT_AI_PRIMARY_BASE_URL: "https://primary.example.com/v1",
    CLASSROOM_TOOLKIT_AI_PRIMARY_API_KEY: "primary-key",
    CLASSROOM_TOOLKIT_AI_PRIMARY_TEXT_MODEL: "gpt-5.6-sol",
    CLASSROOM_TOOLKIT_AI_PRIMARY_VISION_MODEL: "gpt-5.6-sol",
    CLASSROOM_TOOLKIT_AI_PRIMARY_REASONING_EFFORT: "xhigh",
    CLASSROOM_TOOLKIT_AI_FALLBACK_1_TEXT_MODEL: "gpt-5.6-sol",
    CLASSROOM_TOOLKIT_AI_FALLBACK_1_REASONING_EFFORT: "medium",
    CLASSROOM_TOOLKIT_AI_FALLBACK_1_INHERIT_PRIMARY: "true",
    CLASSROOM_TOOLKIT_AI_FALLBACK_1_BASE_URL: "https://stale.example.com/v1",
    CLASSROOM_TOOLKIT_AI_FALLBACK_1_API_KEY: "stale-key",
    CLASSROOM_TOOLKIT_AI_FALLBACK_2_TEXT_MODEL: "gpt-5.6-terra",
    CLASSROOM_TOOLKIT_AI_FALLBACK_2_REASONING_EFFORT: "xhigh",
    CLASSROOM_TOOLKIT_AI_FALLBACK_3_TEXT_MODEL: "gpt-5.6-terra",
    CLASSROOM_TOOLKIT_AI_FALLBACK_3_REASONING_EFFORT: "high"
  });

  const aiProviders = config.providers.filter((provider) => provider.lane === "ai");
  assert.deepEqual(
    aiProviders.map(({ role, textModel, reasoningEffort }) => ({ role, textModel, reasoningEffort })),
    [
      { role: "primary", textModel: "gpt-5.6-sol", reasoningEffort: "xhigh" },
      { role: "fallback_1", textModel: "gpt-5.6-sol", reasoningEffort: "medium" },
      { role: "fallback_2", textModel: "gpt-5.6-terra", reasoningEffort: "xhigh" },
      { role: "fallback_3", textModel: "gpt-5.6-terra", reasoningEffort: "high" }
    ]
  );
  assert.ok(aiProviders.slice(1).every((provider) => provider.baseUrl === aiProviders[0].baseUrl));
  assert.ok(aiProviders.slice(1).every((provider) => provider.apiKey === aiProviders[0].apiKey));
  assert.ok(aiProviders.every((provider) => provider.visionModel === provider.textModel));
});

test("visual audit prompt treats audit images as source evidence rather than reference answers", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "classroom-answer-visual-audit-prompt-"));
  const promptPath = path.join(directory, "spec.md");
  try {
    writeFileSync(promptPath, "v8.14 production specification", "utf8");
    const prompt = buildPrompt(promptPath, {
      mode: "visual_audit",
      candidateMarkdown: "# 参考答案\n\n1—5：B、C、C、B、D\n\n17. ④0.16 A。",
      sourcePageCount: 8,
      auditImageCount: 8
    });

    assert.match(prompt, /无参考答案视觉审计任务/);
    assert.match(prompt, /不是参考答案/);
    assert.match(prompt, /逐项反证/);
    assert.match(prompt, /承重绳段/);
    assert.match(prompt, /实际连接导线的接线柱/);
    assert.match(prompt, /量程.*分度值.*指针/);
    assert.match(prompt, /刻度尺.*两端/);
    assert.match(prompt, /无法可靠判读/);
    assert.match(prompt, /0\.16 A/);
    assert.doesNotMatch(prompt, /参考答案是答案取值的权威来源/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("visual findings and merge prompts separate evidence extraction from Markdown rewriting", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "classroom-answer-visual-findings-prompt-"));
  const promptPath = path.join(directory, "spec.md");
  try {
    writeFileSync(promptPath, "v8.14 production specification", "utf8");
    const candidateMarkdown = "# 参考答案\n\n16. n=2。\n\n17. 0.16 A。";
    const findingsPrompt = buildPrompt(promptPath, {
      mode: "visual_audit_findings",
      candidateMarkdown,
      auditImageCount: 16
    });
    const mergePrompt = buildPrompt(promptPath, {
      mode: "visual_audit_merge",
      candidateMarkdown,
      auditFindings: "第16题：n 应为 3。"
    });

    assert.match(findingsPrompt, /只输出视觉审计发现报告/);
    assert.match(findingsPrompt, /不得重写整份答案/);
    assert.match(findingsPrompt, /n=2/);
    assert.match(mergePrompt, /视觉审计合并任务/);
    assert.match(mergePrompt, /n 应为 3/);
    assert.match(mergePrompt, /证据不足.*保留候选原文/);
    assert.match(mergePrompt, /仅返回修正后的完整 Markdown/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("blind solving accepts only gpt-5.6-sol/xhigh and never falls back to a lower tier", () => {
  const providers = [
    { lane: "ai", role: "fallback_3", visionModel: "gpt-5.6-terra", reasoningEffort: "high" },
    { lane: "ai", role: "fallback_1", visionModel: "gpt-5.6-sol", reasoningEffort: "medium" },
    { lane: "ai", role: "primary", visionModel: "gpt-5.6-sol", reasoningEffort: "xhigh" },
    { lane: "ai", role: "fallback_2", visionModel: "gpt-5.6-terra", reasoningEffort: "xhigh" }
  ];
  const route = selectAnswerRoute({ providers }, "blind_generation", "all");
  assert.deepEqual(route.orderedRoles, ["primary"]);
  assert.equal(route.providers[0].visionModel, "gpt-5.6-sol");
  assert.equal(route.providers[0].reasoningEffort, "xhigh");
  assert.deepEqual(selectAnswerRoute({ providers }, "blind_generation", "fallback").orderedRoles, []);
});

function createConfig(surface = "responses") {
  return {
    cloudEgressEnabled: true,
    providers: [
      {
        lane: "ai",
        role: "primary",
        baseUrl: "https://primary.example.com/v1",
        apiKey: "primary-key",
        visionModel: "gpt-5",
        visionSurface: surface,
        reasoningEffort: "medium"
      },
      {
        lane: "ai",
        role: "fallback_1",
        baseUrl: "https://fallback.example.com/v1",
        apiKey: "fallback-key",
        visionModel: "gpt-5",
        visionSurface: surface,
        reasoningEffort: "medium"
      }
    ]
  };
}

function createPageImages(count = 2) {
  const directory = mkdtempSync(path.join(os.tmpdir(), "classroom-answer-pages-"));
  const imagePaths = [];
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
    "base64"
  );
  for (let index = 1; index <= count; index += 1) {
    const imagePath = path.join(directory, `page-${String(index).padStart(3, "0")}.png`);
    writeFileSync(imagePath, png);
    imagePaths.push(imagePath);
  }
  return { directory, imagePaths };
}

test("responses request sends the full prompt followed by every ordered page image", () => {
  const { directory, imagePaths } = createPageImages(3);
  try {
    const body = buildAnswerRequestBody(createConfig().providers[0], {
      prompt: "完整 v8.14 提示词\n\n请输出答案 Markdown。",
      imagePaths,
      visualDetailMode: "original",
      maxOutputTokens: 16000
    });

    assert.equal(body.model, "gpt-5");
    assert.equal(body.max_output_tokens, 16000);
    assert.deepEqual(body.reasoning, { effort: "medium" });
    assert.equal(body.input[0].content[0].type, "input_text");
    assert.match(body.input[0].content[0].text, /v8\.14/);
    assert.deepEqual(
      body.input[0].content.slice(1).map((part) => part.type),
      ["input_image", "input_image", "input_image"]
    );
    assert.ok(body.input[0].content.slice(1).every((part) => part.detail === "high"));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("request body records the provider-supported detail mode", () => {
  const { directory, imagePaths } = createPageImages(1);
  try {
    const body = buildAnswerRequestBody(createConfig().providers[0], {
      prompt: "audit",
      imagePaths,
      visualDetailMode: "original",
      maxOutputTokens: 4000
    });

    assert.equal(body.input[0].content[1].detail, "high");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("chat completions request keeps page order and uses multimodal content", () => {
  const { directory, imagePaths } = createPageImages(2);
  try {
    const provider = createConfig("chat_completions").providers[0];
    const body = buildAnswerRequestBody(provider, {
      prompt: "Generate answer Markdown.",
      imagePaths,
      visualDetailMode: "high",
      maxOutputTokens: 12000
    });

    assert.equal(body.max_tokens, 12000);
    assert.equal(body.reasoning_effort, "medium");
    assert.deepEqual(
      body.messages[0].content.map((part) => part.type),
      ["text", "image_url", "image_url"]
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("reference review retries a retryable primary failure and returns fallback Markdown", async () => {
  const { directory, imagePaths } = createPageImages(1);
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    if (String(url).startsWith("https://primary.example.com")) {
      return new Response(JSON.stringify({ error: "temporary" }), { status: 502 });
    }
    return new Response(JSON.stringify({ output_text: "```markdown\n# 参考答案\n\n1. B\n```" }), { status: 200 });
  };

  try {
    const result = await requestAnswerWithFailover(createConfig(), {
      allowCloudEgress: true,
      provider: "all",
      mode: "reference_review",
      sourcePageCount: 8,
      referencePageCount: 8,
      prompt: "v8.14",
      imagePaths,
      visualDetailMode: "high",
      maxOutputTokens: 16000,
      timeoutMs: 1000
    });

    assert.equal(result.ok, true);
    assert.equal(result.provider, "fallback_1");
    assert.equal(result.reasoningEffort, "medium");
    assert.equal(result.answerMarkdown, "# 参考答案\n\n1. B");
    assert.equal(calls.length, 2);
    assert.deepEqual(result.routing.orderedRoles, ["primary", "fallback_1"]);
  } finally {
    globalThis.fetch = originalFetch;
    rmSync(directory, { recursive: true, force: true });
  }
});

test("reference review tries every configured AI tier in provider order", async () => {
  const { directory, imagePaths } = createPageImages(1);
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (_url, request) => {
    const body = JSON.parse(request.body);
    calls.push({ model: body.model, effort: body.reasoning.effort });
    if (calls.length < 4) {
      return new Response(JSON.stringify({ error: "temporary" }), { status: 503 });
    }
    return new Response(JSON.stringify({ output_text: "# 参考答案\n\n1. B" }), { status: 200 });
  };

  const providers = [
    { role: "fallback_3", visionModel: "gpt-5.6-terra", reasoningEffort: "high" },
    { role: "primary", visionModel: "gpt-5.6-sol", reasoningEffort: "xhigh" },
    { role: "fallback_2", visionModel: "gpt-5.6-terra", reasoningEffort: "xhigh" },
    { role: "fallback_1", visionModel: "gpt-5.6-sol", reasoningEffort: "medium" }
  ].map((provider) => ({
    lane: "ai",
    baseUrl: "https://primary.example.com/v1",
    apiKey: "key",
    visionSurface: "responses",
    ...provider
  }));

  try {
    const result = await requestAnswerWithFailover({ cloudEgressEnabled: true, providers }, {
      allowCloudEgress: true,
      provider: "all",
      mode: "reference_review",
      sourcePageCount: 8,
      referencePageCount: 8,
      prompt: "four tiers",
      imagePaths,
      visualDetailMode: "high",
      maxOutputTokens: 1000,
      timeoutMs: 1000
    });

    assert.equal(result.ok, true);
    assert.equal(result.provider, "fallback_3");
    assert.deepEqual(calls, [
      { model: "gpt-5.6-sol", effort: "xhigh" },
      { model: "gpt-5.6-sol", effort: "medium" },
      { model: "gpt-5.6-terra", effort: "xhigh" },
      { model: "gpt-5.6-terra", effort: "high" }
    ]);
  } finally {
    globalThis.fetch = originalFetch;
    rmSync(directory, { recursive: true, force: true });
  }
});

test("failover reuses pre-encoded page images instead of reading them for every provider", async () => {
  const { directory, imagePaths } = createPageImages(1);
  const originalFetch = globalThis.fetch;
  let callCount = 0;
  globalThis.fetch = async () => {
    callCount += 1;
    if (callCount === 1) {
      unlinkSync(imagePaths[0]);
      return new Response(JSON.stringify({ error: "temporary" }), { status: 503 });
    }
    return new Response(JSON.stringify({ output_text: "# 参考答案\n\n1. B" }), { status: 200 });
  };

  try {
    const result = await requestAnswerWithFailover(createConfig(), {
      allowCloudEgress: true,
      provider: "all",
      mode: "reference_review",
      prompt: "reuse images",
      imagePaths,
      visualDetailMode: "high",
      maxOutputTokens: 1000,
      timeoutMs: 1000
    });

    assert.equal(result.ok, true);
    assert.equal(result.provider, "fallback_1");
    assert.equal(callCount, 2);
  } finally {
    globalThis.fetch = originalFetch;
    rmSync(directory, { recursive: true, force: true });
  }
});

test("blind solving fails closed after a retryable sol/xhigh failure", async () => {
  const { directory, imagePaths } = createPageImages(1);
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (_url, request) => {
    const body = JSON.parse(request.body);
    calls.push({ model: body.model, effort: body.reasoning?.effort });
    return new Response(JSON.stringify({ error: "temporary" }), { status: 503 });
  };
  const providers = [
    { lane: "ai", role: "primary", baseUrl: "https://primary.example.com/v1", apiKey: "key", visionSurface: "responses", visionModel: "gpt-5.6-sol", reasoningEffort: "xhigh" },
    { lane: "ai", role: "fallback_1", baseUrl: "https://primary.example.com/v1", apiKey: "key", visionSurface: "responses", visionModel: "gpt-5.6-sol", reasoningEffort: "medium" }
  ];
  try {
    const result = await requestAnswerWithFailover({ cloudEgressEnabled: true, providers }, {
      allowCloudEgress: true,
      provider: "all",
      mode: "blind_generation",
      sourcePageCount: 1,
      prompt: "fixed solving tier",
      imagePaths,
      visualDetailMode: "high",
      maxOutputTokens: 1000,
      timeoutMs: 1000
    });
    assert.equal(result.ok, false);
    assert.deepEqual(calls, [{ model: "gpt-5.6-sol", effort: "xhigh" }]);
    assert.deepEqual(result.routing.orderedRoles, ["primary"]);
  } finally {
    globalThis.fetch = originalFetch;
    rmSync(directory, { recursive: true, force: true });
  }
});

test("answer request remains blocked unless config and command both allow cloud egress", async () => {
  const { directory, imagePaths } = createPageImages(1);
  try {
    await assert.rejects(
      requestAnswerWithFailover(
        { ...createConfig(), cloudEgressEnabled: false },
        {
          allowCloudEgress: true,
          prompt: "v8.14",
          imagePaths,
          visualDetailMode: "high",
          maxOutputTokens: 16000,
          timeoutMs: 1000
        }
      ),
      /Live request blocked/
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("answer request refuses to overwrite one of its inputs", () => {
  const { directory, imagePaths } = createPageImages(1);
  const promptPath = path.join(directory, "spec.md");
  writeFileSync(promptPath, "spec", "utf8");
  try {
    const result = spawnSync(process.execPath, [
      fileURLToPath(new URL("./answer-request.mjs", import.meta.url)),
      "--prompt-file", promptPath,
      "--image", imagePaths[0],
      "--output", promptPath
    ], {
      cwd: directory,
      encoding: "utf8"
    });

    assert.notEqual(result.status, 0);
    assert.match(`${result.stdout}\n${result.stderr}`, /must not overwrite/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("answer request refuses a summary path that overwrites an input or output", () => {
  const { directory, imagePaths } = createPageImages(1);
  const promptPath = path.join(directory, "spec.md");
  const outputPath = path.join(directory, "answer.md");
  writeFileSync(promptPath, "spec", "utf8");
  try {
    for (const summaryPath of [promptPath, outputPath]) {
      const result = spawnSync(process.execPath, [
        fileURLToPath(new URL("./answer-request.mjs", import.meta.url)),
        "--prompt-file", promptPath,
        "--image", imagePaths[0],
        "--output", outputPath,
        "--summary-out", summaryPath
      ], {
        cwd: directory,
        encoding: "utf8"
      });

      assert.notEqual(result.status, 0);
      assert.match(`${result.stdout}\n${result.stderr}`, /--summary-out must not overwrite/);
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("answer request preserves the safe fetch cause in retry diagnostics", async () => {
  const { directory, imagePaths } = createPageImages(1);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    const error = new TypeError("fetch failed");
    error.cause = Object.assign(new Error("Connect Timeout Error"), {
      code: "UND_ERR_CONNECT_TIMEOUT"
    });
    throw error;
  };

  try {
    const result = await requestAnswerWithFailover(createConfig(), {
      allowCloudEgress: true,
      provider: "primary",
      mode: "reference_review",
      sourcePageCount: 1,
      referencePageCount: 1,
      prompt: "v8.14",
      imagePaths,
      visualDetailMode: "high",
      maxOutputTokens: 16000,
      timeoutMs: 1000
    });

    assert.equal(result.ok, false);
    assert.match(result.attempts[0].error, /UND_ERR_CONNECT_TIMEOUT/);
    assert.match(result.attempts[0].error, /Connect Timeout Error/);
  } finally {
    globalThis.fetch = originalFetch;
    rmSync(directory, { recursive: true, force: true });
  }
});

test("Markdown normalization removes only one outer code fence", () => {
  assert.equal(
    normalizeAnswerMarkdown("```md\r\n# 答案\r\n\r\n$P=UI$\r\n```\r\n"),
    "# 答案\n\n$P=UI$"
  );
  assert.equal(normalizeAnswerMarkdown("# 答案\n\n正文"), "# 答案\n\n正文");
});

test("Markdown normalization removes model commentary before the answer heading", () => {
  assert.equal(
    normalizeAnswerMarkdown("我正在逐题核对仪表图，避免按惯例作答。# 物理试卷参考答案\n\n1—5：B、C、C、B、C"),
    "# 物理试卷参考答案\n\n1—5：B、C、C、B、C"
  );
});

test("Markdown normalization removes math fences around simple point-label lists", () => {
  assert.equal(
    normalizeAnswerMarkdown("13. 作 $A、B$ 关于平面镜的对称点 $A'、B'$。"),
    "13. 作 A、B 关于平面镜的对称点 A'、B'。"
  );
});

test("reference review deterministically overwrites the two ten-question choice lines", () => {
  const reviewed = applyReferenceChoiceAnswers(
    "# 物理试卷参考答案\n\n1—5：C、B、D、D、D\n6—10：C、B、C、D、D",
    "第1页 BAADA CBBDD 11.（1）"
  );

  assert.equal(reviewed.applied, true);
  assert.match(reviewed.markdown, /1—5：B、A、A、D、A/);
  assert.match(reviewed.markdown, /6—10：C、B、B、D、D/);
});

test("reference review extracts numbered choices from an explained answer PDF text layer", () => {
  const referenceText = [
    "1. 光导纤维原理（ ）A.折射 B.反射【答案】B【解析】利用反射。",
    "2. 鸟鸣和猫叫（ ）【答案】C【解析】鸟鸣频率高。",
    "3. 能源分类（ ）【答案】C【解析】风能、水能。",
    "4. 吸盘所受摩擦力（ ）【答案】B【解析】方向向上。",
    "5. 回南天玻璃出水（ ）【答案】C【解析】液化放热。",
    "6. 潜水艇掉深（ ）【答案】A【解析】浮力变小。",
    "7. 物态变化（ ）【答案】D【解析】略。",
    "8. 家庭电路故障（ ）【答案】D【解析】略。",
    "9. 地磅电路（ ）【答案】A【解析】电压表示数变大。",
    "10. 水塔压强（ ）【答案】D【解析】略。",
    "11. 非选择题"
  ].join("\n");
  const reviewed = applyReferenceChoiceAnswers(
    "# 物理试卷参考答案\n\n1—5：A、A、A、A、A\n6—10：B、B、B、B、B",
    referenceText
  );

  assert.equal(reviewed.applied, true);
  assert.equal(reviewed.answers, "BCCBCADDAD");
  assert.match(reviewed.markdown, /1—5：B、C、C、B、C/);
  assert.match(reviewed.markdown, /6—10：A、D、D、A、D/);
});
