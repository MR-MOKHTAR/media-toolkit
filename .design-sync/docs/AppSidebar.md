---
category: Layout
---

The app's primary navigation: every tool, plus Tasks and Settings in a separate
foot group. It replaces both a breadcrumb bar and a home screen — it says where
you are by highlighting the row, and gets you anywhere in one click.

```jsx
<div className="flex h-full">
  <AppSidebar isRtl={i18n.dir() === "rtl"} />
  <main className="min-w-0 flex-1 overflow-y-auto">{screen}</main>
</div>
```

Mount it as the **first child of a flex row**. That is what puts it on the
leading edge — left in English, right in Persian and Arabic — with its border
and active markers following across. Do not give it a `dir` of its own.

It reads its own data and owns its own state, so `isRtl` is the only prop:

- the tool list and the active row come from the navigation store,
- the running-job count on Tasks comes from the jobs store,
- expanded vs. collapsed is remembered in `localStorage` and toggled from the
  chevron at its head — there is no prop to force either state.

`isRtl` exists only because Lucide ships no mirroring, so the chevron's
direction has to be chosen explicitly.

Width is 240px expanded, 56px collapsed, and it never shrinks below that — give
the content pane `min-w-0 flex-1` so it takes the remainder and truncates its
own text rather than pushing the rail.

The tool list scrolls if it has to; the Tasks/Settings group stays pinned to the
bottom.
