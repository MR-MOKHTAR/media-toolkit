# Building with this design system

A desktop app's UI kit: one accent, a fixed token scale, and full RTL support
(the app ships English, Persian and Arabic).

## Wrap the tree in `DesignSystemProvider`

```jsx
const { DesignSystemProvider, AppTitleBar, AppSidebar } = window.DownloaderDS;

<DesignSystemProvider>
  <div className="flex h-full flex-col bg-canvas">
    <AppTitleBar isMaximized={false} onMinimize={fn} onToggleMaximize={fn} onClose={fn} />
    <div className="flex min-h-0 flex-1">
      <AppSidebar isRtl={false} />
      <main className="min-w-0 flex-1 overflow-y-auto p-6">{/* screen */}</main>
    </div>
  </div>
</DesignSystemProvider>
```

It supplies translations and the navigation/jobs stores. Without it `Toast`,
`OfflineBanner`, `AppTitleBar` and `AppSidebar` render raw translation keys, and
`AppSidebar` throws outright. Everything else works unwrapped — but wrap anyway,
it costs nothing.

## Style with the token utilities — there are no others

Tailwind utilities generated from the `@theme` scale. **The stylesheet ships
exactly the vocabulary below.** Off-palette classes (`bg-blue-500`,
`text-gray-400`) resolve to nothing, by design — this system has one accent.

| Family | Names |
|---|---|
| Backgrounds | `bg-canvas` (app), `bg-surface` (cards), `bg-surface-soft` (rails), `bg-surface-hover` |
| Text | `text-fg`, `text-fg-soft` (labels), `text-fg-muted` (metadata) |
| Borders | `border-line`, `border-line-strong`, `border-accent-line` |
| Accent | `bg-accent`, `bg-accent-soft`, `text-accent`, `text-on-accent`, `bg-accent-hover` |
| Semantic | `text-success`, `text-danger`, `text-warning`, `text-media-audio` (audio only) |
| Type | `text-xs` 12 · `text-sm` 13 · `text-base` 14 (body **and every control**) · `text-lg` 16 · `text-xl` 20 · `text-2xl` 24 |
| Radius | `rounded-sm` 6 (chips, inputs) · `rounded-md` 10 (buttons, rows) · `rounded-lg` 16 (cards) · `rounded-xl` 24 |
| Elevation | `shadow-(--shadow-panel)` (panels that float over the app) · `shadow-(--shadow-card)` (the form card) — there are no others |
| Motion | `duration-[--duration-fast]` 120ms · `duration-[--duration-base]` 200ms |
| Helper | `tnum` — tabular numerals; use on **every** number that counts or measures |

Each prefix works across `bg-`/`text-`/`border-`. There is no smaller type than
`text-xs`, and no fifth radius. Dark mode is a token override on `html.dark` —
never write a second set of colours for it.

## Write direction-agnostic layout

The app runs RTL in two of its three languages, so use **logical** utilities
throughout: `ps-*`/`pe-*` and `ms-*`/`me-*` over `pl-*`/`pr-*`, `border-s`/
`border-e` over `border-l`/`border-r`, `text-start`/`text-end` over left/right.
Components handle their own mirroring; do not branch on language to reorder
things. Pin `dir="ltr"` on inputs holding a URL, path or timecode — those read
left-to-right in every language.

## Where the truth is

- `_ds/<folder>/styles.css` and its imports — the whole shipped stylesheet.
- `components/<group>/<Name>/<Name>.prompt.md` — when to use each component and
  what not to assume. Read it before composing anything non-obvious.
- `<Name>.d.ts` — the exact props.

Groups: **ui** (`Button`, `IconButton`, `Card`, `Field`, `EmptyState`,
`ProgressBar`, `Segmented`, `TextInput`, `Tooltip`), **feedback** (`Toast`,
`OfflineBanner`), **layout** (`AppTitleBar`, `AppSidebar`).

## A screen, put together

```jsx
const { Card, Field, TextInput, Segmented, Button } = window.DownloaderDS;

<Card className="w-96">
  <div className="flex flex-col gap-4">
    <Field label="Video URL" htmlFor="url">
      <TextInput id="url" dir="ltr" placeholder="https://…" />
    </Field>
    <Field label="Quality">
      <Segmented label="Quality" value={q} onChange={setQ} options={[
        { value: "1080p", label: "1080p" },
        { value: "720p", label: "720p", hint: "about 21 MB" },
      ]} />
    </Field>
    <Button variant="primary">Start download</Button>
  </div>
</Card>
```

Library components for the controls; token utilities for your own layout glue.
One `primary` button per screen — `secondary` is the default for a reason.
