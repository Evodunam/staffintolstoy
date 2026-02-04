package com.tolstoy.staffing

import android.app.PendingIntent
import android.content.Context
import android.content.Intent

object GeofencePendingIntentHelper {
    private const val REQUEST_CODE = 9001

    fun getPendingIntent(context: Context): PendingIntent {
        val intent = Intent(context, GeofenceBroadcastReceiver::class.java)
        return PendingIntent.getBroadcast(
            context,
            REQUEST_CODE,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
    }
}
