import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  assertLiveEgressAllowed,
  isRetryableGatewayFailure,
  loadGatewayConfig,
  requireValue,
  repoRoot
} from "./validate-config.mjs";
import { validateValueAgainstSchema } from "../rule-compiler/schema-validator.mjs";

const syntheticPngBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";
const trackResultSchemaPath = path.join(repoRoot, "prompts", "shared", "schemas", "track-result.schema.json");

function usage() {
  return [
    "Usage:",
    "  npm --prefix tools/ai-gateway run request:vision -- --allow-cloud-egress --synthetic-image",
    "  npm --prefix tools/ai-gateway run request:vision -- --allow-cloud-egress --image <path>",
    "",
    "Options:",
    "  --config-env-file <path>       Env file to read; defaults to .env",
    "  --allow-cloud-egress           Required for live requests",
    "  --image <path>                 Synthetic or de-identified image to send",
    "  --synthetic-image              Use a built-in 1x1 PNG smoke image",
    "  --prompt <text>                Override the TrackResult prompt",
    "  --subject-pack <id>            Subject-pack label for the prompt; default math-answer",
    "  --evidence-bundle-ref <id>     Expected evidence bundle ref",
    "  --track-result-id <id>         Expected TrackResult id",
    "  --visual-detail <mode>         low, high, or original; default high",
    "  --provider <target>            primary, fallback, or all; default all",
    "  --force-primary-failure        Simulate a retryable primary failure, then use fallback",
    "  --timeout-ms <ms>              Per-provider timeout; default 30000",
    "  --json                         Emit JSON summary"
  ].join("\n");
}

function parseArgs(argv) {
  const options = {
    envFile: path.join(repoRoot, ".env"),
    allowCloudEgress: false,
    imagePath: null,
    syntheticImage: false,
    prompt: null,
    subjectPack: "math-answer",
    evidenceBundleRef: "bundle.synthetic-vision-smoke",
    trackResultId: "track-a.synthetic-vision-smoke",
    visualDetailMode: "high",
    provider: "all",
    forcePrimaryFailure: false,
    timeoutMs: 30000,
    json: false
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
    if (arg === "--allow-cloud-egress") {
      options.allowCloudEgress = true;
      continue;
    }
    if (arg === "--image") {
      options.imagePath = path.resolve(repoRoot, requireValue(argv, ++index, arg));
      continue;
    }
    if (arg.startsWith("--image=")) {
      options.imagePath = path.resolve(repoRoot, arg.slice("--image=".length));
      continue;
    }
    if (arg === "--synthetic-image" || arg === "--synthetic-smoke") {
      options.syntheticImage = true;
      continue;
    }
    if (arg === "--prompt") {
      options.prompt = requireValue(argv, ++index, arg);
      continue;
    }
    if (arg.startsWith("--prompt=")) {
      options.prompt = arg.slice("--prompt=".length);
      continue;
    }
    if (arg === "--subject-pack") {
      options.subjectPack = requireValue(argv, ++index, arg);
      continue;
    }
    if (arg.startsWith("--subject-pack=")) {
      options.subjectPack = arg.slice("--subject-pack=".length);
      continue;
    }
    if (arg === "--evidence-bundle-ref") {
      options.evidenceBundleRef = requireValue(argv, ++index, arg);
      continue;
    }
    if (arg.startsWith("--evidence-bundle-ref=")) {
      options.evidenceBundleRef = arg.slice("--evidence-bundle-ref=".length);
      continue;
    }
    if (arg === "--track-result-id") {
      options.trackResultId = requireValue(argv, ++index, arg);
      continue;
    }
    if (arg.startsWith("--track-result-id=")) {
      options.trackResultId = arg.slice("--track-result-id=".length);
      continue;
    }
    if (arg === "--visual-detail") {
      options.visualDetailMode = requireValue(argv, ++index, arg);
      continue;
    }
    if (arg.startsWith("--visual-detail=")) {
      options.visualDetailMode = arg.slice("--visual-detail=".length);
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
    if (arg === "--force-primary-failure") {
      options.forcePrimaryFailure = true;
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
    if (arg === "--json") {
      options.json = true;
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

  if (!["low", "high", "original"].includes(options.visualDetailMode)) {
    throw new Error("--visual-detail must be low, high, or original.");
  }

  if (!["primary", "fallback", "all"].includes(options.provider)) {
    throw new Error("--provider must be primary, fallback, or all.");
  }

  if (!options.syntheticImage && !options.imagePath) {
    throw new Error("--image or --synthetic-image is required.");
  }

  if (options.syntheticImage && options.imagePath) {
    throw new Error("Use only one of --image or --synthetic-image.");
  }

  if (options.prompt === null) {
    options.prompt = buildVisionPrompt(options);
  }

  return options;
}

export function buildVisionPrompt(options = {}) {
  const subjectPack = options.subjectPack ?? "math-answer";
  const evidenceBundleRef = options.evidenceBundleRef ?? "bundle.synthetic-vision-smoke";
  const trackResultId = options.trackResultId ?? "track-a.synthetic-vision-smoke";

  return [
    "You are validating a synthetic or de-identified classroom image input.",
    "Return only one JSON object that conforms to track-result.schema.json.",
    "Do not solve a real student exam in this probe.",
    `Use kind=track-result, trackType=vlm_direct, candidateSourceType=generated, evidenceBundleRef=${evidenceBundleRef}, trackResultId=${trackResultId}.`,
    `Mention subjectPack=${subjectPack} only inside evidence or summary text if needed.`,
    "Set risk.reviewRequired=true unless this is later approved by a separate DecisionRecord."
  ].join("\n");
}

export async function requestVisionWithFailover(config, options) {
  assertLiveEgressAllowed(config, options.allowCloudEgress);

  if (typeof fetch !== "function") {
    throw new Error("This Node.js runtime does not provide fetch; use a newer Node.js runtime for live requests.");
  }

  const providers = orderedAiProviders(config, options.provider ?? "all");
  if (providers.length === 0) {
    throw new Error(`No ${options.provider ?? "all"} AI providers are configured for vision requests.`);
  }

  const attempts = [];
  for (const provider of providers) {
    const forcedFailure = options.forcePrimaryFailure === true && provider.role === "primary";
    const attempt = forcedFailure
      ? forcedRetryableFailure(provider)
      : await callVisionProvider(provider, options);

    attempts.push(attempt);
    if (attempt.ok) {
      return {
        ok: true,
        provider: provider.role,
        trackResult: attempt.trackResult,
        schemaErrors: attempt.schemaErrors,
        attempts
      };
    }

    if (!attempt.retryable) {
      return {
        ok: false,
        provider: provider.role,
        trackResult: null,
        schemaErrors: attempt.schemaErrors ?? [],
        attempts,
        error: attempt.error
      };
    }
  }

  return {
    ok: false,
    provider: attempts.at(-1)?.provider ?? null,
    trackResult: null,
    schemaErrors: [],
    attempts,
    error: "All configured AI providers failed with retryable errors."
  };
}

async function callVisionProvider(provider, options) {
  const endpointPath = provider.visionSurface === "chat_completions" ? "chat/completions" : "responses";
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
        "User-Agent": "classroom-answer-toolkit-ai-gateway-vision-probe/1.0"
      },
      body: JSON.stringify(buildVisionRequestBody(provider, options))
    });

    const bodyText = await response.text();
    if (!response.ok) {
      return {
        provider: provider.role,
        ok: false,
        retryable: isRetryableGatewayFailure(response.status),
        status: response.status,
        error: summarizeResponseBody(bodyText)
      };
    }

    let parsed;
    try {
      parsed = JSON.parse(bodyText);
    } catch (error) {
      return {
        provider: provider.role,
        ok: false,
        retryable: false,
        status: response.status,
        error: `Provider response was not valid JSON: ${error instanceof Error ? error.message : String(error)}`
      };
    }

    const output = extractTextOutput(parsed);
    let trackResult;
    try {
      trackResult = parseTrackResult(output);
    } catch (error) {
      return {
        provider: provider.role,
        ok: false,
        retryable: false,
        status: response.status,
        output: output.slice(0, 240),
        error: `Provider output did not contain a valid TrackResult JSON object: ${error instanceof Error ? error.message : String(error)}`
      };
    }

    const schemaErrors = validateTrackResult(trackResult, options);
    return {
      provider: provider.role,
      ok: schemaErrors.length === 0,
      retryable: false,
      status: response.status,
      output: output.slice(0, 240),
      trackResult,
      schemaErrors,
      error: schemaErrors.length > 0 ? schemaErrors.join("; ") : ""
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      provider: provider.role,
      ok: false,
      retryable: true,
      status: null,
      error: errorMessage
    };
  } finally {
    clearTimeout(timeout);
  }
}

function buildVisionRequestBody(provider, options) {
  const dataUrl = imageDataUrl(options);
  if (provider.visionSurface === "chat_completions") {
    return {
      model: provider.visionModel,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: options.prompt },
            {
              type: "image_url",
              image_url: {
                url: dataUrl,
                detail: normalizeDetailForProvider(options.visualDetailMode)
              }
            }
          ]
        }
      ],
      response_format: {
        type: "json_schema",
        json_schema: trackResultJsonSchemaFormat()
      },
      max_tokens: 1200
    };
  }

  return {
    model: provider.visionModel,
    input: [
      {
        role: "user",
        content: [
          { type: "input_text", text: options.prompt },
          {
            type: "input_image",
            image_url: dataUrl,
            detail: normalizeDetailForProvider(options.visualDetailMode)
          }
        ]
      }
    ],
    text: {
      format: {
        type: "json_schema",
        ...trackResultJsonSchemaFormat()
      }
    },
    max_output_tokens: 1200
  };
}

function trackResultJsonSchemaFormat() {
  return {
    name: "track_result",
    schema: trackResultProviderSchema(),
    strict: false
  };
}

function trackResultProviderSchema() {
  const schema = JSON.parse(fs.readFileSync(trackResultSchemaPath, "utf8"));
  const {
    $schema,
    $id,
    compatibility,
    title,
    ...providerSchema
  } = schema;
  return providerSchema;
}

function imageDataUrl(options) {
  if (options.syntheticImage) {
    return `data:image/png;base64,${syntheticPngBase64}`;
  }

  if (!fs.existsSync(options.imagePath)) {
    throw new Error(`Image file not found: ${options.imagePath}`);
  }

  const mimeType = mimeTypeForPath(options.imagePath);
  const base64 = fs.readFileSync(options.imagePath).toString("base64");
  return `data:${mimeType};base64,${base64}`;
}

function mimeTypeForPath(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".jpg" || ext === ".jpeg") {
    return "image/jpeg";
  }
  if (ext === ".webp") {
    return "image/webp";
  }
  if (ext === ".gif") {
    return "image/gif";
  }
  return "image/png";
}

function normalizeDetailForProvider(detailMode) {
  return detailMode === "original" ? "high" : detailMode;
}

function orderedAiProviders(config, providerTarget) {
  return config.providers
    .filter((provider) => provider.lane === "ai")
    .filter((provider) => {
      if (providerTarget === "all") {
        return true;
      }
      if (providerTarget === "primary") {
        return provider.role === "primary";
      }
      return provider.role.startsWith("fallback");
    })
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
    error: "forced retryable primary failure"
  };
}

function joinUrl(baseUrl, endpointPath) {
  return `${baseUrl.replace(/\/+$/, "")}/${endpointPath}`;
}

function parseTrackResult(output) {
  const jsonText = extractJsonObject(output);
  return JSON.parse(jsonText);
}

function extractJsonObject(output) {
  const trimmed = output.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    return trimmed;
  }

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) {
    return extractJsonObject(fenced[1]);
  }

  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) {
    return trimmed.slice(start, end + 1);
  }

  throw new Error("Provider response did not contain a JSON object.");
}

function validateTrackResult(trackResult, options) {
  const errors = validateValueAgainstSchema(trackResult, trackResultSchemaPath);
  if (trackResult.kind !== "track-result") {
    errors.push("$.kind should be track-result.");
  }
  if (trackResult.trackType !== "vlm_direct") {
    errors.push("$.trackType should be vlm_direct for the vision gateway lane.");
  }
  if (trackResult.evidenceBundleRef !== options.evidenceBundleRef) {
    errors.push(`$.evidenceBundleRef should be ${options.evidenceBundleRef}.`);
  }
  if (trackResult.trackResultId !== options.trackResultId) {
    errors.push(`$.trackResultId should be ${options.trackResultId}.`);
  }
  return errors;
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

function redactAttempt(attempt) {
  return {
    provider: attempt.provider,
    ok: attempt.ok,
    retryable: attempt.retryable,
    status: attempt.status,
    output: attempt.output ? attempt.output.slice(0, 120) : "",
    schemaErrors: attempt.schemaErrors ?? [],
    error: attempt.error ? attempt.error.slice(0, 240) : ""
  };
}

function printHuman(result) {
  for (const attempt of result.attempts) {
    const status = attempt.status ? ` status=${attempt.status}` : "";
    const retryable = attempt.retryable ? " retryable=true" : " retryable=false";
    const schema = attempt.schemaErrors?.length ? ` schemaErrors=${attempt.schemaErrors.join(" | ")}` : "";
    const error = attempt.error ? ` error=${attempt.error.slice(0, 240)}` : "";
    console.log(`- attempt ${attempt.provider}: ${attempt.ok ? "ok" : "failed"}${status}${retryable}${schema}${error}`);
  }

  console.log(`Vision request ${result.ok ? "OK" : "FAILED"} via ${result.provider ?? "none"}.`);
}

export async function main() {
  const options = parseArgs(process.argv.slice(2));
  const loaded = loadGatewayConfig({
    envFile: options.envFile,
    allowMissingSecrets: false
  });
  const { config, validation } = loaded;

  if (validation.errors.length > 0) {
    for (const error of validation.errors) {
      console.error(`error: ${error}`);
    }
    process.exitCode = 1;
    return;
  }

  const result = await requestVisionWithFailover(config, options);

  if (options.json) {
    console.log(JSON.stringify({
      ok: result.ok,
      provider: result.provider,
      trackResultId: result.trackResult?.trackResultId ?? null,
      evidenceBundleRef: result.trackResult?.evidenceBundleRef ?? null,
      schemaErrors: result.schemaErrors ?? [],
      attempts: result.attempts.map(redactAttempt),
      error: result.error ?? ""
    }, null, 2));
  } else {
    printHuman(result);
  }

  if (!result.ok) {
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
