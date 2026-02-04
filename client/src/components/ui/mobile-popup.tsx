"use client";

import * as React from "react";
import { ReactNode, useRef, useEffect } from "react";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Drawer, DrawerContent, DrawerTitle, DrawerDescription } from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { X, ArrowLeft } from "lucide-react";
import { useIsMobile, useIsDesktop } from "@/hooks/use-mobile";
import { useScrollHeaderContainer } from "@/hooks/use-scroll-header-container";
import { cn } from "@/lib/utils";

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

/** Line separator matching job-details popup style. Use between sections. */
export function PopupSeparator({ className }: { className?: string }) {
  return <div className={cn("border-b border-border/60 my-4", className)} />;
}

/** Gold-standard popup design tokens (job-details template). Use for all popups. */
export const POPUP_TOKENS = {
  SOFT_BLACK: "bg-neutral-900 hover:bg-neutral-800 text-white border-0",
  FOOTER_SHADOW: "shadow-[0_-2px_12px_rgba(0,0,0,0.06)]",
  FOOTER_SHADOW_MOBILE: "shadow-[0_-4px_12px_rgba(0,0,0,0.1)]",
  /** Mobile footer safe-area for notched devices (home indicator). */
  FOOTER_SAFE_AREA: "pb-[max(1rem,env(safe-area-inset-bottom))]",
} as const;

interface MobilePopupProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  headerContent?: ReactNode;
  /** Breadcrumb-style back button (job-details pattern). */
  showBackButton?: boolean;
  onBack?: () => void;
  backLabel?: string;
  /** Progress bar in footer (job-details pattern). Steps 1..N, current 1-based. */
  progressSteps?: number;
  progressCurrent?: number;
  primaryAction?: {
    label: string;
    onClick: () => void;
    disabled?: boolean;
    loading?: boolean;
    icon?: ReactNode;
    testId?: string;
  };
  secondaryAction?: {
    label: string;
    onClick: () => void;
    icon?: ReactNode;
    testId?: string;
  };
  maxWidth?: "sm" | "md" | "lg" | "xl" | "2xl";
  /** Hide X close (e.g. when using custom chrome). Default false. */
  hideCloseButton?: boolean;
}

const SOFT_BLACK = "bg-neutral-900 hover:bg-neutral-800 text-white border-0";
const FOOTER_SHADOW = "shadow-[0_-2px_12px_rgba(0,0,0,0.06)]";
const FOOTER_SHADOW_MOBILE = "shadow-[0_-4px_12px_rgba(0,0,0,0.1)]";
const FOOTER_SAFE_AREA = "pb-[max(1rem,env(safe-area-inset-bottom))]";

export function MobilePopup({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  headerContent,
  showBackButton = false,
  onBack,
  backLabel = "Back",
  progressSteps = 0,
  progressCurrent = 1,
  primaryAction,
  secondaryAction,
  maxWidth = "md",
  hideCloseButton = false,
}: MobilePopupProps) {
  const isMobile = useIsMobile();
  const isDesktop = useIsDesktop();
  const descriptionId = React.useId();
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const isScrolled = useScrollHeaderContainer(scrollContainerRef);

  // Cleanup overlays when popup closes
  useEffect(() => {
    if (!open) {
      cleanupOverlays();
    }
  }, [open]);

  const maxWidthClass = {
    sm: "max-w-sm",
    md: "max-w-md",
    lg: "max-w-lg",
    xl: "max-w-xl",
    "2xl": "max-w-2xl",
  }[maxWidth];

  const header = (
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
              className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors flex-shrink-0"
              data-testid="popup-back-button"
              aria-label={backLabel}
            >
              <ArrowLeft className="w-5 h-5" />
              <span className="font-medium">{backLabel}</span>
            </button>
            <span className="text-muted-foreground flex-shrink-0">/</span>
          </>
        )}
        <div
          className={cn(
            "flex-1 min-w-0 pr-2 transition-all duration-200",
            isScrolled ? "scale-[0.95]" : "scale-100"
          )}
        >
          <h2
            className={cn(
              "font-semibold break-words transition-all duration-200 truncate",
              isScrolled ? "text-base" : "text-lg"
            )}
          >
            {title}
          </h2>
          {description && (
            <p
              className={cn(
                "text-muted-foreground mt-0.5 break-words transition-all duration-200",
                isScrolled ? "text-xs" : "text-sm"
              )}
            >
              {description}
            </p>
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
            data-testid="popup-close-button"
            aria-label="Close"
          >
            <X className={cn("text-muted-foreground transition-all duration-200", isScrolled ? "w-4 h-4" : "w-5 h-5")} />
          </button>
        )}
      </div>
      {headerContent && (
        <div className={cn("transition-all duration-200", isScrolled ? "mt-2" : "mt-3")}>{headerContent}</div>
      )}
    </div>
  );

  const hasProgress = progressSteps > 0;
  const hasActions = !!(primaryAction || secondaryAction);
  const progressBar = hasProgress && (
    <div className="flex h-1 w-full bg-muted overflow-hidden" aria-hidden>
      {Array.from({ length: progressSteps }).map((_, i) => (
        <div
          key={i}
          className={cn("h-full flex-1 transition-all", progressCurrent > i && "bg-primary")}
        />
      ))}
    </div>
  );

  const useDrawerFooterStyle = !isDesktop;
  const actionButtonsOnly = (hasProgress || hasActions) && !footer && hasActions && (
    <>
      {secondaryAction && (
        <Button
          variant="outline"
          className="flex-1 sm:flex-none sm:min-w-[120px] h-12 rounded-xl"
          onClick={secondaryAction.onClick}
          data-testid={secondaryAction.testId}
        >
          {secondaryAction.icon && <span className="mr-2">{secondaryAction.icon}</span>}
          {secondaryAction.label}
        </Button>
      )}
      {primaryAction && (
        <Button
          className={cn(
            "flex-1 sm:flex-none sm:min-w-[140px] h-12 text-base font-semibold rounded-xl shadow-lg",
            SOFT_BLACK
          )}
          onClick={primaryAction.onClick}
          disabled={primaryAction.disabled}
          data-testid={primaryAction.testId}
        >
          {primaryAction.icon && <span className="mr-2">{primaryAction.icon}</span>}
          {primaryAction.label}
        </Button>
      )}
    </>
  );
  const hasFooterContent = footer || (hasProgress || hasActions);
  const footerBlock = hasFooterContent && (
    <div
      className={cn(
        "flex-shrink-0 flex flex-col border-t bg-background overflow-hidden rounded-t-none",
        useDrawerFooterStyle ? FOOTER_SHADOW_MOBILE + " " + FOOTER_SAFE_AREA : FOOTER_SHADOW,
        hasProgress && !hasActions && "pb-4"
      )}
    >
      {progressBar}
      {(footer || actionButtonsOnly) && (
        <div className="footer-actions-container flex-row justify-between gap-3 p-4 sm:p-6">
          {footer ?? actionButtonsOnly}
        </div>
      )}
    </div>
  );

  const bodyClass = cn(
    "flex-1 min-h-0 overflow-y-auto overflow-x-hidden scrollbar-pill-on-scroll",
    "px-4 sm:px-6 py-4 space-y-4",
    hasFooterContent && "pb-6"
  );

  const drawerContainer = "flex flex-col min-h-0 max-h-[90dvh] w-full";
  const dialogContainer = "flex flex-col h-full max-h-[85vh] overflow-hidden min-h-0";

  /* Mobile and tablet: bottom-up drawer. Desktop: centered dialog. */
  if (!isDesktop) {
    return (
      <Drawer open={open} onOpenChange={onOpenChange}>
        <DrawerContent className="rounded-t-[28px] max-h-[90dvh] w-full max-w-full flex flex-col overflow-hidden">
          <DrawerTitle className="sr-only">{title}</DrawerTitle>
          <DrawerDescription className="sr-only">{description || title}</DrawerDescription>
          <div className={drawerContainer}>
            {header}
            <div ref={scrollContainerRef} className={bodyClass}>
              {children}
            </div>
            {footerBlock}
          </div>
        </DrawerContent>
      </Drawer>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        hideCloseButton
        className={cn(maxWidthClass, "p-0 rounded-2xl shadow-2xl border-0 max-h-[85vh] overflow-hidden")}
        aria-describedby={descriptionId}
      >
        <DialogTitle className="sr-only">{title}</DialogTitle>
        <DialogDescription id={descriptionId} className="sr-only">{description || title}</DialogDescription>
        <div className={dialogContainer}>
          {header}
          <div ref={scrollContainerRef} className={bodyClass}>
            {children}
          </div>
          {footerBlock}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function MobilePopupFooter({ children, isMobile }: { children: ReactNode; isMobile?: boolean }) {
  return (
    <div
      className={cn(
        "flex-shrink-0 flex flex-col border-t bg-background overflow-hidden rounded-t-none min-h-[60px] sm:min-h-0",
        isMobile ? FOOTER_SHADOW_MOBILE + " " + FOOTER_SAFE_AREA : FOOTER_SHADOW
      )}
    >
      <div className="footer-actions-container flex-col sm:flex-row gap-2 p-4 sm:p-6">
        {children}
      </div>
    </div>
  );
}
