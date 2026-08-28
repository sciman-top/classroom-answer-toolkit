import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { EXECUTION_SLOT_COUNT, MODEL_FAMILY_PREFERENCE } from "./profile-matrix.mjs";

const HEALTH_FILE_NAME = "preset-health.json";
const SLOT_DIRECTORY_NAME = "execution-slots";
const LEASE_GRACE_MS = 10_000;
const SLOT_WAIT_INTERVAL_MS = 25;

export const DEFAULT_PRESET_COOLDOWN_MS = 120_000;

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

function defaultHealthState() {
  return {
    version: 1,
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
  if (!value || typeof value !== "object" || value.version !== 1) {
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
      lastFailureAt: Number.isFinite(source.lastFailureAt) ? source.lastFailureAt : null
    };
  }
  return {
    version: 1,
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

export function recordPresetSuccess(config, preset, now = Date.now()) {
  const health = readPresetHealth(config);
  if (!MODEL_FAMILY_PREFERENCE.includes(preset)) {
    return health;
  }
  health.activePreset = preset;
  health.presets[preset] = {
    consecutiveFailures: 0,
    cooldownUntil: 0,
    lastSuccessAt: now,
    lastFailureAt: health.presets[preset].lastFailureAt
  };
  writePresetHealth(config, health);
  return health;
}

export function recordPresetFailure(config, preset, now = Date.now()) {
  const health = readPresetHealth(config);
  if (!MODEL_FAMILY_PREFERENCE.includes(preset)) {
    return health;
  }
  const prior = health.presets[preset];
  const cooldownMs = Number.isInteger(config.presetCooldownMs) && config.presetCooldownMs > 0
    ? config.presetCooldownMs
    : DEFAULT_PRESET_COOLDOWN_MS;
  health.presets[preset] = {
    consecutiveFailures: prior.consecutiveFailures + 1,
    cooldownUntil: now + cooldownMs,
    lastSuccessAt: prior.lastSuccessAt,
    lastFailureAt: now
  };
  if (health.activePreset === preset) {
    health.activePreset = null;
  }
  writePresetHealth(config, health);
  return health;
}

export function presetOrderForRequest(requestedPreset, health = defaultHealthState(), now = Date.now()) {
  const canonical = [requestedPreset, ...MODEL_FAMILY_PREFERENCE.filter((preset) => preset !== requestedPreset)];
  const ready = canonical.filter((preset) => (health.presets?.[preset]?.cooldownUntil ?? 0) <= now);
  const cooling = canonical.filter((preset) => !ready.includes(preset));
  if (ready.length === 0) {
    return canonical;
  }
  const active = health.activePreset;
  if (active && ready.includes(active) && cooling.includes(requestedPreset)) {
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
