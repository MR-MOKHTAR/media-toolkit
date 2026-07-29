import { ArrowLeft, ArrowRight, ChevronLeft, ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";

import { useNavigation } from "../../app/navigation";
import { routeLabelKey } from "../../app/routeLabels";
import { cn } from "../../lib/cn";

/**
 * Where am I, and how do I get back.
 *
 * Navigation used to be a single back arrow in the title bar, which says
 * nothing about where you are or how deep you went. The route stack was
 * already there in NavigationProvider; this just renders it.
 *
 * The bar renders even on the home screen, with a single crumb. Hiding it
 * would shift every screen 37px up and down on each navigation.
 */
export function BreadcrumbBar({ isRtl }: { isRtl: boolean }) {
  const { t } = useTranslation();
  const { stack, back, goToIndex, canGoBack } = useNavigation();

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
        {stack.map((route, index) => {
          const last = index === stack.length - 1;
          const label = t(routeLabelKey(route));

          return (
            <li key={`${route.name}-${index}`} className="flex min-w-0 items-center gap-1">
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
                <button
                  type="button"
                  onClick={() => goToIndex(index)}
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
    </nav>
  );
}
