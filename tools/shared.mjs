import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// This module lives directly under tools/, one level below the repository root.
export const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * True when the script is the process's direct entry point. Windows callers
 * may pass a drive letter in any case (`node D:\...` vs the URL's `d:`), so
 * win32 compares case-insensitively; a plain equality made such direct
 * invocations silently do nothing.
 */
export function isDirectInvocation(importMetaUrl, argv1Path = process.argv[1]) {
  if (!argv1Path) {
    return false;
  }
  const entryUrl = pathToFileURL(path.resolve(argv1Path)).href;
  return process.platform === "win32"
    ? importMetaUrl.toLowerCase() === entryUrl.toLowerCase()
    : importMetaUrl === entryUrl;
}

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
const MAX_PROVIDER_RESPONSE_BYTES = 32 * 1024 * 1024;

const DEFAULT_PROVIDER_ERROR_LENGTH = 300;

/**
 * A provider error body can echo the request back (prompt, inlined page
 * images), so receipts must never embed it verbatim. Keep only short provider
 * error text and replace anything that looks like a payload.
 */
function sanitizeProviderErrorText(value, maxLength = DEFAULT_PROVIDER_ERROR_LENGTH) {
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
    throw responseSizeLimitError(`Provider response declared ${declared} bytes, above the ${maxBytes}-byte limit.`);
  }

  const body = response.body;
  if (!body || typeof body.getReader !== "function") {
    const text = await response.text();
    if (Buffer.byteLength(text) > maxBytes) {
      throw responseSizeLimitError(`Provider response exceeded the ${maxBytes}-byte limit.`);
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
        throw responseSizeLimitError(`Provider response exceeded the ${maxBytes}-byte limit.`);
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock?.();
  }

  return Buffer.concat(chunks).toString("utf8");
}

const UNSAFE_MERGE_KEYS = new Set(["__proto__", "constructor", "prototype"]);

// Consumed by the gateway's failover classifier: an oversized response is a
// deterministic endpoint property, so re-downloading 32MB from the same
// provider or on a retry attempt is pure waste.
function responseSizeLimitError(message) {
  const error = new Error(message);
  error.providerResponseOverSizeLimit = true;
  return error;
}

/**
 * Reads and parses a JSON file, tolerating a UTF-8 BOM (e.g. an editor or
 * Windows PowerShell 5.1 rewrite): JSON.parse rejects it with a misleading
 * "Unexpected token" error.
 */
export function readJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/u, ""));
}

export function readJsonFileIfExists(filePath) {
  return fs.existsSync(filePath) ? readJsonFile(filePath) : null;
}

/**
 * Escapes text for safe interpolation into HTML element content and
 * double-quoted attribute values.
 */
export function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Prints a CLI error to stderr and exits with a non-zero status. */
export function fail(message, code = 2) {
  console.error(message);
  process.exit(code);
}

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
  optionalValueFlags = {},
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

      // An optional-value flag consumes the next argument only when it is a
      // plain value.  With no value, or an inline empty value (--flag=), the
      // declared fallback stands so a flag's bare form can differ from its
      // absent form (e.g. --ocr alone still enables OCR with a default
      // language while omitting the flag keeps it disabled).
      if (optionalValueFlags[flagName] !== undefined) {
        const { target, fallback } = optionalValueFlags[flagName];
        const key = target === true ? kebabToCamel(flagName) : target;
        if (hasInlineValue) {
          options[key] = arg.slice(equalsIndex + 1) || (fallback ?? options[key]);
        } else {
          const next = argv[index + 1];
          if (next !== undefined && !next.startsWith("--")) {
            options[key] = next;
            index += 1;
          } else if (fallback !== undefined) {
            options[key] = fallback;
          }
        }
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
