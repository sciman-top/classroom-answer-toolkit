import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  buildPrompt,
  buildAnswerRequestBody,
  applyReferenceChoiceAnswers,
  normalizeAnswerMarkdown,
  requestAnswerWithFailover
} from "./answer-request.mjs";

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

test("answer request retries a retryable primary failure and returns fallback Markdown", async () => {
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

test("Markdown normalization removes only one outer code fence", () => {
  assert.equal(
    normalizeAnswerMarkdown("```md\r\n# 答案\r\n\r\n$P=UI$\r\n```\r\n"),
    "# 答案\n\n$P=UI$"
  );
  assert.equal(normalizeAnswerMarkdown("# 答案\n\n正文"), "# 答案\n\n正文");
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
