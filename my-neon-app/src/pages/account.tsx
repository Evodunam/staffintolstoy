import { AccountView } from '@neondatabase/neon-js/auth/react/ui'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  clearQueuedTimekeepingLocations,
  isNativeAndroid,
  readQueuedTimekeepingLocations,
  startTimekeepingBackgroundLocation,
  stopTimekeepingBackgroundLocation,
  type TimekeepingLocationSample,
} from '../lib/timekeeping-location'

const locationDisclosureConsentKey = 'timekeeping.location.disclosure.v1'

export default function AccountPage() {
  const [isTracking, setIsTracking] = useState(false)
  const [latestSample, setLatestSample] = useState<TimekeepingLocationSample | null>(null)
  const [statusMessage, setStatusMessage] = useState('')
  const [queuedCount, setQueuedCount] = useState(() => readQueuedTimekeepingLocations().length)
  const [locationDisclosureAccepted, setLocationDisclosureAccepted] = useState(() => {
    return localStorage.getItem(locationDisclosureConsentKey) === 'accepted'
  })

  useEffect(() => {
    return () => {
      void stopTimekeepingBackgroundLocation()
    }
  }, [])

  async function startTracking() {
    if (!locationDisclosureAccepted) {
      setStatusMessage('Please confirm location disclosure before enabling tracking.')
      return
    }

    try {
      setStatusMessage('Starting background location watcher...')
      await startTimekeepingBackgroundLocation((sample) => {
        setLatestSample(sample)
        setQueuedCount(readQueuedTimekeepingLocations().length)
      })
      setIsTracking(true)
      setStatusMessage('Background location tracking is running.')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to start tracker'
      setStatusMessage(message)
      setIsTracking(false)
    }
  }

  async function stopTracking() {
    await stopTimekeepingBackgroundLocation()
    setIsTracking(false)
    setStatusMessage('Background tracking stopped.')
  }

  function clearQueue() {
    clearQueuedTimekeepingLocations()
    setQueuedCount(0)
    setStatusMessage('Queued location samples cleared.')
  }

  function onDisclosureToggle(checked: boolean) {
    setLocationDisclosureAccepted(checked)
    if (checked) {
      localStorage.setItem(locationDisclosureConsentKey, 'accepted')
    } else {
      localStorage.removeItem(locationDisclosureConsentKey)
    }
  }

  return (
    <main style={{ maxWidth: 960, margin: '2rem auto', padding: '0 1rem' }}>
      <AccountView />
      <section style={{ marginTop: '2rem', borderTop: '1px solid #ddd', paddingTop: '1.5rem' }}>
        <h2>Timekeeping location runner</h2>
        <p>
          Platform: {isNativeAndroid() ? 'Native Android (background enabled)' : 'Web/Desktop (native tracker disabled)'}
        </p>
        <div
          style={{
            marginTop: '0.75rem',
            marginBottom: '0.75rem',
            padding: '0.75rem',
            border: '1px solid #ddd',
            borderRadius: '8px',
            textAlign: 'left',
          }}
        >
          <p style={{ marginBottom: '0.5rem' }}>
            Background location is used for timekeeping verification and can run when the app is minimized while tracking is active.
          </p>
          <p style={{ marginBottom: '0.5rem' }}>
            Review details in <Link to="/privacy#location-data">Privacy Policy</Link>.
          </p>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <input
              type="checkbox"
              checked={locationDisclosureAccepted}
              onChange={(event) => onDisclosureToggle(event.target.checked)}
            />
            I understand and consent to location/background location collection for timekeeping features.
          </label>
        </div>
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
          <button type="button" onClick={startTracking} disabled={isTracking || !locationDisclosureAccepted}>
            Start background tracking
          </button>
          <button type="button" onClick={stopTracking} disabled={!isTracking}>
            Stop tracking
          </button>
          <button type="button" onClick={clearQueue}>
            Clear queued samples ({queuedCount})
          </button>
        </div>
        <p style={{ marginTop: 0 }}>{statusMessage || 'Idle'}</p>
        {latestSample ? (
          <pre style={{ padding: '0.75rem', background: '#f7f7f7', overflowX: 'auto' }}>
            {JSON.stringify(latestSample, null, 2)}
          </pre>
        ) : null}
      </section>
    </main>
  )
}
