import { useEffect, useRef, useState, useCallback } from 'react';
import { useProfile } from './use-profiles';
import { useAuth } from './use-auth';
import { useToast } from './use-toast';

interface NotificationPayload {
  type: 'new_job' | 'application_update' | 'job_update' | 'timesheet_update' | 'general';
  title: string;
  message: string;
  data?: Record<string, any>;
  timestamp: number;
}

interface UseRealtimeOptions {
  showToasts?: boolean;
  onNotification?: (notification: NotificationPayload) => void;
}

export function useRealtime(options: UseRealtimeOptions = {}) {
  const { showToasts = true, onNotification } = options;
  const { user } = useAuth();
  const { data: profile } = useProfile(user?.id);
  const { toast } = useToast();
  
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [notifications, setNotifications] = useState<NotificationPayload[]>([]);

  const connect = useCallback(() => {
    if (!profile?.id || wsRef.current?.readyState === WebSocket.OPEN) return;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;
    
    try {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log('[realtime] Connected to WebSocket (session-authenticated)');
        setIsConnected(true);
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          
          if (data.type === 'authenticated') {
            console.log('[realtime] Authenticated:', data.message);
            return;
          }
          
          if (data.type === 'pong') {
            return;
          }

          const notification = data as NotificationPayload;
          setNotifications((prev) => [notification, ...prev].slice(0, 50));
          
          if (showToasts) {
            toast({
              title: notification.title,
              description: notification.message,
            });
          }
          
          onNotification?.(notification);
        } catch (err) {
          console.error('[realtime] Error parsing message:', err);
        }
      };

      ws.onclose = () => {
        console.log('[realtime] Disconnected from WebSocket');
        setIsConnected(false);
        wsRef.current = null;
        
        reconnectTimeoutRef.current = setTimeout(() => {
          connect();
        }, 5000);
      };

      ws.onerror = (err) => {
        console.error('[realtime] WebSocket error:', err);
      };
    } catch (err) {
      console.error('[realtime] Failed to connect:', err);
    }
  }, [profile, user, showToasts, toast, onNotification]);

  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    
    setIsConnected(false);
  }, []);

  const updatePreferences = useCallback((preferences: Record<string, any>) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'update_preferences',
        preferences,
      }));
    }
  }, []);

  const clearNotifications = useCallback(() => {
    setNotifications([]);
  }, []);

  useEffect(() => {
    if (profile?.id) {
      connect();
    }
    
    return () => {
      disconnect();
    };
  }, [profile?.id, connect, disconnect]);

  useEffect(() => {
    const pingInterval = setInterval(() => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'ping' }));
      }
    }, 30000);

    return () => clearInterval(pingInterval);
  }, []);

  return {
    isConnected,
    notifications,
    updatePreferences,
    clearNotifications,
    reconnect: connect,
  };
}

export function useNewJobNotifications(onNewJob?: (job: any) => void) {
  const handleNotification = useCallback((notification: NotificationPayload) => {
    if (notification.type === 'new_job' && onNewJob) {
      onNewJob(notification.data);
    }
  }, [onNewJob]);

  return useRealtime({
    showToasts: true,
    onNotification: handleNotification,
  });
}

export function useApplicationNotifications(onUpdate?: (update: any) => void) {
  const handleNotification = useCallback((notification: NotificationPayload) => {
    if (notification.type === 'application_update' && onUpdate) {
      onUpdate(notification.data);
    }
  }, [onUpdate]);

  return useRealtime({
    showToasts: true,
    onNotification: handleNotification,
  });
}
