package com.tolstoy.staffing

import android.content.Context
import android.util.Log
import com.google.android.gms.location.LocationServices
import com.google.firebase.messaging.FirebaseMessaging
import kotlinx.coroutines.tasks.await
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/**
 * When the app receives geolocation_wakeup push (including when app is closed),
 * gets location and POSTs to /api/location-pings/from-push so the server can
 * record the ping and optionally auto clock-in the worker.
 */
object PingFromPushHelper {
    private const val TAG = "PingFromPushHelper"
    private const val TIMEOUT_MS = 15_000

    suspend fun sendPingFromPush(context: Context, workerId: Int, jobId: Int): Boolean {
        return try {
            val token = getFcmToken(context) ?: run {
                Log.w(TAG, "No FCM token available")
                return false
            }
            val apiBase = context.getString(R.string.api_base_url).trimEnd('/')
            val location = getLocation(context) ?: run {
                Log.w(TAG, "Could not get location")
                return false
            }
            val payload = JSONObject().apply {
                put("deviceToken", token)
                put("workerId", workerId)
                put("jobId", jobId)
                put("latitude", location.latitude)
                put("longitude", location.longitude)
                put("accuracy", location.accuracy.toDouble())
            }
            val url = URL("$apiBase/api/location-pings/from-push")
            val conn = url.openConnection() as HttpURLConnection
            conn.requestMethod = "POST"
            conn.doOutput = true
            conn.connectTimeout = TIMEOUT_MS
            conn.readTimeout = TIMEOUT_MS
            conn.setRequestProperty("Content-Type", "application/json")
            conn.outputStream.use { os ->
                os.write(payload.toString().toByteArray(Charsets.UTF_8))
            }
            val code = conn.responseCode
            if (code in 200..299) {
                Log.d(TAG, "Ping from push sent successfully")
                true
            } else {
                Log.e(TAG, "Ping from push failed: $code ${conn.responseMessage}")
                false
            }
        } catch (e: Exception) {
            Log.e(TAG, "Ping from push error", e)
            false
        }
    }

    private suspend fun getFcmToken(context: Context): String? {
        return try {
            val prefs = context.getSharedPreferences("tolstoy_push", Context.MODE_PRIVATE)
            prefs.getString("fcm_token", null)
                ?: FirebaseMessaging.getInstance().token.await().takeIf { it.isNotBlank() }
        } catch (e: Exception) {
            null
        }
    }

    private suspend fun getLocation(context: Context): android.location.Location? {
        return try {
            val client = LocationServices.getFusedLocationProviderClient(context)
            client.lastLocation.await()
        } catch (e: Exception) {
            Log.e(TAG, "Get location error", e)
            null
        }
    }
}
