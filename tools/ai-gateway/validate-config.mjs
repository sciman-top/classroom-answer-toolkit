import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const toolDir = path.dirname(fileURLToPath(import.meta.url));
export const repoRoot = path.resolve(toolDir, "..", "..");

const KNOWN_PREFIXES = [
  "CLASSROOM_TOOLKIT_",
  "TEXT_PROVIDER",
  "IMAGE_PROVIDER"
];

const ALLOWED_AI_KINDS = new Set(["openai_compatible"]);
const ALLOWED_IMAGE_KINDS = new Set(["openai_compatible_image", "openai_compatible_image_only"]);
const ALLOWED_TEXT_SURFACES = new Set(["responses", "chat_completions"]);
const ALLOWED_IMAGE_SURFACES = new Set(["responses", "images"]);

function usage() {
  return [
    "Usage:",
    "  npm --prefix tools/ai-gateway run validate:config -- [--config-env-file .env] [--allow-missing-secrets] [--json]",
    "  npm --prefix tools/ai-gateway run probe:text -- --allow-cloud-egress",
    "  npm --prefix tools/ai-gateway run request:text -- --allow-cloud-egress --prompt \"Return exactly OK.\"",
    "",
    "Live probes require both:",
    "  CLASSROOM_TOOLKIT_CLOUD_EGRESS_ENABLED=true",
    "  --allow-cloud-egress"
  ].join("\n");
}

export function parseArgs(argv) {
  const options = {
    envFile: path.join(repoRoot, ".env"),
    allowMissingSecrets: false,
    json: false,
    live: null,
    provider: "primary",
    allowCloudEgress: false,
    timeoutMs: 30000
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--config-env-file") {
      options.envFile = path.resolve(repoRoot, requireValue(argv, ++index, arg));
      continue;
    }
    if (arg.startsWith("--config-env-file=")) {
      options.envFile = path.resolve(repoRoot, arg.slice("--config-env-file=".length));
      continue;
    }
    if (arg === "--allow-missing-secrets") {
      options.allowMissingSecrets = true;
      continue;
    }
    if (arg === "--json") {
      options.json = true;
      continue;
    }
    if (arg === "--live") {
      options.live = requireValue(argv, ++index, arg);
      continue;
    }
    if (arg.startsWith("--live=")) {
      options.live = arg.slice("--live=".length);
      continue;
    }
    if (arg === "--provider") {
      options.provider = requireValue(argv, ++index, arg);
      continue;
    }
    if (arg.startsWith("--provider=")) {
      options.provider = arg.slice("--provider=".length);
      continue;
    }
    if (arg === "--allow-cloud-egress") {
      options.allowCloudEgress = true;
      continue;
    }
    if (arg === "--timeout-ms") {
      options.timeoutMs = Number(requireValue(argv, ++index, arg));
      continue;
    }
    if (arg.startsWith("--timeout-ms=")) {
      options.timeoutMs = Number(arg.slice("--timeout-ms=".length));
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      console.log(usage());
      process.exit(0);
    }

    throw new Error(`Unknown argument: ${arg}\n\n${usage()}`);
  }

  if (!Number.isInteger(options.timeoutMs) || options.timeoutMs < 1000) {
    throw new Error("--timeout-ms must be an integer >= 1000.");
  }

  if (options.live !== null && options.live !== "text") {
    throw new Error("Only --live text is implemented in this safety slice.");
  }

  if (!["primary", "fallback", "all"].includes(options.provider)) {
    throw new Error("--provider must be primary, fallback, or all.");
  }

  return options;
}

export function requireValue(argv, index, flag) {
  const value = argv[index];
  if (typeof value !== "string" || value.startsWith("--")) {
    throw new Error(`${flag} requires a value.`);
  }
  return value;
}

function isKnownEnvKey(key) {
  return KNOWN_PREFIXES.some((prefix) => key.startsWith(prefix));
}

export function parseEnvFile(envFile) {
  if (!fs.existsSync(envFile)) {
    throw new Error(`Env file not found: ${envFile}`);
  }

  const values = {};
  const lines = fs.readFileSync(envFile, "utf8").split(/\r?\n/);
  const errors = [];

  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) {
      return;
    }

    const normalizedLine = trimmed.startsWith("export ") ? trimmed.slice("export ".length).trim() : trimmed;
    const separatorIndex = normalizedLine.indexOf("=");
    if (separatorIndex <= 0) {
      errors.push(`Line ${index + 1}: expected KEY=value.`);
      return;
    }

    const key = normalizedLine.slice(0, separatorIndex).trim();
    const rawValue = normalizedLine.slice(separatorIndex + 1).trim();
    if (!/^[A-Z_][A-Z0-9_]*$/.test(key)) {
      errors.push(`Line ${index + 1}: invalid env key '${key}'.`);
      return;
    }

    values[key] = stripOptionalQuotes(rawValue);
  });

  return { values, errors };
}

function stripOptionalQuotes(value) {
  if (value.length >= 2) {
    const first = value[0];
    const last = value[value.length - 1];
    if ((first === "\"" && last === "\"") || (first === "'" && last === "'")) {
      return value.slice(1, -1);
    }
  }
  return value;
}

export function loadEnvironment(options) {
  const parsed = parseEnvFile(options.envFile);
  const env = { ...parsed.values };
  for (const [key, value] of Object.entries(process.env)) {
    if (isKnownEnvKey(key) && typeof value === "string") {
      env[key] = value;
    }
  }
  return { env, parseErrors: parsed.errors };
}

function get(env, key) {
  const value = env[key];
  return typeof value === "string" ? value.trim() : "";
}

function hasAny(env, prefix) {
  return Object.keys(env).some((key) => key.startsWith(prefix));
}

function boolValue(value) {
  return ["1", "true", "yes", "on"].includes(String(value ?? "").trim().toLowerCase());
}

function readAiProvider(env, role, canonicalPrefix, legacyPrefix) {
  const hasCanonical = hasAny(env, `${canonicalPrefix}_`);
  const hasLegacy = hasAny(env, `${legacyPrefix}_`);
  if (!hasCanonical && !hasLegacy) {
    return null;
  }

  const source = hasCanonical ? "canonical" : "legacy";
  const prefix = hasCanonical ? canonicalPrefix : legacyPrefix;
  const model = hasCanonical ? get(env, `${prefix}_TEXT_MODEL`) : get(env, `${prefix}_MODEL`);
  const visionModel = hasCanonical ? get(env, `${prefix}_VISION_MODEL`) || model : model;

  return {
    lane: "ai",
    role,
    source,
    kind: get(env, `${prefix}_KIND`) || "openai_compatible",
    baseUrl: get(env, `${prefix}_BASE_URL`),
    apiKey: get(env, `${prefix}_API_KEY`),
    textModel: model,
    visionModel,
    textSurface: normalizeSurface(get(env, `${prefix}_TEXT_SURFACE`) || "responses"),
    visionSurface: normalizeSurface(get(env, `${prefix}_VISION_SURFACE`) || "responses")
  };
}

function readImageProvider(env, role, canonicalPrefix, legacyPrefix) {
  const hasCanonical = hasAny(env, `${canonicalPrefix}_`);
  const hasLegacy = hasAny(env, `${legacyPrefix}_`);
  if (!hasCanonical && !hasLegacy) {
    return null;
  }

  const source = hasCanonical ? "canonical" : "legacy";
  const prefix = hasCanonical ? canonicalPrefix : legacyPrefix;

  return {
    lane: "image",
    role,
    source,
    kind: get(env, `${prefix}_KIND`) || "openai_compatible_image",
    baseUrl: get(env, `${prefix}_BASE_URL`),
    apiKey: get(env, `${prefix}_API_KEY`) || get(env, `${prefix}_API_KEY_1`),
    model: get(env, `${prefix}_MODEL`),
    surface: normalizeSurface(get(env, `${prefix}_SURFACE`) || get(env, `${prefix}_IMAGE_SURFACE`) || "responses"),
    responsesModel: get(env, `${prefix}_RESPONSES_MODEL`),
    totalConcurrency: get(env, `${prefix}_TOTAL_CONCURRENCY`)
  };
}

function normalizeSurface(value) {
  return value.trim().toLowerCase().replace(/-/g, "_");
}

export function normalizeConfig(env) {
  const providers = [
    readAiProvider(env, "primary", "CLASSROOM_TOOLKIT_AI_PRIMARY", "TEXT_PROVIDER"),
    readAiProvider(env, "fallback_1", "CLASSROOM_TOOLKIT_AI_FALLBACK_1", "TEXT_PROVIDER_FALLBACK_1"),
    readImageProvider(env, "primary", "CLASSROOM_TOOLKIT_IMAGE_PRIMARY", "IMAGE_PROVIDER"),
    readImageProvider(env, "fallback_1", "CLASSROOM_TOOLKIT_IMAGE_FALLBACK_1", "IMAGE_PROVIDER_FALLBACK_1")
  ].filter(Boolean);

  return {
    cloudEgressEnabled: boolValue(get(env, "CLASSROOM_TOOLKIT_CLOUD_EGRESS_ENABLED")),
    providers
  };
}

export function validateConfig(config, options, parseErrors) {
  const errors = [...parseErrors];
  const warnings = [];

  if (config.providers.length === 0) {
    errors.push("No AI gateway providers are configured.");
  }

  if (!config.cloudEgressEnabled) {
    warnings.push("Cloud egress is disabled; live probes and cloud-backed visual lanes are blocked until CLASSROOM_TOOLKIT_CLOUD_EGRESS_ENABLED=true.");
  }

  for (const provider of config.providers) {
    validateProvider(provider, options, errors, warnings);
  }

  const primaryAi = config.providers.find((provider) => provider.lane === "ai" && provider.role === "primary");
  if (!primaryAi) {
    warnings.push("No primary AI provider configured; vision understanding cannot use a primary cloud lane.");
  }

  return { errors, warnings };
}

function validateProvider(provider, options, errors, warnings) {
  const label = `${provider.lane}.${provider.role}`;

  if (provider.lane === "ai" && !ALLOWED_AI_KINDS.has(provider.kind)) {
    errors.push(`${label}: unsupported kind '${provider.kind}'.`);
  }
  if (provider.lane === "image" && !ALLOWED_IMAGE_KINDS.has(provider.kind)) {
    errors.push(`${label}: unsupported kind '${provider.kind}'.`);
  }

  validateBaseUrl(provider.baseUrl, label, errors);
  validateSecret(provider.apiKey, `${label}: api key`, options, errors, warnings);

  if (provider.lane === "ai") {
    validateRequired(provider.textModel, `${label}: text model`, errors);
    validateRequired(provider.visionModel, `${label}: vision model`, errors);
    validateSurface(provider.textSurface, ALLOWED_TEXT_SURFACES, `${label}: text surface`, errors);
    validateSurface(provider.visionSurface, ALLOWED_TEXT_SURFACES, `${label}: vision surface`, errors);
    return;
  }

  validateRequired(provider.model, `${label}: image model`, errors);
  validateSurface(provider.surface, ALLOWED_IMAGE_SURFACES, `${label}: image surface`, errors);
  if (provider.surface === "responses" && provider.responsesModel.length === 0) {
    warnings.push(`${label}: responses surface is set without an explicit responses model; the image model may not be valid for /responses.`);
  }
  if (provider.totalConcurrency.length > 0 && (!/^[1-9][0-9]*$/.test(provider.totalConcurrency))) {
    errors.push(`${label}: total concurrency must be a positive integer.`);
  }
}

function validateBaseUrl(baseUrl, label, errors) {
  if (baseUrl.length === 0) {
    errors.push(`${label}: base URL is required.`);
    return;
  }

  let parsed;
  try {
    parsed = new URL(baseUrl);
  } catch {
    errors.push(`${label}: base URL is not a valid URL.`);
    return;
  }

  const isLocal = ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname);
  if (parsed.protocol !== "https:" && !(isLocal && parsed.protocol === "http:")) {
    errors.push(`${label}: base URL must use https, except local http endpoints.`);
  }

  if (!parsed.pathname.replace(/\/+$/, "").endsWith("/v1")) {
    errors.push(`${label}: OpenAI-compatible base URL must include /v1.`);
  }
}

function validateSecret(secret, label, options, errors, warnings) {
  if (secret.length > 0) {
    return;
  }

  if (options.allowMissingSecrets) {
    warnings.push(`${label} is empty; accepted because --allow-missing-secrets is set.`);
    return;
  }

  errors.push(`${label} is required.`);
}

function validateRequired(value, label, errors) {
  if (value.length === 0) {
    errors.push(`${label} is required.`);
  }
}

function validateSurface(value, allowed, label, errors) {
  if (!allowed.has(value)) {
    errors.push(`${label} must be one of ${[...allowed].join(", ")}.`);
  }
}

export function summarizeProvider(provider) {
  const base = {
    lane: provider.lane,
    role: provider.role,
    source: provider.source,
    kind: provider.kind,
    baseUrl: provider.baseUrl,
    apiKey: provider.apiKey.length > 0 ? "set" : "missing"
  };

  if (provider.lane === "ai") {
    return {
      ...base,
      textModel: provider.textModel,
      visionModel: provider.visionModel,
      textSurface: provider.textSurface,
      visionSurface: provider.visionSurface
    };
  }

  return {
    ...base,
    model: provider.model,
    surface: provider.surface,
    responsesModel: provider.responsesModel || null,
    totalConcurrency: provider.totalConcurrency || null
  };
}

function printHumanSummary(options, config, validation, liveResults = []) {
  console.log("AI gateway config summary");
  console.log(`- env file: ${path.relative(repoRoot, options.envFile) || "."}`);
  console.log(`- cloud egress: ${config.cloudEgressEnabled ? "enabled" : "disabled"}`);
  for (const provider of config.providers) {
    const summary = summarizeProvider(provider);
    if (summary.lane === "ai") {
      console.log(`- ${summary.lane}.${summary.role}: ${summary.source}, ${summary.baseUrl}, text=${summary.textModel}, vision=${summary.visionModel}, key=${summary.apiKey}`);
    } else {
      console.log(`- ${summary.lane}.${summary.role}: ${summary.source}, ${summary.baseUrl}, model=${summary.model}, surface=${summary.surface}, key=${summary.apiKey}`);
    }
  }

  for (const warning of validation.warnings) {
    console.warn(`warning: ${warning}`);
  }
  for (const result of liveResults) {
    console.log(`- live ${result.provider}: ${result.ok ? "ok" : "failed"}${result.status ? ` status=${result.status}` : ""}${result.output ? ` output=${result.output}` : ""}${result.error ? ` error=${result.error}` : ""}`);
  }

  if (validation.errors.length > 0) {
    for (const error of validation.errors) {
      console.error(`error: ${error}`);
    }
    return;
  }

  console.log("Validation OK.");
}

export function loadGatewayConfig(options = {}) {
  const resolvedOptions = {
    envFile: path.join(repoRoot, ".env"),
    allowMissingSecrets: false,
    ...options
  };
  const { env, parseErrors } = loadEnvironment(resolvedOptions);
  const config = normalizeConfig(env);
  const validation = validateConfig(config, resolvedOptions, parseErrors);
  return { options: resolvedOptions, config, validation };
}

export function assertLiveEgressAllowed(config, allowCloudEgress) {
  if (!allowCloudEgress || !config.cloudEgressEnabled) {
    throw new Error("Live request blocked. Set CLASSROOM_TOOLKIT_CLOUD_EGRESS_ENABLED=true and pass --allow-cloud-egress.");
  }
}

export async function runLiveTextProbes(config, options) {
  if (!options.live) {
    return [];
  }

  assertLiveEgressAllowed(config, options.allowCloudEgress);

  if (typeof fetch !== "function") {
    throw new Error("This Node.js runtime does not provide fetch; use a newer Node.js runtime for live probes.");
  }

  const candidates = config.providers.filter((provider) => provider.lane === "ai");
  const selected = candidates.filter((provider) => {
    if (options.provider === "all") {
      return true;
    }
    if (options.provider === "primary") {
      return provider.role === "primary";
    }
    return provider.role.startsWith("fallback");
  });

  if (selected.length === 0) {
    throw new Error(`No ${options.provider} AI provider is configured for live text probe.`);
  }

  const results = [];
  for (const provider of selected) {
    results.push(await probeTextProvider(provider, options.timeoutMs));
  }
  return results;
}

export async function probeTextProvider(provider, timeoutMs) {
  const result = await callTextProvider(provider, {
    prompt: "Return exactly OK.",
    timeoutMs
  });
  return {
    provider: provider.role,
    ok: result.ok && result.output.toUpperCase().includes("OK"),
    status: result.status,
    output: result.output.slice(0, 80),
    error: result.error
  };
}

export async function requestTextWithFailover(config, options) {
  assertLiveEgressAllowed(config, options.allowCloudEgress);

  if (typeof fetch !== "function") {
    throw new Error("This Node.js runtime does not provide fetch; use a newer Node.js runtime for live requests.");
  }

  const providers = orderedAiProviders(config);
  if (providers.length === 0) {
    throw new Error("No AI providers are configured for text requests.");
  }

  const attempts = [];
  for (const provider of providers) {
    const forcedFailure = options.forcePrimaryFailure === true && provider.role === "primary";
    const attempt = forcedFailure
      ? forcedRetryableFailure(provider)
      : await callTextProvider(provider, {
        prompt: options.prompt,
        timeoutMs: options.timeoutMs
      });

    attempts.push(attempt);
    if (attempt.ok) {
      return {
        ok: true,
        provider: provider.role,
        output: attempt.output,
        attempts
      };
    }

    if (!attempt.retryable) {
      return {
        ok: false,
        provider: provider.role,
        output: "",
        attempts,
        error: attempt.error
      };
    }
  }

  return {
    ok: false,
    provider: attempts.at(-1)?.provider ?? null,
    output: "",
    attempts,
    error: "All configured AI providers failed with retryable errors."
  };
}

function orderedAiProviders(config) {
  return config.providers
    .filter((provider) => provider.lane === "ai")
    .sort((left, right) => providerOrder(left.role) - providerOrder(right.role));
}

function providerOrder(role) {
  if (role === "primary") {
    return 0;
  }

  const match = role.match(/^fallback_(\d+)$/);
  return match ? Number(match[1]) : 999;
}

function forcedRetryableFailure(provider) {
  return {
    provider: provider.role,
    ok: false,
    retryable: true,
    status: null,
    output: "",
    error: "forced retryable primary failure"
  };
}

export async function callTextProvider(provider, options) {
  const endpointPath = provider.textSurface === "chat_completions" ? "chat/completions" : "responses";
  const endpoint = joinUrl(provider.baseUrl, endpointPath);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs);

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Authorization": `Bearer ${provider.apiKey}`,
        "Content-Type": "application/json",
        "Accept": "application/json, text/event-stream",
        "User-Agent": "classroom-answer-toolkit-ai-gateway-probe/1.0"
      },
      body: JSON.stringify(buildTextRequestBody(provider, options.prompt))
    });

    const bodyText = await response.text();
    if (!response.ok) {
      return {
        provider: provider.role,
        ok: false,
        retryable: isRetryableGatewayFailure(response.status),
        status: response.status,
        output: "",
        error: summarizeResponseBody(bodyText)
      };
    }

    const parsed = JSON.parse(bodyText);
    const output = extractTextOutput(parsed);
    return {
      provider: provider.role,
      ok: output.length > 0,
      retryable: false,
      status: response.status,
      output
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      provider: provider.role,
      ok: false,
      retryable: true,
      status: null,
      output: "",
      error: errorMessage
    };
  } finally {
    clearTimeout(timeout);
  }
}

export function isRetryableGatewayFailure(status) {
  return [408, 409, 425, 429, 500, 502, 503, 504].includes(status);
}

function joinUrl(baseUrl, endpointPath) {
  return `${baseUrl.replace(/\/+$/, "")}/${endpointPath}`;
}

function buildTextRequestBody(provider, prompt) {
  if (provider.textSurface === "chat_completions") {
    return {
      model: provider.textModel,
      messages: [
        { role: "user", content: prompt }
      ],
      max_tokens: 8
    };
  }

  return {
    model: provider.textModel,
    input: prompt,
    max_output_tokens: 8
  };
}

function summarizeResponseBody(bodyText) {
  try {
    const parsed = JSON.parse(bodyText);
    return JSON.stringify(parsed).slice(0, 240);
  } catch {
    return bodyText.slice(0, 240);
  }
}

function extractTextOutput(parsed) {
  if (typeof parsed.output_text === "string") {
    return parsed.output_text.trim();
  }

  const responseOutput = parsed.output;
  if (Array.isArray(responseOutput)) {
    const textParts = [];
    for (const item of responseOutput) {
      const content = item?.content;
      if (!Array.isArray(content)) {
        continue;
      }
      for (const part of content) {
        if (typeof part?.text === "string") {
          textParts.push(part.text);
        }
      }
    }
    if (textParts.length > 0) {
      return textParts.join(" ").trim();
    }
  }

  const choice = Array.isArray(parsed.choices) ? parsed.choices[0] : null;
  const messageContent = choice?.message?.content;
  if (typeof messageContent === "string") {
    return messageContent.trim();
  }
  if (Array.isArray(messageContent)) {
    return messageContent.map((part) => part?.text ?? "").join(" ").trim();
  }

  return "";
}

export async function main() {
  const options = parseArgs(process.argv.slice(2));
  const { env, parseErrors } = loadEnvironment(options);
  const config = normalizeConfig(env);
  const validation = validateConfig(config, options, parseErrors);
  const liveResults = validation.errors.length === 0 ? await runLiveTextProbes(config, options) : [];
  const liveFailed = liveResults.some((result) => !result.ok);

  if (options.json) {
    console.log(JSON.stringify({
      envFile: path.relative(repoRoot, options.envFile) || ".",
      cloudEgressEnabled: config.cloudEgressEnabled,
      providers: config.providers.map(summarizeProvider),
      warnings: validation.warnings,
      errors: validation.errors,
      liveResults
    }, null, 2));
  } else {
    printHumanSummary(options, config, validation, liveResults);
  }

  if (validation.errors.length > 0 || liveFailed) {
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
