import crypto from "node:crypto";
import fs from "node:fs";

export function sha256Hex(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function sha256File(filePath) {
  // Chunked reading keeps large PDFs/page images out of a single big buffer.
  const handle = fs.openSync(filePath, "r");
  try {
    const hash = crypto.createHash("sha256");
    const buffer = Buffer.alloc(1024 * 1024);
    let read = 0;
    while ((read = fs.readSync(handle, buffer)) > 0) {
      hash.update(read === buffer.length ? buffer : buffer.subarray(0, read));
    }
    return hash.digest("hex");
  } finally {
    fs.closeSync(handle);
  }
}

// An abnormal or hostile gateway can stream an unbounded body; reading it
// whole would exhaust memory before any schema check runs.
export const MAX_PROVIDER_RESPONSE_BYTES = 32 * 1024 * 1024;

const DEFAULT_PROVIDER_ERROR_LENGTH = 300;

/**
 * A provider error body can echo the request back (prompt, inlined page
 * images), so receipts must never embed it verbatim. Keep only short provider
 * error text and replace anything that looks like a payload.
 */
export function sanitizeProviderErrorText(value, maxLength = DEFAULT_PROVIDER_ERROR_LENGTH) {
  return String(value)
    .replace(/data:[a-z0-9.+-]+\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=]+/giu, "<embedded-data-url>")
    .replace(/[A-Za-z0-9+/]{200,}={0,2}/gu, "<redacted-blob>")
    .replace(/[\u0000-\u001f\u007f]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, maxLength);
}

/**
 * Summarizes an error response without echoing its body: only the provider's
 * own structured error text survives, and never more than `maxLength` chars.
 */
export function summarizeProviderErrorBody(bodyText, maxLength = DEFAULT_PROVIDER_ERROR_LENGTH) {
  let parsed;
  try {
    parsed = JSON.parse(bodyText);
  } catch {
    return `Provider returned a non-JSON error body (${Buffer.byteLength(bodyText)} bytes).`;
  }

  const candidates = [
    parsed?.error?.message,
    parsed?.error?.code,
    parsed?.error?.type,
    parsed?.message
  ].filter((value) => typeof value === "string" && value.trim().length > 0);

  if (candidates.length === 0) {
    return `Provider returned an error body without a message (${Buffer.byteLength(bodyText)} bytes).`;
  }

  return sanitizeProviderErrorText([...new Set(candidates)].join(": "), maxLength);
}

/**
 * Reads a fetch Response body as UTF-8 text with a hard byte cap. Checks the
 * declared Content-Length first, then enforces the limit while streaming.
 */
export async function readResponseTextCapped(response, maxBytes = MAX_PROVIDER_RESPONSE_BYTES) {
  const declared = Number(response.headers?.get?.("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new Error(`Provider response declared ${declared} bytes, above the ${maxBytes}-byte limit.`);
  }

  const body = response.body;
  if (!body || typeof body.getReader !== "function") {
    const text = await response.text();
    if (Buffer.byteLength(text) > maxBytes) {
      throw new Error(`Provider response exceeded the ${maxBytes}-byte limit.`);
    }
    return text;
  }

  const reader = body.getReader();
  const chunks = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
        throw new Error(`Provider response exceeded the ${maxBytes}-byte limit.`);
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock?.();
  }

  return Buffer.concat(chunks).toString("utf8");
}

const UNSAFE_MERGE_KEYS = new Set(["__proto__", "constructor", "prototype"]);

export function deepMerge(base, override) {
  if (!override || typeof override !== "object" || Array.isArray(override)) {
    return base;
  }

  const merged = { ...base };
  for (const [key, value] of Object.entries(override)) {
    if (UNSAFE_MERGE_KEYS.has(key)) {
      continue;
    }
    if (
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      base[key] &&
      typeof base[key] === "object" &&
      !Array.isArray(base[key])
    ) {
      merged[key] = deepMerge(base[key], value);
    } else {
      merged[key] = value;
    }
  }
  return merged;
}

function kebabToCamel(name) {
  return name.replace(/-([a-z])/g, (_, character) => character.toUpperCase());
}

/**
 * Parses the `--flag value` / `--flag=value` convention shared by the Node CLIs.
 * `stringFlags` / `booleanFlags` map flag name to the target option key
 * (`true` derives the key as kebab-case -> camelCase). Boolean flags only
 * accept the bare `--flag` form; `--flag=value` falls through to the unknown
 * flag policy, matching the per-CLI parsers this replaces. Unknown flags are
 * ignored by default, collected as positionals with `unknownFlag: "positional"`,
 * or rejected with `unknownFlag: "error"`.
 */
export function parseArgvFlags(argv, {
  stringFlags = {},
  booleanFlags = {},
  defaults = {},
  help = false,
  unknownFlag = "ignore",
  positional: collectPositional = false
} = {}) {
  const options = { ...defaults };
  const positionalArgs = [];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (help && (arg === "--help" || arg === "-h")) {
      options.help = true;
      continue;
    }

    if (arg.startsWith("--")) {
      const equalsIndex = arg.indexOf("=");
      const flagName = equalsIndex === -1 ? arg.slice(2) : arg.slice(2, equalsIndex);
      const hasInlineValue = equalsIndex !== -1;

      if (!hasInlineValue && booleanFlags[flagName] !== undefined) {
        const target = booleanFlags[flagName];
        options[target === true ? kebabToCamel(flagName) : target] = true;
        continue;
      }

      if (stringFlags[flagName] !== undefined) {
        const target = stringFlags[flagName];
        const key = target === true ? kebabToCamel(flagName) : target;
        const rawValue = hasInlineValue ? arg.slice(equalsIndex + 1) : argv[index + 1];
        // A missing, empty, or flag-like value used to be swallowed silently,
        // shifting every later argument one slot over.
        if (!hasInlineValue && (rawValue === undefined || rawValue.startsWith("--"))) {
          throw new Error(`Missing value for flag: --${flagName}`);
        }
        if (hasInlineValue && rawValue === "") {
          throw new Error(`Missing value for flag: --${flagName}=`);
        }
        options[key] = rawValue;
        index += hasInlineValue ? 0 : 1;
        continue;
      }

      if (unknownFlag === "error") {
        throw new Error(`Unknown argument: ${arg}`);
      }
      if (unknownFlag === "positional") {
        positionalArgs.push(arg);
      }
      continue;
    }

    positionalArgs.push(arg);
  }

  return collectPositional ? { options, positional: positionalArgs } : options;
}
