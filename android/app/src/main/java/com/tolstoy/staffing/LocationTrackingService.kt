package com.tolstoy.staffing

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.location.Location
import android.os.Build
import android.os.IBinder
import android.os.Looper
import android.util.Log
import androidx.core.app.NotificationCompat
import com.google.android.gms.location.*

/**
 * Foreground service for location tracking during active jobs.
 * Continues to receive location updates when the app is in the background.
 * When the app process is killed (e.g. user swipes away), the service stops.
 * See docs/LOCATION_TRACKING.md for behavior summary.
 */
class LocationTrackingService : Service() {
    
    companion object {
        private const val TAG = "LocationTrackingService"
        private const val NOTIFICATION_ID = 1001
        private const val CHANNEL_ID = "location_tracking_channel"
        private const val LOCATION_INTERVAL = 30000L // 30 seconds
        private const val LOCATION_FASTEST_INTERVAL = 15000L // 15 seconds
        private const val LOCATION_DISPLACEMENT = 10f // 10 meters
        
        const val ACTION_START_TRACKING = "com.tolstoy.staffing.START_TRACKING"
        const val ACTION_STOP_TRACKING = "com.tolstoy.staffing.STOP_TRACKING"
        const val EXTRA_JOB_ID = "job_id"
        const val EXTRA_WORKER_ID = "worker_id"
    }
    
    private lateinit var fusedLocationClient: FusedLocationProviderClient
    private lateinit var locationCallback: LocationCallback
    private var isTracking = false
    private var currentJobId: Int? = null
    private var currentWorkerId: Int? = null
    
    override fun onCreate() {
        super.onCreate()
        Log.d(TAG, "Service created")
        
        fusedLocationClient = LocationServices.getFusedLocationProviderClient(this)
        createNotificationChannel()
        
        locationCallback = object : LocationCallback() {
            override fun onLocationResult(locationResult: LocationResult) {
                for (location in locationResult.locations) {
                    handleLocationUpdate(location)
                }
            }
        }
    }
    
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_START_TRACKING -> {
                currentJobId = intent.getIntExtra(EXTRA_JOB_ID, -1).takeIf { it != -1 }
                currentWorkerId = intent.getIntExtra(EXTRA_WORKER_ID, -1).takeIf { it != -1 }
                startForegroundTracking()
            }
            ACTION_STOP_TRACKING -> {
                stopTracking()
            }
        }
        return START_STICKY
    }
    
    override fun onBind(intent: Intent?): IBinder? = null
    
    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "Location Tracking",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "Tracking location during active jobs to automatically record work time"
                setShowBadge(false)
            }
            
            val notificationManager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            notificationManager.createNotificationChannel(channel)
        }
    }
    
    private fun createNotification(): Notification {
        val notificationIntent = Intent(this, MainActivity::class.java)
        val pendingIntent = PendingIntent.getActivity(
            this, 0, notificationIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        
        val stopIntent = Intent(this, LocationTrackingService::class.java).apply {
            action = ACTION_STOP_TRACKING
        }
        val stopPendingIntent = PendingIntent.getService(
            this, 1, stopIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("Tolstoy Staffing")
            .setContentText("Tracking location during active jobs to automatically record work time")
            .setSmallIcon(R.drawable.ic_notification)
            .setContentIntent(pendingIntent)
            .addAction(R.drawable.ic_stop, "Stop", stopPendingIntent)
            .setOngoing(true)
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
            .build()
    }
    
    private fun startForegroundTracking() {
        if (isTracking) {
            Log.d(TAG, "Already tracking")
            return
        }
        
        Log.d(TAG, "Starting foreground tracking for job: $currentJobId, worker: $currentWorkerId")
        
        startForeground(NOTIFICATION_ID, createNotification())
        
        val locationRequest = LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, LOCATION_INTERVAL)
            .setMinUpdateIntervalMillis(LOCATION_FASTEST_INTERVAL)
            .setMinUpdateDistanceMeters(LOCATION_DISPLACEMENT)
            .build()
        
        try {
            fusedLocationClient.requestLocationUpdates(
                locationRequest,
                locationCallback,
                Looper.getMainLooper()
            )
            isTracking = true
            Log.d(TAG, "Location updates started")
        } catch (e: SecurityException) {
            Log.e(TAG, "Location permission not granted", e)
        }
    }
    
    private fun stopTracking() {
        Log.d(TAG, "Stopping tracking")
        isTracking = false
        fusedLocationClient.removeLocationUpdates(locationCallback)
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }
    
    private fun handleLocationUpdate(location: Location) {
        Log.d(TAG, "Location update: ${location.latitude}, ${location.longitude}")
        
        // Send location to WebView/Capacitor bridge
        val intent = Intent("com.tolstoy.staffing.LOCATION_UPDATE").apply {
            putExtra("latitude", location.latitude)
            putExtra("longitude", location.longitude)
            putExtra("accuracy", location.accuracy)
            putExtra("timestamp", location.time)
            putExtra("job_id", currentJobId)
            putExtra("worker_id", currentWorkerId)
        }
        sendBroadcast(intent)
    }
    
    override fun onDestroy() {
        super.onDestroy()
        if (isTracking) {
            fusedLocationClient.removeLocationUpdates(locationCallback)
        }
        Log.d(TAG, "Service destroyed")
    }
}
