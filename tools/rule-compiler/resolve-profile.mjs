import { compileResolvedSnapshot } from "./merge-rules.mjs";

function main() {
  const profileName = process.argv[2];
  const snapshot = compileResolvedSnapshot({ profileName });
  console.log(JSON.stringify(snapshot.activeProfile, null, 2));
}

main();
