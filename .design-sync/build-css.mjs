/**
 * Compiles the design system's stylesheet for design-sync.
 *
 * The app has no library build -- its only CSS artifact is whatever `vite
 * build` happens to emit under a content hash. That is a moving target, so
 * this runs Tailwind's own compiler directly against .design-sync/
 * tailwind-entry.css and writes a stable path the converter can point
 * `cssEntry` at.
 *
 * Font urls are rewritten to sit beside the output. theme.css declares them
 * relative to src/styles/, which resolves to nothing once the stylesheet is
 * copied into the bundle; the converter needs a url it can follow from the
 * stylesheet's own directory to copy the woff2 into fonts/.
 */
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { compile, optimize } from "@tailwindcss/node";
import { Scanner } from "@tailwindcss/oxide";

const HERE = dirname(fileURLToPath(import.meta.url));
const ENTRY = join(HERE, "tailwind-entry.css");
const OUT_DIR = join(HERE, "generated");
const OUT_CSS = join(OUT_DIR, "styles.css");
const FONT_SRC = resolve(HERE, "../src/assets/fonts");

mkdirSync(join(OUT_DIR, "fonts"), { recursive: true });
mkdirSync(join(HERE, "previews"), { recursive: true });

const compiler = await compile(readFileSync(ENTRY, "utf8"), {
  base: HERE,
  onDependency() {},
});

const scanner = new Scanner({ sources: compiler.sources });
const candidates = scanner.scan();
let css = compiler.build(candidates);
css = optimize(css).code;

// Every woff2 reference, whatever depth it was written at, becomes a sibling
// lookup -- and the file itself is copied next to the stylesheet.
const fonts = new Set();
css = css.replace(
  /url\(\s*["']?([^)"']*?([A-Za-z0-9_.-]+\.woff2))["']?\s*\)/g,
  (_match, _full, file) => {
    fonts.add(file);
    return `url("./fonts/${file}")`;
  },
);
for (const file of fonts) copyFileSync(join(FONT_SRC, file), join(OUT_DIR, "fonts", file));

writeFileSync(OUT_CSS, css);
console.error(
  `build-css: ${(css.length / 1024).toFixed(1)} KB from ${candidates.length} candidates, ` +
    `fonts: ${[...fonts].join(", ") || "none"}`,
);
