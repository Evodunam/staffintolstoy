package com.tolstoy.staffing

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log
import com.google.android.gms.location.Geofence
import com.google.android.gms.location.GeofencingEvent
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking

/**
 * Receives OS geofence transition events (enter/exit). When worker exits job site geofence,
 * POSTs to server to trigger auto clock-out. Works even when app is in background.
 */
class GeofenceBroadcastReceiver : BroadcastReceiver() {
    
    companion object {
        private const val TAG = "GeofenceReceiver"
        const val REQUEST_ID_PREFIX = "job_"
    }
    
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    
    override fun onReceive(context: Context, intent: Intent) {
        val event = GeofencingEvent.fromIntent(intent) ?: return
        if (event.hasError()) {
            Log.e(TAG, "Geofence error: ${event.errorCode}")
            return
        }
        when (event.geofenceTransition) {
            Geofence.GEOFENCE_TRANSITION_EXIT -> {
                val triggering = event.triggeringGeofences ?: return
                val location = event.triggeringLocation
                for (g in triggering) {
                    val requestId = g.requestId
                    if (!requestId.startsWith(REQUEST_ID_PREFIX)) continue
                    val jobId = requestId.removePrefix(REQUEST_ID_PREFIX).toIntOrNull() ?: continue
                    val workerId = GeofenceHelper.getWorkerIdForJob(context, jobId) ?: continue
                    val lat = location?.latitude ?: 0.0
                    val lng = location?.longitude ?: 0.0
                    scope.launch(Dispatchers.IO) {
                        GeofenceHelper.notifyGeofenceExit(context, workerId, jobId, lat, lng)
                    }
                    break // One job per exit
                }
            }
            Geofence.GEOFENCE_TRANSITION_ENTER -> {
                // Could trigger auto clock-in if we wanted; for now we rely on pings
                Log.d(TAG, "Geofence enter")
            }
            else -> {}
        }
    }
}
