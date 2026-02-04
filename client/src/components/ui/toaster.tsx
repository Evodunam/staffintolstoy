import { useToast } from "@/hooks/use-toast"
import { cn } from "@/lib/utils"
import { X } from "lucide-react"

/**
 * Custom Toaster that does NOT use Radix Toast primitives.
 * Radix's ToastProvider/Toast use an internal ref collection (setRef) which can
 * trigger setState during commit and cause "Maximum update depth exceeded"
 * when toasts are shown after React Query onSuccess. This implementation
 * renders toasts as plain divs so no Radix refs run.
 */
export function Toaster() {
  const { toasts, dismiss } = useToast()

  return (
    <div
      className={cn(
        "fixed top-0 z-[10000] flex max-h-screen w-full flex-col-reverse p-2 sm:top-0 sm:right-0 sm:flex-col sm:p-4 md:max-w-[420px]"
      )}
      aria-live="polite"
      role="region"
    >
      {toasts.map(({ id, title, description, action, variant = "default" }) => (
        <div
          key={id}
          role="status"
          className={cn(
            "group pointer-events-auto relative flex w-full items-center justify-between space-x-2 overflow-hidden rounded-md border p-2 pr-8 shadow-lg transition-all cursor-pointer sm:space-x-4 sm:p-4 sm:pr-8 md:p-6",
            "animate-in slide-in-from-top-full fade-in-80 duration-200",
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
      ))}
    </div>
  )
}
