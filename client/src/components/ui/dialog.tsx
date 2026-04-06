"use client"

import * as React from "react"
import * as DialogPrimitive from "@radix-ui/react-dialog"
import { ChevronLeft, X } from "lucide-react"

import { cn } from "@/lib/utils"
import { blurFocusInside, blurFocusInsideRoot } from "@/lib/modal-focus"

const Dialog = DialogPrimitive.Root

const DialogTrigger = DialogPrimitive.Trigger

const DialogPortal = DialogPrimitive.Portal

const DialogClose = DialogPrimitive.Close

const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      "fixed inset-0 z-[200] bg-black/80 data-[state=open]:opacity-100 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
      className
    )}
    {...props}
  />
))
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName

const closeButtonClass = "flex items-center justify-center rounded-full bg-muted hover:bg-muted/80 w-9 h-9 transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none";

type DialogContentProps = React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
  overlayClassName?: string;
  hideCloseButton?: boolean;
  /** When provided, shows a back button (left side) styled like the close button. Use for branching/wizard dialogs. */
  onBack?: () => void;
};

const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  DialogContentProps
>(({ className, overlayClassName, hideCloseButton, onBack, children, "aria-describedby": ariaDescribedBy, onOpenAutoFocus, onCloseAutoFocus, ...props }, ref) => {
  const contentNodeRef = React.useRef<HTMLDivElement | null>(null);
  const setContentRef = React.useCallback(
    (node: HTMLDivElement | null) => {
      contentNodeRef.current = node;
      if (typeof ref === "function") ref(node);
      else if (ref && typeof ref === "object") (ref as React.MutableRefObject<HTMLDivElement | null>).current = node;
    },
    [ref]
  );
  React.useLayoutEffect(() => {
    blurFocusInsideRoot();
  }, []);
  return (
  <DialogPortal container={typeof document !== "undefined" ? (document.getElementById("dialog-container") ?? document.body) : undefined}>
    <DialogOverlay className={cn("data-[state=open]:opacity-100", overlayClassName)} />
    <DialogPrimitive.Content
      ref={setContentRef}
      aria-describedby={ariaDescribedBy}
      onOpenAutoFocus={(e) => {
        // Radix may set aria-hidden on #root in the same tick; drop focus from root first, then again after paint.
        blurFocusInsideRoot();
        onOpenAutoFocus?.(e);
        queueMicrotask(() => blurFocusInsideRoot());
        requestAnimationFrame(() => blurFocusInsideRoot());
      }}
      onCloseAutoFocus={(e) => {
        // Closing: dialog content gets aria-hidden while a footer button may still be focused during exit.
        blurFocusInside(contentNodeRef.current);
        onCloseAutoFocus?.(e);
      }}
      className={cn(
        "dialog-content-base fixed left-[50%] top-[50%] z-[201] grid w-full max-w-lg max-h-[90vh] overflow-y-auto translate-x-[-50%] translate-y-[-50%] gap-4 border border-border bg-background p-[21pt] shadow-lg duration-200 data-[state=open]:opacity-100 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%] rounded-2xl pointer-events-auto",
        className
      )}
      {...props}
    >
      <DialogPrimitive.Title className="sr-only">Dialog</DialogPrimitive.Title>
      <DialogPrimitive.Description className="sr-only">Dialog content</DialogPrimitive.Description>
      {children}
      {onBack && (
        <button
          type="button"
          onClick={onBack}
          className={cn("absolute left-4 top-4", closeButtonClass)}
          aria-label="Back"
        >
          <ChevronLeft className="h-5 w-5 text-muted-foreground" />
        </button>
      )}
      {!hideCloseButton && (
        <DialogPrimitive.Close className={cn("absolute right-4 top-4", closeButtonClass)}>
          <X className="h-5 w-5 text-muted-foreground" />
          <span className="sr-only">Close</span>
        </DialogPrimitive.Close>
      )}
    </DialogPrimitive.Content>
  </DialogPortal>
  );
})
DialogContent.displayName = DialogPrimitive.Content.displayName

const DialogHeader = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "flex flex-col space-y-1.5 text-center sm:text-left",
      className
    )}
    {...props}
  />
)
DialogHeader.displayName = "DialogHeader"

const DialogFooter = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2",
      className
    )}
    {...props}
  />
)
DialogFooter.displayName = "DialogFooter"

const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn(
      "text-lg font-semibold leading-none tracking-tight",
      className
    )}
    {...props}
  />
))
DialogTitle.displayName = DialogPrimitive.Title.displayName

const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn("text-sm text-muted-foreground", className)}
    {...props}
  />
))
DialogDescription.displayName = DialogPrimitive.Description.displayName

export {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogClose,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
}
