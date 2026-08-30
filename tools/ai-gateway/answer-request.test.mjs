import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { existsSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  buildPrompt,
  buildIndexedChoiceCandidate,
  buildAnswerRequestBody,
  applyReferenceChoiceAnswers,
  applySemanticChoiceFindings,
  parseSemanticChoiceFindings,
  buildAnswerRoutingSummary,
  normalizeAnswerMarkdown,
  resolveAnswerTransportPolicy,
  resolveDefaultPromptPath,
  resolveImageEvidenceLabels,
  selectAnswerRoute,
  requestAnswerWithFailover
} from "./answer-request.mjs";
import {
  normalizeConfig,
  runInExecutionSlot,
  runLiveTextProbes,
  validateConfig
} from "./validate-config.mjs";
import { acquirePresetHealthLock, presetOrderForRequest } from "./gateway-runtime.mjs";

test("answer transport keeps the application timeout authoritative", () => {
  assert.deepEqual(resolveAnswerTransportPolicy(600000, ""), {
    applicationTimeoutMs: 600000,
    headersTimeoutMs: 605000,
    bodyTimeoutMs: 605000,
    environmentProxyEnabled: false
  });
  assert.deepEqual(resolveAnswerTransportPolicy(600000, "--trace-warnings --use-env-proxy"), {
    applicationTimeoutMs: 600000,
    headersTimeoutMs: 605000,
    bodyTimeoutMs: 605000,
    environmentProxyEnabled: true
  });
});

test("application timeout aborts before the longer transport timeout", async () => {
  const { directory, imagePaths } = createPageImages(1);
  const originalNodeOptions = process.env.NODE_OPTIONS;
  delete process.env.NODE_OPTIONS;
  const server = createServer((_request, response) => {
    setTimeout(() => {
      if (!response.destroyed) {
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ output_text: "# 参考答案\n\n1. B" }));
      }
    }, 250);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  const provider = {
    lane: "ai",
    role: "primary",
    baseUrl: `http://127.0.0.1:${address.port}`,
    apiKey: "key",
    visionSurface: "responses",
    visionModel: "gpt-5.6-sol",
    reasoningEffort: "high"
  };

  try {
    const result = await requestAnswerWithFailover({ cloudEgressEnabled: true, providers: [provider], runtimeDirectory: path.join(directory, ".gateway-runtime") }, {
      allowCloudEgress: true,
      provider: "primary",
      mode: "blind_generation",
      prompt: "timeout precedence",
      imagePaths,
      visualDetailMode: "original",
      maxOutputTokens: 1000,
      timeoutMs: 60
    });

    assert.equal(result.ok, false);
    assert.match(result.attempts[0].error, /abort/i);
    assert.ok(result.attempts[0].durationMs < 500);
    assert.deepEqual(result.attempts[0].transport, {
      applicationTimeoutMs: 60,
      headersTimeoutMs: 5060,
      bodyTimeoutMs: 5060,
      environmentProxyEnabled: false
    });
  } finally {
    if (originalNodeOptions === undefined) {
      delete process.env.NODE_OPTIONS;
    } else {
      process.env.NODE_OPTIONS = originalNodeOptions;
    }
    server.close();
    await once(server, "close");
    rmSync(directory, { recursive: true, force: true });
  }
});

test("live task prompt requires complete subquestion coverage and independent visual checks", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "classroom-answer-prompt-"));
  const promptPath = path.join(directory, "spec.md");
  try {
    writeFileSync(promptPath, "v8.14 production specification", "utf8");
    const prompt = buildPrompt(promptPath);

    assert.match(prompt, /逐题覆盖清单/);
    assert.match(prompt, /括号小问、圈号小问和每个待填空/);
    assert.match(prompt, /量程、分度值和指针位置/);
    assert.match(prompt, /结构化证据链/);
    assert.match(prompt, /不得用 \$R=U\/I\$ 反推读数/);
    assert.match(prompt, /小问明确引用的目标图/);
    assert.match(prompt, /禁止借用同题另一图的接线或量程/);
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
    assert.match(prompt, /参考答案是答案取值的默认权威来源/);
    assert.match(prompt, /参考答案不得静默覆盖原卷可直接复算的冲突/);
    assert.match(prompt, /## 疑点清单/);
    assert.match(prompt, /待人工复核/);
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
    CLASSROOM_TOOLKIT_AI_PRIMARY_REASONING_EFFORT: "high",
    CLASSROOM_TOOLKIT_AI_PRIMARY_EXECUTION_SLOT: "1",
    CLASSROOM_TOOLKIT_AI_FALLBACK_1_TEXT_MODEL: "gpt-5.6-sol",
    CLASSROOM_TOOLKIT_AI_FALLBACK_1_REASONING_EFFORT: "medium",
    CLASSROOM_TOOLKIT_AI_FALLBACK_1_EXECUTION_SLOT: "2",
    CLASSROOM_TOOLKIT_AI_FALLBACK_1_INHERIT_PRIMARY: "true",
    CLASSROOM_TOOLKIT_AI_FALLBACK_1_BASE_URL: "https://stale.example.com/v1",
    CLASSROOM_TOOLKIT_AI_FALLBACK_1_API_KEY: "stale-key",
    CLASSROOM_TOOLKIT_AI_FALLBACK_2_TEXT_MODEL: "gpt-5.6-sol",
    CLASSROOM_TOOLKIT_AI_FALLBACK_2_REASONING_EFFORT: "low",
    CLASSROOM_TOOLKIT_AI_FALLBACK_2_EXECUTION_SLOT: "3",
    CLASSROOM_TOOLKIT_AI_FALLBACK_3_TEXT_MODEL: "gpt-5.6-terra",
    CLASSROOM_TOOLKIT_AI_FALLBACK_3_REASONING_EFFORT: "xhigh",
    CLASSROOM_TOOLKIT_AI_FALLBACK_3_EXECUTION_SLOT: "1",
    CLASSROOM_TOOLKIT_AI_FALLBACK_4_TEXT_MODEL: "gpt-5.6-terra",
    CLASSROOM_TOOLKIT_AI_FALLBACK_4_REASONING_EFFORT: "high",
    CLASSROOM_TOOLKIT_AI_FALLBACK_4_EXECUTION_SLOT: "4",
    CLASSROOM_TOOLKIT_AI_FALLBACK_5_TEXT_MODEL: "gpt-5.6-terra",
    CLASSROOM_TOOLKIT_AI_FALLBACK_5_REASONING_EFFORT: "medium",
    CLASSROOM_TOOLKIT_AI_FALLBACK_5_EXECUTION_SLOT: "5",
    CLASSROOM_TOOLKIT_AI_FALLBACK_6_TEXT_MODEL: "gpt-5.6-luna",
    CLASSROOM_TOOLKIT_AI_FALLBACK_6_REASONING_EFFORT: "xhigh",
    CLASSROOM_TOOLKIT_AI_FALLBACK_6_EXECUTION_SLOT: "1",
    CLASSROOM_TOOLKIT_AI_FALLBACK_7_TEXT_MODEL: "gpt-5.6-luna",
    CLASSROOM_TOOLKIT_AI_FALLBACK_7_REASONING_EFFORT: "high",
    CLASSROOM_TOOLKIT_AI_FALLBACK_7_EXECUTION_SLOT: "4",
    CLASSROOM_TOOLKIT_AI_FALLBACK_8_TEXT_MODEL: "gpt-5.6-luna",
    CLASSROOM_TOOLKIT_AI_FALLBACK_8_REASONING_EFFORT: "medium",
    CLASSROOM_TOOLKIT_AI_FALLBACK_8_EXECUTION_SLOT: "5"
  });

  const aiProviders = config.providers.filter((provider) => provider.lane === "ai");
  assert.deepEqual(
    aiProviders.map(({ role, textModel, reasoningEffort }) => ({ role, textModel, reasoningEffort })),
    [
      { role: "primary", textModel: "gpt-5.6-sol", reasoningEffort: "high" },
      { role: "fallback_1", textModel: "gpt-5.6-sol", reasoningEffort: "medium" },
      { role: "fallback_2", textModel: "gpt-5.6-sol", reasoningEffort: "low" },
      { role: "fallback_3", textModel: "gpt-5.6-terra", reasoningEffort: "xhigh" },
      { role: "fallback_4", textModel: "gpt-5.6-terra", reasoningEffort: "high" },
      { role: "fallback_5", textModel: "gpt-5.6-terra", reasoningEffort: "medium" },
      { role: "fallback_6", textModel: "gpt-5.6-luna", reasoningEffort: "xhigh" },
      { role: "fallback_7", textModel: "gpt-5.6-luna", reasoningEffort: "high" },
      { role: "fallback_8", textModel: "gpt-5.6-luna", reasoningEffort: "medium" }
    ]
  );
  assert.ok(aiProviders.slice(1).every((provider) => provider.baseUrl === aiProviders[0].baseUrl));
  assert.ok(aiProviders.slice(1).every((provider) => provider.apiKey === aiProviders[0].apiKey));
  assert.ok(aiProviders.every((provider) => provider.visionModel === provider.textModel));
  assert.equal(config.executionSlotCount, 5);
  assert.deepEqual(aiProviders.map(({ executionSlot }) => executionSlot), [1, 2, 3, 1, 4, 5, 1, 4, 5]);
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
    assert.match(findingsPrompt, /电流进入端、离开端/);
    assert.match(findingsPrompt, /N→S磁场方向/);
    assert.match(findingsPrompt, /题内校准图/);
    assert.match(findingsPrompt, /仪表证据链/);
    assert.match(findingsPrompt, /另一图的接线柱与目标图的指针拼接/);
    assert.match(findingsPrompt, /不得写“建议保留候选”/);
    assert.match(findingsPrompt, /端子写“不适用\/未显示”/);
    assert.match(findingsPrompt, /另一幅电路图/);
    assert.match(findingsPrompt, /直接视觉不一致/);
    assert.match(findingsPrompt, /语义复算分歧，仅供参考复核/);
    assert.match(findingsPrompt, /选择字母或定性方向本身不是直接视觉事实/);
    assert.match(findingsPrompt, /左手定则、受力平衡、惯性、机械能守恒/);
    assert.match(findingsPrompt, /n=2/);
    assert.match(mergePrompt, /视觉审计合并任务/);
    assert.match(mergePrompt, /n 应为 3/);
    assert.match(mergePrompt, /证据不足.*保留候选原文/);
    assert.match(mergePrompt, /只应用明确标为【直接视觉不一致】/);
    assert.match(mergePrompt, /语义复算分歧，仅供参考复核/);
    assert.match(mergePrompt, /即使报告写了计算链或“建议修正”.*禁止在本阶段覆盖候选/);
    assert.match(mergePrompt, /仅返回修正后的完整 Markdown/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("preset routes stay model-family closed and order preset failover", () => {
  const providers = [
    { lane: "ai", role: "fallback_8", visionModel: "gpt-5.6-luna", reasoningEffort: "medium" },
    { lane: "ai", role: "fallback_7", visionModel: "gpt-5.6-luna", reasoningEffort: "high" },
    { lane: "ai", role: "fallback_6", visionModel: "gpt-5.6-luna", reasoningEffort: "xhigh" },
    { lane: "ai", role: "fallback_5", visionModel: "gpt-5.6-terra", reasoningEffort: "medium" },
    { lane: "ai", role: "fallback_4", visionModel: "gpt-5.6-terra", reasoningEffort: "high" },
    { lane: "ai", role: "fallback_3", visionModel: "gpt-5.6-terra", reasoningEffort: "xhigh" },
    { lane: "ai", role: "fallback_2", visionModel: "gpt-5.6-sol", reasoningEffort: "low" },
    { lane: "ai", role: "fallback_1", visionModel: "gpt-5.6-sol", reasoningEffort: "medium" },
    { lane: "ai", role: "primary", visionModel: "gpt-5.6-sol", reasoningEffort: "high" },
  ];
  const solRoute = selectAnswerRoute({ providers }, "blind_generation", "all");
  assert.equal(solRoute.qualityProfile, "sol-high");
  assert.equal(solRoute.requestedPreset, "sol");
  assert.equal(solRoute.activePreset, "sol");
  assert.deepEqual(solRoute.orderedPresets, ["sol", "terra", "luna"]);
  assert.deepEqual(solRoute.providers.map(({ role, visionModel }) => ({ role, visionModel })), [
    { role: "primary", visionModel: "gpt-5.6-sol" }
  ]);
  assert.deepEqual(solRoute.presetRoutes.map(({ preset, qualityProfile, orderedRoles }) => ({ preset, qualityProfile, orderedRoles })), [
    { preset: "sol", qualityProfile: "sol-high", orderedRoles: ["primary"] },
    { preset: "terra", qualityProfile: "terra-xhigh", orderedRoles: ["fallback_3"] },
    { preset: "luna", qualityProfile: "luna-xhigh", orderedRoles: ["fallback_6"] }
  ]);

  const terraRoute = selectAnswerRoute({ providers }, "visual_audit_findings", "all", "terra-xhigh");
  assert.deepEqual(terraRoute.orderedPresets, ["terra", "sol", "luna"]);
  assert.deepEqual(terraRoute.providers.map(({ role, visionModel }) => ({ role, visionModel })), [
    { role: "fallback_3", visionModel: "gpt-5.6-terra" }
  ]);
  assert.deepEqual(terraRoute.presetRoutes.map(({ preset, qualityProfile }) => ({ preset, qualityProfile })), [
    { preset: "terra", qualityProfile: "terra-xhigh" },
    { preset: "sol", qualityProfile: "sol-high" },
    { preset: "luna", qualityProfile: "luna-xhigh" }
  ]);

  const expectedTierRoutes = [
    ["sol-medium", ["sol-medium", "terra-high", "luna-high"]],
    ["terra-high", ["terra-high", "sol-medium", "luna-high"]],
    ["luna-high", ["luna-high", "sol-medium", "terra-high"]]
  ];
  for (const [profile, expectedProfiles] of expectedTierRoutes) {
    const route = selectAnswerRoute({ providers }, "reference_review", "all", profile);
    assert.deepEqual(route.orderedQualityProfiles, expectedProfiles, `${profile} must preserve its relative tier across presets`);
  }
});

test("each preset binds all five slots to only its own three profiles", () => {
  const config = normalizeConfig({
    CLASSROOM_TOOLKIT_CLOUD_EGRESS_ENABLED: "true",
    CLASSROOM_TOOLKIT_AI_EXECUTION_SLOT_COUNT: "5",
    CLASSROOM_TOOLKIT_AI_PRIMARY_BASE_URL: "https://primary.example.com/v1",
    CLASSROOM_TOOLKIT_AI_PRIMARY_API_KEY: "primary-key",
    CLASSROOM_TOOLKIT_AI_PRIMARY_TEXT_MODEL: "gpt-5.6-sol",
    CLASSROOM_TOOLKIT_AI_PRIMARY_VISION_MODEL: "gpt-5.6-sol",
    CLASSROOM_TOOLKIT_AI_PRIMARY_REASONING_EFFORT: "high",
    CLASSROOM_TOOLKIT_AI_PRESET_SOL_SLOT_1: "sol-high",
    CLASSROOM_TOOLKIT_AI_PRESET_SOL_SLOT_2: "sol-high",
    CLASSROOM_TOOLKIT_AI_PRESET_SOL_SLOT_3: "sol-medium",
    CLASSROOM_TOOLKIT_AI_PRESET_SOL_SLOT_4: "sol-low",
    CLASSROOM_TOOLKIT_AI_PRESET_SOL_SLOT_5: "sol-medium",
    CLASSROOM_TOOLKIT_AI_PRESET_TERRA_SLOT_1: "terra-xhigh",
    CLASSROOM_TOOLKIT_AI_PRESET_TERRA_SLOT_2: "terra-xhigh",
    CLASSROOM_TOOLKIT_AI_PRESET_TERRA_SLOT_3: "terra-high",
    CLASSROOM_TOOLKIT_AI_PRESET_TERRA_SLOT_4: "terra-medium",
    CLASSROOM_TOOLKIT_AI_PRESET_TERRA_SLOT_5: "terra-high",
    CLASSROOM_TOOLKIT_AI_PRESET_LUNA_SLOT_1: "luna-xhigh",
    CLASSROOM_TOOLKIT_AI_PRESET_LUNA_SLOT_2: "luna-xhigh",
    CLASSROOM_TOOLKIT_AI_PRESET_LUNA_SLOT_3: "luna-high",
    CLASSROOM_TOOLKIT_AI_PRESET_LUNA_SLOT_4: "luna-medium",
    CLASSROOM_TOOLKIT_AI_PRESET_LUNA_SLOT_5: "luna-high"
  });

  const route = selectAnswerRoute(config, "blind_generation", "all", "sol-medium");
  assert.equal(config.providers.length, 1);
  assert.equal(config.presetSlotsExplicit, true);
  assert.deepEqual(config.presetSlotBindings.sol, ["sol-high", "sol-high", "sol-medium", "sol-low", "sol-medium"]);
  assert.deepEqual(config.presetSlotBindings.terra, ["terra-xhigh", "terra-xhigh", "terra-high", "terra-medium", "terra-high"]);
  assert.deepEqual(config.presetSlotBindings.luna, ["luna-xhigh", "luna-xhigh", "luna-high", "luna-medium", "luna-high"]);
  assert.deepEqual(route.orderedQualityProfiles, ["sol-medium", "terra-high", "luna-high"]);
  assert.deepEqual(route.orderedExecutionSlots, [3, 5]);
  assert.deepEqual(route.providers.map(({ role, visionModel, reasoningEffort, executionSlot }) => ({
    role, visionModel, reasoningEffort, executionSlot
  })), [
    { role: "primary", visionModel: "gpt-5.6-sol", reasoningEffort: "medium", executionSlot: 3 }
  ]);
  assert.ok(route.presetRoutes.every((presetRoute) => presetRoute.providers.every((provider) => provider.preset === presetRoute.preset)));

  const invalidConfig = {
    ...config,
    presetSlotBindings: {
      ...config.presetSlotBindings,
      sol: ["sol-high", "terra-xhigh", "sol-medium", "sol-low", "sol-medium"]
    }
  };
  const validation = validateConfig(invalidConfig, { allowMissingSecrets: false }, []);
  assert.ok(validation.errors.some((error) => error.includes("sol slot 2") && error.includes("sol-only")));
});

test("execution slots serialize shared lanes and allow independent lanes to overlap", async () => {
  const { directory, imagePaths } = createPageImages(1);
  const originalFetch = globalThis.fetch;
  let active = 0;
  let maxActive = 0;
  globalThis.fetch = async () => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    await new Promise((resolve) => setTimeout(resolve, 30));
    active -= 1;
    return new Response(JSON.stringify({ output_text: "# 参考答案\n\n1. B" }), { status: 200 });
  };

  const config = {
    cloudEgressEnabled: true,
    runtimeDirectory: path.join(directory, ".gateway-runtime"),
    executionSlotCount: 5,
    providers: [
      {
        lane: "ai",
        role: "primary",
        baseUrl: "https://primary.example.com/v1",
        apiKey: "key",
        visionSurface: "responses",
        visionModel: "gpt-5.6-sol",
        reasoningEffort: "high",
        executionSlot: 1
      },
      {
        lane: "ai",
        role: "fallback_1",
        baseUrl: "https://primary.example.com/v1",
        apiKey: "key",
        visionSurface: "responses",
        visionModel: "gpt-5.6-sol",
        reasoningEffort: "medium",
        executionSlot: 2
      }
    ]
  };
  const requestOptions = {
    allowCloudEgress: true,
    provider: "all",
    mode: "blind_generation",
    prompt: "slot scheduling",
    imagePaths,
    visualDetailMode: "high",
    maxOutputTokens: 1000,
    timeoutMs: 1000
  };

  try {
    maxActive = 0;
    const sameSlot = await Promise.all([
      requestAnswerWithFailover(config, { ...requestOptions, qualityProfile: "sol-high" }),
      requestAnswerWithFailover(config, { ...requestOptions, qualityProfile: "sol-high" })
    ]);
    assert.ok(sameSlot.every((result) => result.ok));
    assert.equal(maxActive, 1);
    assert.ok(sameSlot.every((result) => result.routing.executionSlot === 1));

    maxActive = 0;
    const differentSlots = await Promise.all([
      requestAnswerWithFailover(config, { ...requestOptions, qualityProfile: "sol-high" }),
      requestAnswerWithFailover(config, { ...requestOptions, qualityProfile: "sol-medium" })
    ]);
    assert.ok(differentSlots.every((result) => result.ok));
    assert.equal(maxActive, 2);
    assert.deepEqual(differentSlots.map((result) => result.routing.executionSlot).sort(), [1, 2]);
  } finally {
    globalThis.fetch = originalFetch;
    rmSync(directory, { recursive: true, force: true });
  }
});

test("repeated preset bindings let one quality tier occupy its two assigned slots", async () => {
  const { directory, imagePaths } = createPageImages(1);
  const originalFetch = globalThis.fetch;
  let active = 0;
  let maxActive = 0;
  globalThis.fetch = async () => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    await new Promise((resolve) => setTimeout(resolve, 30));
    active -= 1;
    return new Response(JSON.stringify({ output_text: "# 参考答案\n\n1. B" }), { status: 200 });
  };

  const config = normalizeConfig({
    CLASSROOM_TOOLKIT_CLOUD_EGRESS_ENABLED: "true",
    CLASSROOM_TOOLKIT_AI_PRIMARY_BASE_URL: "https://primary.example.com/v1",
    CLASSROOM_TOOLKIT_AI_PRIMARY_API_KEY: "key",
    CLASSROOM_TOOLKIT_AI_PRIMARY_TEXT_MODEL: "gpt-5.6-sol",
    CLASSROOM_TOOLKIT_AI_PRIMARY_VISION_MODEL: "gpt-5.6-sol",
    CLASSROOM_TOOLKIT_AI_PRIMARY_REASONING_EFFORT: "high",
    CLASSROOM_TOOLKIT_AI_PRESET_SOL_SLOT_1: "sol-high",
    CLASSROOM_TOOLKIT_AI_PRESET_SOL_SLOT_2: "sol-high",
    CLASSROOM_TOOLKIT_AI_PRESET_SOL_SLOT_3: "sol-medium",
    CLASSROOM_TOOLKIT_AI_PRESET_SOL_SLOT_4: "sol-medium",
    CLASSROOM_TOOLKIT_AI_PRESET_SOL_SLOT_5: "sol-low",
    CLASSROOM_TOOLKIT_AI_PRESET_TERRA_SLOT_1: "terra-xhigh",
    CLASSROOM_TOOLKIT_AI_PRESET_TERRA_SLOT_2: "terra-xhigh",
    CLASSROOM_TOOLKIT_AI_PRESET_TERRA_SLOT_3: "terra-high",
    CLASSROOM_TOOLKIT_AI_PRESET_TERRA_SLOT_4: "terra-high",
    CLASSROOM_TOOLKIT_AI_PRESET_TERRA_SLOT_5: "terra-medium",
    CLASSROOM_TOOLKIT_AI_PRESET_LUNA_SLOT_1: "luna-xhigh",
    CLASSROOM_TOOLKIT_AI_PRESET_LUNA_SLOT_2: "luna-xhigh",
    CLASSROOM_TOOLKIT_AI_PRESET_LUNA_SLOT_3: "luna-high",
    CLASSROOM_TOOLKIT_AI_PRESET_LUNA_SLOT_4: "luna-high",
    CLASSROOM_TOOLKIT_AI_PRESET_LUNA_SLOT_5: "luna-medium"
  });
  config.runtimeDirectory = path.join(directory, ".gateway-runtime");
  const requestOptions = {
    allowCloudEgress: true,
    provider: "all",
    mode: "blind_generation",
    qualityProfile: "sol-high",
    prompt: "repeated slot scheduling",
    imagePaths,
    visualDetailMode: "high",
    maxOutputTokens: 1000,
    timeoutMs: 1000
  };

  try {
    const results = await Promise.all([
      requestAnswerWithFailover(config, requestOptions),
      requestAnswerWithFailover(config, requestOptions)
    ]);
    assert.ok(results.every((result) => result.ok));
    assert.equal(maxActive, 2);
    assert.deepEqual(results.map((result) => result.routing.executionSlot).sort(), [1, 2]);
  } finally {
    globalThis.fetch = originalFetch;
    rmSync(directory, { recursive: true, force: true });
  }
});

function spawnLeaseChild(runtimeDirectory, slots, holdMs, eventsPath) {
  const runtimeModuleUrl = new URL("./gateway-runtime.mjs", import.meta.url).href;
  const source = [
    'import { appendFileSync } from "node:fs";',
    `import { acquireSharedExecutionSlot } from ${JSON.stringify(runtimeModuleUrl)};`,
    'const [runtimeDirectory, slotsText, holdMsText, eventsPath] = process.argv.slice(1);',
    'const lease = await acquireSharedExecutionSlot({ runtimeDirectory }, slotsText.split(",").map(Number), 5000);',
    'if (!lease) { process.exitCode = 2; } else {',
    '  appendFileSync(eventsPath, JSON.stringify({ event: "acquire", slot: lease.slot }) + "\\n");',
    '  await new Promise((resolve) => setTimeout(resolve, Number(holdMsText)));',
    '  appendFileSync(eventsPath, JSON.stringify({ event: "release", slot: lease.slot }) + "\\n");',
    '  lease.release();',
    '}'
  ].join("\n");
  const child = spawn(process.execPath, ["--input-type=module", "--eval", source, runtimeDirectory, slots.join(","), String(holdMs), eventsPath], {
    stdio: "ignore"
  });
  return once(child, "exit").then(([code]) => {
    assert.equal(code, 0);
  });
}

function spawnPresetHealthLockChild(runtimeDirectory, holdMs, eventsPath) {
  const runtimeModuleUrl = new URL("./gateway-runtime.mjs", import.meta.url).href;
  const source = [
    'import { appendFileSync } from "node:fs";',
    `import { acquirePresetHealthLock } from ${JSON.stringify(runtimeModuleUrl)};`,
    'const [runtimeDirectory, holdMsText, eventsPath] = process.argv.slice(1);',
    'const lock = acquirePresetHealthLock({ runtimeDirectory }, 5000);',
    'if (!lock) { process.exitCode = 2; } else {',
    '  appendFileSync(eventsPath, JSON.stringify({ event: "acquire" }) + "\\n");',
    '  await new Promise((resolve) => setTimeout(resolve, Number(holdMsText)));',
    '  appendFileSync(eventsPath, JSON.stringify({ event: "release" }) + "\\n");',
    '  lock.release();',
    '}'
  ].join("\n");
  const child = spawn(process.execPath, ["--input-type=module", "--eval", source, runtimeDirectory, String(holdMs), eventsPath], {
    stdio: "ignore"
  });
  return once(child, "exit").then(([code]) => {
    assert.equal(code, 0);
  });
}

function maxConcurrentLeaseEvents(eventsPath) {
  const events = readFileSync(eventsPath, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  let active = 0;
  let maximum = 0;
  for (const event of events) {
    active += event.event === "acquire" ? 1 : -1;
    maximum = Math.max(maximum, active);
  }
  assert.equal(active, 0);
  return maximum;
}

test("execution leases cap concurrent independent CLI processes at the configured slots", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "classroom-answer-shared-slot-"));
  const runtimeDirectory = path.join(directory, "runtime");
  const eventsPath = path.join(directory, "lease-events.jsonl");
  try {
    writeFileSync(eventsPath, "", "utf8");
    await Promise.all([
      spawnLeaseChild(runtimeDirectory, [1], 80, eventsPath),
      spawnLeaseChild(runtimeDirectory, [1], 80, eventsPath)
    ]);
    assert.equal(maxConcurrentLeaseEvents(eventsPath), 1);

    writeFileSync(eventsPath, "", "utf8");
    await Promise.all([
      spawnLeaseChild(runtimeDirectory, [1, 2], 80, eventsPath),
      spawnLeaseChild(runtimeDirectory, [1, 2], 80, eventsPath),
      spawnLeaseChild(runtimeDirectory, [1, 2], 80, eventsPath)
    ]);
    assert.equal(maxConcurrentLeaseEvents(eventsPath), 2);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("preset-health lock serializes independent CLI processes separately from execution slots", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "classroom-answer-health-lock-"));
  const runtimeDirectory = path.join(directory, "runtime");
  const eventsPath = path.join(directory, "health-lock-events.jsonl");
  try {
    writeFileSync(eventsPath, "", "utf8");
    await Promise.all([
      spawnPresetHealthLockChild(runtimeDirectory, 80, eventsPath),
      spawnPresetHealthLockChild(runtimeDirectory, 80, eventsPath)
    ]);
    assert.equal(maxConcurrentLeaseEvents(eventsPath), 1);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("live probes project one shared connection across all nine quality profiles", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  let runtimeDirectory = null;
  globalThis.fetch = async (_url, request) => {
    calls.push(JSON.parse(request.body));
    return new Response(JSON.stringify({ output_text: "OK" }), { status: 200 });
  };

  try {
    const config = normalizeConfig({
      CLASSROOM_TOOLKIT_CLOUD_EGRESS_ENABLED: "true",
      CLASSROOM_TOOLKIT_AI_EXECUTION_SLOT_COUNT: "5",
      CLASSROOM_TOOLKIT_AI_PRIMARY_BASE_URL: "https://primary.example.com/v1",
      CLASSROOM_TOOLKIT_AI_PRIMARY_API_KEY: "primary-key",
      CLASSROOM_TOOLKIT_AI_PRIMARY_TEXT_MODEL: "gpt-5.6-sol",
      CLASSROOM_TOOLKIT_AI_PRIMARY_VISION_MODEL: "gpt-5.6-sol",
      CLASSROOM_TOOLKIT_AI_PRIMARY_REASONING_EFFORT: "high",
      CLASSROOM_TOOLKIT_AI_PRESET_SOL_SLOT_1: "sol-high",
      CLASSROOM_TOOLKIT_AI_PRESET_SOL_SLOT_2: "sol-high",
      CLASSROOM_TOOLKIT_AI_PRESET_SOL_SLOT_3: "sol-medium",
      CLASSROOM_TOOLKIT_AI_PRESET_SOL_SLOT_4: "sol-medium",
      CLASSROOM_TOOLKIT_AI_PRESET_SOL_SLOT_5: "sol-low",
      CLASSROOM_TOOLKIT_AI_PRESET_TERRA_SLOT_1: "terra-xhigh",
      CLASSROOM_TOOLKIT_AI_PRESET_TERRA_SLOT_2: "terra-xhigh",
      CLASSROOM_TOOLKIT_AI_PRESET_TERRA_SLOT_3: "terra-high",
      CLASSROOM_TOOLKIT_AI_PRESET_TERRA_SLOT_4: "terra-high",
      CLASSROOM_TOOLKIT_AI_PRESET_TERRA_SLOT_5: "terra-medium",
      CLASSROOM_TOOLKIT_AI_PRESET_LUNA_SLOT_1: "luna-xhigh",
      CLASSROOM_TOOLKIT_AI_PRESET_LUNA_SLOT_2: "luna-xhigh",
      CLASSROOM_TOOLKIT_AI_PRESET_LUNA_SLOT_3: "luna-high",
      CLASSROOM_TOOLKIT_AI_PRESET_LUNA_SLOT_4: "luna-high",
      CLASSROOM_TOOLKIT_AI_PRESET_LUNA_SLOT_5: "luna-medium"
    });
    runtimeDirectory = mkdtempSync(path.join(os.tmpdir(), "classroom-answer-probe-runtime-"));
    config.runtimeDirectory = runtimeDirectory;
    const results = await runLiveTextProbes(config, {
      live: "text",
      allowCloudEgress: true,
      provider: "all",
      timeoutMs: 1000
    });

    assert.equal(results.length, 9);
    assert.ok(results.every((result) => result.ok));
    assert.deepEqual(results.map(({ qualityProfile, model, reasoningEffort, executionSlot }) => ({
      qualityProfile,
      model,
      reasoningEffort,
      executionSlot
    })), [
      { qualityProfile: "sol-high", model: "gpt-5.6-sol", reasoningEffort: "high", executionSlot: 1 },
      { qualityProfile: "sol-medium", model: "gpt-5.6-sol", reasoningEffort: "medium", executionSlot: 3 },
      { qualityProfile: "sol-low", model: "gpt-5.6-sol", reasoningEffort: "low", executionSlot: 5 },
      { qualityProfile: "terra-xhigh", model: "gpt-5.6-terra", reasoningEffort: "xhigh", executionSlot: 1 },
      { qualityProfile: "terra-high", model: "gpt-5.6-terra", reasoningEffort: "high", executionSlot: 3 },
      { qualityProfile: "terra-medium", model: "gpt-5.6-terra", reasoningEffort: "medium", executionSlot: 5 },
      { qualityProfile: "luna-xhigh", model: "gpt-5.6-luna", reasoningEffort: "xhigh", executionSlot: 1 },
      { qualityProfile: "luna-high", model: "gpt-5.6-luna", reasoningEffort: "high", executionSlot: 3 },
      { qualityProfile: "luna-medium", model: "gpt-5.6-luna", reasoningEffort: "medium", executionSlot: 5 }
    ]);
    assert.deepEqual(calls.map(({ model, reasoning }) => ({ model, effort: reasoning.effort })), [
      { model: "gpt-5.6-sol", effort: "high" },
      { model: "gpt-5.6-sol", effort: "medium" },
      { model: "gpt-5.6-sol", effort: "low" },
      { model: "gpt-5.6-terra", effort: "xhigh" },
      { model: "gpt-5.6-terra", effort: "high" },
      { model: "gpt-5.6-terra", effort: "medium" },
      { model: "gpt-5.6-luna", effort: "xhigh" },
      { model: "gpt-5.6-luna", effort: "high" },
      { model: "gpt-5.6-luna", effort: "medium" }
    ]);
  } finally {
    globalThis.fetch = originalFetch;
    if (typeof runtimeDirectory === "string") {
      rmSync(runtimeDirectory, { recursive: true, force: true });
    }
  }
});

test("execution slot FIFO wait is bounded by the attempt timeout", async () => {
  let signalStarted;
  const started = new Promise((resolve) => {
    signalStarted = resolve;
  });
  let unblock;
  const blocked = new Promise((resolve) => {
    unblock = resolve;
  });
  let laterStarted = false;
  const first = runInExecutionSlot(5, async () => {
    signalStarted();
    await blocked;
  });

  await started;
  const waiting = runInExecutionSlot(5, () => "unexpected", { timeoutMs: 20 });
  await assert.rejects(waiting, (error) => (
    error.code === "EXECUTION_SLOT_TIMEOUT"
      && error.slot === 5
      && error.timeoutMs === 20
  ));

  const later = runInExecutionSlot(5, () => {
    laterStarted = true;
    return "later";
  }, { timeoutMs: 1000 });
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(laterStarted, false);

  unblock();
  await first;
  assert.equal(await later, "later");
});

test("auto failover probes Terra after Sol and probes Luna after a later Terra failure", async () => {
  const { directory, imagePaths } = createPageImages(1);
  const runtimeDirectory = path.join(directory, ".gateway-runtime");
  const originalFetch = globalThis.fetch;
  const calls = [];
  let requestRound = 0;
  const providers = [
    { lane: "ai", role: "primary", baseUrl: "https://primary.example.com/v1", apiKey: "key", visionSurface: "responses", visionModel: "gpt-5.6-sol", reasoningEffort: "high" },
    { lane: "ai", role: "fallback_3", baseUrl: "https://terra.example.com/v1", apiKey: "key", visionSurface: "responses", visionModel: "gpt-5.6-terra", reasoningEffort: "xhigh" },
    { lane: "ai", role: "fallback_6", baseUrl: "https://luna.example.com/v1", apiKey: "key", visionSurface: "responses", visionModel: "gpt-5.6-luna", reasoningEffort: "xhigh" }
  ];
  globalThis.fetch = async (_url, request) => {
    const body = JSON.parse(request.body);
    calls.push({ round: requestRound, model: body.model, effort: body.reasoning.effort });
    const isSuccess = requestRound === 0
      ? body.model === "gpt-5.6-terra"
      : body.model === "gpt-5.6-luna";
    return isSuccess
      ? new Response(JSON.stringify({ output_text: "# 参考答案\n\n1. B" }), { status: 200 })
      : new Response(JSON.stringify({ error: "temporary" }), { status: 503 });
  };

  const requestOptions = {
    allowCloudEgress: true,
    provider: "all",
    mode: "blind_generation",
    prompt: "model family failover",
    imagePaths,
    visualDetailMode: "high",
    maxOutputTokens: 1000,
    timeoutMs: 1000
  };

  try {
    const first = await requestAnswerWithFailover({ cloudEgressEnabled: true, providers, runtimeDirectory }, requestOptions);
    assert.equal(first.ok, true);
    assert.equal(first.provider, "fallback_3");
    assert.equal(first.routing.qualityDegraded, true);
    assert.equal(first.routing.requestedPreset, "sol");
    assert.equal(first.routing.resolvedPreset, "terra");
    assert.equal(first.routing.activePreset, "terra");
    assert.deepEqual(first.attempts.map((attempt) => attempt.preset), ["sol", "sol", "terra"]);
    assert.deepEqual(calls.map(({ model }) => model), [
      "gpt-5.6-sol", "gpt-5.6-sol", "gpt-5.6-terra"
    ]);

    requestRound = 1;
    const second = await requestAnswerWithFailover({ cloudEgressEnabled: true, providers, runtimeDirectory }, requestOptions);
    assert.equal(second.ok, true);
    assert.equal(second.provider, "fallback_6");
    assert.equal(second.routing.qualityDegraded, true);
    assert.equal(second.routing.requestedPreset, "sol");
    assert.equal(second.routing.resolvedPreset, "luna");
    assert.equal(second.routing.activePreset, "luna");
    assert.deepEqual(second.attempts.map((attempt) => attempt.preset), ["terra", "terra", "sol", "sol", "luna"]);
    assert.deepEqual(calls.slice(3).map(({ model }) => model), [
      "gpt-5.6-terra", "gpt-5.6-terra", "gpt-5.6-sol", "gpt-5.6-sol", "gpt-5.6-luna"
    ]);
  } finally {
    globalThis.fetch = originalFetch;
    rmSync(directory, { recursive: true, force: true });
  }
});

test("cooldown keeps a healthy active preset first but restores Sol-first after expiry", () => {
  const health = {
    activePreset: "terra",
    presets: {
      sol: { cooldownUntil: 200 },
      terra: { cooldownUntil: 0 },
      luna: { cooldownUntil: 0 }
    }
  };
  assert.deepEqual(presetOrderForRequest("sol", health, 100), ["terra", "sol", "luna"]);
  assert.deepEqual(presetOrderForRequest("sol", health, 201), ["sol", "terra", "luna"]);
});

test("semantic findings and merge prompts create an observable no-reference review gate", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "classroom-answer-semantic-review-prompt-"));
  const promptPath = path.join(directory, "spec.md");
  try {
    writeFileSync(promptPath, "v8.18 production specification", "utf8");
    const candidateMarkdown = "# 参考答案\n\n1—5：D、C、D、D、C\n6—10：A、B、C、D、A\n11—12：B、C";
    const findingsPrompt = buildPrompt(promptPath, {
      mode: "semantic_review_findings",
      candidateMarkdown,
      sourcePageCount: 10,
      sourceText: "13. 图11中明确标注为凸透镜。\n21. 电流表示数为0.2A时，电压 UDE=____。"
    });
    const mergePrompt = buildPrompt(promptPath, {
      mode: "semantic_review_merge",
      candidateMarkdown,
      semanticFindings: "Q12【语义确认修正】：逐项核对 A、B、C、D；建议修正为 A。",
      sourcePageCount: 10,
      sourceText: "13. 图11中明确标注为凸透镜。\n21. 电流表示数为0.2A时，电压 UDE=____。"
    });

    assert.match(findingsPrompt, /不是参考答案/);
    assert.match(findingsPrompt, /不得沿用其结论作为证据/);
    assert.match(findingsPrompt, /原卷 PDF 文本层（辅助）/);
    assert.match(findingsPrompt, /图11中明确标注为凸透镜/);
    assert.match(findingsPrompt, /不得只校验最后一问/);
    assert.match(findingsPrompt, /逐项核对 A、B、C、D/);
    assert.match(findingsPrompt, /故障前后各支路状态/);
    assert.match(findingsPrompt, /第7题候选结论：B/);
    assert.match(findingsPrompt, /每个选择题必须以 `### 第N题` 开头/);
    assert.match(findingsPrompt, /【语义确认修正】/);
    assert.match(mergePrompt, /只应用明确标为【语义确认修正】/);
    assert.match(mergePrompt, /发现报告都不是证据/);
    assert.match(mergePrompt, /每一项建议修正必须再次与原卷图文核对/);
    assert.match(mergePrompt, /图11中明确标注为凸透镜/);
    assert.match(mergePrompt, /未逐项核对 A、B、C、D，不得修改/);
    assert.match(mergePrompt, /原始盲答候选/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("grouped choice lines are deterministically expanded into question-indexed candidates", () => {
  assert.equal(
    buildIndexedChoiceCandidate("1—5：D、C、D、D、A\n6—10：D、B、C、A、B\n11—12：C、D"),
    [
      "## 程序展开的选择题候选索引",
      "",
      "第1题候选结论：D",
      "第2题候选结论：C",
      "第3题候选结论：D",
      "第4题候选结论：D",
      "第5题候选结论：A",
      "第6题候选结论：D",
      "第7题候选结论：B",
      "第8题候选结论：C",
      "第9题候选结论：A",
      "第10题候选结论：B",
      "第11题候选结论：C",
      "第12题候选结论：D"
    ].join("\n")
  );
});

test("answer routing summary distinguishes planned and resolved provider roles", () => {
  assert.deepEqual(
    buildAnswerRoutingSummary({
      provider: "fallback_1",
      routing: {
        mode: "semantic_review_findings",
        selectedRole: "primary",
        orderedRoles: ["primary", "fallback_1"],
        target: "all"
      },
      attempts: [
        { provider: "primary" },
        { provider: "fallback_1" }
      ]
    }),
    {
      mode: "semantic_review_findings",
      selectedRole: "primary",
      orderedRoles: ["primary", "fallback_1"],
      target: "all",
      resolvedRole: "fallback_1",
      attemptedRoles: ["primary", "fallback_1"]
    }
  );
});

test("blind generation prompt binds extracted source text as auxiliary evidence", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "classroom-answer-source-text-prompt-"));
  const promptPath = path.join(directory, "spec.md");
  try {
    writeFileSync(promptPath, "v8.16 production specification", "utf8");
    const prompt = buildPrompt(promptPath, {
      sourceText: "19. 甲瓶中的油比乙瓶中的多。\n23. 电压表 V1 的示数为____。"
    });

    assert.match(prompt, /原卷 PDF 文本层（辅助）/);
    assert.match(prompt, /甲瓶中的油比乙瓶中的多/);
    assert.match(prompt, /精确抄录.*数量关系/);
    assert.match(prompt, /原卷页图仍是.*最高依据/);
    assert.match(prompt, /不得用文本层猜图/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

function createConfig(surface = "responses", runtimeDirectory = "") {
  return {
    cloudEgressEnabled: true,
    runtimeDirectory: runtimeDirectory || path.join(os.tmpdir(), "classroom-answer-test-runtime", String(process.pid)),
    providers: [
      {
        lane: "ai",
        role: "primary",
        baseUrl: "https://primary.example.com/v1",
        apiKey: "primary-key",
        visionModel: "gpt-5.6-sol",
        visionSurface: surface,
        reasoningEffort: "high"
      },
      {
        lane: "ai",
        role: "fallback_1",
        baseUrl: "https://fallback.example.com/v1",
        apiKey: "fallback-key",
        visionModel: "gpt-5.6-sol",
        visionSurface: surface,
        reasoningEffort: "high"
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

    assert.equal(body.model, "gpt-5.6-sol");
    assert.equal(body.max_output_tokens, 16000);
    assert.deepEqual(body.reasoning, { effort: "high" });
    assert.equal(body.input[0].content[0].type, "input_text");
    assert.match(body.input[0].content[0].text, /v8\.14/);
    assert.deepEqual(
      body.input[0].content.slice(1).map((part) => part.type),
      ["input_image", "input_image", "input_image"]
    );
    assert.ok(body.input[0].content.slice(1).every((part) => part.detail === "original"));
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

    assert.equal(body.input[0].content[1].detail, "original");
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
    assert.equal(body.reasoning_effort, "high");
    assert.deepEqual(
      body.messages[0].content.map((part) => part.type),
      ["text", "image_url", "image_url"]
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("reference review retries the same quality profile before using its matching fallback", async () => {
  const { directory, imagePaths } = createPageImages(1);
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    if (calls.length <= 2) {
      return new Response(JSON.stringify({ error: "temporary" }), { status: 502 });
    }
    return new Response(JSON.stringify({ output_text: "```markdown\n# 参考答案\n\n1. B\n```" }), { status: 200 });
  };

  try {
    const result = await requestAnswerWithFailover(createConfig("responses", path.join(directory, ".gateway-runtime")), {
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
    assert.equal(result.reasoningEffort, "high");
    assert.equal(result.answerMarkdown, "# 参考答案\n\n1. B");
    assert.equal(calls.length, 3);
    assert.equal(result.routing.qualityProfile, "sol-high");
    assert.equal(result.routing.qualityDegraded, false);
    assert.deepEqual(result.routing.orderedRoles, ["primary", "fallback_1"]);
    assert.deepEqual(result.attempts.map((attempt) => attempt.attemptNumber), [1, 2, 1]);
  } finally {
    globalThis.fetch = originalFetch;
    rmSync(directory, { recursive: true, force: true });
  }
});

test("reference review uses an explicitly selected Terra profile without crossing to another tier", async () => {
  const { directory, imagePaths } = createPageImages(1);
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (_url, request) => {
    const body = JSON.parse(request.body);
    calls.push({ model: body.model, effort: body.reasoning.effort });
    return new Response(JSON.stringify({ output_text: "# 参考答案\n\n1. B" }), { status: 200 });
  };

  const providers = [
    { role: "fallback_3", visionModel: "gpt-5.6-terra", reasoningEffort: "high" },
    { role: "primary", visionModel: "gpt-5.6-sol", reasoningEffort: "high" },
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
    const result = await requestAnswerWithFailover({ cloudEgressEnabled: true, providers, runtimeDirectory: path.join(directory, ".gateway-runtime") }, {
      allowCloudEgress: true,
      provider: "all",
      qualityProfile: "terra-xhigh",
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
    assert.equal(result.provider, "fallback_2");
    assert.deepEqual(calls, [
      { model: "gpt-5.6-terra", effort: "xhigh" }
    ]);
  } finally {
    globalThis.fetch = originalFetch;
    rmSync(directory, { recursive: true, force: true });
  }
});

test("focused crop manifest labels are interleaved before the matching ordered images", () => {
  const { directory, imagePaths } = createPageImages(2);
  try {
    writeFileSync(path.join(directory, "manifest.json"), JSON.stringify({
      pages: [
        {
          kind: "page-tile",
          imagePath: imagePaths[0],
          pageNumber: 8,
          questionNumber: 23,
          tileIndex: 1,
          tileCount: 1,
          horizontalIndex: 1,
          horizontalTileCount: 2
        },
        {
          kind: "focus-region",
          imagePath: imagePaths[1],
          pageNumber: 8,
          questionNumber: 23,
          focusRegionId: "q23-figure-25-current-meter",
          focusLabel: "Question 23 Figure 25 current meter dial and visible terminals",
          analogMeterReading: {
            status: "measured",
            rangeMin: 0,
            rangeMax: 0.6,
            divisions: 30,
            nearestDivision: 5,
            rawDivision: 5.12,
            value: 0.1
          },
          linearScaleReading: {
            status: "measured", rangeMin: 50, rangeMax: 60, divisions: 10,
            nearestDivision: 8, rawDivision: 8.012, value: 58
          },
          opticalRayGeometry: {
            status: "measured", relation: "converging_less",
            beforeIntersectionY: 0.5965, afterIntersectionY: 0.6366
          }
        }
      ]
    }), "utf8");
    const imageEvidenceLabels = resolveImageEvidenceLabels(imagePaths, "audit");
    const body = buildAnswerRequestBody(createConfig().providers[0], {
      prompt: "audit",
      imagePaths,
      imageEvidenceLabels,
      visualDetailMode: "high",
      maxOutputTokens: 4000
    });

    assert.deepEqual(
      body.input[0].content.map((part) => part.type),
      ["input_text", "input_text", "input_image", "input_text", "input_image"]
    );
    assert.match(body.input[0].content[1].text, /page 8; question 23; region 1\/1/u);
    assert.match(body.input[0].content[3].text, /focused crop.*current meter.*not an answer/u);
    assert.match(body.input[0].content[3].text, /division 5.*giving 0\.1/u);
    assert.match(body.input[0].content[3].text, /indicator at division 8.*giving 58/u);
    assert.match(body.input[0].content[3].text, /post-lens rays converging less/u);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("GPT-5.6 keeps original image dimensions when requested", () => {
  const { directory, imagePaths } = createPageImages(1);
  try {
    const provider = { ...createConfig().providers[0], visionModel: "gpt-5.6-sol" };
    const body = buildAnswerRequestBody(provider, {
      prompt: "audit",
      imagePaths,
      visualDetailMode: "original",
      maxOutputTokens: 4000
    });

    assert.equal(body.input[0].content[1].detail, "original");
  } finally {
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
    assert.equal(result.provider, "primary");
    assert.equal(callCount, 2);
  } finally {
    globalThis.fetch = originalFetch;
    rmSync(directory, { recursive: true, force: true });
  }
});

test("blind solving retries sol/xhigh twice and fails closed without a quality downgrade", async () => {
  const { directory, imagePaths } = createPageImages(1);
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (_url, request) => {
    const body = JSON.parse(request.body);
    calls.push({ model: body.model, effort: body.reasoning?.effort });
    return new Response(JSON.stringify({ error: "temporary" }), { status: 503 });
  };
  const providers = [
    { lane: "ai", role: "primary", baseUrl: "https://primary.example.com/v1", apiKey: "key", visionSurface: "responses", visionModel: "gpt-5.6-sol", reasoningEffort: "high" },
    { lane: "ai", role: "fallback_1", baseUrl: "https://primary.example.com/v1", apiKey: "key", visionSurface: "responses", visionModel: "gpt-5.6-sol", reasoningEffort: "medium" },
    { lane: "ai", role: "fallback_2", baseUrl: "https://primary.example.com/v1", apiKey: "key", visionSurface: "responses", visionModel: "gpt-5.6-sol", reasoningEffort: "medium" }
  ];
  try {
    const result = await requestAnswerWithFailover({ cloudEgressEnabled: true, providers, runtimeDirectory: path.join(directory, ".gateway-runtime") }, {
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
    assert.deepEqual(calls, [
      { model: "gpt-5.6-sol", effort: "high" },
      { model: "gpt-5.6-sol", effort: "high" }
    ]);
    assert.deepEqual(result.routing.orderedRoles, ["primary"]);
  } finally {
    globalThis.fetch = originalFetch;
    rmSync(directory, { recursive: true, force: true });
  }
});

test("blind solving retries sol/high after one headers timeout", async () => {
  const { directory, imagePaths } = createPageImages(1);
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, request) => {
    const body = JSON.parse(request.body);
    calls.push({ url: String(url), effort: body.reasoning.effort });
    if (calls.length === 1) {
      throw new TypeError("fetch failed", {
        cause: { code: "UND_ERR_HEADERS_TIMEOUT", message: "Headers Timeout Error" }
      });
    }
    return new Response(JSON.stringify({ output_text: "# 参考答案\n\n1. B" }), { status: 200 });
  };
  const providers = [
    { lane: "ai", role: "primary", baseUrl: "https://primary.example.com/v1", apiKey: "key", visionSurface: "responses", visionModel: "gpt-5.6-sol", reasoningEffort: "high" },
    { lane: "ai", role: "fallback_1", baseUrl: "https://primary.example.com/v1", apiKey: "key", visionSurface: "responses", visionModel: "gpt-5.6-sol", reasoningEffort: "medium" },
    { lane: "ai", role: "fallback_2", baseUrl: "https://primary.example.com/v1", apiKey: "key", visionSurface: "responses", visionModel: "gpt-5.6-sol", reasoningEffort: "medium" }
  ];
  try {
    const result = await requestAnswerWithFailover({ cloudEgressEnabled: true, providers, runtimeDirectory: path.join(directory, ".gateway-runtime") }, {
      allowCloudEgress: true,
      provider: "all",
      mode: "blind_generation",
      prompt: "retry headers",
      imagePaths,
      visualDetailMode: "original",
      maxOutputTokens: 1000,
      timeoutMs: 1000
    });
    assert.equal(result.ok, true);
    assert.equal(result.reasoningEffort, "high");
    assert.deepEqual(calls, [
      { url: "https://primary.example.com/v1/responses", effort: "high" },
      { url: "https://primary.example.com/v1/responses", effort: "high" }
    ]);
    assert.deepEqual(result.attempts.map((attempt) => attempt.attemptNumber), [1, 2]);
  } finally {
    globalThis.fetch = originalFetch;
    rmSync(directory, { recursive: true, force: true });
  }
});

test("blind solving does not reach sol-medium after sol-high retryable failures", async () => {
  const { directory, imagePaths } = createPageImages(1);
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (_url, request) => {
    const body = JSON.parse(request.body);
    calls.push(body.reasoning.effort);
    if (calls.length < 3) {
      return new Response(JSON.stringify({ error: "temporary" }), { status: 503 });
    }
    return new Response(JSON.stringify({ output_text: "# 参考答案\n\n1. B" }), { status: 200 });
  };
  const providers = ["high", "medium", "low"].map((reasoningEffort, index) => ({
    lane: "ai",
    role: index === 0 ? "primary" : `fallback_${index}`,
    baseUrl: "https://primary.example.com/v1",
    apiKey: "key",
    visionSurface: "responses",
    visionModel: "gpt-5.6-sol",
    reasoningEffort
  }));
  try {
    const result = await requestAnswerWithFailover({ cloudEgressEnabled: true, providers, runtimeDirectory: path.join(directory, ".gateway-runtime") }, {
      allowCloudEgress: true,
      provider: "all",
      mode: "blind_generation",
      prompt: "fallback to medium",
      imagePaths,
      visualDetailMode: "original",
      maxOutputTokens: 1000,
      timeoutMs: 1000
    });
    assert.equal(result.ok, false);
    assert.deepEqual(calls, ["high", "high"]);
  } finally {
    globalThis.fetch = originalFetch;
    rmSync(directory, { recursive: true, force: true });
  }
});

test("blind solving rejects a truncated payload and retries the same profile", async () => {
  const { directory, imagePaths } = createPageImages(1);
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (_url, request) => {
    const body = JSON.parse(request.body);
    calls.push(body.reasoning.effort);
    if (calls.length === 1) {
      return new Response(JSON.stringify({
        status: "incomplete",
        incomplete_details: { reason: "max_output_tokens" },
        output_text: "# 参考答案\n\n1. B" // Non-empty but truncated: must never be accepted.
      }), { status: 200 });
    }
    return new Response(JSON.stringify({ output_text: "# 参考答案\n\n1. B" }), { status: 200 });
  };
  const providers = ["high", "medium", "low"].map((reasoningEffort, index) => ({
    lane: "ai",
    role: index === 0 ? "primary" : `fallback_${index}`,
    baseUrl: "https://primary.example.com/v1",
    apiKey: "key",
    visionSurface: "responses",
    visionModel: "gpt-5.6-sol",
    reasoningEffort
  }));
  try {
    const result = await requestAnswerWithFailover({ cloudEgressEnabled: true, providers, runtimeDirectory: path.join(directory, ".gateway-runtime") }, {
      allowCloudEgress: true,
      provider: "all",
      mode: "blind_generation",
      prompt: "truncation fail-closed",
      imagePaths,
      visualDetailMode: "original",
      maxOutputTokens: 1000,
      timeoutMs: 1000
    });
    assert.equal(result.ok, true);
    assert.equal(result.reasoningEffort, "high");
    assert.deepEqual(calls, ["high", "high"]);
    assert.equal(result.attempts.length, 2);
    assert.match(result.attempts[0].error, /status=incomplete \(max_output_tokens\).*truncated/);
    assert.equal(result.attempts[0].ok, false);
    assert.equal(result.attempts[0].answerMarkdown, "");
  } finally {
    globalThis.fetch = originalFetch;
    rmSync(directory, { recursive: true, force: true });
  }
});

test("chat completions finish_reason=length is rejected instead of delivered", async () => {
  const { directory, imagePaths } = createPageImages(1);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    choices: [{
      message: { content: "# 参考答案\n\n1. B" },
      finish_reason: "length"
    }]
  }), { status: 200 });
  const providers = [{
    lane: "ai",
    role: "primary",
    baseUrl: "https://primary.example.com/v1",
    apiKey: "key",
    visionSurface: "chat_completions",
    visionModel: "gpt-5.6-sol",
    reasoningEffort: "high"
  }];
  try {
    const result = await requestAnswerWithFailover({ cloudEgressEnabled: true, providers, runtimeDirectory: path.join(directory, ".gateway-runtime") }, {
      allowCloudEgress: true,
      provider: "all",
      mode: "blind_generation",
      prompt: "chat completions truncation",
      imagePaths,
      visualDetailMode: "original",
      maxOutputTokens: 1000,
      timeoutMs: 1000
    });
    assert.equal(result.ok, false);
    assert.equal(result.answerMarkdown, "");
    assert.match(result.attempts[0].error, /finish_reason=length.*truncated at max_tokens=1000/);
  } finally {
    globalThis.fetch = originalFetch;
    rmSync(directory, { recursive: true, force: true });
  }
});

test("a 200 non-JSON body is retryable and the same profile retries", async () => {
  const { directory, imagePaths } = createPageImages(1);
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (_url, request) => {
    calls.push(JSON.parse(request.body).model);
    if (calls.length === 1) {
      return new Response("<html>gateway soft error page</html>", {
        status: 200,
        headers: { "Content-Type": "text/html" }
      });
    }
    return new Response(JSON.stringify({ output_text: "# 参考答案\n\n1. B" }), { status: 200 });
  };
  const providers = [
    { lane: "ai", role: "primary", baseUrl: "https://primary.example.com/v1", apiKey: "key", visionSurface: "responses", visionModel: "gpt-5.6-sol", reasoningEffort: "high" },
    { lane: "ai", role: "fallback_1", baseUrl: "https://fallback.example.com/v1", apiKey: "key", visionSurface: "responses", visionModel: "gpt-5.6-sol", reasoningEffort: "medium" }
  ];
  try {
    const result = await requestAnswerWithFailover({ cloudEgressEnabled: true, providers, runtimeDirectory: path.join(directory, ".gateway-runtime") }, {
      allowCloudEgress: true,
      provider: "all",
      mode: "reference_review",
      prompt: "non-JSON recovery",
      imagePaths,
      visualDetailMode: "original",
      maxOutputTokens: 1000,
      timeoutMs: 1000
    });
    assert.equal(result.ok, true);
    assert.equal(result.provider, "primary");
    assert.equal(result.attempts.length, 2);
    assert.equal(result.attempts[0].retryable, true);
    assert.match(result.attempts[0].error, /was not JSON/);
  } finally {
    globalThis.fetch = originalFetch;
    rmSync(directory, { recursive: true, force: true });
  }
});

test("an empty 200 output is retryable and the same profile retries", async () => {
  const { directory, imagePaths } = createPageImages(1);
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async () => {
    calls.push(1);
    if (calls.length === 1) {
      return new Response(JSON.stringify({}), { status: 200 });
    }
    return new Response(JSON.stringify({ output_text: "# 参考答案\n\n1. B" }), { status: 200 });
  };
  const providers = [
    { lane: "ai", role: "primary", baseUrl: "https://primary.example.com/v1", apiKey: "key", visionSurface: "responses", visionModel: "gpt-5.6-sol", reasoningEffort: "high" },
    { lane: "ai", role: "fallback_1", baseUrl: "https://fallback.example.com/v1", apiKey: "key", visionSurface: "responses", visionModel: "gpt-5.6-sol", reasoningEffort: "medium" }
  ];
  try {
    const result = await requestAnswerWithFailover({ cloudEgressEnabled: true, providers, runtimeDirectory: path.join(directory, ".gateway-runtime") }, {
      allowCloudEgress: true,
      provider: "all",
      mode: "reference_review",
      prompt: "empty output recovery",
      imagePaths,
      visualDetailMode: "original",
      maxOutputTokens: 1000,
      timeoutMs: 1000
    });
    assert.equal(result.ok, true);
    assert.equal(result.provider, "primary");
    assert.equal(result.attempts[0].ok, false);
    assert.equal(result.attempts[0].retryable, true);
    assert.match(result.attempts[0].error, /did not contain answer Markdown/);
  } finally {
    globalThis.fetch = originalFetch;
    rmSync(directory, { recursive: true, force: true });
  }
});

test("a 429 with Retry-After stays retryable and the same profile retries", async () => {
  const { directory, imagePaths } = createPageImages(1);
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async () => {
    calls.push(1);
    if (calls.length === 1) {
      return new Response(JSON.stringify({ error: "rate limited" }), {
        status: 429,
        headers: { "retry-after": "0" }
      });
    }
    return new Response(JSON.stringify({ output_text: "# 参考答案\n\n1. B" }), { status: 200 });
  };
  const providers = [
    { lane: "ai", role: "primary", baseUrl: "https://primary.example.com/v1", apiKey: "key", visionSurface: "responses", visionModel: "gpt-5.6-sol", reasoningEffort: "high" },
    { lane: "ai", role: "fallback_1", baseUrl: "https://fallback.example.com/v1", apiKey: "key", visionSurface: "responses", visionModel: "gpt-5.6-sol", reasoningEffort: "medium" }
  ];
  try {
    const result = await requestAnswerWithFailover({ cloudEgressEnabled: true, providers, runtimeDirectory: path.join(directory, ".gateway-runtime") }, {
      allowCloudEgress: true,
      provider: "all",
      mode: "reference_review",
      prompt: "rate limit recovery",
      imagePaths,
      visualDetailMode: "original",
      maxOutputTokens: 1000,
      timeoutMs: 1000
    });
    assert.equal(result.ok, true);
    assert.equal(result.provider, "primary");
    assert.equal(result.attempts[0].status, 429);
    assert.equal(result.attempts[0].retryable, true);
    assert.equal(result.attempts[0].retryAfterMs, 0);
  } finally {
    globalThis.fetch = originalFetch;
    rmSync(directory, { recursive: true, force: true });
  }
});

test("reference review retries the same provider after one headers timeout", async () => {
  const { directory, imagePaths } = createPageImages(1);
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, request) => {
    const body = JSON.parse(request.body);
    calls.push({ url: String(url), effort: body.reasoning.effort });
    if (calls.length === 1) {
      throw new TypeError("fetch failed", {
        cause: { code: "UND_ERR_HEADERS_TIMEOUT", message: "Headers Timeout Error" }
      });
    }
    return new Response(JSON.stringify({ output_text: "# 参考答案\n\n1. B" }), { status: 200 });
  };
  try {
    const result = await requestAnswerWithFailover(createConfig(), {
      allowCloudEgress: true,
      provider: "all",
      mode: "reference_review",
      prompt: "retry reference headers",
      imagePaths,
      visualDetailMode: "high",
      maxOutputTokens: 1000,
      timeoutMs: 1000
    });
    assert.equal(result.ok, true);
    assert.equal(result.provider, "primary");
    assert.deepEqual(calls, [
      { url: "https://primary.example.com/v1/responses", effort: "high" },
      { url: "https://primary.example.com/v1/responses", effort: "high" }
    ]);
    assert.deepEqual(result.attempts.map((attempt) => attempt.attemptNumber), [1, 2]);
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
  assert.equal(
    normalizeAnswerMarkdown("13. 连接 $O、A$，箭头由 $O$ 指向 A。"),
    "13. 连接 O、A，箭头由 $O$ 指向 A。"
  );
});

test("Markdown normalization wraps bare CJK script labels in LaTeX text", () => {
  assert.equal(
    normalizeAnswerMarkdown("$E_{k乙}=2\\,\\mathrm{J}$，$F^{甲}=3\\,\\mathrm{N}$，$E_{\\text{损}}=1\\,\\mathrm{J}$。"),
    "$E_{k\\text{乙}}=2\\,\\mathrm{J}$，$F^{\\text{甲}}=3\\,\\mathrm{N}$，$E_{\\text{损}}=1\\,\\mathrm{J}$。"
  );
});

test("Markdown normalization keeps Chinese punctuation out of math mode", () => {
  assert.equal(
    normalizeAnswerMarkdown("# 参考答案\n\n23. 电表接入 $a、b$，短路 $c、d$。"),
    "# 参考答案\n\n23. 电表接入 $a\\text{、}b$，短路 $c\\text{、}d$。"
  );
});

test("Markdown normalization closes real multiline math fences before rendering", () => {
  assert.equal(
    normalizeAnswerMarkdown(
      "# 参考答案\n\n21．（2）\n\n$m=\\rho V=1.0\\times10^3\\,\\mathrm{kg/m^3}\n\\times1.0\\times10^{-3}\\,\\mathrm{m^3}=1\\,\\mathrm{kg}$。\n\n$Q_{\\text{吸}}=cm\\Delta t\n=4.2\\times10^3\\,\\mathrm{J/(kg\\cdot{}^\\circ C)}\n\\times1\\,\\mathrm{kg}\\times(80-30)\\,^\\circ\\mathrm{C}\n=2.1\\times10^5\\,\\mathrm{J}$。"
    ),
    "# 参考答案\n\n21．（2）\n\n$m=\\rho V=1.0\\times10^3\\,\\mathrm{kg/m^3}$  \n$\\times1.0\\times10^{-3}\\,\\mathrm{m^3}=1\\,\\mathrm{kg}$。\n\n$Q_{\\text{吸}}=cm\\Delta t$  \n$=4.2\\times10^3\\,\\mathrm{J/(kg\\cdot{}^\\circ C)}$  \n$\\times1\\,\\mathrm{kg}\\times(80-30)\\,^\\circ\\mathrm{C}$  \n$=2.1\\times10^5\\,\\mathrm{J}$。"
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

test("semantic findings deterministically apply only explicit confirmed choice corrections", () => {
  const baseline = [
    "# 物理试卷参考答案",
    "",
    "1—5：D、B、D、D、D",
    "6—10：D、A、B、A、C",
    "11—12：C、C"
  ].join("\n");
  const mergedByModel = [
    "# 物理试卷参考答案",
    "",
    "1—5：A、A、A、A、A",
    "6—10：B、B、B、B、B",
    "11—12：D、D"
  ].join("\n");
  const findings = [
    "### 第2题",
    "标签：【语义确认修正】",
    "独立结论：C",
    "候选结论：B",
    "建议修正：改为 C",
    "",
    "### 第5题",
    "标签：【语义确认修正】",
    "独立结论：A",
    "候选结论：D",
    "建议修正：改为 A",
    "",
    "### 第8题",
    "标签：【语义确认修正】",
    "独立结论：B",
    "候选结论：D",
    "建议修正：改为 B",
    "",
    "### 第12题",
    "标签：语义一致",
    "独立结论：B",
    "候选结论：C"
  ].join("\n");
  const result = applySemanticChoiceFindings(mergedByModel, findings, baseline);
  assert.equal(result.applied, true);
  assert.deepEqual(result.questions, [2, 5]);
  assert.match(result.markdown, /1—5：D、C、D、D、A/);
  assert.match(result.markdown, /6—10：D、A、B、A、C/);
  assert.match(result.markdown, /11—12：C、C/);
});

test("semantic findings ignore incomplete or unconfirmed corrections", () => {
  const result = applySemanticChoiceFindings(
    "# 参考答案\n\n1—5：A、B、C、D、A",
    "### 第1题\n标签：语义一致\n独立结论：C\n候选结论：A\n### 第2题\n【语义确认修正】\n候选结论：B"
  );
  assert.equal(result.applied, false);
  assert.deepEqual(result.questions, []);
  assert.match(result.markdown, /1—5：A、B、C、D、A/);
});

test("semantic choice parser rejects missing, duplicated, or inconsistent correction fields", () => {
  const findings = [
    "### 第1题\n【语义确认修正】\n独立结论：B\n候选结论：A",
    "### 第2题\n【语义确认修正】\n独立结论：B\n独立结论：C\n候选结论：A\n建议修正：改为 C",
    "### 第3题\n【语义确认修正】【语义一致】\n独立结论：B\n候选结论：A\n建议修正：改为 B",
    "### 第4题\n【语义确认修正】\n独立结论：B\n候选结论：A\n建议修正：改为 B"
  ].join("\n");
  const corrections = parseSemanticChoiceFindings(findings);
  assert.deepEqual([...corrections.entries()], [[4, { candidate: "A", answer: "B" }]]);
});

test("semantic choice parser rejects an ambiguous multi-answer conclusion", () => {
  const findings = [
    "### 第4题",
    "【语义确认修正】",
    "独立结论：A、B（题面出现双正确）",
    "候选结论：B",
    "建议修正：改为 A；若为单选则不能唯一判定。"
  ].join("\n");
  const corrections = parseSemanticChoiceFindings(findings);
  assert.deepEqual([...corrections.entries()], []);
});

test("semantic findings reject a correction whose candidate does not match the frozen baseline", () => {
  const result = applySemanticChoiceFindings(
    "# 参考答案\n\n6—10：D、A、D、B、C",
    "### 第7题\n【语义确认修正】\n独立结论：A\n候选结论：D\n建议修正：改为 A"
  );
  assert.equal(result.applied, false);
  assert.deepEqual(result.questions, []);
  assert.match(result.markdown, /6—10：D、A、D、B、C/);
});

test("semantic findings fail closed on a self-contradictory correction block", () => {
  const result = applySemanticChoiceFindings(
    "# 参考答案\n\n1—5：A、C、C、D、A",
    "### 第2题\n【语义确认修正】\n独立结论：D\n候选结论：C\n建议修正：D\n注：题干显示为原子核，应改为 C。"
  );
  assert.equal(result.applied, false);
  assert.deepEqual(result.questions, []);
  assert.match(result.markdown, /1—5：A、C、C、D、A/);
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

test("reference review extracts choices when PDF text uses full-width question punctuation", () => {
  const referenceText = [
    "1．题目【答案】D",
    "2．题目【答案】C",
    "3．题目【答案】D",
    "4．题目【答案】D",
    "5．题目【答案】A",
    "6．题目【答案】D",
    "7．题目【答案】A",
    "8．题目【答案】B",
    "9．题目【答案】A",
    "10．题目【答案】B",
    "11．非选择题"
  ].join("\n");
  const reviewed = applyReferenceChoiceAnswers(
    "# 参考答案\n\n1—5：A、A、A、A、A\n6—10：B、B、B、B、B",
    referenceText
  );
  assert.equal(reviewed.applied, true);
  assert.equal(reviewed.answers, "DCDDADABAB");
  assert.match(reviewed.markdown, /1—5：D、C、D、D、A/);
  assert.match(reviewed.markdown, /6—10：D、A、B、A、B/);
});

test("reference review extracts answer choices from Chinese explained-answer markers", () => {
  const referenceText = Array.from({ length: 10 }, (_, index) => `${index + 1}．题目\n故选：${"DCDDADABAB"[index]}`).join("\n");
  const reviewed = applyReferenceChoiceAnswers(
    "# 参考答案\n\n1—5：A、A、A、A、A\n6—10：B、B、B、B、B",
    referenceText
  );
  assert.equal(reviewed.applied, true);
  assert.equal(reviewed.answers, "DCDDADABAB");
});

test("reference review does not let question 11 explanation bleed into question 10", () => {
  const referenceText = [
    "1．题目\n故选：D", "2．题目\n故选：C", "3．题目\n故选：D", "4．题目\n故选：D", "5．题目\n故选：A",
    "6．题目\n故选：D", "7．题目\n故选：A", "8．题目\n故选：B", "9．题目\n故选：A", "10．题目\n故选：B",
    "11．非选择题\n故选：A"
  ].join("\n");
  const reviewed = applyReferenceChoiceAnswers(
    "# 参考答案\n\n1—5：A、A、A、A、A\n6—10：B、B、B、B、B",
    referenceText
  );
  assert.equal(reviewed.answers, "DCDDADABAB");
});

test("default prompt resolves to the compiled full spec via the manifest", () => {
  const resolved = resolveDefaultPromptPath();
  assert.match(resolved.replace(/\\/g, "/"), /prompts\/specs\/compiled\/[^/]+\.md$/);
  assert.equal(existsSync(resolved), true);
});

test("explicit --image prints the deprecation warning", () => {
  const { directory, imagePaths } = createPageImages(1);
  const missingEnvFile = path.join(directory, "missing.env");
  try {
    const result = spawnSync(process.execPath, [
      fileURLToPath(new URL("./answer-request.mjs", import.meta.url)),
      "--config-env-file", missingEnvFile,
      "--image", imagePaths[0],
      "--output", path.join(directory, "answer.md")
    ], {
      cwd: directory,
      encoding: "utf8"
    });

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /\[deprecated\] --image is deprecated/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("directory-based image inputs print no deprecation warning", () => {
  const { directory } = createPageImages(1);
  const missingEnvFile = path.join(directory, "missing.env");
  const candidatePath = path.join(directory, "candidate.md");
  writeFileSync(candidatePath, "# 候选\n", "utf8");
  try {
    const invocations = [
      ["--images-dir", directory, "--output", path.join(directory, "blind.md")],
      ["--audit-images-dir", directory, "--audit-findings-only", "--candidate-file", candidatePath, "--output", path.join(directory, "findings.md")]
    ];
    for (const invocationArgs of invocations) {
      const result = spawnSync(process.execPath, [
        fileURLToPath(new URL("./answer-request.mjs", import.meta.url)),
        "--config-env-file", missingEnvFile,
        ...invocationArgs
      ], {
        cwd: directory,
        encoding: "utf8"
      });

      assert.notEqual(result.status, 0);
      // 到达配置加载层才证明参数校验已通过、弃用告警逻辑已执行，断言不空真。
      assert.match(result.stderr, /Env file not found/);
      assert.doesNotMatch(result.stderr, /\[deprecated\]/);
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
