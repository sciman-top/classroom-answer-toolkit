import fs from "node:fs";
import path from "node:path";
import { Agent, EnvHttpProxyAgent, setGlobalDispatcher } from "undici";

import { normalizeAnswerMarkdown } from "./answer-tasks.mjs";
import { assertLiveEgressAllowed, isRetryableGatewayFailure } from "./validate-config.mjs";

const TRANSPORT_TIMEOUT_GRACE_MS = 5000;
let activeTransportKey = null;

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
    setGlobalDispatcher(dispatcher);
    activeTransportKey = transportKey;
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

export const QUALITY_PROFILES = Object.freeze({
  "sol-xhigh": Object.freeze({ model: "gpt-5.6-sol", reasoningEffort: "xhigh" }),
  "sol-medium": Object.freeze({ model: "gpt-5.6-sol", reasoningEffort: "medium" }),
  "terra-xhigh": Object.freeze({ model: "gpt-5.6-terra", reasoningEffort: "xhigh" }),
  "terra-high": Object.freeze({ model: "gpt-5.6-terra", reasoningEffort: "high" })
});
export const QUALITY_PROFILE_NAMES = new Set(["auto", ...Object.keys(QUALITY_PROFILES)]);
const DEFAULT_QUALITY_PROFILE_BY_MODE = Object.freeze(Object.fromEntries(
  [...TASK_MODES].map((mode) => [mode, "sol-xhigh"])
));
const RETRYABLE_ATTEMPTS_PER_PROVIDER = 2;

export function normalizeQualityProfile(value = "auto") {
  return String(value).trim().toLowerCase();
}

function resolveQualityProfile(mode, requestedQualityProfile = "auto") {
  const normalized = normalizeQualityProfile(requestedQualityProfile);
  if (!QUALITY_PROFILE_NAMES.has(normalized)) {
    throw new Error("qualityProfile must be auto, sol-xhigh, sol-medium, terra-xhigh, or terra-high.");
  }
  return normalized === "auto" ? DEFAULT_QUALITY_PROFILE_BY_MODE[mode] : normalized;
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

export function selectAnswerRoute(config, modeOrOptions = {}, target = "all", requestedQualityProfile = "auto") {
  const mode = typeof modeOrOptions === "string" ? modeOrOptions : inferAnswerMode(modeOrOptions);
  const qualityProfile = resolveQualityProfile(mode, requestedQualityProfile);
  const requiredProfile = QUALITY_PROFILES[qualityProfile];
  const providers = config.providers
    .filter((provider) => provider.lane === "ai")
    .filter((provider) => provider.visionModel === requiredProfile.model
      && provider.reasoningEffort === requiredProfile.reasoningEffort)
    .filter((provider) => target === "all"
      || (target === "primary" && provider.role === "primary")
      || (target === "fallback" && provider.role.startsWith("fallback")))
    .sort((left, right) => providerOrder(left.role) - providerOrder(right.role));
  return {
    mode,
    target,
    qualityProfile,
    qualityDegraded: false,
    selectedRole: providers[0]?.role ?? null,
    orderedRoles: providers.map((provider) => provider.role),
    providers
  };
}

function routingReceipt(route) {
  return {
    mode: route.mode,
    qualityProfile: route.qualityProfile,
    qualityDegraded: route.qualityDegraded,
    selectedRole: route.selectedRole,
    orderedRoles: route.orderedRoles,
    target: route.target
  };
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
    return finishReason === "length"
      ? `chat_completions finish_reason=length: answer truncated at max_tokens=${maxOutputTokens}.`
      : null;
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
  const requestBody = JSON.stringify(buildAnswerRequestBody(provider, options));
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
  const route = selectAnswerRoute(config, mode, options.provider, options.qualityProfile);
  const providers = route.providers;
  if (providers.length === 0) {
    throw new Error(`No ${options.provider ?? "all"} AI provider is configured for quality profile ${route.qualityProfile}.`);
  }

  const attempts = [];
  const requestOptions = {
    ...options,
    transportPolicy,
    imageDataUrls: resolveImageDataUrls(options)
  };
  for (const provider of providers) {
    for (let attemptNumber = 1; attemptNumber <= RETRYABLE_ATTEMPTS_PER_PROVIDER; attemptNumber += 1) {
      const attempt = await callProvider(provider, { ...requestOptions, attemptNumber });
      attempts.push(attempt);
      if (attempt.ok) {
        return {
          ok: true,
          provider: provider.role,
          model: attempt.model,
          reasoningEffort: attempt.reasoningEffort,
          answerMarkdown: attempt.answerMarkdown,
          attempts,
          routing: routingReceipt(route)
        };
      }
      if (!attempt.retryable) {
        return {
          ok: false,
          provider: provider.role,
          answerMarkdown: "",
          attempts,
          routing: routingReceipt(route),
          error: attempt.error
        };
      }
      if (attemptNumber < RETRYABLE_ATTEMPTS_PER_PROVIDER) {
        const backoffMs = attempt.status === 429
          ? (attempt.retryAfterMs > 0 ? attempt.retryAfterMs : defaultRateLimitBackoffMs)
          : 0;
        if (backoffMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, backoffMs));
        }
      }
    }
  }
  return {
    ok: false,
    provider: attempts.at(-1)?.provider ?? null,
    answerMarkdown: "",
    attempts,
    routing: routingReceipt(route),
    error: "All configured AI providers failed with retryable errors."
  };
}
