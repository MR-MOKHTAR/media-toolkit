# design-sync notes — downloader

Repo-specific gotchas for future syncs. Read this before re-running the driver.

## What this repo is

A Tauri desktop app, not a published component library. There is no library
build, no `dist/` entry, no Storybook. The design system is real all the same:
`src/styles/theme.css` is an explicit token scale, and `src/components/{ui,
feedback,layout}` are the reusable parts. Everything under `src/features/` is
app code and is deliberately **out of scope**.

## The two artifacts the converter needs, and why they are generated

`.design-sync/prepare.mjs` (the config's `buildCmd`) makes both. Run it before
`package-build.mjs`, always.

- **A declaration tree.** The converter reads `<Name>Props` out of a shipped
  `.d.ts`. An app has none, so without this every component's contract emits as
  `[key: string]: unknown` — which is exactly what the design agent would then
  code against. `tsconfig.dts.json` emits to `dist/types`, which is one of the
  roots `findTypesRoot` probes, and prepare writes a root `index.d.ts` barrel
  because `projectFor` resolves the type entry as `<pkgDir>/index.d.ts`. The
  pair is discovered with **no `package.json` change** — deliberate, since this
  package ships no types.
- **The stylesheet.** `build-css.mjs` runs Tailwind's compiler directly against
  `.design-sync/tailwind-entry.css`. The alternative — `vite build`'s
  `dist/assets/index-<hash>.css` — is a moving target under a content hash.
  Font `url()`s are rewritten to sit beside the output so the converter can
  follow them into `fonts/`.

Both outputs land in gitignored dirs (`dist/`, `.design-sync/generated/`,
`/index.d.ts`). Nothing generated is committed.

## Entry surface

`--entry ./.design-sync/entry.ts` is required. Without it the converter
synthesizes an entry from every `.tsx` under `src/`, which sweeps in screens,
feature panels and hooks. `entry.ts` names exactly the 13 exports the design
system publishes, plus `DesignSystemProvider`.

`DesignSystemProvider` is excluded from the component list via
`componentSrcMap: {"DesignSystemProvider": null}` — it must stay a bundle
export (it is `cfg.provider`) but it is scaffolding, not a component.

## Providers

`.design-sync/preview-provider.tsx` composes what the components actually read:

- **i18n** — `Toast`, `OfflineBanner`, `AppTitleBar` and `AppSidebar` call
  `useTranslation`. Importing `src/i18n` runs its init at module scope, which
  registers the instance react-i18next falls back to with no `<I18nextProvider>`.
  Without it those four render raw translation keys.
- **Navigation + Jobs** — `AppSidebar` only. `useNavigation` throws outside its
  provider; `useJobs` returns null context and crashes.
- **A Tauri host shim.** The jobs store subscribes to Tauri events on mount, and
  outside the desktop shell `@tauri-apps/api` reads `transformCallback` off an
  object that does not exist. That produced one `TypeError` per card on **every**
  component (`[RENDER_ERRORS]` ×10) until the shim was added. It answers nothing
  — the store mounts, the subscription resolves, no job ever arrives.

## The safelist is load-bearing — two separate reasons

`tailwind-entry.css` pins a large `@source inline(…)` vocabulary. It is not
belt-and-braces; drop it and two different things break.

1. **Ordering.** Utilities used only inside a preview are missing from the
   compiled stylesheet unless `build-css.mjs` reruns *after* that preview is
   written — and previews rebuild on their own (`preview-rebuild.mjs`) far more
   often than the stylesheet does. The card then lays out wrong for reasons
   invisible in its source. This bit during authoring (`ps-2`/`pe-40` in the
   Tooltip preview).
2. **Reach.** The compiled sheet is the *entire* stylesheet a rendered design
   receives in claude.ai/design. Tailwind only emits what it scanned, so before
   the safelist an agent writing perfectly ordinary classes (`gap-2.5`, `size-8`,
   `line-clamp-3`, `max-w-2xl`) would have got nothing at all.

Colour is deliberately **not** generous: the safelist emits the `@theme` palette
across `bg-`/`text-`/`border-` and nothing else, so `bg-blue-500` resolves to
nothing. That is intentional — it is what keeps generated designs on-brand, and
`conventions.md` tells the agent so. Do not "fix" it by adding Tailwind's
default palette.

**If you add a preview using a utility outside the safelist and outside `src/`,
either extend the safelist or re-run `prepare.mjs`.** Verify with
`grep -cF '.<class>' .design-sync/generated/styles.css` — use `-F`, since class
names are CSS-escaped in the output (`.shadow-\(--shadow-panel\)`,
`.duration-\[--duration-fast\]`) and a regex grep reports a false miss.

## Toolchain

- Package manager is **bun** (`bun install --frozen-lockfile`).
- Render check needs **playwright 1.59.0** — that is the release pinning
  chromium build 1217, which is what is in `~/.cache/ms-playwright`. Any other
  version fails with `browserType.launch: Executable doesn't exist`. Install it
  into `.ds-sync/`, and run validate/capture with
  `PLAYWRIGHT_BROWSERS_PATH=$HOME/.cache/ms-playwright NODE_PATH=$PWD/.ds-sync/node_modules`.

## Grouping

Path-derived grouping puts everything in `src/components/ui/` into `general`,
because both `components` and `ui` are on the converter's generic-directory
list. Groups therefore come from the `category` frontmatter in
`.design-sync/docs/<Name>.md` (`UI` / `Feedback` / `Layout`). Those docs also
become each `.prompt.md`.

Write docs **without** a `## Props` section: the converter appends the real
props block from the `.d.ts` only when the doc doesn't already have one, so
omitting it means the contract can never drift from the doc.

The first sync uploaded three components under `components/general/` before the
docs existed; the close-out reconciliation deleted those paths. A future regroup
has the same shape — the deletes only happen at close-out, so never abort
between a regroup and the close-out.

## Preview techniques worth reusing

- **Tooltip** renders `opacity-0` until hover or focus-within, so a static
  screenshot shows nothing. `autoFocus` on the trigger drives `focus-within` and
  is the only way to capture the open state.
- **Toast** is `position: fixed`, so it needs
  `{"cardMode": "single", "viewport": "520x320"}` or the card is mostly dead
  space. Note that changing `viewport` trips `[CONFIG_STALE]` on a targeted
  `preview-rebuild` — viewport edits need a full `package-build.mjs`, unlike
  `cardMode` edits which the targeted loop accepts.
- Wide components (`Card`, `Field`, `ProgressBar`, `TextInput`, `AppSidebar`)
  use `{"cardMode": "column"}`; without it the product grid crops them.

## Known render warns

None outstanding — the final validate exits clean with zero warnings. (Recorded
so a re-sync can tell a new warn from a triaged one.)

## Design-system gaps found while authoring

Real findings about the components, not about the sync. Worth fixing in `src/`
some day; documented in the affected `.prompt.md` meanwhile.

- **`TextInput` has no disabled styling.** The `disabled` attribute works but
  the control renders pixel-identical to an enabled one. Its `Disabled` preview
  story was dropped for exactly this reason — the cell would have claimed a
  state the component does not express.
- **`TextInput` has no error/invalid state** and no message slot. Validation
  failures have to go through `Toast` or a `Field` hint.
- **`AppTitleBar`'s `isMaximized`** changes only the middle control's label and
  tooltip, never the glyph — so a maximized story is pixel-identical to the
  default one. No story is authored for it.
- **`AppSidebar` expanded/collapsed is not a prop** — it lives in `localStorage`
  and is toggled from the chevron, so the collapsed rail cannot be previewed.

## Re-sync risks

- **The declaration tree can drift silently.** `prepare.mjs` runs `tsc` over
  `src` + `.design-sync`. If a component's props stop compiling, `tsc` fails
  loudly — but if a prop is *removed*, the emitted `.d.ts` quietly narrows and
  nothing flags it. Skim a couple of `components/*/*/<Name>.d.ts` after a sync
  where component APIs changed.
- **`entry.ts` is hand-maintained.** A component added to
  `src/components/{ui,feedback,layout}` will **not** appear in the sync until it
  is exported there *and* added to `componentSrcMap`. There is no discovery step
  that would catch the omission — the count in the build log (`components: 13`)
  is the only signal.
- **The Tauri shim tracks `@tauri-apps/api` internals.** It fakes
  `__TAURI_INTERNALS__`. If that package changes the shape it reads at mount,
  the shim goes stale and the `transformCallback` errors return. The symptom is
  `[RENDER_ERRORS]` on every card at once.
- **A new component with no doc file lands in `general`** (see Grouping above)
  and gets a synthesized `.prompt.md` instead of a written one. Nothing fails —
  it just quietly ships in the wrong section with a thinner usage reference.
- **`conventions.md` names ~40 utility classes explicitly.** If the `@theme`
  scale in `src/styles/theme.css` is renamed or trimmed, that table goes stale
  and the design agent will confidently emit classes that resolve to nothing.
  Re-run the validation greps in the conventions step against the fresh build —
  the agent trusts this file completely.
- **The `AppSidebar` `Rtl` story shows English nav labels.** The harness locale
  is `en` while `dir` is `rtl`, so the sidebar's own translated strings stay
  English next to Persian body copy. That is the truthful render for that
  locale, not a defect — do not "fix" it by faking translations.
- **Tailwind version coupling.** `build-css.mjs` uses `@tailwindcss/node`'s
  `compile()` and `@tailwindcss/oxide`'s `Scanner` directly. These are internal-
  ish APIs; a Tailwind v4 minor bump could change the signatures. Pinned at
  4.2.2 today.
