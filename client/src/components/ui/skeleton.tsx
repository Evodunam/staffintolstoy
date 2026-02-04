import * as React from "react";
import { cn } from "@/lib/utils";
import { cva, type VariantProps } from "class-variance-authority";

const skeletonVariants = cva(
  "animate-pulse rounded-md bg-muted",
  {
    variants: {
      variant: {
        default: "bg-muted",
        text: "bg-muted rounded-md",
        circle: "rounded-full bg-muted",
        avatar: "rounded-full bg-muted",
        button: "bg-muted rounded-md",
        card: "bg-muted rounded-lg",
      },
      size: {
        sm: "h-4",
        default: "h-6",
        lg: "h-8",
        xl: "h-10",
        "2xl": "h-12",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface SkeletonProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof skeletonVariants> {
  /**
   * Custom width for the skeleton
   */
  width?: string | number;
  /**
   * Custom height for the skeleton
   */
  height?: string | number;
}

const Skeleton = React.forwardRef<HTMLDivElement, SkeletonProps>(
  (
    {
      className,
      variant,
      size,
      width,
      height,
      style,
      ...props
    },
    ref,
  ) => {
    const customStyle = {
      width: typeof width === "number" ? `${width}px` : width,
      height: typeof height === "number" ? `${height}px` : height,
      ...style,
    };

    return (
      <div
        ref={ref}
        className={cn(skeletonVariants({ variant, size }), className)}
        style={customStyle}
        {...props}
      />
    );
  },
);
Skeleton.displayName = "Skeleton";

// Pre-built skeleton components for common use cases
const SkeletonText = React.forwardRef<
  HTMLDivElement,
  Omit<SkeletonProps, "variant">
>(({ className, ...props }, ref) => (
  <Skeleton
    ref={ref}
    variant="text"
    className={cn("w-full", className)}
    {...props}
  />
));
SkeletonText.displayName = "SkeletonText";

const SkeletonAvatar = React.forwardRef<
  HTMLDivElement,
  Omit<SkeletonProps, "variant">
>(({ className, size = "default", ...props }, ref) => {
  const avatarSizeMap = {
    sm: "w-8 h-8",
    default: "w-10 h-10",
    lg: "w-12 h-12",
    xl: "w-16 h-16",
    "2xl": "w-20 h-20",
  };
  const avatarSize =
    avatarSizeMap[size as keyof typeof avatarSizeMap] || "w-10 h-10";

  return (
    <Skeleton
      ref={ref}
      variant="avatar"
      className={cn(avatarSize, className)}
      {...props}
    />
  );
});
SkeletonAvatar.displayName = "SkeletonAvatar";

const SkeletonButton = React.forwardRef<
  HTMLDivElement,
  Omit<SkeletonProps, "variant">
>(({ className, size = "default", ...props }, ref) => {
  const buttonHeight: Record<string, string> = {
    sm: "h-8",
    default: "h-10",
    lg: "h-11",
    xl: "h-12",
    "2xl": "h-14",
  };
  const selectedHeight = buttonHeight[size as string] || "h-10";

  return (
    <Skeleton
      ref={ref}
      variant="button"
      className={cn(selectedHeight, "w-20 rounded-md", className)}
      {...props}
    />
  );
});
SkeletonButton.displayName = "SkeletonButton";

const SkeletonCard = React.forwardRef<
  HTMLDivElement,
  Omit<SkeletonProps, "variant"> & {
    showImage?: boolean;
    showHeader?: boolean;
    showFooter?: boolean;
  }
>(
  (
    {
      className,
      showImage = true,
      showHeader = true,
      showFooter = true,
      ...props
    },
    ref,
  ) => (
    <div
      ref={ref}
      className={cn(
        "rounded-lg border bg-card p-0 overflow-hidden",
        className,
      )}
      {...props}
    >
      {showImage && (
        <Skeleton className="w-full h-48 rounded-none rounded-t-xl" />
      )}
      <div className="p-6 space-y-4">
        {showHeader && (
          <div className="space-y-2">
            <Skeleton className="h-6 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        )}
        <div className="space-y-2">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-4/5" />
          <Skeleton className="h-4 w-3/5" />
        </div>
        {showFooter && (
          <div className="flex justify-between items-center pt-2">
            <Skeleton className="h-8 w-20" />
            <Skeleton className="h-8 w-16" />
          </div>
        )}
      </div>
    </div>
  ),
);
SkeletonCard.displayName = "SkeletonCard";

export {
  Skeleton,
  SkeletonText,
  SkeletonAvatar,
  SkeletonButton,
  SkeletonCard,
  skeletonVariants,
};
