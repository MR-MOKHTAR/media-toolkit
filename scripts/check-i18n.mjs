#!/usr/bin/env node
// Fails when the locale files drift apart.
//
// Three locales are edited by hand, and i18next falls back to English on a
// missing key -- so a gap in fa or ar shows up as an English string in an
// otherwise Persian UI rather than as an error. That is easy to ship without
// noticing, which is what this guards.
//
// Also flags keys no code references, so dead strings do not accumulate the
// way they did before (19 orphans had built up by the time anyone looked).

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const LOCALES_DIR = "src/i18n/locales";
const SOURCE_DIR = "src";
const REFERENCE = "en";

const read = (locale) =>
  JSON.parse(readFileSync(join(LOCALES_DIR, `${locale}.json`), "utf8"));

const locales = readdirSync(LOCALES_DIR)
  .filter((f) => f.endsWith(".json"))
  .map((f) => f.replace(/\.json$/, ""));

if (!locales.includes(REFERENCE)) {
  console.error(`✗ no ${REFERENCE}.json in ${LOCALES_DIR}`);
  process.exit(1);
}

const bundles = Object.fromEntries(locales.map((l) => [l, read(l)]));
const reference = Object.keys(bundles[REFERENCE]);
const problems = [];

// 1. Every locale carries exactly the reference key set.
for (const locale of locales.filter((l) => l !== REFERENCE)) {
  const keys = new Set(Object.keys(bundles[locale]));
  const missing = reference.filter((k) => !keys.has(k));
  const extra = [...keys].filter((k) => !reference.includes(k));

  if (missing.length) problems.push(`${locale}: missing ${missing.length} key(s): ${missing.join(", ")}`);
  if (extra.length) problems.push(`${locale}: has ${extra.length} key(s) not in ${REFERENCE}: ${extra.join(", ")}`);
}

// 2. No empty values -- an empty string renders as nothing at all, which is
//    worse than falling back to English.
for (const [locale, bundle] of Object.entries(bundles)) {
  const blank = Object.entries(bundle)
    .filter(([, v]) => typeof v !== "string" || v.trim() === "")
    .map(([k]) => k);
  if (blank.length) problems.push(`${locale}: empty value(s): ${blank.join(", ")}`);
}

// 3. Interpolation placeholders must match, or the count silently disappears
//    from the translated string.
const placeholders = (value) => [...value.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort().join(",");
for (const locale of locales.filter((l) => l !== REFERENCE)) {
  for (const key of reference) {
    const want = placeholders(bundles[REFERENCE][key] ?? "");
    const got = placeholders(bundles[locale][key] ?? "");
    if (want !== got) {
      problems.push(`${locale}.${key}: placeholders differ (${REFERENCE}: "${want || "none"}", ${locale}: "${got || "none"}")`);
    }
  }
}

// 4. Orphans. Dynamic keys are built as t(`status_${x}`), so any key sharing a
//    prefix that appears in a template literal counts as used.
const sources = [];
const walk = (dir) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path);
    else if (/\.tsx?$/.test(entry.name)) sources.push(readFileSync(path, "utf8"));
  }
};
walk(SOURCE_DIR);
const code = sources.join("\n");
const dynamicPrefixes = [...code.matchAll(/t\(`([a-z_]+)\$\{/g)].map((m) => m[1]);

const orphans = reference.filter(
  (key) =>
    !new RegExp(`["'\`]${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["'\`]`).test(code) &&
    !dynamicPrefixes.some((prefix) => key.startsWith(prefix)),
);

if (problems.length) {
  console.error("✗ i18n check failed:\n");
  for (const problem of problems) console.error(`  ${problem}`);
  if (orphans.length) console.error(`\n  (also ${orphans.length} unused key(s): ${orphans.join(", ")})`);
  process.exit(1);
}

console.log(`✓ i18n: ${locales.length} locales x ${reference.length} keys, in sync`);
if (orphans.length) {
  console.log(`  note: ${orphans.length} unused key(s): ${orphans.join(", ")}`);
}
