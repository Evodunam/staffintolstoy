"use client";

import * as React from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { useIsMobile } from "@/hooks/use-mobile";
import { useScrollHeaderContainer } from "@/hooks/use-scroll-header-container";
import { cn } from "@/lib/utils";
import { X, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PopupSeparator } from "./mobile-popup";

// Cleanup lingering modal overlays (fixes DropdownMenu → Dialog interactions)
function cleanupOverlays() {
  setTimeout(() => {
    const root = document.getElementById('root');
    if (root && root.getAttribute('aria-hidden') === 'true') {
      root.removeAttribute('aria-hidden');
    }
    // Remove lingering dropdown overlays
    document.querySelectorAll('[data-radix-popper-content-wrapper]').forEach(el => {
      const content = el.querySelector('[data-state="open"]');
      if (!content && el.parentElement) {
        (el.parentElement as HTMLElement).style.pointerEvents = 'none';
        setTimeout(() => {
          if (el.parentElement && !(el.parentElement as HTMLElement).querySelector('[data-state="open"]')) {
            (el.parentElement as HTMLElement).style.display = 'none';
          }
        }, 300);
      }
    });
  }, 150);
}

const SOFT_BLACK = "bg-neutral-900 hover:bg-neutral-800 text-white border-0";
const FOOTER_SHADOW = "shadow-[0_-2px_12px_rgba(0,0,0,0.06)]";
const FOOTER_SHADOW_MOBILE = "shadow-[0_-4px_12px_rgba(0,0,0,0.1)]";
/** Mobile footer safe-area for notched devices (home indicator). */
const FOOTER_SAFE_AREA = "pb-[max(1rem,env(safe-area-inset-bottom))]";

interface ResponsiveDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
  title?: string | React.ReactNode;
  description?: string;
  footer?: React.ReactNode;
  className?: string;
  contentClassName?: string;
  headerClassName?: string;
  footerClassName?: string;
  onPointerDownOutside?: (e: Event) => void;
  onEscapeKeyDown?: (e: Event) => void;
  hideCloseButton?: boolean;
  hideDefaultFooter?: boolean;
  /** Breadcrumb-style back button (job-details pattern). Aliased as showBack. */
  showBackButton?: boolean;
  /** Alias for showBackButton. */
  showBack?: boolean;
  onBack?: () => void;
  backLabel?: string;
  /** When "text", back button is plain text only (no highlight/background). Default "default". */
  backButtonVariant?: "text" | "default";
  /** Progress bar in footer (job-details pattern). Steps 1..N, current 1-based. */
  progressSteps?: number;
  progressCurrent?: number;
  /** Primary action button (soft black). */
  primaryAction?: {
    label: string;
    onClick: () => void;
    disabled?: boolean;
    loading?: boolean;
    icon?: React.ReactNode;
    testId?: string;
  };
  /** Secondary action button. */
  secondaryAction?: {
    label: string;
    onClick: () => void;
    icon?: React.ReactNode;
    testId?: string;
  };
  /** Optional content in header to the left of the close button (e.g. "1 of 5"). */
  headerTrailing?: React.ReactNode;
  /** Footer button order: "primaryLeft" (default) = [Primary] [Secondary], "primaryRight" = [Secondary] [Primary]. Use primaryRight so action stays on the right. */
  footerButtonOrder?: "primaryLeft" | "primaryRight";
}

export { PopupSeparator };

export function ResponsiveDialog({
  open,
  onOpenChange,
  children,
  title,
  description,
  footer,
  className,
  contentClassName,
  headerClassName,
  footerClassName,
  onPointerDownOutside,
  onEscapeKeyDown,
  hideCloseButton = false,
  hideDefaultFooter = false,
  showBackButton: showBackButtonProp = false,
  showBack,
  onBack,
  backLabel = "Back",
  backButtonVariant = "default",
  progressSteps = 0,
  progressCurrent = 1,
  primaryAction,
  secondaryAction,
  headerTrailing,
  footerButtonOrder = "primaryLeft",
}: ResponsiveDialogProps) {
  const isMobile = useIsMobile();
  /** Centered dialog from 768px up; drawer only on small mobile (< 768). */
  const useDrawerForLayout = isMobile;
  const descriptionId = React.useId();
  const scrollContainerRef = React.useRef<HTMLDivElement>(null);
  const isScrolled = useScrollHeaderContainer(scrollContainerRef);

  // Cleanup overlays when dialog closes
  React.useEffect(() => {
    if (!open) {
      cleanupOverlays();
    }
  }, [open]);

  const showBackButton = showBackButtonProp ?? showBack ?? false;
  const hasProgress = progressSteps > 0;
  const hasActions = !!(primaryAction || secondaryAction);
  const progressBar = hasProgress && (
    <div className="flex h-1 w-full bg-muted overflow-hidden" aria-hidden>
      {Array.from({ length: progressSteps }).map((_, i) => (
        <div key={i} className={cn("h-full flex-1 transition-all", progressCurrent > i && "bg-primary")} />
      ))}
    </div>
  );

  const useDrawerStyle = useDrawerForLayout;
  const hasFooterContent = !hideDefaultFooter && (footer || (hasProgress || hasActions));
  const primaryButton = primaryAction && (
    <Button
      className={cn(
        "flex-1 min-w-0 sm:min-w-[120px] h-9 text-sm font-semibold rounded-lg shadow-md",
        SOFT_BLACK
      )}
      onClick={primaryAction.onClick}
      disabled={primaryAction.disabled}
      data-testid={primaryAction.testId}
    >
      {primaryAction.icon && <span className="mr-2">{primaryAction.icon}</span>}
      {primaryAction.label}
    </Button>
  );
  const secondaryButton = secondaryAction && (
    <Button
      variant="outline"
      className="flex-1 min-w-0 sm:min-w-[100px] h-9 rounded-lg"
      onClick={secondaryAction.onClick}
      data-testid={secondaryAction.testId}
    >
      {secondaryAction.icon && <span className="mr-2">{secondaryAction.icon}</span>}
      {secondaryAction.label}
    </Button>
  );
  const actionButtonsOnly = (hasProgress || hasActions) && !footer && hasActions && (
    <>
      {footerButtonOrder === "primaryRight" ? (
        <>
          {secondaryButton}
          {primaryButton}
        </>
      ) : (
        <>
          {primaryButton}
          {secondaryButton}
        </>
      )}
    </>
  );
  const footerBlock = hasFooterContent && (
    <div
      className={cn(
        "flex-shrink-0 flex flex-col border-t bg-background overflow-hidden",
        useDrawerStyle ? "rounded-t-none " + FOOTER_SHADOW_MOBILE + " " + FOOTER_SAFE_AREA : cn(FOOTER_SHADOW, "rounded-b-2xl"),
        hasProgress && !hasActions && "pb-3"
      )}
    >
      {progressBar}
      {(footer || actionButtonsOnly) && (
        <div
          className={cn(
            "footer-actions-container px-[23px]",
            secondaryAction && !footer ? "justify-between" : "justify-end",
            useDrawerStyle ? "py-4 min-h-[60px]" : "py-3",
            footerClassName
          )}
        >
          {footer ?? actionButtonsOnly}
        </div>
      )}
    </div>
  );

  const handlePointerDownOutside = (e: Event) => {
    if ((e.target as HTMLElement).closest("[data-google-places-dropdown]")) {
      e.preventDefault();
    }
    onPointerDownOutside?.(e);
  };

  const headerBlock = (
    <div
      className={cn(
        "flex-shrink-0 border-b bg-background sticky top-0 z-10 transition-all duration-200",
        "px-4 sm:px-6",
        isScrolled ? "py-2" : "py-3"
      )}
    >
      <div className="flex items-center gap-2">
        {showBackButton && onBack && (
          <>
            <button
              type="button"
              onClick={onBack}
              className={cn(
                "flex items-center gap-2 transition-all flex-shrink-0",
                backButtonVariant === "text"
                  ? "text-muted-foreground hover:text-foreground p-0 min-w-0 bg-transparent hover:bg-transparent border-0"
                  : "rounded-full bg-muted hover:bg-muted/80 text-muted-foreground hover:text-foreground px-3 h-9 justify-center"
              )}
              data-testid="responsive-dialog-back-button"
              aria-label={backLabel}
            >
              <ArrowLeft className="w-5 h-5" />
              <span className="font-medium">{backLabel}</span>
            </button>
            {backButtonVariant !== "text" && <span className="text-muted-foreground flex-shrink-0">/</span>}
          </>
        )}
        <div className={cn("flex-1 min-w-0 pr-2 transition-all duration-200", isScrolled ? "scale-[0.95]" : "scale-100")}>
          {(title || description) && (
            <div className={cn("text-left p-0", headerClassName)}>
              {title && (
                typeof title === "string" ? (
                  <span className={cn("font-semibold transition-all duration-200 truncate block", isScrolled ? "text-base" : "text-lg")}>
                    {title}
                  </span>
                ) : (
                  <span className={cn("font-semibold leading-none tracking-tight transition-all duration-200 truncate block", isScrolled ? "text-base" : "text-lg")}>
                    {title}
                  </span>
                )
              )}
            </div>
          )}
        </div>
        {headerTrailing != null && (
          <span className="text-sm text-muted-foreground flex-shrink-0 tabular-nums">{headerTrailing}</span>
        )}
        {!hideCloseButton && (
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className={cn(
              "flex items-center justify-center rounded-full bg-muted hover:bg-muted/80 transition-all duration-200 flex-shrink-0",
              isScrolled ? "w-8 h-8" : "w-9 h-9"
            )}
            aria-label="Close"
          >
            <X className={cn("text-muted-foreground transition-all duration-200", isScrolled ? "w-4 h-4" : "w-5 h-5")} />
          </button>
        )}
      </div>
    </div>
  );

  const bodyAndFooter = (
    <>
      <div ref={scrollContainerRef} className={cn("flex-1 min-h-0 min-w-0 w-full overflow-y-auto overflow-x-hidden scrollbar-pill-on-scroll px-4 sm:px-6 py-4", className)}>
        {children}
      </div>
      {footerBlock}
    </>
  );

  /* Small mobile only: full-width bottom drawer. Tablet & desktop (768px+): centered dialog. */
  if (useDrawerForLayout) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          side="bottom"
          hideCloseButton
          className={cn(
            "responsive-dialog-drawer inset-x-0 left-0 right-0 w-full min-w-full max-w-[100vw] max-h-[90dvh] overflow-hidden p-0 rounded-t-2xl shadow-2xl border-0 flex flex-col",
            contentClassName
          )}
          onPointerDownOutside={handlePointerDownOutside as unknown as (e: Event) => void}
          onEscapeKeyDown={onEscapeKeyDown as unknown as (e: KeyboardEvent) => void}
        >
          <SheetTitle className="sr-only">{typeof title === "string" ? title : "Dialog"}</SheetTitle>
          <SheetDescription id={descriptionId} className="sr-only">{description || (typeof title === "string" ? title : "Dialog")}</SheetDescription>
          <div className="flex flex-col h-full max-h-[90dvh] w-full min-w-full overflow-hidden min-h-0">
            {headerBlock}
            {bodyAndFooter}
          </div>
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        hideCloseButton
        className={cn("left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 max-h-[85vh] overflow-hidden p-0 rounded-2xl shadow-2xl border-0", contentClassName)}
        onPointerDownOutside={handlePointerDownOutside}
        onEscapeKeyDown={onEscapeKeyDown}
        aria-describedby={descriptionId}
        onOpenAutoFocus={(e) => {
          const target = e.target as HTMLElement;
          if (target) {
            setTimeout(() => {
              target.focus();
            }, 50);
          }
          e.preventDefault();
        }}
      >
        <DialogTitle className="sr-only">{typeof title === "string" ? title : "Dialog"}</DialogTitle>
        <DialogDescription id={descriptionId} className="sr-only">{description || (typeof title === "string" ? title : "Dialog")}</DialogDescription>
        <div className="flex flex-col h-full max-h-[85vh] overflow-hidden min-h-0">
          <div
            className={cn(
              "flex-shrink-0 border-b bg-background sticky top-0 z-10 transition-all duration-200",
              "px-4 sm:px-6",
              isScrolled ? "py-2" : "py-3"
            )}
          >
            <div className="flex items-center gap-2">
              {showBackButton && onBack && (
                <>
                  <button
                    type="button"
                    onClick={onBack}
                    className={cn(
                      "flex items-center gap-2 transition-all flex-shrink-0",
                      backButtonVariant === "text"
                        ? "text-muted-foreground hover:text-foreground p-0 min-w-0 bg-transparent hover:bg-transparent border-0"
                        : "rounded-full bg-muted hover:bg-muted/80 text-muted-foreground hover:text-foreground px-3 h-9 justify-center"
                    )}
                    data-testid="responsive-dialog-back-button"
                    aria-label={backLabel}
                  >
                    <ArrowLeft className="w-5 h-5" />
                    <span className="font-medium">{backLabel}</span>
                  </button>
                  {backButtonVariant !== "text" && <span className="text-muted-foreground flex-shrink-0">/</span>}
                </>
              )}
              <div className={cn("flex-1 min-w-0 pr-2 transition-all duration-200", isScrolled ? "scale-[0.95]" : "scale-100")}>
                {(title || description) && (
                  <DialogHeader className={cn("text-left p-0", headerClassName)}>
                    {title && (
                      typeof title === "string" ? (
                        <DialogTitle className={cn("font-semibold transition-all duration-200 truncate", isScrolled ? "text-base" : "text-lg")}>
                          {title}
                        </DialogTitle>
                      ) : (
                        <DialogTitle asChild>
                          <div className={cn("font-semibold leading-none tracking-tight transition-all duration-200 truncate", isScrolled ? "text-base" : "text-lg")}>
                            {title}
                          </div>
                        </DialogTitle>
                      )
                    )}
                  </DialogHeader>
                )}
              </div>
              {!hideCloseButton && (
                <button
                  type="button"
                  onClick={() => onOpenChange(false)}
                  className={cn(
                    "flex items-center justify-center rounded-full bg-muted hover:bg-muted/80 transition-all duration-200 flex-shrink-0",
                    isScrolled ? "w-8 h-8" : "w-9 h-9"
                  )}
                  aria-label="Close"
                >
                  <X className={cn("text-muted-foreground transition-all duration-200", isScrolled ? "w-4 h-4" : "w-5 h-5")} />
                </button>
              )}
            </div>
          </div>
          {bodyAndFooter}
        </div>
      </DialogContent>
    </Dialog>
  );
}
