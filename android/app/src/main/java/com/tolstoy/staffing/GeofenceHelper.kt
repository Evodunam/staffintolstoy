package com.tolstoy.staffing

import android.content.Context
import android.util.Log
import com.google.android.gms.location.Geofence
import com.google.android.gms.location.GeofencingClient
import com.google.android.gms.location.GeofencingRequest
import com.google.android.gms.location.LocationServices
import com.google.android.gms.tasks.OnFailureListener
import com.google.android.gms.tasks.OnSuccessListener
import com.google.firebase.messaging.FirebaseMessaging
import kotlinx.coroutines.tasks.await
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/**
 * Registers OS-level geofences around job sites and notifies server on exit.
 * More reliable than app-based pings when app is backgrounded.
 */
object GeofenceHelper {
    private const val TAG = "GeofenceHelper"
    private const val GEOFENCE_RADIUS_M = 500
    private const val GEOFENCE_EXPIRATION_MS = 24 * 60 * 60 * 1000L // 24 hours
    private const val PREFS = "tolstoy_geofence"
    private const val KEY_WORKER_PREFIX = "worker_job_"
    private const val TIMEOUT_MS = 15_000

    fun registerJobGeofence(context: Context, jobId: Int, workerId: Int, lat: Double, lng: Double) {
        val client: GeofencingClient = LocationServices.getGeofencingClient(context)
        val requestId = "${GeofenceBroadcastReceiver.REQUEST_ID_PREFIX}$jobId"
        val geofence = Geofence.Builder()
            .setRequestId(requestId)
            .setCircularRegion(lat, lng, GEOFENCE_RADIUS_M.toFloat())
            .setExpirationDuration(GEOFENCE_EXPIRATION_MS)
            .setTransitionTypes(Geofence.GEOFENCE_TRANSITION_EXIT or Geofence.GEOFENCE_TRANSITION_ENTER)
            .build()
        val request = GeofencingRequest.Builder()
            .setInitialTrigger(GeofencingRequest.INITIAL_TRIGGER_EXIT)
            .addGeofence(geofence)
            .build()
        val pendingIntent = GeofencePendingIntentHelper.getPendingIntent(context)
        saveWorkerForJob(context, jobId, workerId)
        client.addGeofences(request, pendingIntent)
            .addOnSuccessListener {
                Log.d(TAG, "Geofence registered for job $jobId")
            }
            .addOnFailureListener { e ->
                Log.e(TAG, "Geofence registration failed", e)
            }
    }

    fun removeJobGeofence(context: Context, jobId: Int) {
        val client = LocationServices.getGeofencingClient(context)
        val requestIds = listOf("${GeofenceBroadcastReceiver.REQUEST_ID_PREFIX}$jobId")
        client.removeGeofences(requestIds)
            .addOnSuccessListener { Log.d(TAG, "Geofence removed for job $jobId") }
            .addOnFailureListener { e -> Log.e(TAG, "Geofence remove failed", e) }
        clearWorkerForJob(context, jobId)
    }

    fun getWorkerIdForJob(context: Context, jobId: Int): Int? {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val v = prefs.getInt("${KEY_WORKER_PREFIX}$jobId", -1)
        return if (v == -1) null else v
    }

    private fun saveWorkerForJob(context: Context, jobId: Int, workerId: Int) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .putInt("${KEY_WORKER_PREFIX}$jobId", workerId)
            .apply()
    }

    private fun clearWorkerForJob(context: Context, jobId: Int) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .remove("${KEY_WORKER_PREFIX}$jobId")
            .apply()
    }

    suspend fun notifyGeofenceExit(context: Context, workerId: Int, jobId: Int, lat: Double, lng: Double): Boolean {
        return try {
            val token = context.getSharedPreferences("tolstoy_push", Context.MODE_PRIVATE)
                .getString("fcm_token", null)
                ?: FirebaseMessaging.getInstance().token.await().takeIf { it.isNotBlank() }
                ?: return false
            val apiBase = context.getString(R.string.api_base_url).trimEnd('/')
            val payload = JSONObject().apply {
                put("deviceToken", token)
                put("workerId", workerId)
                put("jobId", jobId)
                put("latitude", lat)
                put("longitude", lng)
            }
            val url = URL("$apiBase/api/location-pings/geofence-exit")
            val conn = url.openConnection() as HttpURLConnection
            conn.requestMethod = "POST"
            conn.doOutput = true
            conn.connectTimeout = TIMEOUT_MS
            conn.readTimeout = TIMEOUT_MS
            conn.setRequestProperty("Content-Type", "application/json")
            conn.outputStream.use { it.write(payload.toString().toByteArray(Charsets.UTF_8)) }
            val ok = conn.responseCode in 200..299
            if (ok) Log.d(TAG, "Geofence exit notified for job $jobId")
            else Log.e(TAG, "Geofence exit failed: ${conn.responseCode}")
            ok
        } catch (e: Exception) {
            Log.e(TAG, "Geofence exit notify error", e)
            false
        }
    }
}
