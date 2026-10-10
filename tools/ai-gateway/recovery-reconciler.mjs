import path from "node:path";

import {
  assertLiveEgressAllowed,
  callTextProvider,
  loadGatewayConfig,
  repoRoot
} from "./validate-config.mjs";
import {
  readPresetHealth,
  recordRecoveryProbeResult,
  recoveryProbeEligibility
} from "./gateway-runtime.mjs";
import { isDirectInvocation, parseArgvFlags } from "../shared.mjs";

// The probe verifies Sol connectivity, not business-answer quality. Reasoning
// effort stays low and the token budget must leave room for it: reasoning
// tokens count against max_output_tokens, so the earlier xhigh+8 pairing could
// never complete and Sol could never auto-recover (2026-08-29 audit).
const SOL_RECOVERY_PROFILE = Object.freeze({
  qualityProfile: "sol-recovery-probe",
  model: "gpt-5.6-sol",
  reasoningEffort: "low"
});

function usage() {
  return [
    "Usage:",
    "  npm --prefix tools/ai-gateway run reconcile:recovery -- --allow-cloud-egress [--config-env-file .env] [--once]",
    "  npm --prefix tools/ai-gateway run watch:recovery -- --allow-cloud-egress [--config-env-file .env]",
    "",
    "The reconciler only probes Sol while Terra-only or Luna-only is active.",
    "It never acquires a business execution slot and never changes activePreset itself."
  ].join("\n");
}

export function parseArgs(argv) {
  const options = parseArgvFlags(argv, {
    stringFlags: {
      "config-env-file": "envFile",
      "timeout-ms": "timeoutMs"
    },
    booleanFlags: {
      "allow-cloud-egress": "allowCloudEgress",
      watch: true,
      once: true,
      json: true
    },
    defaults: {
      envFile: path.join(repoRoot, ".env"),
      allowCloudEgress: false,
      once: true,
      timeoutMs: null,
      json: false
    },
    help: true,
    unknownFlag: "error"
  });

  if (options.help) {
    console.log(usage());
    process.exit(0);
  }

  options.envFile = path.resolve(repoRoot, options.envFile);
  if (options.watch) {
    options.once = false;
  }
  if (options.timeoutMs !== null) {
    options.timeoutMs = Number(options.timeoutMs);
    if (!Number.isInteger(options.timeoutMs) || options.timeoutMs < 1000) {
      throw new Error("--timeout-ms must be an integer >= 1000.");
    }
  }
  return options;
}

function providerOrder(role) {
  if (role === "primary") {
    return 0;
  }
  const match = String(role).match(/^fallback_(\d+)$/);
  return match ? Number(match[1]) : 999;
}

function uniqueProbeConnections(providers) {
  const seen = new Set();
  return providers.filter((provider) => {
    const fingerprint = [provider.kind, provider.baseUrl, provider.apiKey, provider.textSurface].join("\u0000");
    if (seen.has(fingerprint)) {
      return false;
    }
    seen.add(fingerprint);
    return true;
  });
}

export function solRecoveryProviders(config) {
  return uniqueProbeConnections(config.providers
    .filter((provider) => provider.lane === "ai")
    .sort((left, right) => providerOrder(left.role) - providerOrder(right.role)))
    .map((provider) => ({
      ...provider,
      textModel: SOL_RECOVERY_PROFILE.model,
      visionModel: SOL_RECOVERY_PROFILE.model,
      reasoningEffort: SOL_RECOVERY_PROFILE.reasoningEffort,
      qualityProfile: SOL_RECOVERY_PROFILE.qualityProfile
    }));
}

function isExactOk(result) {
  return result.ok === true && result.output.trim().toUpperCase() === "OK";
}

export async function runSolRecoveryProbeOnce(config, options = {}) {
  assertLiveEgressAllowed(config, options.allowCloudEgress === true);
  const now = Number.isFinite(options.now) ? options.now : Date.now();
  const before = readPresetHealth(config);
  const eligibility = recoveryProbeEligibility(config, before, now);
  if (!eligibility.due) {
    return {
      ran: false,
      reason: eligibility.reason,
      nextProbeAt: eligibility.nextProbeAt,
      activePreset: before.activePreset,
      recoveryReady: before.presets.sol?.recovery?.recoveryReady === true,
      attempts: []
    };
  }

  const timeoutMs = options.timeoutMs ?? config.recoveryProbeTimeoutMs;
  const attempts = [];
  for (const provider of solRecoveryProviders(config)) {
    let result;
    try {
      // Health recovery uses the smallest exact response probe directly. It
      // intentionally bypasses business execution slots so a degraded model
      // cannot consume classroom-answer concurrency.
      result = await callTextProvider(provider, {
        prompt: "Return exactly OK.",
        timeoutMs,
        maxOutputTokens: 512
      });
    } catch (error) {
      result = {
        ok: false,
        status: null,
        output: "",
        error: error instanceof Error ? error.message : String(error)
      };
    }
    attempts.push({
      provider: provider.role,
      qualityProfile: provider.qualityProfile,
      model: provider.textModel,
      reasoningEffort: provider.reasoningEffort,
      ok: isExactOk(result),
      status: result.status ?? null,
      error: result.error ?? null
    });
    if (isExactOk(result)) {
      break;
    }
  }

  const ok = attempts.some((attempt) => attempt.ok);
  // A long-running watcher must survive transient health-lock contention: the
  // probe already ran, the next round re-records state, and answer-transport
  // applies the same tolerance to its own health writes.
  let after;
  try {
    after = recordRecoveryProbeResult(config, "sol", ok, now);
  } catch (error) {
    console.error(
      `[gateway] Preset health update failed; retrying next round: ${error instanceof Error ? error.message : String(error)}`);
    const current = readPresetHealth(config);
    const recovery = current.presets?.sol?.recovery;
    return {
      ran: true,
      reason: ok ? "sol-probe-succeeded" : "sol-probe-failed",
      nextProbeAt: recovery?.nextProbeAt ?? null,
      activePreset: current.activePreset,
      recoveryReady: recovery?.recoveryReady === true,
      consecutiveProbeSuccesses: recovery?.consecutiveProbeSuccesses ?? 0,
      attempts
    };
  }
  return {
    ran: true,
    reason: ok ? "sol-probe-succeeded" : "sol-probe-failed",
    nextProbeAt: after.presets.sol.recovery.nextProbeAt,
    activePreset: after.activePreset,
    recoveryReady: after.presets.sol.recovery.recoveryReady,
    consecutiveProbeSuccesses: after.presets.sol.recovery.consecutiveProbeSuccesses,
    attempts
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function nextWatchDelayMs(config, result) {
  if (Number.isFinite(result.nextProbeAt)) {
    return Math.max(1000, Math.min(30_000, result.nextProbeAt - Date.now()));
  }
  return Math.min(30_000, config.recoveryProbeIntervalMs);
}

function printResult(result, json) {
  if (json) {
    console.log(JSON.stringify(result));
    return;
  }
  console.log(`recovery probe ${result.ran ? "ran" : "skipped"}: ${result.reason}; active=${result.activePreset ?? "none"}; solReady=${result.recoveryReady}; consecutiveSuccesses=${result.consecutiveProbeSuccesses ?? 0}${result.nextProbeAt ? `; next=${new Date(result.nextProbeAt).toISOString()}` : ""}`);
}

export async function main() {
  const options = parseArgs(process.argv.slice(2));
  const { config, validation } = loadGatewayConfig({ envFile: options.envFile });
  if (validation.errors.length > 0) {
    throw new Error(`Gateway configuration is invalid:\n${validation.errors.join("\n")}`);
  }

  do {
    const result = await runSolRecoveryProbeOnce(config, {
      allowCloudEgress: options.allowCloudEgress,
      timeoutMs: options.timeoutMs
    });
    printResult(result, options.json);
    if (options.once) {
      return;
    }
    await sleep(nextWatchDelayMs(config, result));
  } while (true);
}

if (isDirectInvocation(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack : String(error));
    process.exitCode = 1;
  });
}
