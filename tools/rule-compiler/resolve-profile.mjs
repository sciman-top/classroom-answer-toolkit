import { compileResolvedSnapshot } from "./merge-rules.mjs";
import { getDefaultSubjectPackName, normalizeSubjectPackName } from "./shared.mjs";

const defaultSubjectPack = getDefaultSubjectPackName();

function parseArgs(argv) {
  const positional = [];
  const options = {
    profile: null,
    subjectPack: defaultSubjectPack
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--profile") {
      options.profile = argv[++index];
      continue;
    }

    if (arg.startsWith("--profile=")) {
      options.profile = arg.slice("--profile=".length);
      continue;
    }

    if (arg === "--subject-pack") {
      options.subjectPack = argv[++index];
      continue;
    }

    if (arg.startsWith("--subject-pack=")) {
      options.subjectPack = arg.slice("--subject-pack=".length);
      continue;
    }

    positional.push(arg);
  }

  if (!options.profile && positional[0]) {
    options.profile = positional[0];
  }

  return options;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  options.subjectPack = normalizeSubjectPackName(options.subjectPack, defaultSubjectPack);
  const snapshot = compileResolvedSnapshot({
    profileName: options.profile,
    subjectPack: options.subjectPack
  });
  console.log(JSON.stringify(snapshot.activeProfile, null, 2));
}

main();
