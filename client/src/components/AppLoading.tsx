import React from "react";
import { cn } from "@/lib/utils";

interface AppLoadingProps {
  className?: string;
  size?: "sm" | "default" | "lg" | "xl";
}

/**
 * Global app loading component that displays the T logo with soft black background
 * Used for initial app load and global loading states
 */
export function AppLoading({ className, size = "default" }: AppLoadingProps) {
  const sizeMap = {
    sm: "w-8 h-8 text-base",
    default: "w-12 h-12 text-xl",
    lg: "w-16 h-16 text-2xl",
    xl: "w-20 h-20 text-3xl",
  };

  const sizeClass = sizeMap[size];

  return (
    <div
      className={cn(
        "min-h-screen flex flex-col items-center justify-center bg-neutral-950",
        className
      )}
    >
      <div
        className={cn(
          "bg-neutral-900 rounded-lg flex items-center justify-center text-white font-display font-bold shadow-sm",
          sizeClass,
          "animate-pulse"
        )}
      >
        T
      </div>
    </div>
  );
}
