import { compileResolvedSnapshot } from "./merge-rules.mjs";
import { getDefaultSubjectPackName, normalizeSubjectPackName } from "./shared.mjs";
import { parseArgvFlags } from "../shared.mjs";

const defaultSubjectPack = getDefaultSubjectPackName();

function parseArgs(argv) {
  const { options, positional } = parseArgvFlags(argv, {
    stringFlags: { profile: true, "subject-pack": true },
    defaults: { profile: null, subjectPack: defaultSubjectPack },
    unknownFlag: "positional",
    positional: true
  });

  if (!options.profile && positional[0]) {
    options.profile = positional[0];
  }

  return options;
}

function main() {
  console.error("[deprecated] resolve:profile (resolve-profile.mjs) is deprecated and will be removed on 2026-09-30; use compile:snapshot --profile.");
  const options = parseArgs(process.argv.slice(2));
  options.subjectPack = normalizeSubjectPackName(options.subjectPack, defaultSubjectPack);
  const snapshot = compileResolvedSnapshot({
    profileName: options.profile,
    subjectPack: options.subjectPack
  });
  console.log(JSON.stringify(snapshot.activeProfile, null, 2));
}

main();
