import { useTranslation } from "react-i18next";

import { useNavigation } from "../../app/navigation";
import { cn } from "../../lib/cn";
import { TOOLS } from "./tools";

/** Tools, and nothing else.
 *
 *  Tasks used to have a row of its own under the grid. It now lives in the
 *  breadcrumb bar, where it is reachable from every screen instead of only from
 *  this one -- see TasksButton. */
export function HomeScreen() {
  const { t } = useTranslation();
  const { go } = useNavigation();

  return (
    // min-h-full + justify-center, not h-full: with a min-height the box grows
    // to fit its content, so once the content is taller than the viewport the
    // free space is zero and justify-center has nothing to distribute. It
    // degrades to top-aligned instead of clipping the first row out of reach.
    <div className="mx-auto flex min-h-full w-full max-w-2xl flex-col justify-center gap-6 px-6 py-8 lg:max-w-4xl xl:max-w-5xl 2xl:max-w-6xl">
      {/* Explicit columns rather than auto-fit. Seven tools sit as 3x3 with the
          last row short; auto-fit gives four columns on a wide monitor and
          leaves orphans. The unprefixed case has to be the single column,
          because the window's 600px minimum is below Tailwind's `sm`
          breakpoint. */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {TOOLS.map(({ route, key, icon: Icon }) => (
          <button
            key={key}
            type="button"
            onClick={() => go(route)}
            className={cn(
              // justify-center matters: the grid stretches every card in a row
              // to the tallest one, so without it a tool with a shorter hint
              // hangs its content off the top edge.
              "group flex flex-col items-center justify-center gap-3 rounded-xl border border-line bg-surface p-5 text-center",
              "transition-colors duration-[--duration-fast]",
              "hover:border-accent-line hover:bg-accent-soft",
            )}
          >
            <span
              className={cn(
                "flex size-12 items-center justify-center rounded-md bg-surface-soft text-fg-soft",
                "transition-colors duration-[--duration-fast]",
                "group-hover:bg-accent group-hover:text-on-accent",
              )}
            >
              <Icon size={24} />
            </span>
            <span className="flex flex-col gap-0.5">
              <span className="text-lg font-medium text-fg">{t(`tool_${key}`)}</span>
              <span className="text-sm text-fg-muted">{t(`tool_${key}_hint`)}</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
