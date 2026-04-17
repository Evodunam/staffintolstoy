import { Navigation } from "@/components/Navigation";

export default function PrivacyPolicy() {
  return (
    <div className="min-h-screen bg-white font-sans">
      <style>{`
        .taskrabbit-text {
          color: #222222;
        }
        .taskrabbit-text-muted {
          color: #717171;
        }
      `}</style>
      
      <Navigation />
      
      <section className="pt-24 pb-16 bg-white">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <h1 className="text-4xl sm:text-5xl font-bold mb-6 taskrabbit-text">Privacy Policy</h1>
          
          <div className="prose prose-lg max-w-none">
            <p className="text-sm taskrabbit-text-muted mb-8">
              Last updated: {new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
            </p>
            
            <h2 className="text-2xl font-bold taskrabbit-text mb-4">1. Information We Collect</h2>
            <p className="taskrabbit-text-muted mb-4">
              Tolstoy Staffing operates a business-to-business labor marketplace connecting companies, service professionals, and affiliates. We collect:
            </p>
            <ul className="list-disc pl-6 taskrabbit-text-muted mb-6 space-y-2">
              <li>Account and identity information (name, email, phone, company details)</li>
              <li>Worker profile data (skills, certifications, trade categories, work history, availability, and service radius)</li>
              <li>Job and staffing data (job postings, applications, assignments, schedules, and status updates)</li>
              <li>Operational timekeeping and location data tied to shifts (for attendance verification, billing, dispute handling, safety, and fraud prevention)</li>
              <li>Transaction and payout data (billing records, payout records, and payment metadata processed by payment providers)</li>
              <li>Communications and support records (messages, emails, and customer support interactions)</li>
              <li>Technical and usage data (IP address, device/browser data, logs, and product analytics)</li>
            </ul>
            
            <h2 className="text-2xl font-bold taskrabbit-text mb-4">2. How We Use Information</h2>
            <p className="taskrabbit-text-muted mb-4">
              We use data to run and improve marketplace operations, including:
            </p>
            <ul className="list-disc pl-6 taskrabbit-text-muted mb-6 space-y-2">
              <li>Account access, authentication, and fraud/risk controls</li>
              <li>Matching workers to jobs and helping companies fill shifts</li>
              <li>Shift coordination, timekeeping verification, and attendance workflows</li>
              <li>Billing, invoicing, payouts, reconciliations, and related financial reporting</li>
              <li>Customer support, dispute resolution, and service communications</li>
              <li>Compliance with contractual and legal obligations</li>
              <li>Platform quality, analytics, and feature improvement</li>
            </ul>
            
            <h2 className="text-2xl font-bold taskrabbit-text mb-4">3. How Information Is Shared</h2>
            <p className="taskrabbit-text-muted mb-4">
              We share data on a need-to-know basis to operate the platform:
            </p>
            <ul className="list-disc pl-6 taskrabbit-text-muted mb-6 space-y-2">
              <li>Between companies and workers for hiring, assignment, and shift execution</li>
              <li>With affiliates when attribution or referral operations apply</li>
              <li>With service providers (for example: hosting, authentication, communication, analytics, and payments)</li>
              <li>With legal or regulatory authorities when required by law or to protect rights and safety</li>
            </ul>
            <p className="taskrabbit-text-muted mb-6">
              We do not sell personal information.
            </p>
            
            <h2 className="text-2xl font-bold taskrabbit-text mb-4">4. Timekeeping and Location Data</h2>
            <p className="taskrabbit-text-muted mb-4">
              Tolstoy Staffing uses worker location data to support core timesheet and workforce operations. This is not used for consumer advertising. Depending on the workflow and permissions, we may collect:
            </p>
            <ul className="list-disc pl-6 taskrabbit-text-muted mb-4 space-y-2">
              <li>Precise location at clock-in and clock-out</li>
              <li>Location evidence during active shifts (for example, periodic checks or geofence validation)</li>
              <li>Timestamps, device/network metadata, and shift/job identifiers associated with those events</li>
            </ul>
            <p className="taskrabbit-text-muted mb-4">
              Operational purposes include attendance validation, timesheet integrity, automated approval workflows, payroll/billing accuracy, dispute resolution, worker safety review, and fraud/abuse prevention.
            </p>
            <p className="taskrabbit-text-muted mb-6">
              We do not permit use of worker location data for third-party marketing, and we do not sell location data.
            </p>
            
            <h2 className="text-2xl font-bold taskrabbit-text mb-4">5. Mobile Location Permission Disclosure (Google Play and iOS)</h2>
            <p className="taskrabbit-text-muted mb-4">
              For worker-facing mobile features, location access may be requested in foreground and, where enabled for shift verification reliability, background mode.
            </p>
            <ul className="list-disc pl-6 taskrabbit-text-muted mb-4 space-y-2">
              <li><strong>Why requested:</strong> to verify presence for scheduled work, support clock-in/clock-out records, and protect companies/workers against false timesheets</li>
              <li><strong>When collected:</strong> primarily during active shift workflows, attendance events, and related anti-fraud checks</li>
              <li><strong>User control:</strong> workers can manage permissions in device settings; disabling location may limit ability to clock in, verify attendance, or complete certain shift tasks</li>
              <li><strong>Data handling:</strong> location events are linked to job operations and retained only as long as needed for operational, contractual, and legal obligations</li>
            </ul>
            <p className="taskrabbit-text-muted mb-6">
              This section is intended to provide a clear disclosure aligned with mobile platform expectations for location-enabled workforce/timekeeping applications.
            </p>
            
            <h2 className="text-2xl font-bold taskrabbit-text mb-4">6. Cookies and Similar Technologies</h2>
            <p className="taskrabbit-text-muted mb-6">
              We use cookies and similar technologies for session management, security, analytics, and product performance. You can manage cookie behavior in your browser settings, but disabling some cookies may affect platform functionality.
            </p>
            
            <h2 className="text-2xl font-bold taskrabbit-text mb-4">7. Data Security</h2>
            <p className="taskrabbit-text-muted mb-6">
              We apply technical and organizational safeguards designed to protect information against unauthorized access, alteration, disclosure, or destruction. No internet-based system is perfectly secure, so we cannot guarantee absolute security.
            </p>
            
            <h2 className="text-2xl font-bold taskrabbit-text mb-4">8. Data Retention</h2>
            <p className="taskrabbit-text-muted mb-6">
              We retain information for as long as needed to operate the marketplace, satisfy contractual obligations, resolve disputes, enforce agreements, and meet legal, accounting, and tax requirements. Retention periods vary by data type and operational purpose.
            </p>
            
            <h2 className="text-2xl font-bold taskrabbit-text mb-4">9. Your Rights and Choices</h2>
            <p className="taskrabbit-text-muted mb-4">
              Subject to applicable law, you may have the right to:
            </p>
            <ul className="list-disc pl-6 taskrabbit-text-muted mb-6 space-y-2">
              <li>Access, correct, or update your information</li>
              <li>Request deletion of your account or specific data</li>
              <li>Request a copy of your data</li>
              <li>Opt out of non-essential marketing messages</li>
            </ul>
            
            <h2 className="text-2xl font-bold taskrabbit-text mb-4">10. Third-Party Services</h2>
            <p className="taskrabbit-text-muted mb-6">
              Some functions are provided by third parties (such as payment processors, authentication providers, cloud hosting, and analytics). Their services are governed by their own terms and privacy policies.
            </p>
            
            <h2 className="text-2xl font-bold taskrabbit-text mb-4">11. Children's Privacy</h2>
            <p className="taskrabbit-text-muted mb-6">
              Our services are intended for adults and are not directed to children under 18. We do not knowingly collect personal information from children.
            </p>
            
            <h2 className="text-2xl font-bold taskrabbit-text mb-4">12. Policy Updates</h2>
            <p className="taskrabbit-text-muted mb-6">
              We may revise this Privacy Policy to reflect operational, legal, or product changes. Material updates will be posted here and, where appropriate, communicated through the platform or email.
            </p>
            
            <h2 className="text-2xl font-bold taskrabbit-text mb-4">13. Contact</h2>
            <p className="taskrabbit-text-muted mb-6">
              For privacy-related questions or requests, contact <a href="mailto:privacy@tolstoystaffing.com" className="text-[#00A86B] hover:underline">privacy@tolstoystaffing.com</a>.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
