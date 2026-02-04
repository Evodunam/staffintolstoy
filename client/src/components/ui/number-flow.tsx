'use client';

import { useState, useEffect } from "react";

interface NumberFlowProps {
  value: number;
  trend?: boolean;
  className?: string;
  prefix?: string;
  suffix?: string;
}

// Simple animated number component to replace NumberFlow temporarily
export function NumberFlowComponent({ 
  value, 
  trend = false, 
  className = "",
  prefix = "",
  suffix = ""
}: NumberFlowProps) {
  const [displayValue, setDisplayValue] = useState(value);

  useEffect(() => {
    // Simple animation: gradually update to target value
    const startValue = displayValue;
    const endValue = value;
    const duration = 300; // ms
    const startTime = Date.now();

    if (startValue === endValue) return;

    const animate = () => {
      const now = Date.now();
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      
      // Easing function (ease-out)
      const easeOut = 1 - Math.pow(1 - progress, 3);
      const currentValue = startValue + (endValue - startValue) * easeOut;
      
      setDisplayValue(currentValue);

      if (progress < 1) {
        requestAnimationFrame(animate);
      } else {
        setDisplayValue(endValue);
      }
    };

    requestAnimationFrame(animate);
  }, [value]);

  // Format number with commas for thousands
  const formatNumber = (num: number) => {
    return num.toLocaleString('en-US', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2
    });
  };

  return (
    <span className={className}>
      {prefix}
      {formatNumber(displayValue)}
      {suffix}
    </span>
  );
}

export type { Value } from "@number-flow/react";
