package com.tolstoy.staffing

import android.content.Intent
import android.util.Log
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

class MessagingService : FirebaseMessagingService() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    
    companion object {
        private const val TAG = "MessagingService"
    }
    
    override fun onMessageReceived(remoteMessage: RemoteMessage) {
        Log.d(TAG, "Message received from: ${remoteMessage.from}")
        
        // Handle data-only messages (for background geolocation wakeup)
        remoteMessage.data.isNotEmpty().let {
            Log.d(TAG, "Message data payload: ${remoteMessage.data}")
            handleDataMessage(remoteMessage.data)
        }
        
        // Handle notification messages (for visible alerts)
        remoteMessage.notification?.let {
            Log.d(TAG, "Message notification body: ${it.body}")
            handleNotificationMessage(it)
        }
    }
    
    private fun handleDataMessage(data: Map<String, String>) {
        when (data["type"]) {
            "geolocation_wakeup" -> {
                Log.d(TAG, "Geolocation wakeup received")
                
                val jobId = data["jobId"]?.toIntOrNull()
                val workerId = data["workerId"]?.toIntOrNull()
                
                if (jobId != null && workerId != null) {
                    // Start location tracking service (for when app is in background)
                    val intent = Intent(this, LocationTrackingService::class.java).apply {
                        action = LocationTrackingService.ACTION_START_TRACKING
                        putExtra(LocationTrackingService.EXTRA_JOB_ID, jobId)
                        putExtra(LocationTrackingService.EXTRA_WORKER_ID, workerId)
                    }
                    startForegroundService(intent)
                    
                    // Send ping from native (works when app is closed - no WebView/session)
                    scope.launch {
                        PingFromPushHelper.sendPingFromPush(this@MessagingService, workerId, jobId)
                    }
                    
                    // Also broadcast to WebView (when app is open)
                    val broadcastIntent = Intent("com.tolstoy.staffing.GEOLOCATION_WAKEUP").apply {
                        putExtra("job_id", jobId)
                        putExtra("worker_id", workerId)
                    }
                    sendBroadcast(broadcastIntent)
                }
            }
            
            "clock_in_reminder" -> {
                Log.d(TAG, "Clock-in reminder received")
                // Let Capacitor handle this notification
                val intent = Intent("com.tolstoy.staffing.CLOCK_REMINDER").apply {
                    putExtra("job_id", data["jobId"])
                    putExtra("job_title", data["jobTitle"])
                    putExtra("start_time", data["startTime"])
                    putExtra("reminder_type", "clock_in")
                }
                sendBroadcast(intent)
            }
            
            "clock_out_reminder" -> {
                Log.d(TAG, "Clock-out reminder received")
                val intent = Intent("com.tolstoy.staffing.CLOCK_REMINDER").apply {
                    putExtra("job_id", data["jobId"])
                    putExtra("job_title", data["jobTitle"])
                    putExtra("end_time", data["endTime"])
                    putExtra("reminder_type", "clock_out")
                }
                sendBroadcast(intent)
            }
        }
    }
    
    private fun handleNotificationMessage(notification: RemoteMessage.Notification) {
        // Display notification - Capacitor handles this automatically
        Log.d(TAG, "Notification: ${notification.title} - ${notification.body}")
    }
    
    override fun onNewToken(token: String) {
        Log.d(TAG, "New FCM token: $token")
        // Store for native ping-from-push (app closed scenario)
        getSharedPreferences("tolstoy_push", MODE_PRIVATE).edit()
            .putString("fcm_token", token)
            .apply()
        // Broadcast new token to WebView for registration
        val intent = Intent("com.tolstoy.staffing.FCM_TOKEN_REFRESH").apply {
            putExtra("token", token)
        }
        sendBroadcast(intent)
    }
}
