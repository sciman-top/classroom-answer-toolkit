import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  presetOrderForRequest,
  readPresetHealth,
  recordPresetFailure,
  recordPresetSuccess,
  recordRecoveryProbeResult,
  recoveryProbeEligibility
} from "./gateway-runtime.mjs";
import { runSolRecoveryProbeOnce } from "./recovery-reconciler.mjs";

function recoveryConfig(runtimeDirectory) {
  return {
    cloudEgressEnabled: true,
    runtimeDirectory,
    presetCooldownMs: 100,
    recoveryProbeEnabled: true,
    recoveryProbeIntervalMs: 100,
    recoveryProbeFailureIntervalMs: 300,
    recoveryProbeSuccessThreshold: 2,
    recoveryProbeJitterMs: 0,
    recoveryProbeTimeoutMs: 1000,
    providers: [{
      lane: "ai",
      role: "primary",
      kind: "openai_compatible",
      baseUrl: "https://gateway.example.test/v1",
      apiKey: "test-key",
      textSurface: "responses",
      visionSurface: "responses",
      textModel: "gpt-5.6-sol",
      visionModel: "gpt-5.6-sol",
      reasoningEffort: "xhigh"
    }]
  };
}

test("Sol remains behind a healthy Terra until two independent recovery probes succeed", () => {
  const runtimeDirectory = mkdtempSync(path.join(os.tmpdir(), "gateway-recovery-runtime-"));
  const config = recoveryConfig(runtimeDirectory);
  try {
    recordPresetSuccess(config, "terra", 0);
    recordPresetFailure(config, "sol", 0);
    const afterFailure = readPresetHealth(config);
    assert.deepEqual(recoveryProbeEligibility(config, afterFailure, 99), {
      due: false,
      reason: "waiting",
      nextProbeAt: 100
    });
    assert.equal(recoveryProbeEligibility(config, afterFailure, 100).due, true);
    assert.deepEqual(presetOrderForRequest("sol", afterFailure, 101, config), ["terra", "sol", "luna"]);

    const firstRecovery = recordRecoveryProbeResult(config, "sol", true, 100, () => 0.5);
    assert.equal(firstRecovery.activePreset, "terra");
    assert.equal(firstRecovery.presets.sol.recovery.recoveryReady, false);
    assert.equal(firstRecovery.presets.sol.recovery.nextProbeAt, 200);
    assert.deepEqual(presetOrderForRequest("sol", firstRecovery, 201, config), ["terra", "sol", "luna"]);

    const secondRecovery = recordRecoveryProbeResult(config, "sol", true, 200, () => 0.5);
    assert.equal(secondRecovery.activePreset, "terra");
    assert.equal(secondRecovery.presets.sol.recovery.recoveryReady, true);
    assert.deepEqual(presetOrderForRequest("sol", secondRecovery, 201, config), ["sol", "terra", "luna"]);
  } finally {
    rmSync(runtimeDirectory, { recursive: true, force: true });
  }
});

test("a failed recovery probe backs off without changing the healthy active preset", () => {
  const runtimeDirectory = mkdtempSync(path.join(os.tmpdir(), "gateway-recovery-runtime-"));
  const config = recoveryConfig(runtimeDirectory);
  try {
    recordPresetSuccess(config, "luna", 0);
    recordPresetFailure(config, "sol", 0);
    const afterProbe = recordRecoveryProbeResult(config, "sol", false, 100, () => 0.5);
    assert.equal(afterProbe.activePreset, "luna");
    assert.equal(afterProbe.presets.sol.recovery.recoveryReady, false);
    assert.equal(afterProbe.presets.sol.recovery.nextProbeAt, 400);
    assert.deepEqual(recoveryProbeEligibility(config, afterProbe, 399), {
      due: false,
      reason: "waiting",
      nextProbeAt: 400
    });
  } finally {
    rmSync(runtimeDirectory, { recursive: true, force: true });
  }
});

test("the reconciler probes Sol outside business slots and promotes only recovery readiness", async () => {
  const runtimeDirectory = mkdtempSync(path.join(os.tmpdir(), "gateway-recovery-runtime-"));
  const config = recoveryConfig(runtimeDirectory);
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (_url, request) => {
    calls.push(JSON.parse(request.body));
    return new Response(JSON.stringify({ output_text: "OK" }), { status: 200 });
  };
  try {
    recordPresetSuccess(config, "terra", 0);
    recordPresetFailure(config, "sol", 0);
    const first = await runSolRecoveryProbeOnce(config, { allowCloudEgress: true, now: 100 });
    assert.equal(first.ran, true);
    assert.equal(first.activePreset, "terra");
    assert.equal(first.recoveryReady, false);
    assert.equal(calls[0].model, "gpt-5.6-sol");
    assert.equal(calls[0].reasoning.effort, "xhigh");
    assert.equal(existsSync(path.join(runtimeDirectory, "execution-slots")), false);

    const second = await runSolRecoveryProbeOnce(config, { allowCloudEgress: true, now: 200 });
    assert.equal(second.ran, true);
    assert.equal(second.recoveryReady, true);
    assert.equal(readPresetHealth(config).activePreset, "terra");
  } finally {
    globalThis.fetch = originalFetch;
    rmSync(runtimeDirectory, { recursive: true, force: true });
  }
});
