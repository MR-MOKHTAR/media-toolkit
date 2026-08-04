// The version lives in three places -- package.json, src-tauri/tauri.conf.json
// and src-tauri/Cargo.toml -- and Tauri reads the middle one to name every
// installer it builds. Bumping them by hand is how five releases went out
// called "0.1.0". This writes all three, and the release workflow refuses to
// build a tag whose number they don't agree on.
//
//   bun run set-version 1.1.0
//
// Cargo.lock carries the version too; `cargo check` after this rewrites it.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const version = process.argv[2];

if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
  console.error(`usage: bun run set-version <major.minor.patch>\n  got: ${version ?? "(nothing)"}`);
  process.exit(1);
}

// Rewriting the matched line rather than JSON.parse/stringify: these files are
// hand-edited and comment-free but key order and formatting are worth keeping.
const edits = [
  ["package.json", /("version"\s*:\s*")[^"]+(")/],
  ["src-tauri/tauri.conf.json", /("version"\s*:\s*")[^"]+(")/],
  ["src-tauri/Cargo.toml", /^(version\s*=\s*")[^"]+(")/m],
];

for (const [file, pattern] of edits) {
  const path = join(root, file);
  const before = readFileSync(path, "utf8");
  // Test for the field rather than comparing before/after: re-running with the
  // version that is already set is a no-op, not a failure.
  if (!pattern.test(before)) {
    console.error(`could not find a version field in ${file} -- nothing written`);
    process.exit(1);
  }
  writeFileSync(path, before.replace(pattern, `$1${version}$2`));
  console.log(`${file} -> ${version}`);
}

console.log(`\nnext:\n  cd src-tauri && cargo check   # refresh Cargo.lock`);
console.log(`  git commit -am "chore: release v${version}"`);
console.log(`  git tag v${version} && git push origin v${version}`);
