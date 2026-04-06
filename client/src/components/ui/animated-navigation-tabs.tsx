"use client";

import { useState } from "react";
import { motion } from "motion/react";
import { cn } from "@/lib/utils";

export interface AnimatedNavigationTabItem {
  id: string;
  label: string;
  onClick?: () => void;
  /** Optional badge text shown as a pill (e.g. pending count) */
  badge?: string;
}

interface AnimatedNavigationTabsProps {
  items: AnimatedNavigationTabItem[];
  value: string;
  onValueChange: (id: string) => void;
  className?: string;
  /** Accessible label for the nav landmark, e.g. "Dashboard navigation" */
  "aria-label"?: string;
}

export function AnimatedNavigationTabs({ items, value, onValueChange, className, "aria-label": ariaLabel }: AnimatedNavigationTabsProps) {
  return (
    <div className={cn("relative overflow-visible", className)}>
      <ul role="tablist" aria-label={ariaLabel} className="flex items-center justify-center gap-1 rounded-xl p-1 pb-1.5 text-muted-foreground min-h-9 overflow-visible">
        {items.map((item) => {
          const isActive = value === item.id;
          const handleClick = () => {
            if (item.onClick) {
              item.onClick();
            } else {
              onValueChange(item.id);
            }
          };
          return (
            <AnimatedTabButton
              key={item.id}
              item={item}
              isActive={isActive}
              onClick={handleClick}
            />
          );
        })}
      </ul>
    </div>
  );
}

function AnimatedTabButton({
  item,
  isActive,
  onClick,
}: {
  item: AnimatedNavigationTabItem;
  isActive: boolean;
  onClick: () => void;
}) {
  const [isHover, setIsHover] = useState(false);

  return (
    <li>
      <button
        type="button"
        role="tab"
        aria-selected={isActive}
        className={cn(
          "relative py-2 duration-300 transition-colors hover:!text-primary",
          isActive ? "text-primary" : "text-muted-foreground"
        )}
        onClick={onClick}
        onMouseEnter={() => setIsHover(true)}
        onMouseLeave={() => setIsHover(false)}
        data-testid={`tab-${item.id}`}
      >
        <div className="px-5 py-2 relative flex items-center gap-1.5">
          {item.label}
          {item.badge && (
            <span className="min-w-[18px] h-[18px] px-1 bg-orange-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center leading-none">
              {item.badge}
            </span>
          )}
          {isHover && (
            <motion.div
              layoutId="hover-bg"
              className="absolute bottom-0 left-0 right-0 w-full h-full bg-primary/10"
              style={{ borderRadius: 6 }}
              transition={{ type: "spring", bounce: 0.2, duration: 0.3 }}
            />
          )}
        </div>
        {isActive && (
          <motion.div
            layoutId="active"
            className="absolute bottom-0 left-0 right-0 w-full h-[2px] bg-foreground dark:bg-primary z-10"
            transition={{ type: "spring", bounce: 0.2, duration: 0.4 }}
          />
        )}
        {isHover && (
          <motion.div
            layoutId="hover"
            className="absolute bottom-0 left-0 right-0 w-full h-[2px] bg-foreground dark:bg-primary z-10"
            transition={{ type: "spring", bounce: 0.2, duration: 0.3 }}
          />
        )}
      </button>
    </li>
  );
}
