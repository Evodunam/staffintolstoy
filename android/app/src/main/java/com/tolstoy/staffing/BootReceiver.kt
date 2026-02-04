package com.tolstoy.staffing

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log

class BootReceiver : BroadcastReceiver() {
    
    companion object {
        private const val TAG = "BootReceiver"
    }
    
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action == Intent.ACTION_BOOT_COMPLETED ||
            intent.action == "android.intent.action.QUICKBOOT_POWERON") {
            
            Log.d(TAG, "Device booted, checking for active tracking sessions")
            
            // Check SharedPreferences for active tracking session
            val prefs = context.getSharedPreferences("tolstoy_tracking", Context.MODE_PRIVATE)
            val isTrackingEnabled = prefs.getBoolean("tracking_enabled", false)
            val activeJobId = prefs.getInt("active_job_id", -1)
            val activeWorkerId = prefs.getInt("active_worker_id", -1)
            
            if (isTrackingEnabled && activeJobId != -1 && activeWorkerId != -1) {
                Log.d(TAG, "Resuming tracking for job: $activeJobId, worker: $activeWorkerId")
                
                val serviceIntent = Intent(context, LocationTrackingService::class.java).apply {
                    action = LocationTrackingService.ACTION_START_TRACKING
                    putExtra(LocationTrackingService.EXTRA_JOB_ID, activeJobId)
                    putExtra(LocationTrackingService.EXTRA_WORKER_ID, activeWorkerId)
                }
                
                context.startForegroundService(serviceIntent)
            }
        }
    }
}
