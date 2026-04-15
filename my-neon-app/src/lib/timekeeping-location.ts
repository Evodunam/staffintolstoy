import { Capacitor, registerPlugin } from '@capacitor/core'
import type {
  BackgroundGeolocationPlugin,
  CallbackError,
  Location,
} from '@capacitor-community/background-geolocation'

const queueStorageKey = 'timekeeping.location.queue.v1'
const maxQueuedSamples = 500

let activeWatcherId: string | null = null
const BackgroundGeolocation = registerPlugin<BackgroundGeolocationPlugin>('BackgroundGeolocation')

export type TimekeepingLocationSample = {
  latitude: number
  longitude: number
  accuracy: number
  speed: number | null
  capturedAt: number
}

type LocationListener = (sample: TimekeepingLocationSample) => void

export function isNativeAndroid() {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android'
}

function safeReadQueue() {
  try {
    const raw = localStorage.getItem(queueStorageKey)
    if (!raw) {
      return [] as TimekeepingLocationSample[]
    }

    const parsed = JSON.parse(raw) as TimekeepingLocationSample[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return [] as TimekeepingLocationSample[]
  }
}

function safeWriteQueue(samples: TimekeepingLocationSample[]) {
  localStorage.setItem(queueStorageKey, JSON.stringify(samples.slice(-maxQueuedSamples)))
}

function queueSample(sample: TimekeepingLocationSample) {
  const current = safeReadQueue()
  current.push(sample)
  safeWriteQueue(current)
}

export function readQueuedTimekeepingLocations() {
  return safeReadQueue()
}

export function clearQueuedTimekeepingLocations() {
  safeWriteQueue([])
}

export async function startTimekeepingBackgroundLocation(listener: LocationListener) {
  if (!isNativeAndroid()) {
    throw new Error('Background location is only enabled on native Android builds')
  }

  if (activeWatcherId) {
    return activeWatcherId
  }

  activeWatcherId = await BackgroundGeolocation.addWatcher(
    {
      requestPermissions: true,
      stale: false,
      distanceFilter: 20,
      backgroundTitle: 'Tolstoy timekeeping is active',
      backgroundMessage: 'Location tracking stays active while clocked in.',
    },
    (position?: Location, error?: CallbackError) => {
      if (error) {
        console.error('Background location error', error)
        return
      }

      if (!position) {
        return
      }

      const sample: TimekeepingLocationSample = {
        latitude: position.latitude,
        longitude: position.longitude,
        accuracy: position.accuracy,
        speed: position.speed,
        capturedAt: position.time ?? Date.now(),
      }

      queueSample(sample)
      listener(sample)
    },
  )

  return activeWatcherId
}

export async function stopTimekeepingBackgroundLocation() {
  if (!activeWatcherId) {
    return
  }

  await BackgroundGeolocation.removeWatcher({ id: activeWatcherId })
  activeWatcherId = null
}
