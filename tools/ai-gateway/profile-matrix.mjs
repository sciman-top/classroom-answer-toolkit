// The model/effort and logical execution-slot contract has one source of truth.
export const QUALITY_PROFILES = Object.freeze({
  "sol-high": Object.freeze({ model: "gpt-5.6-sol", reasoningEffort: "high" }),
  "sol-medium": Object.freeze({ model: "gpt-5.6-sol", reasoningEffort: "medium" }),
  "sol-low": Object.freeze({ model: "gpt-5.6-sol", reasoningEffort: "low" }),
  "terra-xhigh": Object.freeze({ model: "gpt-5.6-terra", reasoningEffort: "xhigh" }),
  "terra-high": Object.freeze({ model: "gpt-5.6-terra", reasoningEffort: "high" }),
  "terra-medium": Object.freeze({ model: "gpt-5.6-terra", reasoningEffort: "medium" }),
  "luna-xhigh": Object.freeze({ model: "gpt-5.6-luna", reasoningEffort: "xhigh" }),
  "luna-high": Object.freeze({ model: "gpt-5.6-luna", reasoningEffort: "high" }),
  "luna-medium": Object.freeze({ model: "gpt-5.6-luna", reasoningEffort: "medium" })
});

export const QUALITY_PROFILE_NAMES = new Set(["auto", ...Object.keys(QUALITY_PROFILES)]);
export const QUALITY_PROFILE_ORDER = Object.freeze(Object.keys(QUALITY_PROFILES));
export const EXECUTION_SLOT_COUNT = 5;

export const MODEL_FAMILY_PREFERENCE = Object.freeze(["sol", "terra", "luna"]);

export const PRESET_NAMES = MODEL_FAMILY_PREFERENCE;

// A preset is a closed model family.  Its slots may repeat a profile for
// parallel capacity, but can never project a model from another preset.
export const PRESET_PROFILES = Object.freeze({
  sol: Object.freeze(["sol-high", "sol-medium", "sol-low"]),
  terra: Object.freeze(["terra-xhigh", "terra-high", "terra-medium"]),
  luna: Object.freeze(["luna-xhigh", "luna-high", "luna-medium"])
});

// Preset-local reasoning efforts differ, but the gateway always fails over by
// the same relative three-level contract rather than by effort-name equality.
export const PROFILE_TIERS = Object.freeze({
  "sol-high": "high",
  "sol-medium": "standard",
  "sol-low": "low",
  "terra-xhigh": "high",
  "terra-high": "standard",
  "terra-medium": "low",
  "luna-xhigh": "high",
  "luna-high": "standard",
  "luna-medium": "low"
});

export const PRESET_TIER_PROFILES = Object.freeze(Object.fromEntries(
  PRESET_NAMES.map((preset) => [preset, Object.freeze(Object.fromEntries(
    PRESET_PROFILES[preset].map((profile) => [PROFILE_TIERS[profile], profile])
  ))])
));

// Five logical slots per selected preset.  The high-priority and normal
// tiers each have two independently queued slots; the lowest tier has one.
// Operators can override every binding with PRESET_<NAME>_SLOT_<N> variables.
export const DEFAULT_PRESET_SLOT_BINDINGS = Object.freeze({
  sol: Object.freeze(["sol-high", "sol-high", "sol-medium", "sol-medium", "sol-low"]),
  terra: Object.freeze(["terra-xhigh", "terra-xhigh", "terra-high", "terra-high", "terra-medium"]),
  luna: Object.freeze(["luna-xhigh", "luna-xhigh", "luna-high", "luna-high", "luna-medium"])
});

export function presetForProfile(profile) {
  return String(profile).split("-", 1)[0];
}

export function tierForProfile(profile) {
  return PROFILE_TIERS[profile] ?? null;
}

export function profileForPresetTier(preset, tier) {
  return PRESET_TIER_PROFILES[preset]?.[tier] ?? null;
}

export function slotsForPresetProfile(bindings, preset, profile) {
  return (bindings?.[preset] ?? [])
    .flatMap((assignedProfile, index) => assignedProfile === profile ? [index + 1] : []);
}

// The deprecated text request path keeps its historical highest-tier-only family
// failover contract. The full profile order is used by live probes.
export const TEXT_FAILOVER_PROFILES = Object.freeze(
  ["sol-high", "terra-xhigh", "luna-xhigh"]
    .map((profile) => Object.freeze({ profile, ...QUALITY_PROFILES[profile] }))
);
