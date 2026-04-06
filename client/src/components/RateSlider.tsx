import * as React from "react";
import { Slider } from "@/components/ui/slider";
import { rateToPosition, positionToRate, RATE_MIN, RATE_MAX } from "@/lib/rate-slider-scale";
import { cn } from "@/lib/utils";

const SLIDER_STEPS = 1000;

type RateSliderProps = Omit<
  React.ComponentPropsWithoutRef<typeof Slider>,
  "value" | "onValueChange" | "min" | "max" | "step"
> & {
  value: number;
  onValueChange: (rate: number) => void;
};

/**
 * Rate slider with non-linear scale: first 50% of bar = $1–$30, second 50% = $30–$200.
 */
const RateSlider = React.forwardRef<
  React.ComponentRef<typeof Slider>,
  RateSliderProps
>(({ value, onValueChange, className, ...props }, ref) => {
  const rate = Math.max(RATE_MIN, Math.min(RATE_MAX, value));
  const position = rateToPosition(rate);
  const sliderValue = Math.round(position * SLIDER_STEPS);

  const handleChange = React.useCallback(
    (v: number[]) => {
      const pos = (v[0] ?? 0) / SLIDER_STEPS;
      onValueChange(positionToRate(pos));
    },
    [onValueChange]
  );

  return (
    <Slider
      ref={ref}
      min={0}
      max={SLIDER_STEPS}
      step={1}
      value={[sliderValue]}
      onValueChange={handleChange}
      className={cn("w-full", className)}
      {...props}
    />
  );
});
RateSlider.displayName = "RateSlider";

export { RateSlider, RATE_MIN, RATE_MAX };
