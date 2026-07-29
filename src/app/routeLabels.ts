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
