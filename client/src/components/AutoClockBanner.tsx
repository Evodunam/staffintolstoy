import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Clock, LogOut, X, MapPin } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useTranslation } from "react-i18next";

interface AutoClockInBannerProps {
  show: boolean;
  jobTitle: string;
  distanceMiles: number;
  onConfirm: () => void;
  onDismiss: () => void;
}

export function AutoClockInBanner({
  show,
  jobTitle,
  distanceMiles,
  onConfirm,
  onDismiss,
}: AutoClockInBannerProps) {
  const { t } = useTranslation();
  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ opacity: 0, y: -50 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -50 }}
          className="fixed top-4 left-4 right-4 z-50 md:left-auto md:right-4 md:w-96"
        >
          <Card className="p-4 bg-green-50 dark:bg-green-950 border-green-200 dark:border-green-800 shadow-lg">
            <div className="flex items-start gap-3">
              <div className="p-2 rounded-full bg-green-100 dark:bg-green-900">
                <MapPin className="w-5 h-5 text-green-600 dark:text-green-400" />
              </div>
              <div className="flex-1 min-w-0">
                <h4 className="font-semibold text-green-900 dark:text-green-100">
                  {t("banners.arrivedAtJobSite")}
                </h4>
                <p className="text-sm text-green-700 dark:text-green-300 mt-1">
                  <strong>{jobTitle}</strong>
                </p>
                <p className="text-xs text-green-600 dark:text-green-400 mt-0.5">
                  {t("banners.milesAway", { distance: distanceMiles.toFixed(1) })}
                </p>
                <div className="flex gap-2 mt-3">
                  <Button
                    size="sm"
                    className="bg-green-600 hover:bg-green-700 text-white"
                    onClick={onConfirm}
                    data-testid="auto-clock-in-confirm"
                  >
                    <Clock className="w-4 h-4 mr-1" />
                    {t("banners.clockInNow")}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="border-green-300 text-green-700 hover:bg-green-100"
                    onClick={onDismiss}
                    data-testid="auto-clock-in-dismiss"
                  >
                    {t("banners.notYet")}
                  </Button>
                </div>
              </div>
              <Button
                size="icon"
                variant="ghost"
                className="h-6 w-6 text-green-600"
                onClick={onDismiss}
              >
                <X className="w-4 h-4" />
              </Button>
            </div>
          </Card>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

interface AutoClockOutBannerProps {
  show: boolean;
  jobTitle?: string;
  onConfirm: () => void;
  onDismiss: () => void;
}

export function AutoClockOutBanner({
  show,
  jobTitle,
  onConfirm,
  onDismiss,
}: AutoClockOutBannerProps) {
  const { t } = useTranslation();
  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ opacity: 0, y: -50 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -50 }}
          className="fixed top-4 left-4 right-4 z-50 md:left-auto md:right-4 md:w-96"
        >
          <Card className="p-4 bg-amber-50 dark:bg-amber-950 border-amber-200 dark:border-amber-800 shadow-lg">
            <div className="flex items-start gap-3">
              <div className="p-2 rounded-full bg-amber-100 dark:bg-amber-900">
                <LogOut className="w-5 h-5 text-amber-600 dark:text-amber-400" />
              </div>
              <div className="flex-1 min-w-0">
                <h4 className="font-semibold text-amber-900 dark:text-amber-100">
                  {t("banners.leftJobSite")}
                </h4>
                {jobTitle && (
                  <p className="text-sm text-amber-700 dark:text-amber-300 mt-1">
                    <strong>{jobTitle}</strong>
                  </p>
                )}
                <p className="text-xs text-amber-600 dark:text-amber-400 mt-0.5">
                  {t("banners.wouldYouLikeToClockOut")}
                </p>
                <div className="flex gap-2 mt-3">
                  <Button
                    size="sm"
                    className="bg-amber-600 hover:bg-amber-700 text-white"
                    onClick={onConfirm}
                    data-testid="auto-clock-out-confirm"
                  >
                    <LogOut className="w-4 h-4 mr-1" />
                    {t("banners.clockOutNow")}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="border-amber-300 text-amber-700 hover:bg-amber-100"
                    onClick={onDismiss}
                    data-testid="auto-clock-out-dismiss"
                  >
                    {t("banners.stayClockedIn")}
                  </Button>
                </div>
              </div>
              <Button
                size="icon"
                variant="ghost"
                className="h-6 w-6 text-amber-600"
                onClick={onDismiss}
              >
                <X className="w-4 h-4" />
              </Button>
            </div>
          </Card>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
