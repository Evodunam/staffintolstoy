export default function PrivacyPage() {
  return (
    <main style={{ maxWidth: 860, margin: '2rem auto', padding: '0 1rem', textAlign: 'left' }}>
      <h1 style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>Privacy Policy</h1>
      <p style={{ marginBottom: '1rem' }}>Last updated: April 14, 2026</p>

      <h2>Overview</h2>
      <p>
        This Privacy Policy explains what information Tolstoy Staffing collects, how we use it, and your choices.
      </p>

      <h2>Information We Collect</h2>
      <p>We may collect account information, profile information, device information, and activity data required to operate staffing workflows.</p>

      <h2 id="location-data">Location Data (Including Background Location)</h2>
      <p>
        When you enable timekeeping/location features, we collect precise location data from your device. This can include
        background location while the app is not actively open if you are clocked in or tracking is enabled.
      </p>
      <p>
        We use location data for timekeeping verification, fraud prevention, job attendance validation, worker-company
        coordination, and operational safety. We do not sell precise location data.
      </p>
      <p>
        Location collection is feature-dependent and permission-based. If you do not grant location/background location
        permission, those location features will not operate.
      </p>

      <h2>When Background Location Is Collected</h2>
      <p>
        Background location collection occurs only when you explicitly enable tracking and grant the required OS permissions.
        You can disable tracking in the app or revoke location permission in system settings at any time.
      </p>

      <h2>How We Share Data</h2>
      <p>
        We may share data with service providers that support hosting, authentication, communications, analytics, fraud
        prevention, and payment operations. We may also disclose data when required by law.
      </p>
      <p>
        We do not share precise location data for advertising sale or broker-style resale.
      </p>

      <h2>Data Retention</h2>
      <p>
        We retain data as long as needed to provide services, satisfy legal/accounting obligations, resolve disputes, and
        enforce agreements. Location and operational logs are retained only as needed for these purposes.
      </p>
      <p>
        Timekeeping and verification records may be retained for compliance, billing, and dispute resolution windows required
        by applicable law or contract.
      </p>

      <h2>Your Controls</h2>
      <p>
        You can access or update account details in-app, request account deletion, disable location collection, or uninstall
        the app. Some service functions may be limited if critical permissions are disabled.
      </p>

      <h2>Security</h2>
      <p>
        We use administrative, technical, and organizational safeguards intended to protect your information. No method of
        transmission or storage is guaranteed to be 100% secure.
      </p>

      <h2>Children</h2>
      <p>Our services are not directed to children under 13, and we do not knowingly collect personal data from children under 13.</p>

      <h2>Contact</h2>
      <p>
        For privacy questions or requests, contact: <a href="mailto:privacy@tolstoystaffing.com">privacy@tolstoystaffing.com</a>
      </p>
    </main>
  )
}
