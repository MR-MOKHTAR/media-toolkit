import type { Route } from "./navigation";

/**
 * One place that knows what a route is called.
 *
 * The breadcrumb bar is the only consumer today, but this used to be a record
 * inlined in App.tsx that the title bar read. Keeping the mapping next to the
 * Route type means adding a screen cannot silently leave it unnamed: the
 * exhaustive switch stops compiling.
 */
export function routeLabelKey(route: Route): string {
  switch (route.name) {
    case "home":
      return "nav_home";
    case "jobs":
      return "nav_jobs";
    case "settings":
      return "settings";
    case "download":
    case "compress":
    case "trim":
    case "convert":
    case "resize":
    case "gif":
      return `tool_${route.name}`;
  }
}

/**
 * A route's ancestors, not the screens you passed through to reach it.
 *
 * The breadcrumb used to render the visit stack, so starting a download (which
 * hands you off to Tasks) read as "Home > Download > Tasks" -- claiming Tasks
 * lives inside Download when it sits beside it. Every screen is a direct child
 * of home: the home screen is a flat grid of tools plus the Tasks row, with no
 * grouping and no intermediate page. So a real trail is one or two entries, and
 * anything longer was history wearing a hierarchy's clothes.
 */
export function trailFor(route: Route): Route[] {
  const home: Route = { name: "home" };
  return route.name === "home" ? [home] : [home, route];
}
