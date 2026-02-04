import { useLocationTracking } from "@/hooks/use-location-tracking";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { MapPin, Clock, X, AlertTriangle, CheckCircle } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useTranslation } from "react-i18next";

export function LocationBanner() {
  const { t } = useTranslation();
  const {
    showClockInBanner,
    showClockOutBanner,
    pendingAutoClockIn,
    activeTimesheet,
    locationError,
    triggerAutoClockIn,
    triggerAutoClockOut,
    dismissClockInBanner,
    dismissClockOutBanner,
    clockIn,
    clockOut,
    CLOCK_IN_RADIUS_MILES,
    CLOCK_OUT_RADIUS_MILES,
  } = useLocationTracking();

  if (locationError) {
    return (
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        className="fixed top-20 left-1/2 transform -translate-x-1/2 z-50 w-full max-w-md px-4"
      >
        <Card className="border-yellow-500/50 bg-yellow-500/10">
          <CardContent className="p-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-yellow-600 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="font-medium text-yellow-800 dark:text-yellow-200">{t("banners.locationServicesIssue")}</p>
                <p className="text-sm text-yellow-700 dark:text-yellow-300">{locationError}</p>
                <p className="text-xs text-muted-foreground mt-1">
                  {t("banners.clockInOutManually")}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </motion.div>
    );
  }

  return (
    <AnimatePresence>
      {showClockInBanner && pendingAutoClockIn && (
        <motion.div
          initial={{ opacity: 0, y: -50 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -50 }}
          className="fixed top-20 left-1/2 transform -translate-x-1/2 z-50 w-full max-w-md px-4"
        >
          <Card className="border-primary/50 bg-primary/5 shadow-lg">
            <CardContent className="p-4">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0">
                  <MapPin className="w-5 h-5 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-foreground">{t("banners.nearJobSite")}</p>
                  <p className="text-sm text-muted-foreground truncate">
                    {pendingAutoClockIn.title}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {t("banners.milesAway", { distance: pendingAutoClockIn.distanceMiles.toFixed(1) })}
                  </p>
                  <div className="flex gap-2 mt-3">
                    <Button 
                      size="sm" 
                      onClick={triggerAutoClockIn}
                      className="flex-1"
                      data-testid="button-auto-clock-in"
                    >
                      <Clock className="w-4 h-4 mr-1" />
                      {t("worker.clockIn")}
                    </Button>
                    <Button 
                      size="sm" 
                      variant="outline" 
                      onClick={dismissClockInBanner}
                      data-testid="button-dismiss-clock-in"
                    >
                      <X className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              </div>
              <p className="text-xs text-muted-foreground mt-2 text-center">
                {t("banners.autoClockInActivates", { radius: CLOCK_IN_RADIUS_MILES })}
              </p>
            </CardContent>
          </Card>
        </motion.div>
      )}

      {showClockOutBanner && activeTimesheet && (
        <motion.div
          initial={{ opacity: 0, y: -50 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -50 }}
          className="fixed top-20 left-1/2 transform -translate-x-1/2 z-50 w-full max-w-md px-4"
        >
          <Card className="border-orange-500/50 bg-orange-500/10 shadow-lg">
            <CardContent className="p-4">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-full bg-orange-500/20 flex items-center justify-center flex-shrink-0">
                  <AlertTriangle className="w-5 h-5 text-orange-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-foreground">{t("banners.leftJobSiteQuestion")}</p>
                  <p className="text-sm text-muted-foreground">
                    {t("banners.moreThanMilesAway", { radius: CLOCK_OUT_RADIUS_MILES })}
                  </p>
                  <div className="flex gap-2 mt-3">
                    <Button 
                      size="sm" 
                      variant="destructive"
                      onClick={triggerAutoClockOut}
                      className="flex-1"
                      data-testid="button-auto-clock-out"
                    >
                      <Clock className="w-4 h-4 mr-1" />
                      {t("worker.clockOut")}
                    </Button>
                    <Button 
                      size="sm" 
                      variant="outline" 
                      onClick={dismissClockOutBanner}
                      data-testid="button-dismiss-clock-out"
                    >
                      {t("banners.stillWorking")}
                    </Button>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </motion.div>
      )}

      {activeTimesheet && !showClockOutBanner && (
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="fixed top-20 left-1/2 transform -translate-x-1/2 z-40 w-full max-w-md px-4"
        >
          <Card className="border-green-500/50 bg-green-500/10">
            <CardContent className="py-3 px-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <CheckCircle className="w-5 h-5 text-green-600" />
                  <div>
                    <p className="text-sm font-medium text-green-800 dark:text-green-200">
                      {t("banners.clockedIn")}
                    </p>
                    <p className="text-xs text-green-700 dark:text-green-300">
                      {t("banners.since", { time: new Date(activeTimesheet.clockInTime).toLocaleTimeString() })}
                    </p>
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => clockOut()}
                  data-testid="button-manual-clock-out"
                  className="border-orange-300 text-orange-700 hover:bg-orange-500/10 dark:border-orange-700 dark:text-orange-300"
                >
                  {t("worker.clockOut")}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground mt-2 text-center">
                Tap &quot;Clock out&quot; when you leave the site for accurate hours
              </p>
            </CardContent>
          </Card>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function ManualClockControls({ 
  job, 
  onClockIn, 
  onClockOut, 
  isActive 
}: { 
  job: { id: number; title: string; location: string };
  onClockIn: () => void;
  onClockOut: () => void;
  isActive: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-2">
      {isActive ? (
        <Button 
          size="sm" 
          variant="destructive" 
          onClick={onClockOut}
          data-testid={`button-clock-out-${job.id}`}
        >
          <Clock className="w-4 h-4 mr-1" />
          {t("worker.clockOut")}
        </Button>
      ) : (
        <Button 
          size="sm" 
          onClick={onClockIn}
          data-testid={`button-clock-in-${job.id}`}
        >
          <Clock className="w-4 h-4 mr-1" />
          {t("worker.clockIn")}
        </Button>
      )}
    </div>
  );
}
