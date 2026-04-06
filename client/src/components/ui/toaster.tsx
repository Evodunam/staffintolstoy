import { useEffect, useState } from "react"
import { createPortal } from "react-dom"
import { useToast } from "@/hooks/use-toast"
import { cn } from "@/lib/utils"
import { X } from "lucide-react"

/**
 * Custom Toaster that does NOT use Radix Toast primitives.
 * Renders via portal to document.body with maximum z-index so toasts
 * always appear above dialogs, sheets, and popups.
 */
export function Toaster() {
  const { toasts, dismiss } = useToast()
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  const content = (
    <div
      data-toaster
      className={cn(
        "fixed top-0 right-0 flex max-h-screen w-fit min-w-0 max-w-[min(100vw,420px)] flex-col-reverse gap-2 p-2 sm:top-0 sm:right-0 sm:flex-col sm:p-4"
      )}
      style={{ zIndex: 2147483647, isolation: "isolate" }}
      aria-live="polite"
      role="region"
    >
      {toasts.map((toast) => {
        const { id, title, description, action, variant = "default", open = true } = toast
        return (
        <div
          key={id}
          role="status"
          data-state={open ? "open" : "closed"}
          className={cn(
            "group pointer-events-auto relative flex w-full items-center justify-between space-x-2 overflow-hidden rounded-md border p-2 pr-8 shadow-lg transition-all cursor-pointer sm:space-x-4 sm:p-4 sm:pr-8 md:p-6",
            "data-[state=open]:animate-in data-[state=open]:slide-in-from-top-full data-[state=open]:fade-in-80 data-[state=open]:duration-200",
            "data-[state=closed]:animate-out data-[state=closed]:fade-out-80 data-[state=closed]:slide-out-to-right-full data-[state=closed]:duration-200",
            variant === "destructive"
              ? "border-destructive bg-destructive text-destructive-foreground"
              : "border bg-background text-foreground"
          )}
          onClick={() => dismiss(id)}
        >
          <div className="grid min-w-0 flex-1 gap-0.5 pr-6 sm:gap-1 sm:pr-8">
            {title && (
              <p className="text-xs font-semibold leading-tight sm:text-sm">
                {title}
              </p>
            )}
            {description && (
              <p className="text-xs opacity-90 leading-tight sm:text-sm">
                {description}
              </p>
            )}
          </div>
          {action}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              dismiss(id)
            }}
            className="absolute right-1 top-1 rounded-md p-1 opacity-70 transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring sm:right-2 sm:top-2 sm:opacity-0 sm:group-hover:opacity-100 z-10"
            aria-label="Dismiss"
          >
            <X className="h-3 w-3 sm:h-4 sm:w-4" />
          </button>
        </div>
        )
      })}
    </div>
  )

  if (!mounted || typeof document === "undefined" || toasts.length === 0) return null
  return createPortal(content, document.body)
}
