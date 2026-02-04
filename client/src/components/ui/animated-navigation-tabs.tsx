"use client";

import { useState } from "react";
import { motion } from "motion/react";
import { cn } from "@/lib/utils";

export interface AnimatedNavigationTabItem {
  id: string;
  label: string;
  onClick?: () => void;
}

interface AnimatedNavigationTabsProps {
  items: AnimatedNavigationTabItem[];
  value: string;
  onValueChange: (id: string) => void;
  className?: string;
}

export function AnimatedNavigationTabs({ items, value, onValueChange, className }: AnimatedNavigationTabsProps) {
  return (
    <div className={cn("relative overflow-visible", className)}>
      <ul className="flex items-center justify-center gap-1 rounded-xl p-1 pb-1.5 text-muted-foreground min-h-9 overflow-visible">
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
        className={cn(
          "relative py-2 duration-300 transition-colors hover:!text-primary",
          isActive ? "text-primary" : "text-muted-foreground"
        )}
        onClick={onClick}
        onMouseEnter={() => setIsHover(true)}
        onMouseLeave={() => setIsHover(false)}
        data-testid={`tab-${item.id}`}
      >
        <div className="px-5 py-2 relative">
          {item.label}
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
