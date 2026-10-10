import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { normalizeConfig, parseEnvFile, validateConfig } from "./validate-config.mjs";

const PRIMARY = {
  CLASSROOM_TOOLKIT_CLOUD_EGRESS_ENABLED: "true",
  CLASSROOM_TOOLKIT_AI_PRIMARY_BASE_URL: "https://primary.example.com/v1",
  CLASSROOM_TOOLKIT_AI_PRIMARY_API_KEY: "primary-key",
  CLASSROOM_TOOLKIT_AI_PRIMARY_TEXT_MODEL: "gpt-5.6-sol",
  CLASSROOM_TOOLKIT_AI_PRIMARY_VISION_MODEL: "gpt-5.6-sol",
  CLASSROOM_TOOLKIT_AI_PRIMARY_REASONING_EFFORT: "high"
};

function fallbackEnv(overrides = {}) {
  return {
    CLASSROOM_TOOLKIT_AI_FALLBACK_1_TEXT_MODEL: "gpt-5.6-sol",
    CLASSROOM_TOOLKIT_AI_FALLBACK_1_VISION_MODEL: "gpt-5.6-sol",
    ...overrides
  };
}

test("fallback with its own BASE_URL but no API key is rejected", () => {
  const config = normalizeConfig({
    ...PRIMARY,
    ...fallbackEnv({ CLASSROOM_TOOLKIT_AI_FALLBACK_1_BASE_URL: "https://other.example.com/v1" })
  });
  const { errors } = validateConfig(config, { allowMissingSecrets: true }, []);
  assert.ok(errors.some((error) => error.includes("ai.fallback_1") && error.includes("reuse the primary key")),
    errors.join("\n"));
});

test("INHERIT_PRIMARY=true combined with local connection fields is rejected", () => {
  const config = normalizeConfig({
    ...PRIMARY,
    ...fallbackEnv({
      "CLASSROOM_TOOLKIT_AI_FALLBACK_1_INHERIT_PRIMARY": "true",
      "CLASSROOM_TOOLKIT_AI_FALLBACK_1_BASE_URL": "https://other.example.com/v1"
    })
  });
  const { errors } = validateConfig(config, { allowMissingSecrets: true }, []);
  assert.ok(errors.some((error) => error.includes("ai.fallback_1") && error.includes("conflicts with locally set connection fields")),
    errors.join("\n"));
});

test("fully omitted connection fields keep working with a migration warning", () => {
  const config = normalizeConfig({ ...PRIMARY, ...fallbackEnv() });
  const { errors, warnings } = validateConfig(config, { allowMissingSecrets: true }, []);
  assert.deepEqual(errors, []);
  assert.ok(warnings.some((warning) => warning.includes("ai.fallback_1") && warning.includes("connectionSource=primary")),
    warnings.join("\n"));
});

test("explicit own BASE_URL plus own API_KEY needs no flag and raises no warning", () => {
  const config = normalizeConfig({
    ...PRIMARY,
    ...fallbackEnv({
      "CLASSROOM_TOOLKIT_AI_FALLBACK_1_BASE_URL": "https://other.example.com/v1",
      "CLASSROOM_TOOLKIT_AI_FALLBACK_1_API_KEY": "other-key"
    })
  });
  const { errors, warnings } = validateConfig(config, { allowMissingSecrets: true }, []);
  assert.deepEqual(errors, []);
  assert.ok(!warnings.some((warning) => warning.includes("ai.fallback_1")));
});

test("a provider whose reasoning effort matches no quality profile fails validation", () => {
  // Runtime routing filters by exact model+effort equality; an empty effort
  // used to pass validation while every quality-profile request died with
  // "No AI provider is configured".
  const config = normalizeConfig({ ...PRIMARY, ...fallbackEnv() });
  config.providers = config.providers.map((provider) => ({ ...provider, reasoningEffort: "" }));
  const { errors } = validateConfig(config, { allowMissingSecrets: true }, []);
  assert.ok(
    errors.some((error) => error.includes("ai.primary") && error.includes("REASONING_EFFORT")),
    errors.join("\n"));
});

test("a provider outside the closed quality-profile model families fails validation", () => {
  const config = normalizeConfig({ ...PRIMARY, ...fallbackEnv() });
  config.providers = config.providers.map((provider) => ({ ...provider, visionModel: "my-custom-model" }));
  const { errors } = validateConfig(config, { allowMissingSecrets: true }, []);
  assert.ok(
    errors.some((error) => error.includes("ai.primary") && error.includes("my-custom-model")),
    errors.join("\n"));
});

test("explicit preset slot bindings skip the routability check", () => {
  const config = normalizeConfig({ ...PRIMARY, ...fallbackEnv() });
  config.presetSlotsExplicit = true;
  config.providers = config.providers.map((provider) => ({ ...provider, reasoningEffort: "" }));
  const { errors } = validateConfig(config, { allowMissingSecrets: true }, []);
  assert.deepEqual(errors, []);
});

test("env parser strips inline comments from unquoted values only", () => {
  const envDir = fs.mkdtempSync(path.join(os.tmpdir(), "gateway-env-parse-"));
  const envPath = path.join(envDir, "inline-comment.env");
  fs.writeFileSync(envPath, [
    "CLASSROOM_TOOLKIT_AI_PRIMARY_API_KEY=sk-plain # production key",
    "CLASSROOM_TOOLKIT_AI_PRIMARY_TEXT_MODEL=\"gpt-5.6-sol\" # quoted keeps its own text",
    "CLASSROOM_TOOLKIT_AI_FALLBACK_1_VISION_MODEL=gpt-5.6-sol"
  ].join("\n"), "utf8");

  try {
    const { values, errors } = parseEnvFile(envPath);
    assert.deepEqual(errors, []);
    assert.equal(values.CLASSROOM_TOOLKIT_AI_PRIMARY_API_KEY, "sk-plain");
    assert.equal(values.CLASSROOM_TOOLKIT_AI_PRIMARY_TEXT_MODEL, "gpt-5.6-sol");
  } finally {
    fs.rmSync(envDir, { recursive: true, force: true });
  }
});
