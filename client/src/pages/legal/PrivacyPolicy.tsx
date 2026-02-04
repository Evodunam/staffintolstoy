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
              We collect information that you provide directly to us, including:
            </p>
            <ul className="list-disc pl-6 taskrabbit-text-muted mb-6 space-y-2">
              <li>Account information (name, email, phone number)</li>
              <li>Profile information (skills, experience, certifications)</li>
              <li>Payment information (processed securely through third-party providers)</li>
              <li>Job and application data</li>
              <li>Communication records</li>
            </ul>
            
            <h2 className="text-2xl font-bold taskrabbit-text mb-4">2. How We Use Your Information</h2>
            <p className="taskrabbit-text-muted mb-4">
              We use collected information to:
            </p>
            <ul className="list-disc pl-6 taskrabbit-text-muted mb-6 space-y-2">
              <li>Provide and improve our services</li>
              <li>Match workers with job opportunities</li>
              <li>Process payments and transactions</li>
              <li>Send important updates and notifications</li>
              <li>Ensure platform safety and security</li>
              <li>Comply with legal obligations</li>
            </ul>
            
            <h2 className="text-2xl font-bold taskrabbit-text mb-4">3. Information Sharing</h2>
            <p className="taskrabbit-text-muted mb-6">
              We share information only as necessary to provide our services. This includes sharing worker profiles with companies for job matching, and company job details with workers. We do not sell your personal information to third parties.
            </p>
            
            <h2 className="text-2xl font-bold taskrabbit-text mb-4">4. Data Security</h2>
            <p className="taskrabbit-text-muted mb-6">
              We implement industry-standard security measures to protect your information. However, no method of transmission over the internet is 100% secure, and we cannot guarantee absolute security.
            </p>
            
            <h2 className="text-2xl font-bold taskrabbit-text mb-4">5. Your Rights</h2>
            <p className="taskrabbit-text-muted mb-4">
              You have the right to:
            </p>
            <ul className="list-disc pl-6 taskrabbit-text-muted mb-6 space-y-2">
              <li>Access your personal information</li>
              <li>Correct inaccurate information</li>
              <li>Request deletion of your account and data</li>
              <li>Opt-out of marketing communications</li>
              <li>Request a copy of your data</li>
            </ul>
            
            <h2 className="text-2xl font-bold taskrabbit-text mb-4">6. Cookies and Tracking</h2>
            <p className="taskrabbit-text-muted mb-6">
              We use cookies and similar technologies to improve your experience, analyze usage, and provide personalized content. You can control cookie preferences through your browser settings.
            </p>
            
            <h2 className="text-2xl font-bold taskrabbit-text mb-4">7. Third-Party Services</h2>
            <p className="taskrabbit-text-muted mb-6">
              Our platform integrates with third-party services for payment processing, authentication, and analytics. These services have their own privacy policies governing data collection and use.
            </p>
            
            <h2 className="text-2xl font-bold taskrabbit-text mb-4">8. Children's Privacy</h2>
            <p className="taskrabbit-text-muted mb-6">
              Our services are not intended for individuals under 18 years of age. We do not knowingly collect information from children.
            </p>
            
            <h2 className="text-2xl font-bold taskrabbit-text mb-4">9. Changes to This Policy</h2>
            <p className="taskrabbit-text-muted mb-6">
              We may update this privacy policy from time to time. We will notify you of significant changes by email or through the platform.
            </p>
            
            <h2 className="text-2xl font-bold taskrabbit-text mb-4">10. Contact Us</h2>
            <p className="taskrabbit-text-muted mb-6">
              For privacy-related questions or requests, please contact us at <a href="mailto:privacy@tolstoystaffing.com" className="text-[#00A86B] hover:underline">privacy@tolstoystaffing.com</a>.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
