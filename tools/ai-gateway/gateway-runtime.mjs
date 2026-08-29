import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { EXECUTION_SLOT_COUNT, MODEL_FAMILY_PREFERENCE } from "./profile-matrix.mjs";

const HEALTH_FILE_NAME = "preset-health.json";
const HEALTH_LOCK_FILE_NAME = "preset-health.lock.json";
const SLOT_DIRECTORY_NAME = "execution-slots";
const LEASE_GRACE_MS = 10_000;
const SLOT_WAIT_INTERVAL_MS = 25;
const HEALTH_LOCK_TIMEOUT_MS = 2_000;
const HEALTH_LOCK_LEASE_MS = 10_000;
const HEALTH_LOCK_WAIT_INTERVAL_MS = 10;
const HEALTH_LOCK_WAIT_SIGNAL = new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT));

export const DEFAULT_PRESET_COOLDOWN_MS = 120_000;
export const DEFAULT_RECOVERY_PROBE_INTERVAL_MS = 300_000;
export const DEFAULT_RECOVERY_PROBE_FAILURE_INTERVAL_MS = 900_000;
export const DEFAULT_RECOVERY_PROBE_SUCCESS_THRESHOLD = 2;
export const DEFAULT_RECOVERY_PROBE_JITTER_MS = 30_000;

function defaultRecoveryState() {
  return {
    consecutiveProbeSuccesses: 0,
    recoveryReady: false,
    lastProbeAt: null,
    lastProbeSucceededAt: null,
    nextProbeAt: null
  };
}

function recoverySettings(config = {}) {
  return {
    intervalMs: Number.isInteger(config.recoveryProbeIntervalMs) && config.recoveryProbeIntervalMs > 0
      ? config.recoveryProbeIntervalMs
      : DEFAULT_RECOVERY_PROBE_INTERVAL_MS,
    failureIntervalMs: Number.isInteger(config.recoveryProbeFailureIntervalMs) && config.recoveryProbeFailureIntervalMs > 0
      ? config.recoveryProbeFailureIntervalMs
      : DEFAULT_RECOVERY_PROBE_FAILURE_INTERVAL_MS,
    successThreshold: Number.isInteger(config.recoveryProbeSuccessThreshold) && config.recoveryProbeSuccessThreshold > 0
      ? config.recoveryProbeSuccessThreshold
      : DEFAULT_RECOVERY_PROBE_SUCCESS_THRESHOLD,
    jitterMs: Number.isInteger(config.recoveryProbeJitterMs) && config.recoveryProbeJitterMs >= 0
      ? config.recoveryProbeJitterMs
      : DEFAULT_RECOVERY_PROBE_JITTER_MS
  };
}

function defaultRuntimeDirectory() {
  return path.join(os.tmpdir(), "classroom-answer-toolkit-ai-gateway");
}

export function resolveGatewayRuntimeDirectory(config = {}) {
  return path.resolve(config.runtimeDirectory || defaultRuntimeDirectory());
}

function ensureRuntimeDirectory(directory) {
  fs.mkdirSync(directory, { recursive: true });
  return directory;
}

function healthPath(config) {
  return path.join(ensureRuntimeDirectory(resolveGatewayRuntimeDirectory(config)), HEALTH_FILE_NAME);
}

function healthLockPath(config) {
  return path.join(ensureRuntimeDirectory(resolveGatewayRuntimeDirectory(config)), HEALTH_LOCK_FILE_NAME);
}

function defaultHealthState() {
  return {
    version: 2,
    activePreset: null,
    presets: Object.fromEntries(MODEL_FAMILY_PREFERENCE.map((preset) => [preset, {
      consecutiveFailures: 0,
      cooldownUntil: 0,
      lastSuccessAt: null,
      lastFailureAt: null
    }]))
  };
}

function normalizeHealthState(value) {
  const defaults = defaultHealthState();
  if (!value || typeof value !== "object" || ![1, 2].includes(value.version)) {
    return defaults;
  }
  const presets = {};
  for (const preset of MODEL_FAMILY_PREFERENCE) {
    const source = value.presets?.[preset] ?? {};
    presets[preset] = {
      consecutiveFailures: Number.isInteger(source.consecutiveFailures) && source.consecutiveFailures >= 0
        ? source.consecutiveFailures
        : 0,
      cooldownUntil: Number.isFinite(source.cooldownUntil) && source.cooldownUntil > 0
        ? source.cooldownUntil
        : 0,
      lastSuccessAt: Number.isFinite(source.lastSuccessAt) ? source.lastSuccessAt : null,
      lastFailureAt: Number.isFinite(source.lastFailureAt) ? source.lastFailureAt : null,
      recovery: {
        consecutiveProbeSuccesses: Number.isInteger(source.recovery?.consecutiveProbeSuccesses)
          && source.recovery.consecutiveProbeSuccesses >= 0
          ? source.recovery.consecutiveProbeSuccesses
          : 0,
        recoveryReady: source.recovery?.recoveryReady === true,
        lastProbeAt: Number.isFinite(source.recovery?.lastProbeAt) ? source.recovery.lastProbeAt : null,
        lastProbeSucceededAt: Number.isFinite(source.recovery?.lastProbeSucceededAt)
          ? source.recovery.lastProbeSucceededAt
          : null,
        nextProbeAt: Number.isFinite(source.recovery?.nextProbeAt) ? source.recovery.nextProbeAt : null
      }
    };
  }
  return {
    version: 2,
    activePreset: MODEL_FAMILY_PREFERENCE.includes(value.activePreset) ? value.activePreset : null,
    presets
  };
}

export function readPresetHealth(config = {}) {
  try {
    return normalizeHealthState(JSON.parse(fs.readFileSync(healthPath(config), "utf8")));
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") {
      return defaultHealthState();
    }
    // Runtime state is advisory. A corrupt or interrupted local state file
    // must not stop answer generation; the canonical Sol-first order resumes.
    return defaultHealthState();
  }
}

function writePresetHealth(config, value) {
  const target = healthPath(config);
  const temporary = `${target}.${process.pid}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value)}\n`, "utf8");
  fs.renameSync(temporary, target);
}

function tryAcquirePresetHealthLock(config) {
  const filePath = healthLockPath(config);
  const token = crypto.randomUUID();
  const now = Date.now();
  try {
    const descriptor = fs.openSync(filePath, "wx");
    try {
      fs.writeFileSync(descriptor, JSON.stringify({
        token,
        pid: process.pid,
        expiresAt: now + HEALTH_LOCK_LEASE_MS
      }), "utf8");
    } finally {
      fs.closeSync(descriptor);
    }
  } catch (error) {
    if (!error || typeof error !== "object" || error.code !== "EEXIST") {
      throw error;
    }
    removeExpiredLease(filePath, now);
    return null;
  }

  return {
    release() {
      const lease = readLease(filePath);
      if (lease?.token === token) {
        try {
          fs.unlinkSync(filePath);
        } catch (error) {
          if (!error || typeof error !== "object" || error.code !== "ENOENT") {
            throw error;
          }
        }
      }
    }
  };
}

// Preset health steers later cross-process requests, so an atomic file replace
// alone is insufficient: two read-modify-write operations could lose a newly
// selected fallback preset or cooldown. This short lock is deliberately
// separate from execution slots because it protects metadata, not business work.
export function acquirePresetHealthLock(config, timeoutMs = HEALTH_LOCK_TIMEOUT_MS) {
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
    throw new Error("Preset health lock timeout must be a positive integer.");
  }

  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const lock = tryAcquirePresetHealthLock(config);
    if (lock) {
      return lock;
    }

    const remainingMs = timeoutMs - (Date.now() - startedAt);
    Atomics.wait(HEALTH_LOCK_WAIT_SIGNAL, 0, 0, Math.min(HEALTH_LOCK_WAIT_INTERVAL_MS, Math.max(1, remainingMs)));
  }

  return null;
}

function updatePresetHealth(config, update) {
  const lock = acquirePresetHealthLock(config);
  if (!lock) {
    throw new Error("Timed out waiting to update preset health state.");
  }

  try {
    const health = readPresetHealth(config);
    update(health);
    writePresetHealth(config, health);
    return health;
  } finally {
    lock.release();
  }
}

export function recordPresetSuccess(config, preset, now = Date.now()) {
  if (!MODEL_FAMILY_PREFERENCE.includes(preset)) {
    return readPresetHealth(config);
  }
  return updatePresetHealth(config, (health) => {
    health.activePreset = preset;
    health.presets[preset] = {
      consecutiveFailures: 0,
      cooldownUntil: 0,
      lastSuccessAt: now,
      lastFailureAt: health.presets[preset].lastFailureAt,
      recovery: health.presets[preset].recovery ?? defaultRecoveryState()
    };
  });
}

export function recordPresetFailure(config, preset, now = Date.now()) {
  if (!MODEL_FAMILY_PREFERENCE.includes(preset)) {
    return readPresetHealth(config);
  }
  return updatePresetHealth(config, (health) => {
    const prior = health.presets[preset];
    const cooldownMs = Number.isInteger(config.presetCooldownMs) && config.presetCooldownMs > 0
      ? config.presetCooldownMs
      : DEFAULT_PRESET_COOLDOWN_MS;
    health.presets[preset] = {
      consecutiveFailures: prior.consecutiveFailures + 1,
      cooldownUntil: now + cooldownMs,
      lastSuccessAt: prior.lastSuccessAt,
      lastFailureAt: now,
      recovery: defaultRecoveryState()
    };
    if (health.activePreset === preset) {
      health.activePreset = null;
    }
  });
}

export function recoveryProbeEligibility(config, health = defaultHealthState(), now = Date.now()) {
  if (config.recoveryProbeEnabled !== true) {
    return { due: false, reason: "disabled", nextProbeAt: null };
  }
  if (!health.activePreset || health.activePreset === "sol") {
    return { due: false, reason: "sol-not-degraded", nextProbeAt: null };
  }
  const sol = health.presets?.sol ?? {};
  const recovery = sol.recovery ?? defaultRecoveryState();
  if (recovery.recoveryReady) {
    return { due: false, reason: "sol-ready", nextProbeAt: null };
  }
  const nextProbeAt = recovery.nextProbeAt
    ?? (recovery.lastProbeAt !== null
      ? recovery.lastProbeAt + recoverySettings(config).failureIntervalMs
      : Math.max(sol.cooldownUntil ?? 0, now));
  return {
    due: now >= nextProbeAt,
    reason: now >= nextProbeAt ? "due" : "waiting",
    nextProbeAt
  };
}

export function recordRecoveryProbeResult(config, preset, ok, now = Date.now(), random = Math.random) {
  if (!MODEL_FAMILY_PREFERENCE.includes(preset)) {
    return readPresetHealth(config);
  }
  return updatePresetHealth(config, (health) => {
    const settings = recoverySettings(config);
    const prior = health.presets[preset];
    const recovery = prior.recovery ?? defaultRecoveryState();
    const consecutiveProbeSuccesses = ok ? recovery.consecutiveProbeSuccesses + 1 : 0;
    const jitter = settings.jitterMs === 0
      ? 0
      : Math.round((random() * 2 - 1) * settings.jitterMs);
    health.presets[preset] = {
      consecutiveFailures: ok ? prior.consecutiveFailures : prior.consecutiveFailures + 1,
      cooldownUntil: ok ? prior.cooldownUntil : now + settings.failureIntervalMs,
      lastSuccessAt: prior.lastSuccessAt,
      lastFailureAt: ok ? prior.lastFailureAt : now,
      recovery: {
        consecutiveProbeSuccesses,
        recoveryReady: ok && consecutiveProbeSuccesses >= settings.successThreshold,
        lastProbeAt: now,
        lastProbeSucceededAt: ok ? now : recovery.lastProbeSucceededAt,
        nextProbeAt: now + (ok ? settings.intervalMs : settings.failureIntervalMs) + jitter
      }
    };
  });
}

export function presetOrderForRequest(requestedPreset, health = defaultHealthState(), now = Date.now(), options = {}) {
  const canonical = [requestedPreset, ...MODEL_FAMILY_PREFERENCE.filter((preset) => preset !== requestedPreset)];
  const ready = canonical.filter((preset) => (health.presets?.[preset]?.cooldownUntil ?? 0) <= now);
  const cooling = canonical.filter((preset) => !ready.includes(preset));
  if (ready.length === 0) {
    return canonical;
  }
  const active = health.activePreset;
  const recoveryPending = options.recoveryProbeEnabled === true
    && requestedPreset === "sol"
    && active
    && active !== "sol"
    && health.presets?.sol?.recovery?.recoveryReady !== true;
  if (active && ready.includes(active) && (cooling.includes(requestedPreset) || recoveryPending)) {
    // A healthy fallback suppresses an unnecessary Sol probe at request start.
    // If it fails, however, recovery must re-probe Sol before Luna even while
    // Sol's prior cooldown has not elapsed.
    return [active, ...canonical.filter((preset) => preset !== active)];
  }
  return [...ready, ...cooling];
}

function slotDirectory(config) {
  return ensureRuntimeDirectory(path.join(
    ensureRuntimeDirectory(resolveGatewayRuntimeDirectory(config)),
    SLOT_DIRECTORY_NAME
  ));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function leasePath(config, slot) {
  return path.join(slotDirectory(config), `slot-${slot}.lease.json`);
}

function readLease(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function removeExpiredLease(filePath, now) {
  const lease = readLease(filePath);
  if (lease && Number.isFinite(lease.expiresAt) && lease.expiresAt > now) {
    return false;
  }
  try {
    fs.unlinkSync(filePath);
  } catch (error) {
    if (!error || typeof error !== "object" || error.code !== "ENOENT") {
      return false;
    }
  }
  return true;
}

function tryAcquireLease(config, slot, timeoutMs) {
  const filePath = leasePath(config, slot);
  const token = crypto.randomUUID();
  const now = Date.now();
  try {
    const descriptor = fs.openSync(filePath, "wx");
    try {
      fs.writeFileSync(descriptor, JSON.stringify({
        token,
        pid: process.pid,
        slot,
        expiresAt: now + timeoutMs + LEASE_GRACE_MS
      }), "utf8");
    } finally {
      fs.closeSync(descriptor);
    }
  } catch (error) {
    if (!error || typeof error !== "object" || error.code !== "EEXIST") {
      throw error;
    }
    removeExpiredLease(filePath, now);
    return null;
  }
  return {
    slot,
    release() {
      const lease = readLease(filePath);
      if (lease?.token === token) {
        try {
          fs.unlinkSync(filePath);
        } catch (error) {
          if (!error || typeof error !== "object" || error.code !== "ENOENT") {
            throw error;
          }
        }
      }
    }
  };
}

// Limits every local CLI process that shares the runtime directory.  Slots are
// work-conserving across processes; the existing in-process FIFO queue still
// provides ordering within an individual Node runtime.
export async function acquireSharedExecutionSlot(config, slots, timeoutMs) {
  const uniqueSlots = [...new Set(slots)]
    .filter((slot) => Number.isInteger(slot) && slot >= 1 && slot <= EXECUTION_SLOT_COUNT);
  if (uniqueSlots.length === 0) {
    throw new Error("At least one valid execution slot is required.");
  }
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    for (const slot of uniqueSlots) {
      const lease = tryAcquireLease(config, slot, timeoutMs);
      if (lease) {
        return lease;
      }
    }
    await sleep(Math.min(SLOT_WAIT_INTERVAL_MS, Math.max(1, timeoutMs - (Date.now() - startedAt))));
  }
  return null;
}
