import { useState } from 'react';
import { MapPin, Info, AlertTriangle } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { useLocationTracking } from '@/hooks/useLocationTracking';
import { LocationPermissionFlow } from './LocationPermissionFlow';

interface LocationTrackingToggleProps {
  onTrackingChange?: (enabled: boolean) => void;
}

export function LocationTrackingToggle({ onTrackingChange }: LocationTrackingToggleProps) {
  const [showPermissionFlow, setShowPermissionFlow] = useState(false);
  const { 
    isTracking, 
    permissionStatus, 
    hasBackgroundPermission,
    stopTracking,
    isNative
  } = useLocationTracking();
  
  const [enabled, setEnabled] = useState(isTracking);

  const handleToggle = (checked: boolean) => {
    if (checked) {
      if (permissionStatus !== 'granted') {
        setShowPermissionFlow(true);
        return;
      }
      setEnabled(true);
      onTrackingChange?.(true);
    } else {
      stopTracking();
      setEnabled(false);
      onTrackingChange?.(false);
    }
  };

  const handlePermissionGranted = () => {
    setEnabled(true);
    onTrackingChange?.(true);
  };

  if (!isNative) {
    return null;
  }

  return (
    <>
      <Card data-testid="card-location-tracking">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <MapPin className="h-4 w-4" />
            Automatic Time Tracking
          </CardTitle>
          <CardDescription>
            Automatically clock in and out based on your location at job sites
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <Label htmlFor="location-tracking" className="flex-1">
              Enable automatic tracking
            </Label>
            <Switch
              id="location-tracking"
              checked={enabled}
              onCheckedChange={handleToggle}
              data-testid="switch-location-tracking"
            />
          </div>
          
          {enabled && !hasBackgroundPermission && (
            <Alert variant="default" className="bg-amber-50 dark:bg-amber-950 border-amber-200">
              <AlertTriangle className="h-4 w-4 text-amber-600" />
              <AlertDescription className="text-amber-800 dark:text-amber-200">
                Background location not enabled. Tracking may stop when the app is closed.
                <Button 
                  variant="ghost" 
                  className="p-0 h-auto text-amber-600 underline ml-1 hover:bg-transparent"
                  onClick={() => setShowPermissionFlow(true)}
                  data-testid="button-enable-background"
                >
                  Enable now
                </Button>
              </AlertDescription>
            </Alert>
          )}
          
          {enabled && hasBackgroundPermission && (
            <Alert>
              <Info className="h-4 w-4" />
              <AlertDescription>
                Location tracking is active during scheduled work hours only. Your location data is used exclusively for time tracking.
              </AlertDescription>
            </Alert>
          )}
          
          {!enabled && (
            <p className="text-sm text-muted-foreground">
              When disabled, you'll need to manually clock in and out for each job using the app.
            </p>
          )}
        </CardContent>
      </Card>
      
      <LocationPermissionFlow
        open={showPermissionFlow}
        onClose={() => setShowPermissionFlow(false)}
        onPermissionGranted={handlePermissionGranted}
      />
    </>
  );
}
