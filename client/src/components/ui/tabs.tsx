import * as React from "react"
import * as TabsPrimitive from "@radix-ui/react-tabs"
import { ChevronLeft, ChevronRight } from "lucide-react"

import { cn } from "@/lib/utils"

const Tabs = TabsPrimitive.Root

const TabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List> & {
    withScrollControls?: boolean;
  }
>(({ className, withScrollControls = false, children, ...props }, ref) => {
  const scrollContainerRef = React.useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = React.useState(false);
  const [canScrollRight, setCanScrollRight] = React.useState(false);
  const [isMobile, setIsMobile] = React.useState(false);

  React.useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768);
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  const checkScroll = React.useCallback(() => {
    const container = scrollContainerRef.current;
    if (container && withScrollControls) {
      setCanScrollLeft(container.scrollLeft > 0);
      setCanScrollRight(
        container.scrollLeft < container.scrollWidth - container.clientWidth - 1
      );
    }
  }, [withScrollControls]);

  React.useEffect(() => {
    checkScroll();
    const container = scrollContainerRef.current;
    if (container && withScrollControls) {
      container.addEventListener('scroll', checkScroll);
      window.addEventListener('resize', checkScroll);
      return () => {
        container.removeEventListener('scroll', checkScroll);
        window.removeEventListener('resize', checkScroll);
      };
    }
  }, [checkScroll, withScrollControls]);

  const scroll = (direction: 'left' | 'right') => {
    const container = scrollContainerRef.current;
    if (container) {
      const scrollAmount = 200;
      container.scrollBy({
        left: direction === 'left' ? -scrollAmount : scrollAmount,
        behavior: 'smooth'
      });
    }
  };

  if (withScrollControls && !isMobile) {
    return (
      <div className="relative flex items-center gap-2">
        {canScrollLeft && (
          <button
            onClick={() => scroll('left')}
            className="absolute left-0 z-10 w-8 h-8 rounded-full bg-background/95 hover:bg-background shadow-md flex items-center justify-center transition-all"
            aria-label="Scroll left"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
        )}
        <div
          ref={scrollContainerRef}
          className="overflow-x-auto scrollbar-hide flex-1"
          style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
        >
          <TabsPrimitive.List
            ref={ref}
            className={cn(
              "inline-flex h-12 items-center justify-start rounded-xl bg-secondary/50 p-1 text-muted-foreground min-w-full",
              className
            )}
            {...props}
          >
            {children}
          </TabsPrimitive.List>
        </div>
        {canScrollRight && (
          <button
            onClick={() => scroll('right')}
            className="absolute right-0 z-10 w-8 h-8 rounded-full bg-background/95 hover:bg-background shadow-md flex items-center justify-center transition-all"
            aria-label="Scroll right"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        )}
      </div>
    );
  }

  if (isMobile || !withScrollControls) {
    return (
      <div
        ref={scrollContainerRef}
        className="overflow-x-auto scrollbar-hide w-full"
        style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
      >
        <TabsPrimitive.List
          ref={ref}
          className={cn(
            "inline-flex h-12 items-center justify-start rounded-xl bg-secondary/50 p-1 text-muted-foreground gap-1",
            className
          )}
          {...props}
        >
          {children}
        </TabsPrimitive.List>
      </div>
    );
  }

  // Desktop without scroll controls - just render normally
  return (
    <TabsPrimitive.List
      ref={ref}
      className={cn(
        "inline-flex h-12 items-center justify-start rounded-xl bg-secondary/50 p-1 text-muted-foreground gap-1",
        className
      )}
      {...props}
    >
      {children}
    </TabsPrimitive.List>
  );
})
TabsList.displayName = TabsPrimitive.List.displayName

const TabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={cn(
      "relative inline-flex items-center justify-center whitespace-nowrap rounded-lg px-4 py-2.5 text-sm font-medium ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
      "hover:text-foreground",
      "data-[state=active]:text-foreground data-[state=active]:bg-background data-[state=active]:shadow-sm",
      "after:absolute after:bottom-0 after:left-0 after:right-0 after:h-0.5 after:bg-primary after:rounded-full",
      "after:scale-x-0 data-[state=active]:after:scale-x-100",
      "after:transition-transform after:duration-300 after:ease-out",
      className
    )}
    {...props}
  />
))
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName

const TabsContent = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    className={cn(
      "mt-2 ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
      className
    )}
    {...props}
  />
))
TabsContent.displayName = TabsPrimitive.Content.displayName

export { Tabs, TabsList, TabsTrigger, TabsContent }
