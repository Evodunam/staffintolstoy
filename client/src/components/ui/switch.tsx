import * as React from "react"
import * as SwitchPrimitives from "@radix-ui/react-switch"
import { Check, X } from "lucide-react"

import { cn } from "@/lib/utils"

export type SwitchProps = React.ComponentPropsWithoutRef<typeof SwitchPrimitives.Root> & {
  /** Green track + check on thumb when on; red-tinted track + X on thumb when off. */
  variant?: "default" | "status"
}

const Switch = React.forwardRef<
  React.ElementRef<typeof SwitchPrimitives.Root>,
  SwitchProps
>(({ className, variant = "default", ...props }, ref) => (
  <SwitchPrimitives.Root
    className={cn(
      "peer inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50",
      variant === "default" &&
        "border-transparent data-[state=checked]:bg-primary data-[state=unchecked]:bg-input",
      variant === "status" &&
        "border-transparent shadow-sm data-[state=checked]:border-emerald-600/30 data-[state=checked]:bg-emerald-600 data-[state=unchecked]:border-red-300/70 data-[state=unchecked]:bg-red-100 dark:data-[state=unchecked]:border-red-800/60 dark:data-[state=unchecked]:bg-red-950/50",
      className
    )}
    {...props}
    ref={ref}
  >
    <SwitchPrimitives.Thumb
      className={cn(
        "pointer-events-none block h-5 w-5 rounded-full shadow-md ring-0 transition-transform data-[state=checked]:translate-x-5 data-[state=unchecked]:translate-x-0",
        variant === "default" && "bg-background shadow-lg",
        variant === "status" &&
          "group relative flex items-center justify-center bg-white dark:bg-card"
      )}
    >
      {variant === "status" && (
        <>
          <Check
            strokeWidth={3}
            className="pointer-events-none absolute h-3 w-3 text-emerald-600 opacity-0 transition-opacity duration-200 group-data-[state=checked]:opacity-100"
            aria-hidden
          />
          <X
            strokeWidth={2.5}
            className="pointer-events-none absolute h-3 w-3 text-red-600 opacity-0 transition-opacity duration-200 group-data-[state=unchecked]:opacity-100"
            aria-hidden
          />
        </>
      )}
    </SwitchPrimitives.Thumb>
  </SwitchPrimitives.Root>
))
Switch.displayName = SwitchPrimitives.Root.displayName

export { Switch }
