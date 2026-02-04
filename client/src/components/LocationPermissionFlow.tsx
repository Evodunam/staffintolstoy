import { useState, useEffect } from 'react';
import { Capacitor, App } from '@capacitor/core';
import { MapPin, Shield, Clock, AlertCircle, ExternalLink } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useLocationTracking } from '@/hooks/useLocationTracking';
import { 
  openBackgroundLocationSettings, 
  checkNativePermissions,
  requestBackgroundLocationPermission 
} from '@/lib/nativeLocationTracking';

interface LocationPermissionFlowProps {
  open: boolean;
  onClose: () => void;
  onPermissionGranted: () => void;
  jobTitle?: string;
}

type FlowStep = 'intro' | 'foreground' | 'background' | 'background_settings' | 'settings' | 'complete';

export function LocationPermissionFlow({ 
  open, 
  onClose, 
  onPermissionGranted,
  jobTitle 
}: LocationPermissionFlowProps) {
  const [step, setStep] = useState<FlowStep>('intro');
  const [isRequesting, setIsRequesting] = useState(false);
  const { requestPermissions, permissionStatus, hasBackgroundPermission } = useLocationTracking();
  
  const isAndroid = Capacitor.getPlatform() === 'android';

  useEffect(() => {
    if (step === 'background_settings' && Capacitor.isNativePlatform()) {
      const checkOnResume = async () => {
        const perms = await checkNativePermissions();
        if (perms.background) {
          setStep('complete');
          setTimeout(() => {
            onPermissionGranted();
            onClose();
          }, 1500);
        }
      };
      
      const handleVisibilityChange = () => {
        if (document.visibilityState === 'visible') {
          checkOnResume();
        }
      };
      
      document.addEventListener('visibilitychange', handleVisibilityChange);
      return () => {
        document.removeEventListener('visibilitychange', handleVisibilityChange);
      };
    }
  }, [step, onPermissionGranted, onClose]);

  const handleRequestPermissions = async () => {
    setIsRequesting(true);
    try {
      const granted = await requestPermissions();
      if (granted) {
        const perms = await checkNativePermissions();
        
        if (perms.background) {
          setStep('complete');
          setTimeout(() => {
            onPermissionGranted();
            onClose();
          }, 1500);
        } else if (isAndroid) {
          const bgResult = await requestBackgroundLocationPermission();
          if (bgResult.granted) {
            setStep('complete');
            setTimeout(() => {
              onPermissionGranted();
              onClose();
            }, 1500);
          } else if (bgResult.needsSettings) {
            setStep('background_settings');
          } else {
            setStep('background');
          }
        } else {
          setStep('complete');
          setTimeout(() => {
            onPermissionGranted();
            onClose();
          }, 1500);
        }
      } else {
        setStep('settings');
      }
    } finally {
      setIsRequesting(false);
    }
  };

  const handleBackgroundRequest = async () => {
    setIsRequesting(true);
    try {
      const result = await requestBackgroundLocationPermission();
      if (result.granted) {
        setStep('complete');
        setTimeout(() => {
          onPermissionGranted();
          onClose();
        }, 1500);
      } else if (result.needsSettings) {
        setStep('background_settings');
      } else {
        setStep('settings');
      }
    } finally {
      setIsRequesting(false);
    }
  };

  const handleOpenBackgroundSettings = async () => {
    await openBackgroundLocationSettings();
  };

  const handleCheckBackgroundPermission = async () => {
    const perms = await checkNativePermissions();
    if (perms.background) {
      setStep('complete');
      setTimeout(() => {
        onPermissionGranted();
        onClose();
      }, 1500);
    }
  };

  const renderStep = () => {
    switch (step) {
      case 'intro':
        return (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <MapPin className="h-5 w-5 text-primary" />
                Location Access Required
              </DialogTitle>
              <DialogDescription>
                To automatically track your work time at job sites, we need access to your location.
              </DialogDescription>
            </DialogHeader>
            
            <div className="space-y-4 py-4">
              <Card>
                <CardContent className="pt-4">
                  <div className="flex items-start gap-3">
                    <Clock className="h-5 w-5 text-primary mt-0.5" />
                    <div>
                      <p className="font-medium">Automatic Time Tracking</p>
                      <p className="text-sm text-muted-foreground">
                        Clock in and out automatically when you arrive at or leave job sites
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
              
              <Card>
                <CardContent className="pt-4">
                  <div className="flex items-start gap-3">
                    <Shield className="h-5 w-5 text-primary mt-0.5" />
                    <div>
                      <p className="font-medium">Accurate Payroll</p>
                      <p className="text-sm text-muted-foreground">
                        Ensures your work hours are recorded correctly and prevents disputes
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
              
              {jobTitle && (
                <p className="text-sm text-muted-foreground text-center">
                  This is required to work on: <strong>{jobTitle}</strong>
                </p>
              )}
            </div>
            
            <DialogFooter>
              <Button variant="outline" onClick={onClose} data-testid="button-cancel-location">
                Not Now
              </Button>
              <Button onClick={() => setStep('foreground')} data-testid="button-continue-location">
                Continue
              </Button>
            </DialogFooter>
          </>
        );
        
      case 'foreground':
        return (
          <>
            <DialogHeader>
              <DialogTitle>Allow Location Access</DialogTitle>
              <DialogDescription>
                First, we need permission to access your location while using the app.
              </DialogDescription>
            </DialogHeader>
            
            <div className="py-6 text-center">
              <div className="mx-auto w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mb-4">
                <MapPin className="h-8 w-8 text-primary" />
              </div>
              <p className="text-sm text-muted-foreground">
                Tap "Allow" when prompted to grant location access.
              </p>
            </div>
            
            <DialogFooter>
              <Button variant="outline" onClick={onClose} data-testid="button-cancel-foreground">
                Cancel
              </Button>
              <Button 
                onClick={handleRequestPermissions} 
                disabled={isRequesting}
                data-testid="button-allow-location"
              >
                {isRequesting ? 'Requesting...' : 'Allow Location'}
              </Button>
            </DialogFooter>
          </>
        );
        
      case 'background':
        return (
          <>
            <DialogHeader>
              <DialogTitle>Enable Background Location</DialogTitle>
              <DialogDescription>
                For automatic clock in/out to work reliably, we need background location access.
              </DialogDescription>
            </DialogHeader>
            
            <div className="py-4 space-y-4">
              <Card className="bg-amber-50 dark:bg-amber-950 border-amber-200 dark:border-amber-800">
                <CardContent className="pt-4">
                  <div className="flex items-start gap-3">
                    <AlertCircle className="h-5 w-5 text-amber-600 mt-0.5" />
                    <div>
                      <p className="font-medium text-amber-900 dark:text-amber-100">Important</p>
                      <p className="text-sm text-amber-800 dark:text-amber-200">
                        Select "Allow all the time" to enable automatic time tracking even when the app is closed.
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
              
              <p className="text-sm text-muted-foreground text-center">
                Your location is only tracked during scheduled work hours and is used solely for time tracking purposes.
              </p>
            </div>
            
            <DialogFooter>
              <Button variant="outline" onClick={() => {
                setStep('complete');
                setTimeout(() => {
                  onPermissionGranted();
                  onClose();
                }, 1500);
              }} data-testid="button-skip-background">
                Skip for Now
              </Button>
              <Button 
                onClick={handleBackgroundRequest} 
                disabled={isRequesting}
                data-testid="button-allow-background"
              >
                {isRequesting ? 'Requesting...' : 'Allow Background'}
              </Button>
            </DialogFooter>
          </>
        );
        
      case 'background_settings':
        return (
          <>
            <DialogHeader>
              <DialogTitle>Enable "Allow all the time"</DialogTitle>
              <DialogDescription>
                Android requires you to enable background location in Settings.
              </DialogDescription>
            </DialogHeader>
            
            <div className="py-4 space-y-4">
              <Card className="bg-blue-50 dark:bg-blue-950 border-blue-200 dark:border-blue-800">
                <CardContent className="pt-4">
                  <div className="flex items-start gap-3">
                    <ExternalLink className="h-5 w-5 text-blue-600 mt-0.5" />
                    <div>
                      <p className="font-medium text-blue-900 dark:text-blue-100">Instructions</p>
                      <ol className="text-sm text-blue-800 dark:text-blue-200 list-decimal list-inside space-y-1 mt-1">
                        <li>Tap "Open Settings" below</li>
                        <li>Go to Permissions &gt; Location</li>
                        <li>Select "Allow all the time"</li>
                        <li>Return to this app and tap "I've Done This"</li>
                      </ol>
                    </div>
                  </div>
                </CardContent>
              </Card>
              
              <p className="text-sm text-muted-foreground text-center">
                This ensures automatic time tracking works even when the app is closed.
              </p>
            </div>
            
            <DialogFooter className="flex-col sm:flex-row gap-2">
              <Button variant="outline" onClick={() => {
                setStep('complete');
                setTimeout(() => {
                  onPermissionGranted();
                  onClose();
                }, 1500);
              }} data-testid="button-skip-background-settings">
                Skip for Now
              </Button>
              <Button 
                variant="outline"
                onClick={handleOpenBackgroundSettings}
                data-testid="button-open-location-settings"
              >
                <ExternalLink className="h-4 w-4 mr-2" />
                Open Settings
              </Button>
              <Button 
                onClick={handleCheckBackgroundPermission}
                data-testid="button-verify-background"
              >
                I've Done This
              </Button>
            </DialogFooter>
          </>
        );
        
      case 'settings':
        return (
          <>
            <DialogHeader>
              <DialogTitle>Permission Required</DialogTitle>
              <DialogDescription>
                Location access was denied. You can enable it in your device settings.
              </DialogDescription>
            </DialogHeader>
            
            <div className="py-6 text-center">
              <div className="mx-auto w-16 h-16 bg-destructive/10 rounded-full flex items-center justify-center mb-4">
                <AlertCircle className="h-8 w-8 text-destructive" />
              </div>
              <p className="text-sm text-muted-foreground">
                Without location access, you'll need to manually clock in and out for each job.
              </p>
            </div>
            
            <DialogFooter>
              <Button variant="outline" onClick={onClose} data-testid="button-close-settings">
                Close
              </Button>
              <Button onClick={async () => {
                const { openAppSettings } = await import('@/lib/nativeLocationTracking');
                await openAppSettings();
                onClose();
              }} data-testid="button-open-settings">
                Open Settings
              </Button>
            </DialogFooter>
          </>
        );
        
      case 'complete':
        return (
          <>
            <DialogHeader>
              <DialogTitle className="text-center">Location Access Enabled</DialogTitle>
            </DialogHeader>
            
            <div className="py-8 text-center">
              <div className="mx-auto w-16 h-16 bg-green-100 dark:bg-green-900 rounded-full flex items-center justify-center mb-4">
                <Shield className="h-8 w-8 text-green-600 dark:text-green-400" />
              </div>
              <p className="text-muted-foreground">
                Automatic time tracking is now active. You're all set!
              </p>
            </div>
          </>
        );
    }
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="sm:max-w-md" data-testid="dialog-location-permission">
        {renderStep()}
      </DialogContent>
    </Dialog>
  );
}
