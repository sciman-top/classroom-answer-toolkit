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
        // A missing or flag-like value used to be swallowed silently, shifting
        // every later argument one slot over.
        if (!hasInlineValue && (rawValue === undefined || rawValue.startsWith("--"))) {
          throw new Error(`Missing value for flag: --${flagName}`);
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
