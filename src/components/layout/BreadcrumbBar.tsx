import type { ReactNode } from "react";
import { ArrowLeft, ArrowRight, ChevronLeft, ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";

import { useNavigation } from "../../app/navigation";
import { routeLabelKey, trailFor } from "../../app/routeLabels";
import { cn } from "../../lib/cn";

/**
 * Where am I, and how do I get back.
 *
 * Navigation used to be a single back arrow in the title bar, which says
 * nothing about where you are or how deep you went.
 *
 * The crumbs come from the route's ancestors, not from the visit stack. Those
 * are different things and rendering the stack conflated them: every screen you
 * passed through got appended, so unrelated siblings appeared to be nested
 * inside one another. The back button still walks history -- that is what back
 * means -- while the trail describes structure.
 *
 * The bar renders even on the home screen, with a single crumb. Hiding it
 * would shift every screen 37px up and down on each navigation.
 *
 * `trailing` is a slot rather than a second concern baked in. The trailing half
 * of this row is empty on every screen, which makes it the one place a
 * screen-level control can live without touching a form's layout -- but what
 * goes there is the Shell's business, not navigation's.
 */
export function BreadcrumbBar({
  isRtl,
  trailing,
}: {
  isRtl: boolean;
  trailing?: ReactNode;
}) {
  const { t } = useTranslation();
  const { route, back, goToRoot, canGoBack } = useNavigation();
  const trail = trailFor(route);

  // lucide ships no mirroring, so directional glyphs have to be picked. The
  // trail reads in the writing direction: rightwards in English, leftwards in
  // Persian and Arabic.
  const BackIcon = isRtl ? ArrowRight : ArrowLeft;
  const Separator = isRtl ? ChevronLeft : ChevronRight;

  return (
    <nav
      aria-label={t("nav_breadcrumb")}
      className="flex h-9 shrink-0 items-center gap-1 border-b border-line bg-surface-soft px-2"
    >
      <button
        type="button"
        onClick={back}
        disabled={!canGoBack}
        aria-label={t("back")}
        title={t("back")}
        className={cn(
          "flex size-7 shrink-0 items-center justify-center rounded-sm text-fg-muted",
          "transition-colors duration-[--duration-fast]",
          "hover:enabled:bg-surface-hover hover:enabled:text-fg",
          !canGoBack && "invisible",
        )}
      >
        <BackIcon size={15} />
      </button>

      <ol className="flex min-w-0 items-center gap-1 text-sm">
        {trail.map((crumb, index) => {
          const last = index === trail.length - 1;
          const label = t(routeLabelKey(crumb));

          return (
            <li key={crumb.name} className="flex min-w-0 items-center gap-1">
              {index > 0 && (
                <Separator size={13} className="shrink-0 text-fg-muted" aria-hidden />
              )}
              {last ? (
                // The current page is a label, not a link. Making it clickable
                // would offer a navigation that goes nowhere.
                <span aria-current="page" className="truncate font-medium text-fg">
                  {label}
                </span>
              ) : (
                // Only ever the home crumb: the trail is at most two deep.
                <button
                  type="button"
                  onClick={goToRoot}
                  className={cn(
                    "truncate rounded-sm px-1 text-fg-muted",
                    "transition-colors duration-[--duration-fast] hover:bg-surface-hover hover:text-fg",
                  )}
                >
                  {label}
                </button>
              )}
            </li>
          );
        })}
      </ol>

      {/* ms-auto, not a fixed side: the trailing edge is the right in English
          and the left in Persian and Arabic. */}
      {trailing && <div className="ms-auto flex shrink-0 items-center">{trailing}</div>}
    </nav>
  );
}
