import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  DEFAULT_PRESET_SLOT_BINDINGS,
  EXECUTION_SLOT_COUNT,
  PRESET_NAMES,
  PRESET_PROFILES,
  QUALITY_PROFILES,
  QUALITY_PROFILE_ORDER,
  presetForProfile,
  slotsForPresetProfile,
  TEXT_FAILOVER_PROFILES
} from "./profile-matrix.mjs";
import { acquireSharedExecutionSlot } from "./gateway-runtime.mjs";

const toolDir = path.dirname(fileURLToPath(import.meta.url));
export const repoRoot = path.resolve(toolDir, "..", "..");

const KNOWN_PREFIXES = [
  "CLASSROOM_TOOLKIT_",
  "TEXT_PROVIDER"
];

const ALLOWED_AI_KINDS = new Set(["openai_compatible"]);
const ALLOWED_TEXT_SURFACES = new Set(["responses", "chat_completions"]);
const ALLOWED_REASONING_EFFORTS = new Set(["none", "low", "medium", "high", "xhigh", "max"]);
export const DEFAULT_EXECUTION_SLOT_COUNT = EXECUTION_SLOT_COUNT;
const DEFAULT_EXECUTION_SLOT_BY_ROLE = Object.freeze({
  primary: 1,
  fallback_1: 2,
  fallback_2: 3,
  fallback_3: 4,
  fallback_4: 5
});
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

function numberOrDefault(env, key, fallback) {
  const value = get(env, key);
  return value.length === 0 ? fallback : Number(value);
}

function readAiProvider(env, role, canonicalPrefix, legacyPrefix, inherited = null) {
  const hasCanonical = hasAny(env, `${canonicalPrefix}_`);
  const hasLegacy = hasAny(env, `${legacyPrefix}_`);
  if (!hasCanonical && !hasLegacy) {
    return null;
  }

  const source = hasCanonical ? "canonical" : "legacy";
  const prefix = hasCanonical ? canonicalPrefix : legacyPrefix;
  const inheritFlagRaw = get(env, `${prefix}_INHERIT_PRIMARY`);
  const inheritPrimaryConnection = inherited !== null && boolValue(inheritFlagRaw);
  const model = hasCanonical ? get(env, `${prefix}_TEXT_MODEL`) : get(env, `${prefix}_MODEL`);
  const visionModel = hasCanonical ? get(env, `${prefix}_VISION_MODEL`) || model : model;
  const executionSlotRaw = get(env, `${prefix}_EXECUTION_SLOT`);
  const executionSlot = executionSlotRaw.length > 0
    ? Number(executionSlotRaw)
    : defaultExecutionSlotForRole(role);

  // Connection provenance probes for the fallback contract: cross-gateway key
  // reuse and partial inheritance must be caught at validate time, not live.
  const ownConnection = {
    baseUrl: Boolean(get(env, `${prefix}_BASE_URL`)),
    apiKey: Boolean(get(env, `${prefix}_API_KEY`)),
    kind: Boolean(get(env, `${prefix}_KIND`)),
    textSurface: Boolean(get(env, `${prefix}_TEXT_SURFACE`)),
    visionSurface: Boolean(get(env, `${prefix}_VISION_SURFACE`))
  };

  return {
    lane: "ai",
    role,
    source,
    kind: inheritPrimaryConnection ? inherited.kind : get(env, `${prefix}_KIND`) || inherited?.kind || "openai_compatible",
    baseUrl: inheritPrimaryConnection ? inherited.baseUrl : get(env, `${prefix}_BASE_URL`) || inherited?.baseUrl || "",
    apiKey: inheritPrimaryConnection ? inherited.apiKey : get(env, `${prefix}_API_KEY`) || inherited?.apiKey || "",
    textModel: model || inherited?.textModel || "",
    visionModel: visionModel || inherited?.visionModel || "",
    reasoningEffort: (get(env, `${prefix}_REASONING_EFFORT`) || inherited?.reasoningEffort || "").toLowerCase(),
    textSurface: inheritPrimaryConnection
      ? inherited.textSurface
      : normalizeSurface(get(env, `${prefix}_TEXT_SURFACE`) || inherited?.textSurface || "responses"),
    visionSurface: inheritPrimaryConnection
      ? inherited.visionSurface
      : normalizeSurface(get(env, `${prefix}_VISION_SURFACE`) || inherited?.visionSurface || "responses"),
    executionSlot,
    _inheritPrimaryConnection: inheritPrimaryConnection,
    _inheritFlagPresent: inherited !== null && inheritFlagRaw != null && inheritFlagRaw !== "",
    _ownConnection: ownConnection
  };
}

function defaultExecutionSlotForRole(role) {
  if (Object.hasOwn(DEFAULT_EXECUTION_SLOT_BY_ROLE, role)) {
    return DEFAULT_EXECUTION_SLOT_BY_ROLE[role];
  }
  const match = role.match(/^fallback_(\d+)$/);
  return match ? ((Number(match[1]) - 1) % DEFAULT_EXECUTION_SLOT_COUNT) + 1 : 1;
}

function discoverAiFallbackIndices(env) {
  const indices = new Set();
  for (const key of Object.keys(env)) {
    const canonical = key.match(/^CLASSROOM_TOOLKIT_AI_FALLBACK_(\d+)_/);
    const legacy = key.match(/^TEXT_PROVIDER_FALLBACK_(\d+)_/);
    const index = canonical?.[1] ?? legacy?.[1];
    if (index && Number(index) > 0) {
      indices.add(Number(index));
    }
  }
  return [...indices].sort((left, right) => left - right);
}

function normalizeSurface(value) {
  return value.trim().toLowerCase().replace(/-/g, "_");
}

function presetSlotEnvKey(preset, slot) {
  return `CLASSROOM_TOOLKIT_AI_PRESET_${preset.toUpperCase()}_SLOT_${slot}`;
}

function readPresetSlotBindings(env) {
  const bindings = {};
  let explicit = false;
  const errors = [];
  for (const preset of PRESET_NAMES) {
    const configured = [];
    const values = DEFAULT_PRESET_SLOT_BINDINGS[preset].map((defaultProfile, index) => {
      const raw = get(env, presetSlotEnvKey(preset, index + 1));
      configured.push(raw.length > 0);
      return raw.length > 0 ? raw.toLowerCase() : defaultProfile;
    });
    if (configured.some(Boolean)) {
      explicit = true;
      if (!configured.every(Boolean)) {
        errors.push(`${preset}: all five ${presetSlotEnvKey(preset, "<N>")} bindings are required when overriding a preset.`);
      }
    }
    bindings[preset] = Object.freeze(values);
  }
  return { bindings: Object.freeze(bindings), explicit, errors };
}

export function normalizeConfig(env) {
  const primaryAi = readAiProvider(env, "primary", "CLASSROOM_TOOLKIT_AI_PRIMARY", "TEXT_PROVIDER");
  const aiFallbacks = discoverAiFallbackIndices(env).map((index) => readAiProvider(
    env,
    `fallback_${index}`,
    `CLASSROOM_TOOLKIT_AI_FALLBACK_${index}`,
    `TEXT_PROVIDER_FALLBACK_${index}`,
    primaryAi
  ));
  const providers = [
    primaryAi,
    ...aiFallbacks
  ].filter(Boolean);
  const presetSlotConfig = readPresetSlotBindings(env);

  return {
    cloudEgressEnabled: boolValue(get(env, "CLASSROOM_TOOLKIT_CLOUD_EGRESS_ENABLED")),
    executionSlotCount: numberOrDefault(env, "CLASSROOM_TOOLKIT_AI_EXECUTION_SLOT_COUNT", DEFAULT_EXECUTION_SLOT_COUNT),
    runtimeDirectory: get(env, "CLASSROOM_TOOLKIT_AI_RUNTIME_DIRECTORY"),
    presetCooldownMs: numberOrDefault(env, "CLASSROOM_TOOLKIT_AI_PRESET_COOLDOWN_MS", 120000),
    recoveryProbeEnabled: boolValue(get(env, "CLASSROOM_TOOLKIT_AI_RECOVERY_PROBE_ENABLED")),
    recoveryProbeIntervalMs: numberOrDefault(env, "CLASSROOM_TOOLKIT_AI_RECOVERY_PROBE_INTERVAL_MS", 300000),
    recoveryProbeFailureIntervalMs: numberOrDefault(env, "CLASSROOM_TOOLKIT_AI_RECOVERY_PROBE_FAILURE_INTERVAL_MS", 900000),
    recoveryProbeSuccessThreshold: numberOrDefault(env, "CLASSROOM_TOOLKIT_AI_RECOVERY_PROBE_SUCCESS_THRESHOLD", 2),
    recoveryProbeJitterMs: numberOrDefault(env, "CLASSROOM_TOOLKIT_AI_RECOVERY_PROBE_JITTER_MS", 30000),
    recoveryProbeTimeoutMs: numberOrDefault(env, "CLASSROOM_TOOLKIT_AI_RECOVERY_PROBE_TIMEOUT_MS", 10000),
    presetSlotBindings: presetSlotConfig.bindings,
    presetSlotsExplicit: presetSlotConfig.explicit,
    presetSlotErrors: presetSlotConfig.errors,
    providers
  };
}

export function validateConfig(config, options, parseErrors) {
  const errors = [...parseErrors, ...(config.presetSlotErrors ?? [])];
  const warnings = [];

  if (config.providers.length === 0) {
    errors.push("No AI gateway providers are configured.");
  }

  if (!Number.isInteger(config.executionSlotCount)
      || config.executionSlotCount < 1
      || config.executionSlotCount > DEFAULT_EXECUTION_SLOT_COUNT) {
    errors.push(`AI execution slot count must be an integer between 1 and ${DEFAULT_EXECUTION_SLOT_COUNT}.`);
  }
  if (!Number.isInteger(config.presetCooldownMs)
      || config.presetCooldownMs < 1000
      || config.presetCooldownMs > 3_600_000) {
    errors.push("AI preset cooldown must be an integer between 1000 and 3600000 milliseconds.");
  }
  for (const [key, value, minimum, maximum] of [
    ["AI recovery probe interval", config.recoveryProbeIntervalMs, 60_000, 3_600_000],
    ["AI recovery probe failure interval", config.recoveryProbeFailureIntervalMs, 60_000, 3_600_000],
    ["AI recovery probe jitter", config.recoveryProbeJitterMs, 0, 300_000],
    ["AI recovery probe timeout", config.recoveryProbeTimeoutMs, 1_000, 120_000]
  ]) {
    if (!Number.isInteger(value) || value < minimum || value > maximum) {
      errors.push(`${key} must be an integer between ${minimum} and ${maximum} milliseconds.`);
    }
  }
  if (!Number.isInteger(config.recoveryProbeSuccessThreshold)
      || config.recoveryProbeSuccessThreshold < 1
      || config.recoveryProbeSuccessThreshold > 5) {
    errors.push("AI recovery probe success threshold must be an integer between 1 and 5.");
  }
  if (config.recoveryProbeFailureIntervalMs < config.recoveryProbeIntervalMs) {
    errors.push("AI recovery probe failure interval must be greater than or equal to the normal interval.");
  }
  if (config.presetSlotsExplicit === true && config.executionSlotCount !== DEFAULT_EXECUTION_SLOT_COUNT) {
    errors.push(`AI execution slot count must be ${DEFAULT_EXECUTION_SLOT_COUNT} when preset slot bindings are configured.`);
  }
  for (const preset of PRESET_NAMES) {
    const bindings = config.presetSlotBindings?.[preset] ?? [];
    if (bindings.length !== DEFAULT_EXECUTION_SLOT_COUNT) {
      errors.push(`${preset}: exactly ${DEFAULT_EXECUTION_SLOT_COUNT} preset slot bindings are required.`);
      continue;
    }
    for (const [index, profile] of bindings.entries()) {
      if (!PRESET_PROFILES[preset].includes(profile)) {
        errors.push(`${preset} slot ${index + 1}: profile '${profile}' must remain ${preset}-only.`);
      }
    }
    for (const profile of PRESET_PROFILES[preset]) {
      if (!bindings.includes(profile)) {
        errors.push(`${preset}: preset slots must include ${profile} at least once.`);
      }
    }
  }

  if (!config.cloudEgressEnabled) {
    warnings.push("Cloud egress is disabled; live probes and cloud-backed visual lanes are blocked until CLASSROOM_TOOLKIT_CLOUD_EGRESS_ENABLED=true.");
  }

  for (const provider of config.providers) {
    validateProvider(provider, config.executionSlotCount, options, errors, warnings);
  }
  validateFallbackConnectionProvenance(config.providers, errors, warnings);

  const primaryAi = config.providers.find((provider) => provider.lane === "ai" && provider.role === "primary");
  if (!primaryAi) {
    warnings.push("No primary AI provider configured; vision understanding cannot use a primary cloud lane.");
  }

  return { errors, warnings };
}

function validateFallbackConnectionProvenance(providers, errors, warnings) {
  const fallbacks = providers.filter((provider) => provider.lane === "ai" && provider.role.startsWith("fallback"));
  for (const provider of fallbacks) {
    const label = `${provider.lane}.${provider.role}`;
    const own = provider._ownConnection;
    const ownFields = Object.entries(own).filter(([, present]) => present).map(([field]) => field);

    if (provider._inheritPrimaryConnection && ownFields.length > 0) {
      errors.push(
        `${label}: CLASSROOM_TOOLKIT_AI_*_${provider.role.toUpperCase()}_INHERIT_PRIMARY=true conflicts with locally set connection fields (${ownFields.join(", ")}); either inherit fully or configure the connection explicitly.`);
      continue;
    }

    if (provider._inheritPrimaryConnection) {
      continue;
    }

    // A distinct endpoint with no key of its own would silently reuse the
    // primary's key against another gateway — fail closed at validate time.
    if (own.baseUrl && !own.apiKey) {
      errors.push(
        `${label}: BASE_URL is set without an API key; it would reuse the primary key across gateways. Set ${provider.role.toUpperCase()}_API_KEY explicitly or set INHERIT_PRIMARY=true to inherit the primary connection entirely.`);
      continue;
    }

    if (ownFields.length === 0) {
      // Compat window: fully-omitted connection fields keep working, loudly.
      warnings.push(
        `${label}: no connection fields set; primary endpoint/key are inherited implicitly (connectionSource=primary). Set INHERIT_PRIMARY=true explicitly before the compatibility window closes.`);
    }
  }
}

function validateProvider(provider, executionSlotCount, options, errors, warnings) {
  const label = `${provider.lane}.${provider.role}`;

  if (!ALLOWED_AI_KINDS.has(provider.kind)) {
    errors.push(`${label}: unsupported kind '${provider.kind}'.`);
  }

  validateBaseUrl(provider.baseUrl, label, errors);
  validateSecret(provider.apiKey, `${label}: api key`, options, errors, warnings);
  validateRequired(provider.textModel, `${label}: text model`, errors);
  validateRequired(provider.visionModel, `${label}: vision model`, errors);
  validateSurface(provider.textSurface, ALLOWED_TEXT_SURFACES, `${label}: text surface`, errors);
  validateSurface(provider.visionSurface, ALLOWED_TEXT_SURFACES, `${label}: vision surface`, errors);
  if (!Number.isInteger(provider.executionSlot)
      || provider.executionSlot < 1
      || provider.executionSlot > executionSlotCount) {
    errors.push(`${label}: execution slot must be an integer between 1 and ${executionSlotCount}.`);
  }
  if (provider.reasoningEffort.length > 0 && !ALLOWED_REASONING_EFFORTS.has(provider.reasoningEffort)) {
    errors.push(`${label}: reasoning effort must be one of ${[...ALLOWED_REASONING_EFFORTS].join(", ")}.`);
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

  return {
    ...base,
    textModel: provider.textModel,
    visionModel: provider.visionModel,
    reasoningEffort: provider.reasoningEffort || null,
    executionSlot: provider.executionSlot,
    textSurface: provider.textSurface,
    visionSurface: provider.visionSurface
  };
}

function printHumanSummary(options, config, validation, liveResults = []) {
  console.log("AI gateway config summary");
  console.log(`- env file: ${path.relative(repoRoot, options.envFile) || "."}`);
  console.log(`- cloud egress: ${config.cloudEgressEnabled ? "enabled" : "disabled"}`);
  console.log(`- execution slots: ${config.executionSlotCount}`);
  console.log(`- preset cooldown: ${config.presetCooldownMs}ms`);
  console.log(`- recovery probe: ${config.recoveryProbeEnabled ? "enabled" : "disabled"}, interval=${config.recoveryProbeIntervalMs}ms, failureInterval=${config.recoveryProbeFailureIntervalMs}ms, successes=${config.recoveryProbeSuccessThreshold}, jitter=${config.recoveryProbeJitterMs}ms, timeout=${config.recoveryProbeTimeoutMs}ms`);
  console.log(`- preset slot bindings: ${JSON.stringify(config.presetSlotBindings)}`);
  for (const provider of config.providers) {
    const summary = summarizeProvider(provider);
    console.log(`- ${summary.lane}.${summary.role}: ${summary.source}, slot=${summary.executionSlot}, ${summary.baseUrl}, text=${summary.textModel}, vision=${summary.visionModel}, reasoning=${summary.reasoningEffort ?? "default"}, key=${summary.apiKey}`);
  }

  for (const warning of validation.warnings) {
    console.warn(`warning: ${warning}`);
  }
  for (const result of liveResults) {
    const profile = result.qualityProfile ? ` profile=${result.qualityProfile}` : "";
    const model = result.model ? ` model=${result.model}` : "";
    const effort = result.reasoningEffort ? ` reasoning=${result.reasoningEffort}` : "";
    const slot = result.executionSlot ? ` slot=${result.executionSlot}` : "";
    console.log(`- live ${result.provider}:${profile}${model}${effort}${slot} ${result.ok ? "ok" : "failed"}${result.status ? ` status=${result.status}` : ""}${result.output ? ` output=${result.output}` : ""}${result.error ? ` error=${result.error}` : ""}`);
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

const executionSlotTails = new Map();

// A slot is a shared in-process queue. Profile selection remains independent,
// while requests mapped to the same slot cannot overload one local gateway lane.
export class ExecutionSlotTimeoutError extends Error {
  constructor(slot, timeoutMs) {
    super(`Execution slot ${slot} wait exceeded the ${timeoutMs}ms attempt timeout.`);
    this.name = "ExecutionSlotTimeoutError";
    this.code = "EXECUTION_SLOT_TIMEOUT";
    this.slot = slot;
    this.timeoutMs = timeoutMs;
  }
}

export async function runInExecutionSlot(slot, operation, options = {}) {
  const normalizedSlot = Number.isInteger(slot) && slot > 0 ? slot : 1;
  const previous = executionSlotTails.get(normalizedSlot) ?? Promise.resolve();
  let release;
  const current = new Promise((resolve) => {
    release = resolve;
  });
  executionSlotTails.set(normalizedSlot, current);
  const timeoutMs = Number.isInteger(options.timeoutMs) && options.timeoutMs > 0
    ? options.timeoutMs
    : null;
  const startedAt = Date.now();
  let waitTimer;
  let timedOutBeforeAcquire = false;
  const finalize = () => {
    release();
    if (executionSlotTails.get(normalizedSlot) === current) {
      executionSlotTails.delete(normalizedSlot);
    }
  };
  try {
    if (timeoutMs === null) {
      await previous;
    } else {
      try {
        await Promise.race([
          previous,
          new Promise((_, reject) => {
            waitTimer = setTimeout(
              () => reject(new ExecutionSlotTimeoutError(normalizedSlot, timeoutMs)),
              timeoutMs);
          })
        ]);
      } catch (error) {
        if (error instanceof ExecutionSlotTimeoutError) {
          // Keep this node in the chain until the prior operation completes;
          // otherwise a later caller could bypass an active slot occupant.
          timedOutBeforeAcquire = true;
          previous.then(finalize, finalize);
        }
        throw error;
      }
      const remainingTimeoutMs = timeoutMs - (Date.now() - startedAt);
      if (remainingTimeoutMs <= 0) {
        throw new ExecutionSlotTimeoutError(normalizedSlot, timeoutMs);
      }
      return await operation(remainingTimeoutMs);
    }
    return await operation(null);
  } finally {
    if (waitTimer) {
      clearTimeout(waitTimer);
    }
    if (!timedOutBeforeAcquire) {
      finalize();
    }
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

  const selected = orderedTextProbeProviders(config, options.provider);

  if (selected.length === 0) {
    throw new Error(`No ${options.provider} AI provider is configured for live text probe.`);
  }

  const results = [];
  for (const provider of selected) {
    results.push(await probeTextProvider(config, provider, options.timeoutMs));
  }
  return results;
}

async function callTextProviderInSharedSlot(config, provider, options) {
  const startedAt = Date.now();
  const lease = await acquireSharedExecutionSlot(config, [provider.executionSlot], options.timeoutMs);
  if (!lease) {
    throw new ExecutionSlotTimeoutError(provider.executionSlot, options.timeoutMs);
  }
  provider.executionSlot = lease.slot;
  try {
    const remainingTimeoutMs = options.timeoutMs - (Date.now() - startedAt);
    if (remainingTimeoutMs <= 0) {
      throw new ExecutionSlotTimeoutError(lease.slot, options.timeoutMs);
    }
    return await runInExecutionSlot(lease.slot, (slotRemainingTimeoutMs) => callTextProvider(provider, {
      ...options,
      timeoutMs: slotRemainingTimeoutMs ?? remainingTimeoutMs
    }), { timeoutMs: remainingTimeoutMs });
  } finally {
    lease.release();
  }
}

export async function probeTextProvider(config, provider, timeoutMs) {
  let result;
  try {
    result = await callTextProviderInSharedSlot(config, provider, {
      prompt: "Return exactly OK.",
      timeoutMs,
      maxOutputTokens: 8
    });
  } catch (error) {
    if (!(error instanceof ExecutionSlotTimeoutError)) {
      throw error;
    }
    result = {
      provider: provider.role,
      ok: false,
      status: null,
      output: "",
      error: error.message
    };
  }
  return {
    provider: provider.role,
    qualityProfile: provider.qualityProfile ?? null,
    model: provider.textModel,
    reasoningEffort: provider.reasoningEffort || null,
    executionSlot: provider.executionSlot ?? null,
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
    const forcedFailure = options.forcePrimaryFailure === true && provider === providers[0];
    const attemptStartedAt = Date.now();
    let attempt;
    if (forcedFailure) {
      attempt = forcedRetryableFailure(provider);
    } else {
      try {
        attempt = await callTextProviderInSharedSlot(config, provider, {
          prompt: options.prompt,
          timeoutMs: options.timeoutMs,
          maxOutputTokens: options.maxOutputTokens
        });
      } catch (error) {
        if (!(error instanceof ExecutionSlotTimeoutError)) {
          throw error;
        }
        attempt = {
          provider: provider.role,
          ok: false,
          retryable: true,
          status: null,
          output: "",
          error: error.message,
          durationMs: Date.now() - attemptStartedAt
        };
      }
    }

    attempt.model ??= provider.textModel;
    attempt.reasoningEffort ??= provider.reasoningEffort || null;
    attempt.qualityProfile ??= provider.qualityProfile ?? null;
    attempt.executionSlot ??= provider.executionSlot;

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
      // Provider-local rejections must not veto the remaining roles in the chain.
      if (!PROVIDER_LOCAL_FAILURE_STATUSES.has(attempt.status) || provider === providers.at(-1)) {
        return {
          ok: false,
          provider: provider.role,
          output: "",
          attempts,
          error: attempt.error
        };
      }
      continue;
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

function executionSlotForProfile(config, profile, provider) {
  const preset = presetForProfile(profile);
  return slotsForPresetProfile(config.presetSlotBindings, preset, profile)[0]
    ?? provider.executionSlot
    ?? 1;
}

function orderedAiProviders(config) {
  if (config.presetSlotsExplicit === true) {
    const candidates = config.providers
      .filter((provider) => provider.lane === "ai")
      .sort((left, right) => providerOrder(left.role) - providerOrder(right.role));
    const connections = uniqueConnections(candidates);
    return TEXT_FAILOVER_PROFILES.flatMap((profile) => connections.map((provider) => ({
      ...provider,
      textModel: profile.model,
      visionModel: profile.model,
      reasoningEffort: profile.reasoningEffort,
      qualityProfile: profile.profile,
      executionSlot: executionSlotForProfile(config, profile.profile, provider)
    })));
  }
  return TEXT_FAILOVER_PROFILES.flatMap((profile) => config.providers
    .filter((provider) => provider.lane === "ai")
    .filter((provider) => provider.textModel === profile.model
      && provider.reasoningEffort === profile.reasoningEffort)
    .sort((left, right) => providerOrder(left.role) - providerOrder(right.role)));
}

function orderedTextProbeProviders(config, target) {
  const matchesTarget = (provider) => target === "all"
    || (target === "primary" && provider.role === "primary")
    || (target === "fallback" && provider.role.startsWith("fallback"));
  const candidates = config.providers
    .filter((provider) => provider.lane === "ai")
    .filter(matchesTarget)
    .sort((left, right) => providerOrder(left.role) - providerOrder(right.role));

  if (config.presetSlotsExplicit !== true) {
    return candidates;
  }

  const connections = uniqueConnections(candidates);
  return QUALITY_PROFILE_ORDER.flatMap((profileName) => {
    const profile = QUALITY_PROFILES[profileName];
    return connections.map((provider) => ({
      ...provider,
      textModel: profile.model,
      visionModel: profile.model,
      reasoningEffort: profile.reasoningEffort,
      qualityProfile: profileName,
      executionSlot: executionSlotForProfile(config, profileName, provider)
    }));
  });
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

function uniqueConnections(providers) {
  const seen = new Set();
  return providers.filter((provider) => {
    const fingerprint = connectionFingerprint(provider);
    if (seen.has(fingerprint)) {
      return false;
    }
    seen.add(fingerprint);
    return true;
  });
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
    model: provider.textModel,
    reasoningEffort: provider.reasoningEffort || null,
    executionSlot: provider.executionSlot,
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
      body: JSON.stringify(buildTextRequestBody(provider, options.prompt, options.maxOutputTokens))
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

// Provider-local rejections: the endpoint itself refused (bad key/URL/payload
// size), so another same-profile role with its own connection may still serve.
export const PROVIDER_LOCAL_FAILURE_STATUSES = Object.freeze(new Set([401, 403, 404, 405, 413]));

function joinUrl(baseUrl, endpointPath) {
  return `${baseUrl.replace(/\/+$/, "")}/${endpointPath}`;
}

function buildTextRequestBody(provider, prompt, requestedMaxOutputTokens) {
  const maxOutputTokens = Number.isInteger(requestedMaxOutputTokens) ? requestedMaxOutputTokens : 8;
  if (provider.textSurface === "chat_completions") {
    return {
      model: provider.textModel,
      ...(provider.reasoningEffort ? { reasoning_effort: provider.reasoningEffort } : {}),
      messages: [
        { role: "user", content: prompt }
      ],
      max_tokens: maxOutputTokens
    };
  }

  return {
    model: provider.textModel,
    ...(provider.reasoningEffort ? { reasoning: { effort: provider.reasoningEffort } } : {}),
    input: prompt,
    max_output_tokens: maxOutputTokens
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
  if (options.live) {
    console.error("[deprecated] --live text probes (npm run probe:text) are deprecated and will be removed on 2026-09-30.");
  }
  const { env, parseErrors } = loadEnvironment(options);
  const config = normalizeConfig(env);
  if (config.providers.some((provider) => provider.source === "legacy")) {
    console.error("[deprecated] TEXT_PROVIDER_* legacy env prefixes are deprecated and will be removed on 2026-09-30; migrate to CLASSROOM_TOOLKIT_AI_*.");
  }
  const validation = validateConfig(config, options, parseErrors);
  const liveResults = validation.errors.length === 0 ? await runLiveTextProbes(config, options) : [];
  const liveFailed = liveResults.some((result) => !result.ok);

  if (options.json) {
    console.log(JSON.stringify({
      envFile: path.relative(repoRoot, options.envFile) || ".",
      cloudEgressEnabled: config.cloudEgressEnabled,
      executionSlotCount: config.executionSlotCount,
      runtimeDirectory: config.runtimeDirectory || null,
      presetCooldownMs: config.presetCooldownMs,
      recoveryProbeEnabled: config.recoveryProbeEnabled,
      recoveryProbeIntervalMs: config.recoveryProbeIntervalMs,
      recoveryProbeFailureIntervalMs: config.recoveryProbeFailureIntervalMs,
      recoveryProbeSuccessThreshold: config.recoveryProbeSuccessThreshold,
      recoveryProbeJitterMs: config.recoveryProbeJitterMs,
      recoveryProbeTimeoutMs: config.recoveryProbeTimeoutMs,
      presetSlotBindings: config.presetSlotBindings,
      presetSlotsExplicit: config.presetSlotsExplicit,
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
