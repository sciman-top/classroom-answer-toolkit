import crypto from "node:crypto";
import fs from "node:fs";

export function sha256Hex(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function sha256File(filePath) {
  return sha256Hex(fs.readFileSync(filePath));
}

export function deepMerge(base, override) {
  if (!override || typeof override !== "object" || Array.isArray(override)) {
    return base;
  }

  const merged = { ...base };
  for (const [key, value] of Object.entries(override)) {
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
        options[key] = hasInlineValue ? arg.slice(equalsIndex + 1) : argv[++index];
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
