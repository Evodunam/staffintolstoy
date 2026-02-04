"use client";

import * as React from "react";
import { User, ArrowUpRight, CheckCircle, Activity, Star } from "lucide-react";
import { motion, type Transition } from "framer-motion";

const transition: Transition = { type: "spring", stiffness: 300, damping: 30 };
const textSwitchTransition: Transition = { duration: 0.22, ease: "easeInOut" };
const summaryTextVariants = { collapsed: { opacity: 1, y: 0 }, expanded: { opacity: 0, y: -16 } };
const actionTextVariants = { collapsed: { opacity: 0, y: 16 }, expanded: { opacity: 1, y: 0 } };

const defaultStats = [
  { label: "Profile Completion", value: "90%", Icon: CheckCircle },
  { label: "Activity Level", value: "75%", Icon: Activity },
  { label: "Reputation", value: "85%", Icon: Star },
];

export interface UserProfileCardProps {
  name?: string;
  role?: string;
  avatarUrl?: string | null;
  stats?: { label: string; value: string; Icon: React.ComponentType<{ className?: string }> }[];
  /** Compact teammate mode: skillsets + rate only, no expand animation */
  teammate?: { skillsets: string[]; rate: number };
  /** Omit hover expansion when used inside HoverCard */
  static?: boolean;
}

export function UserProfileCard({
  name = "Alex Morgan",
  role = "Product Designer",
  avatarUrl,
  stats = defaultStats,
  teammate,
  static: isStatic = false,
}: UserProfileCardProps) {
  const progressPct = (v: string) => (v.endsWith("%") ? parseFloat(v) : 0);
  const avatarSrc = avatarUrl || "https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=96&h=96&fit=crop";

  if (teammate) {
    return (
      <div className="bg-muted/50 dark:bg-muted/30 p-3 rounded-2xl w-56 space-y-2 shadow-sm border border-border">
        <div className="flex items-center gap-3">
          <img
            src={avatarUrl && (String(avatarUrl).startsWith("http") || String(avatarUrl).startsWith("/")) ? String(avatarUrl) : undefined}
            alt={name}
            className="size-10 rounded-full bg-muted object-cover"
          />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold truncate">{name}</p>
            {teammate.skillsets?.length ? (
              <p className="text-xs text-muted-foreground truncate">{teammate.skillsets.slice(0, 3).join(", ")}</p>
            ) : null}
            <p className="text-xs font-medium text-primary">${teammate.rate}/hr</p>
          </div>
        </div>
        {teammate.skillsets?.length ? (
          <div className="flex flex-wrap gap-1">
            {teammate.skillsets.slice(0, 4).map((s) => (
              <span key={s} className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary">
                {s}
              </span>
            ))}
            {teammate.skillsets.length > 4 ? (
              <span className="text-[10px] text-muted-foreground">+{teammate.skillsets.length - 4}</span>
            ) : null}
          </div>
        ) : null}
      </div>
    );
  }

  const content = (
    <motion.div
      className="bg-neutral-200 dark:bg-neutral-900 p-3 rounded-3xl w-xs space-y-3 shadow-md"
      initial="collapsed"
      whileHover={isStatic ? undefined : "expanded"}
    >
      <motion.div
        layout="position"
        transition={transition}
        className="bg-neutral-100 dark:bg-neutral-800 rounded-xl px-4 py-4 shadow-sm"
      >
        <div className="flex items-center gap-4">
          <img src={avatarSrc} alt={name} className="size-12 rounded-full object-cover" />
          <div>
            <h1 className="text-sm font-semibold">{name}</h1>
            <p className="text-xs text-neutral-500 font-medium">{role}</p>
          </div>
        </div>
        <motion.div
          variants={{
            collapsed: { height: 0, opacity: 0, marginTop: 0 },
            expanded: { height: "auto", opacity: 1, marginTop: "16px" },
          }}
          transition={{ staggerChildren: 0.1, ...transition }}
          className="overflow-hidden"
        >
          {stats.map(({ label, value, Icon }) => (
            <motion.div
              key={label}
              variants={{ collapsed: { opacity: 0, y: 10 }, expanded: { opacity: 1, y: 0 } }}
              transition={transition}
              className="mt-2"
            >
              <div className="flex items-center justify-between text-xs font-medium text-neutral-500 mb-1">
                <div className="flex items-center gap-1.5">
                  <Icon className="size-3.5" /> {label}
                </div>
                <span>{value}</span>
              </div>
              <div className="h-1.5 w-full bg-neutral-200 dark:bg-neutral-700 rounded-full">
                <motion.div
                  className="h-1.5 bg-sky-500 rounded-full"
                  variants={{
                    collapsed: { width: 0 },
                    expanded: { width: `${Math.min(100, progressPct(value))}%` },
                  }}
                  transition={transition}
                />
              </div>
            </motion.div>
          ))}
        </motion.div>
      </motion.div>
      <div className="flex items-center gap-2">
        <div className="size-5 rounded-full bg-sky-500 text-white flex items-center justify-center">
          <User className="size-3" />
        </div>
        <span className="grid">
          <motion.span
            className="text-sm font-medium text-neutral-600 dark:text-neutral-300 row-start-1 col-start-1"
            variants={summaryTextVariants}
          >
            Team Profile
          </motion.span>
          <motion.a
            href="#"
            className="text-sm font-medium text-neutral-600 dark:text-neutral-300 flex items-center gap-1 cursor-pointer select-none row-start-1 col-start-1"
            variants={actionTextVariants}
          >
            View Full Profile <ArrowUpRight className="size-4" />
          </motion.a>
        </span>
      </div>
    </motion.div>
  );

  return content;
}
