package com.tolstoy.staffing

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission
import com.getcapacitor.annotation.PermissionCallback

@CapacitorPlugin(
    name = "LocationTrackingService",
    permissions = [
        Permission(
            alias = "location",
            strings = [
                Manifest.permission.ACCESS_FINE_LOCATION,
                Manifest.permission.ACCESS_COARSE_LOCATION
            ]
        ),
        Permission(
            alias = "backgroundLocation",
            strings = [Manifest.permission.ACCESS_BACKGROUND_LOCATION]
        )
    ]
)
class LocationTrackingPlugin : Plugin() {
    
    companion object {
        private const val PREFS_NAME = "tolstoy_tracking"
        private const val KEY_TRACKING_ENABLED = "tracking_enabled"
        private const val KEY_ACTIVE_JOB_ID = "active_job_id"
        private const val KEY_ACTIVE_WORKER_ID = "active_worker_id"
    }
    
    @PluginMethod
    fun startTracking(call: PluginCall) {
        val jobId = call.getInt("jobId", -1)
        val workerId = call.getInt("workerId", -1)
        val jobLat = call.getDouble("jobLatitude", 0.0)
        val jobLng = call.getDouble("jobLongitude", 0.0)

        if (jobId == -1 || workerId == -1) {
            call.reject("jobId and workerId are required")
            return
        }

        if (!hasLocationPermission()) {
            call.reject("Location permission not granted")
            return
        }

        saveTrackingState(true, jobId, workerId)

        if (jobLat != 0.0 && jobLng != 0.0) {
            GeofenceHelper.registerJobGeofence(context, jobId, workerId, jobLat, jobLng)
        }

        val intent = Intent(context, LocationTrackingService::class.java).apply {
            action = LocationTrackingService.ACTION_START_TRACKING
            putExtra(LocationTrackingService.EXTRA_JOB_ID, jobId)
            putExtra(LocationTrackingService.EXTRA_WORKER_ID, workerId)
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            context.startForegroundService(intent)
        } else {
            context.startService(intent)
        }

        val result = JSObject()
        result.put("started", true)
        call.resolve(result)
    }
    
    @PluginMethod
    fun stopTracking(call: PluginCall) {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val jobId = prefs.getInt(KEY_ACTIVE_JOB_ID, -1)
        if (jobId != -1) {
            GeofenceHelper.removeJobGeofence(context, jobId)
        }
        saveTrackingState(false, -1, -1)

        val intent = Intent(context, LocationTrackingService::class.java).apply {
            action = LocationTrackingService.ACTION_STOP_TRACKING
        }
        context.startService(intent)

        val result = JSObject()
        result.put("stopped", true)
        call.resolve(result)
    }
    
    @PluginMethod
    fun getTrackingState(call: PluginCall) {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val enabled = prefs.getBoolean(KEY_TRACKING_ENABLED, false)
        val jobId = prefs.getInt(KEY_ACTIVE_JOB_ID, -1)
        val workerId = prefs.getInt(KEY_ACTIVE_WORKER_ID, -1)
        
        val result = JSObject()
        result.put("enabled", enabled)
        result.put("jobId", if (jobId != -1) jobId else null)
        result.put("workerId", if (workerId != -1) workerId else null)
        call.resolve(result)
    }
    
    @PluginMethod
    fun checkPermissions(call: PluginCall) {
        val result = JSObject()
        result.put("foreground", hasLocationPermission())
        result.put("background", hasBackgroundLocationPermission())
        call.resolve(result)
    }
    
    @PluginMethod
    fun requestForegroundPermission(call: PluginCall) {
        if (hasLocationPermission()) {
            val result = JSObject()
            result.put("granted", true)
            call.resolve(result)
            return
        }
        
        requestPermissionForAlias("location", call, "foregroundPermissionCallback")
    }
    
    @PermissionCallback
    private fun foregroundPermissionCallback(call: PluginCall) {
        val result = JSObject()
        result.put("granted", hasLocationPermission())
        call.resolve(result)
    }
    
    @PluginMethod
    fun requestBackgroundPermission(call: PluginCall) {
        if (!hasLocationPermission()) {
            call.reject("Foreground location permission required first")
            return
        }
        
        if (hasBackgroundLocationPermission()) {
            val result = JSObject()
            result.put("granted", true)
            result.put("needsSettings", false)
            call.resolve(result)
            return
        }
        
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            // Android 11+: Must redirect to settings for background location
            // System won't show "Allow all the time" in-app dialog
            val result = JSObject()
            result.put("granted", false)
            result.put("needsSettings", true)
            call.resolve(result)
        } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            // Android 10: Can request permission directly
            requestPermissionForAlias("backgroundLocation", call, "backgroundPermissionCallback")
        } else {
            // Pre-Android 10: Background location not needed separately
            val result = JSObject()
            result.put("granted", true)
            result.put("needsSettings", false)
            call.resolve(result)
        }
    }
    
    @PermissionCallback
    private fun backgroundPermissionCallback(call: PluginCall) {
        val result = JSObject()
        result.put("granted", hasBackgroundLocationPermission())
        result.put("needsSettings", false)
        call.resolve(result)
    }
    
    @PluginMethod
    fun openBackgroundLocationSettings(call: PluginCall) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            val intent = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
                data = Uri.fromParts("package", context.packageName, null)
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            context.startActivity(intent)
        }
        call.resolve()
    }
    
    @PluginMethod
    fun openAppSettings(call: PluginCall) {
        val intent = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
            data = Uri.fromParts("package", context.packageName, null)
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        context.startActivity(intent)
        call.resolve()
    }
    
    private fun hasLocationPermission(): Boolean {
        return ContextCompat.checkSelfPermission(
            context,
            Manifest.permission.ACCESS_FINE_LOCATION
        ) == PackageManager.PERMISSION_GRANTED
    }
    
    private fun hasBackgroundLocationPermission(): Boolean {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            ContextCompat.checkSelfPermission(
                context,
                Manifest.permission.ACCESS_BACKGROUND_LOCATION
            ) == PackageManager.PERMISSION_GRANTED
        } else {
            true
        }
    }
    
    private fun saveTrackingState(enabled: Boolean, jobId: Int, workerId: Int) {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        prefs.edit().apply {
            putBoolean(KEY_TRACKING_ENABLED, enabled)
            putInt(KEY_ACTIVE_JOB_ID, jobId)
            putInt(KEY_ACTIVE_WORKER_ID, workerId)
            apply()
        }
    }
}
