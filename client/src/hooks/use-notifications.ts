import { useState, useEffect, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { 
  requestNotificationPermission, 
  onForegroundMessage, 
  isNotificationSupported,
  getNotificationPermissionStatus,
  getDeviceInfo,
  initServiceWorker
} from "@/lib/firebase";
import { useToast } from "@/hooks/use-toast";
import type { Notification, DeviceToken } from "@shared/schema";

export function useNotifications(profileId: number | undefined) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [permissionStatus, setPermissionStatus] = useState<NotificationPermission | null>(null);
  const [serviceWorkerError, setServiceWorkerError] = useState<string | null>(null);

  useEffect(() => {
    setPermissionStatus(getNotificationPermissionStatus());
    
    // Initialize service worker with error handling
    initServiceWorker()
      .then((registration) => {
        if (registration) {
          console.log("[Notifications] Service worker initialized successfully");
          setServiceWorkerError(null);
        }
      })
      .catch((error: any) => {
        const userMessage = error?.userMessage || 'Unable to set up notifications';
        console.error("[Notifications] Service worker initialization failed:", error);
        setServiceWorkerError(userMessage);
        
        // Only show toast for certain errors (not InvalidStateError which is common in dev)
        if (error?.name !== 'InvalidStateError') {
          toast({
            title: "Notifications Unavailable",
            description: userMessage,
            variant: "default",
            duration: 5000,
          });
        }
      });
  }, [toast]);

  const { data: notifications = [], isLoading: isLoadingNotifications } = useQuery<Notification[]>({
    queryKey: ["/api/notifications", profileId],
    enabled: !!profileId,
  });

  const { data: deviceTokens = [], isLoading: isLoadingDevices } = useQuery<DeviceToken[]>({
    queryKey: ["/api/device-tokens", profileId],
    enabled: !!profileId,
  });

  const unreadCount = notifications.filter(n => !n.isRead).length;

  const registerDeviceMutation = useMutation({
    mutationFn: async (token: string) => {
      const deviceInfo = getDeviceInfo();
      return apiRequest("POST", "/api/device-tokens", {
        profileId,
        token,
        ...deviceInfo,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/device-tokens", profileId] });
    },
    onError: (error: any) => {
      // Log error but don't break the UI
      console.error("Failed to register device token:", error);
      // Connection errors are handled gracefully in enableNotifications
    },
  });

  const removeDeviceMutation = useMutation({
    mutationFn: async (tokenId: number) => {
      return apiRequest("DELETE", `/api/device-tokens/${tokenId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/device-tokens", profileId] });
    },
  });

  const markAsReadMutation = useMutation({
    mutationFn: async (notificationId: number) => {
      return apiRequest("PATCH", `/api/notifications/${notificationId}/read`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/notifications", profileId] });
    },
  });

  const markAllAsReadMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("PATCH", `/api/notifications/read-all`, { profileId });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/notifications", profileId] });
    },
  });

  const enableNotifications = useCallback(async () => {
    if (!profileId) return false;
    
    try {
      const token = await requestNotificationPermission();
      if (token) {
        await registerDeviceMutation.mutateAsync(token);
        setPermissionStatus("granted");
        return true;
      }
      
      setPermissionStatus(getNotificationPermissionStatus());
      return false;
    } catch (error: any) {
      // Handle connection errors gracefully
      console.error("Failed to enable notifications:", error);
      // Don't show error to user if it's a connection issue - they can try again later
      if (error.message?.includes("connect to server")) {
        // Silently fail - user can try again when server is available
        return false;
      }
      // Re-throw other errors
      throw error;
    }
  }, [profileId, registerDeviceMutation]);

  useEffect(() => {
    if (!profileId) return;

    const unsubscribe = onForegroundMessage((payload) => {
      queryClient.invalidateQueries({ queryKey: ["/api/notifications", profileId] });
      
      if (payload.notification) {
        new Notification(payload.notification.title || "Tolstoy Staffing", {
          body: payload.notification.body,
          icon: "/favicon.ico",
        });
      }
    });

    return unsubscribe;
  }, [profileId, queryClient]);

  const isCurrentDeviceRegistered = useCallback(() => {
    const currentUserAgent = navigator.userAgent;
    return deviceTokens.some(
      (dt) => dt.userAgent === currentUserAgent && dt.isActive
    );
  }, [deviceTokens]);

  return {
    notifications,
    deviceTokens,
    unreadCount,
    isLoadingNotifications,
    isLoadingDevices,
    permissionStatus,
    serviceWorkerError,
    isSupported: isNotificationSupported(),
    isCurrentDeviceRegistered: isCurrentDeviceRegistered(),
    enableNotifications,
    removeDevice: removeDeviceMutation.mutate,
    markAsRead: markAsReadMutation.mutate,
    markAllAsRead: markAllAsReadMutation.mutate,
    isEnabling: registerDeviceMutation.isPending,
  };
}
