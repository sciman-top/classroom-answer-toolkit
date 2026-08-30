import fs from "node:fs";
import path from "node:path";
import { Agent, EnvHttpProxyAgent, setGlobalDispatcher } from "undici";

import { normalizeAnswerMarkdown } from "./answer-tasks.mjs";
import {
  assertLiveEgressAllowed,
  ExecutionSlotTimeoutError,
  isRetryableGatewayFailure,
  PROVIDER_LOCAL_FAILURE_STATUSES,
  runInExecutionSlot,
  DEFAULT_EXECUTION_SLOT_COUNT
} from "./validate-config.mjs";
import {
  QUALITY_PROFILES,
  QUALITY_PROFILE_NAMES,
  presetForProfile,
  profileForPresetTier,
  tierForProfile,
  slotsForPresetProfile
} from "./profile-matrix.mjs";
import {
  acquireSharedExecutionSlot,
  presetOrderForRequest,
  readPresetHealth,
  recordPresetFailure,
  recordPresetSuccess
} from "./gateway-runtime.mjs";

export { QUALITY_PROFILES, QUALITY_PROFILE_NAMES };

const TRANSPORT_TIMEOUT_GRACE_MS = 5000;
let activeTransportKey = null;
let activeDispatcher = null;

export function resolveAnswerTransportPolicy(timeoutMs, nodeOptions = process.env.NODE_OPTIONS ?? "") {
  const environmentProxyEnabled = /(?:^|\s)--use-env-proxy(?:\s|$)/.test(nodeOptions);
  return {
    applicationTimeoutMs: timeoutMs,
    headersTimeoutMs: timeoutMs + TRANSPORT_TIMEOUT_GRACE_MS,
    bodyTimeoutMs: timeoutMs + TRANSPORT_TIMEOUT_GRACE_MS,
    environmentProxyEnabled
  };
}

function configureAnswerTransport(timeoutMs) {
  const policy = resolveAnswerTransportPolicy(timeoutMs);
  const transportKey = JSON.stringify(policy);
  if (transportKey !== activeTransportKey) {
    const dispatcherOptions = {
      headersTimeout: policy.headersTimeoutMs,
      bodyTimeout: policy.bodyTimeoutMs
    };
    const dispatcher = policy.environmentProxyEnabled
      ? new EnvHttpProxyAgent(dispatcherOptions)
      : new Agent(dispatcherOptions);
    const previousDispatcher = activeDispatcher;
    setGlobalDispatcher(dispatcher);
    activeDispatcher = dispatcher;
    activeTransportKey = transportKey;
    // Sockets pooled by the replaced agent would otherwise linger until GC.
    previousDispatcher?.close()?.catch(() => {});
  }
  return policy;
}

export const TASK_MODES = new Set([
  "blind_generation",
  "semantic_review_findings",
  "semantic_review_merge",
  "visual_audit",
  "visual_audit_findings",
  "visual_audit_merge",
  "reference_review"
]);

const DEFAULT_QUALITY_PROFILE_BY_MODE = Object.freeze(Object.fromEntries(
  [...TASK_MODES].map((mode) => [mode, "sol-high"])
));
const RETRYABLE_ATTEMPTS_PER_PROVIDER = 2;
const nextSlotIndexByPresetProfile = new Map();

export function normalizeQualityProfile(value = "auto") {
  return String(value).trim().toLowerCase();
}

function resolveQualityProfile(mode, requestedQualityProfile = "auto") {
  const normalized = normalizeQualityProfile(requestedQualityProfile);
  if (!QUALITY_PROFILE_NAMES.has(normalized)) {
    throw new Error(`qualityProfile must be auto or one of ${Object.keys(QUALITY_PROFILES).join(", ")}.`);
  }
  return normalized === "auto" ? DEFAULT_QUALITY_PROFILE_BY_MODE[mode] : normalized;
}

function resolveExecutionSlots(provider, preset, profile, config = {}) {
  const slots = slotsForPresetProfile(config.presetSlotBindings, preset, profile);
  if (slots.length > 0) {
    const key = `${preset}:${profile}`;
    const index = nextSlotIndexByPresetProfile.get(key) ?? 0;
    nextSlotIndexByPresetProfile.set(key, index + 1);
    const rotatedIndex = index % slots.length;
    return [...slots.slice(rotatedIndex), ...slots.slice(0, rotatedIndex)];
  }
  return [Number.isInteger(provider.executionSlot) && provider.executionSlot > 0
    ? provider.executionSlot
    : 1];
}

function connectionFingerprint(provider) {
  return [
    provider.kind,
    provider.baseUrl,
    provider.apiKey,
    provider.textSurface,
    provider.visionSurface
  ].join("\u0000");
}

function routeConnections(config, target) {
  const candidates = config.providers
    .filter((provider) => provider.lane === "ai")
    .filter((provider) => target === "all"
      || (target === "primary" && provider.role === "primary")
      || (target === "fallback" && provider.role.startsWith("fallback")))
    .sort((left, right) => providerOrder(left.role) - providerOrder(right.role));
  const seen = new Set();
  return candidates.filter((provider) => {
    const fingerprint = connectionFingerprint(provider);
    if (seen.has(fingerprint)) {
      return false;
    }
    seen.add(fingerprint);
    return true;
  });
}

function providersForPresetProfile(config, preset, profile, target) {
  const requiredProfile = QUALITY_PROFILES[profile];
  if (config.presetSlotsExplicit !== true) {
    return config.providers
      .filter((provider) => provider.lane === "ai")
      .filter((provider) => provider.visionModel === requiredProfile.model
        && provider.reasoningEffort === requiredProfile.reasoningEffort)
      .filter((provider) => target === "all"
        || (target === "primary" && provider.role === "primary")
        || (target === "fallback" && provider.role.startsWith("fallback")))
      .sort((left, right) => providerOrder(left.role) - providerOrder(right.role))
      .map((provider) => {
        const executionSlots = resolveExecutionSlots(provider, preset, profile, config);
        return {
          ...provider,
          qualityProfile: profile,
          preset,
          executionSlots,
          executionSlot: executionSlots[0]
        };
      });
  }

  return routeConnections(config, target).map((provider) => {
    const executionSlots = resolveExecutionSlots(provider, preset, profile, config);
    return {
      ...provider,
      textModel: requiredProfile.model,
      visionModel: requiredProfile.model,
      reasoningEffort: requiredProfile.reasoningEffort,
      qualityProfile: profile,
      preset,
      executionSlots,
      executionSlot: executionSlots[0]
    };
  });
}

export function inferAnswerMode(options = {}) {
  if (TASK_MODES.has(options.mode)) {
    return options.mode;
  }
  if (options.semanticFindingsOnly) {
    return "semantic_review_findings";
  }
  if (options.semanticFindingsFile || options.semanticFindings) {
    return "semantic_review_merge";
  }
  if (options.auditFindingsOnly) {
    return "visual_audit_findings";
  }
  if (options.auditFindingsFile || options.auditFindings) {
    return "visual_audit_merge";
  }
  if (options.auditImagesDir || options.auditImagePaths?.length > 0) {
    return "visual_audit";
  }
  if (options.referenceImagesDir || options.referenceImagePaths?.length > 0) {
    return "reference_review";
  }
  return "blind_generation";
}

export function selectAnswerRoute(config, modeOrOptions = {}, target = "all", requestedQualityProfile = "auto", presetHealth = null) {
  const mode = typeof modeOrOptions === "string" ? modeOrOptions : inferAnswerMode(modeOrOptions);
  const qualityProfile = resolveQualityProfile(mode, requestedQualityProfile);
  const requestedPreset = presetForProfile(qualityProfile);
  const requestedTier = tierForProfile(qualityProfile);
  const presetRoutes = presetOrderForRequest(
    requestedPreset,
    presetHealth ?? undefined,
    undefined,
    { recoveryProbeEnabled: config.recoveryProbeEnabled === true }
  ).map((preset) => {
    const resolvedQualityProfile = profileForPresetTier(preset, requestedTier);
    const providers = resolvedQualityProfile
      ? providersForPresetProfile(config, preset, resolvedQualityProfile, target)
      : [];
    return {
      preset,
      qualityProfile: resolvedQualityProfile,
      selectedRole: providers[0]?.role ?? null,
      orderedRoles: providers.map((provider) => provider.role),
      orderedExecutionSlots: providers.flatMap((provider) => provider.executionSlots),
      providers
    };
  });
  const initialRoute = presetRoutes[0];
  return {
    mode,
    target,
    qualityProfile,
    requestedPreset,
    activePreset: requestedPreset,
    qualityDegraded: false,
    selectedRole: initialRoute.selectedRole,
    orderedPresets: presetRoutes.map((presetRoute) => presetRoute.preset),
    orderedRoles: initialRoute.orderedRoles,
    orderedQualityProfiles: presetRoutes.map((presetRoute) => presetRoute.qualityProfile),
    orderedExecutionSlots: initialRoute.orderedExecutionSlots,
    executionSlotCount: Number.isInteger(config.executionSlotCount)
      ? config.executionSlotCount
      : DEFAULT_EXECUTION_SLOT_COUNT,
    presetRoutes,
    providers: initialRoute.providers
  };
}

function routingReceipt(route, resolvedProvider = null, resolvedPreset = null) {
  const actualPreset = resolvedPreset ?? resolvedProvider?.preset ?? null;
  const actualProfile = resolvedProvider?.qualityProfile ?? null;
  const qualityDegraded = resolvedProvider !== null
    && (actualPreset !== route.requestedPreset || actualProfile !== route.qualityProfile);
  return {
    mode: route.mode,
    qualityProfile: route.qualityProfile,
    requestedQualityProfile: route.qualityProfile,
    resolvedQualityProfile: actualProfile,
    requestedPreset: route.requestedPreset,
    resolvedPreset: actualPreset,
    activePreset: actualPreset,
    qualityDegraded,
    selectedRole: route.selectedRole,
    orderedPresets: route.orderedPresets,
    orderedRoles: route.orderedRoles,
    orderedQualityProfiles: route.orderedQualityProfiles,
    orderedExecutionSlots: route.orderedExecutionSlots,
    executionSlot: resolvedProvider?.executionSlot ?? null,
    executionSlotCount: route.executionSlotCount,
    target: route.target
  };
}

function persistPresetHealth(action) {
  try {
    action();
  } catch {
    // Runtime health state is an optimization. A local temp-directory failure
    // must not turn an otherwise valid answer into a failed delivery.
  }
}

async function callProviderInSharedSlot(config, provider, requestOptions, attemptNumber) {
  const startedAt = Date.now();
  const lease = await acquireSharedExecutionSlot(
    config,
    provider.executionSlots ?? [provider.executionSlot],
    requestOptions.timeoutMs
  );
  if (!lease) {
    throw new ExecutionSlotTimeoutError(provider.executionSlot, requestOptions.timeoutMs);
  }
  provider.executionSlot = lease.slot;
  try {
    const remainingTimeoutMs = requestOptions.timeoutMs - (Date.now() - startedAt);
    if (remainingTimeoutMs <= 0) {
      throw new ExecutionSlotTimeoutError(lease.slot, requestOptions.timeoutMs);
    }
    return await runInExecutionSlot(lease.slot, (slotRemainingTimeoutMs) => callProvider(provider, {
      ...requestOptions,
      timeoutMs: slotRemainingTimeoutMs ?? remainingTimeoutMs,
      attemptNumber
    }), { timeoutMs: remainingTimeoutMs });
  } finally {
    lease.release();
  }
}

function providerOrder(role) {
  if (role === "primary") {
    return 0;
  }
  const match = role.match(/^fallback_(\d+)$/);
  return match ? Number(match[1]) : 999;
}

function extractTextOutput(parsed) {
  if (typeof parsed.output_text === "string") {
    return parsed.output_text;
  }
  if (Array.isArray(parsed.output)) {
    const parts = [];
    for (const item of parsed.output) {
      for (const part of Array.isArray(item?.content) ? item.content : []) {
        if (typeof part?.text === "string") {
          parts.push(part.text);
        }
      }
    }
    if (parts.length > 0) {
      return parts.join("");
    }
  }
  const content = Array.isArray(parsed.choices) ? parsed.choices[0]?.message?.content : null;
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content.map((part) => part?.text ?? "").join("");
  }
  return "";
}

function summarizeBody(bodyText) {
  try {
    return JSON.stringify(JSON.parse(bodyText)).slice(0, 500);
  } catch {
    return bodyText.slice(0, 500);
  }
}

function summarizeRequestError(error) {
  const message = error instanceof Error ? error.message : String(error);
  const cause = error && typeof error === "object" ? error.cause : null;
  if (!cause || typeof cause !== "object") {
    return message;
  }
  const causeCode = typeof cause.code === "string" ? cause.code : "";
  const causeMessage = typeof cause.message === "string" ? cause.message : "";
  const detail = [causeCode, causeMessage].filter(Boolean).join(": ");
  return detail ? `${message} (${detail})` : message;
}

function detectTruncation(parsed, provider, maxOutputTokens) {
  if (provider.visionSurface === "chat_completions") {
    const finishReason = Array.isArray(parsed.choices)
      ? parsed.choices[0]?.finish_reason
      : parsed.finish_reason;
    if (finishReason === "length") {
      return `chat_completions finish_reason=length: answer truncated at max_tokens=${maxOutputTokens}.`;
    }
    // Mid-stream policy cut is also a non-terminal output; fail closed on it.
    if (finishReason === "content_filter") {
      return "chat_completions finish_reason=content_filter: answer was not fully produced.";
    }
    return null;
  }
  if (parsed.status === "failed") {
    const reason = typeof parsed.error?.message === "string" ? parsed.error.message : "unknown";
    return `responses status=failed (${reason}): answer was not produced.`;
  }
  if (parsed.status === "incomplete") {
    const reason = typeof parsed.incomplete_details?.reason === "string"
      ? parsed.incomplete_details.reason
      : "unknown";
    return `responses status=incomplete (${reason}): answer truncated before completion.`;
  }
  return null;
}

const defaultRateLimitBackoffMs = 2000;

function parseRetryAfterMs(headers) {
  const raw = headers?.get?.("retry-after");
  if (raw == null) {
    return 0;
  }
  const seconds = Number(raw);
  if (!Number.isFinite(seconds) || seconds < 0) {
    return 0;
  }
  return Math.min(seconds * 1000, 30_000);
}

export function normalizeDetailForProvider(detail, visionModel) {
  if (detail !== "original") {
    return detail;
  }
  // GPT-5.6 supports the original image dimensions; older-compatible gateways
  // still receive high detail because they may reject the newer value.
  return /^gpt-5\.6(?:-|$)/iu.test(visionModel ?? "") ? "original" : "high";
}

function imageDataUrl(imagePath) {
  const extension = path.extname(imagePath).toLowerCase();
  const mimeType = extension === ".png"
    ? "image/png"
    : extension === ".webp"
      ? "image/webp"
      : "image/jpeg";
  return `data:${mimeType};base64,${fs.readFileSync(imagePath).toString("base64")}`;
}

export function resolveImageDataUrls(options) {
  if (Array.isArray(options.imageDataUrls)) {
    return options.imageDataUrls;
  }
  return options.imagePaths.map(imageDataUrl);
}

function buildImageContentParts(surface, imageDataUrls, imageEvidenceLabels, detail) {
  if (imageEvidenceLabels.length > 0 && imageEvidenceLabels.length !== imageDataUrls.length) {
    throw new Error("Image evidence labels must align one-to-one with ordered images.");
  }
  return imageDataUrls.flatMap((imageUrl, index) => {
    const label = imageEvidenceLabels[index];
    if (surface === "chat_completions") {
      return [
        ...(label ? [{ type: "text", text: `[Image evidence ${index + 1}/${imageDataUrls.length}] ${label}` }] : []),
        { type: "image_url", image_url: { url: imageUrl, detail } }
      ];
    }
    return [
      ...(label ? [{ type: "input_text", text: `[Image evidence ${index + 1}/${imageDataUrls.length}] ${label}` }] : []),
      { type: "input_image", image_url: imageUrl, detail }
    ];
  });
}

export function buildAnswerRequestBody(provider, options) {
  const detail = normalizeDetailForProvider(options.visualDetailMode, provider.visionModel);
  const imageDataUrls = resolveImageDataUrls(options);
  const imageEvidenceLabels = Array.isArray(options.imageEvidenceLabels) ? options.imageEvidenceLabels : [];
  if (provider.visionSurface === "chat_completions") {
    return {
      model: provider.visionModel,
      ...(provider.reasoningEffort ? { reasoning_effort: provider.reasoningEffort } : {}),
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: options.prompt },
            ...buildImageContentParts("chat_completions", imageDataUrls, imageEvidenceLabels, detail)
          ]
        }
      ],
      max_tokens: options.maxOutputTokens
    };
  }

  return {
    model: provider.visionModel,
    ...(provider.reasoningEffort ? { reasoning: { effort: provider.reasoningEffort } } : {}),
    input: [
      {
        role: "user",
        content: [
          { type: "input_text", text: options.prompt },
          ...buildImageContentParts("responses", imageDataUrls, imageEvidenceLabels, detail)
        ]
      }
    ],
    max_output_tokens: options.maxOutputTokens
  };
}

async function callProvider(provider, options) {
  const endpointPath = provider.visionSurface === "chat_completions" ? "chat/completions" : "responses";
  const endpoint = `${provider.baseUrl.replace(/\/+$/, "")}/${endpointPath}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs);
  const startedAt = Date.now();
  let requestBody;
  try {
    // Build inside a guard: throwing here used to leak the abort timer and keep
    // the process alive for the full request timeout.
    requestBody = JSON.stringify(buildAnswerRequestBody(provider, options));
  } catch (error) {
    clearTimeout(timeout);
    throw error;
  }
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Authorization": `Bearer ${provider.apiKey}`,
        "Content-Type": "application/json",
        "Accept": "application/json",
        "User-Agent": "classroom-answer-toolkit-answer-generation/1.0"
      },
      body: requestBody
    });
    const bodyText = await response.text();
    if (!response.ok) {
      return {
        provider: provider.role,
        model: provider.visionModel,
        reasoningEffort: provider.reasoningEffort || null,
        attemptNumber: options.attemptNumber ?? 1,
        durationMs: Date.now() - startedAt,
        requestBytes: Buffer.byteLength(requestBody),
        transport: options.transportPolicy,
        ok: false,
        retryable: isRetryableGatewayFailure(response.status),
        status: response.status,
        retryAfterMs: parseRetryAfterMs(response.headers),
        error: summarizeBody(bodyText)
      };
    }
    let parsed;
    try {
      parsed = JSON.parse(bodyText);
    } catch (error) {
      return {
        provider: provider.role,
        model: provider.visionModel,
        reasoningEffort: provider.reasoningEffort || null,
        attemptNumber: options.attemptNumber ?? 1,
        durationMs: Date.now() - startedAt,
        requestBytes: Buffer.byteLength(requestBody),
        transport: options.transportPolicy,
        ok: false,
        retryable: true,
        status: response.status,
        error: `Provider response was not JSON: ${error instanceof Error ? error.message : String(error)}`
      };
    }
    const truncationError = detectTruncation(parsed, provider, options.maxOutputTokens);
    if (truncationError) {
      return {
        provider: provider.role,
        model: provider.visionModel,
        reasoningEffort: provider.reasoningEffort || null,
        attemptNumber: options.attemptNumber ?? 1,
        durationMs: Date.now() - startedAt,
        requestBytes: Buffer.byteLength(requestBody),
        transport: options.transportPolicy,
        ok: false,
        retryable: true,
        status: response.status,
        answerMarkdown: "",
        error: truncationError
      };
    }
    const answerMarkdown = normalizeAnswerMarkdown(extractTextOutput(parsed));
    return {
      provider: provider.role,
      model: provider.visionModel,
      reasoningEffort: provider.reasoningEffort || null,
      attemptNumber: options.attemptNumber ?? 1,
      durationMs: Date.now() - startedAt,
      requestBytes: Buffer.byteLength(requestBody),
      transport: options.transportPolicy,
      ok: answerMarkdown.length > 0,
      retryable: answerMarkdown.length === 0,
      status: response.status,
      answerMarkdown,
      error: answerMarkdown.length > 0 ? "" : "Provider response did not contain answer Markdown."
    };
  } catch (error) {
    return {
      provider: provider.role,
      model: provider.visionModel,
      reasoningEffort: provider.reasoningEffort || null,
      attemptNumber: options.attemptNumber ?? 1,
      durationMs: Date.now() - startedAt,
      requestBytes: Buffer.byteLength(requestBody),
      transport: options.transportPolicy,
      ok: false,
      retryable: true,
      status: null,
      error: summarizeRequestError(error)
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function requestAnswerWithFailover(config, options) {
  assertLiveEgressAllowed(config, options.allowCloudEgress);
  if (typeof fetch !== "function") {
    throw new Error("This Node.js runtime does not provide fetch.");
  }
  const transportPolicy = configureAnswerTransport(options.timeoutMs);
  const mode = inferAnswerMode(options);
  const presetHealth = readPresetHealth(config);
  const route = selectAnswerRoute(config, mode, options.provider, options.qualityProfile, presetHealth);
  if (route.presetRoutes.every((presetRoute) => presetRoute.providers.length === 0)) {
    throw new Error(`No ${options.provider ?? "all"} AI provider is configured for quality profile ${route.qualityProfile}.`);
  }

  const attempts = [];
  const requestOptions = {
    ...options,
    transportPolicy,
    imageDataUrls: resolveImageDataUrls(options)
  };
  let lastProvider = null;
  let lastPreset = null;
  for (const presetRoute of route.presetRoutes) {
    for (const provider of presetRoute.providers) {
      lastProvider = provider;
      lastPreset = presetRoute.preset;
      for (let attemptNumber = 1; attemptNumber <= RETRYABLE_ATTEMPTS_PER_PROVIDER; attemptNumber += 1) {
      const attemptStartedAt = Date.now();
      let attempt;
      try {
        attempt = await callProviderInSharedSlot(config, provider, requestOptions, attemptNumber);
      } catch (error) {
        if (!(error instanceof ExecutionSlotTimeoutError)) {
          throw error;
        }
        attempt = {
          provider: provider.role,
          model: provider.visionModel,
          reasoningEffort: provider.reasoningEffort || null,
          attemptNumber,
          durationMs: Date.now() - attemptStartedAt,
          requestBytes: 0,
          transport: requestOptions.transportPolicy,
          ok: false,
          retryable: true,
          status: null,
          error: error.message
        };
      }
        attempt.executionSlot = provider.executionSlot;
        attempt.qualityProfile = provider.qualityProfile;
        attempt.preset = presetRoute.preset;
        attempts.push(attempt);
        if (attempt.ok) {
          persistPresetHealth(() => recordPresetSuccess(config, presetRoute.preset));
          return {
            ok: true,
            provider: provider.role,
            model: attempt.model,
            reasoningEffort: attempt.reasoningEffort,
            answerMarkdown: attempt.answerMarkdown,
            attempts,
            routing: routingReceipt(route, provider, presetRoute.preset)
          };
        }
        if (!attempt.retryable) {
          // Provider-local rejections are a connection-level failure. Continue with
          // another connection in this preset, then transition at the preset seam.
          if (!PROVIDER_LOCAL_FAILURE_STATUSES.has(attempt.status)) {
            return {
              ok: false,
              provider: provider.role,
              answerMarkdown: "",
              attempts,
              routing: routingReceipt(route, provider, presetRoute.preset),
              error: attempt.error
            };
          }
          break;
        }
        if (attemptNumber < RETRYABLE_ATTEMPTS_PER_PROVIDER) {
          // Honor Retry-After from any retryable failure that carries it, not just 429.
          const backoffMs = attempt.retryAfterMs > 0
            ? attempt.retryAfterMs
            : attempt.status === 429
              ? defaultRateLimitBackoffMs
              : 0;
          if (backoffMs > 0) {
            await new Promise((resolve) => setTimeout(resolve, backoffMs));
          }
        }
      }
    }
    if (presetRoute.providers.length > 0) {
      persistPresetHealth(() => recordPresetFailure(config, presetRoute.preset));
    }
  }
  return {
    ok: false,
    provider: attempts.at(-1)?.provider ?? null,
    answerMarkdown: "",
    attempts,
    routing: routingReceipt(route, lastProvider, lastPreset),
    error: "All configured AI presets failed."
  };
}
