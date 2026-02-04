import { Navigation } from "@/components/Navigation";

export default function TermsOfService() {
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
          <h1 className="text-4xl sm:text-5xl font-bold mb-6 taskrabbit-text">Terms of Service</h1>
          
          <div className="prose prose-lg max-w-none">
            <p className="text-sm taskrabbit-text-muted mb-8">
              Last updated: {new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
            </p>
            
            <h2 className="text-2xl font-bold taskrabbit-text mb-4">1. Acceptance of Terms</h2>
            <p className="taskrabbit-text-muted mb-6">
              By accessing and using Tolstoy Staffing's platform, you agree to be bound by these Terms of Service. If you do not agree to these terms, please do not use our services.
            </p>
            
            <h2 className="text-2xl font-bold taskrabbit-text mb-4">2. Description of Service</h2>
            <p className="taskrabbit-text-muted mb-6">
              Tolstoy Staffing is a B2B on-demand contract labor platform that connects businesses, contractors, and organizations with skilled workers. We facilitate the matching of workers with job opportunities but are not a party to any employment relationship.
            </p>
            
            <h2 className="text-2xl font-bold taskrabbit-text mb-4">3. User Accounts</h2>
            <p className="taskrabbit-text-muted mb-6">
              You are responsible for maintaining the confidentiality of your account credentials and for all activities that occur under your account. You agree to notify us immediately of any unauthorized use of your account.
            </p>
            
            <h2 className="text-2xl font-bold taskrabbit-text mb-4">4. User Conduct</h2>
            <p className="taskrabbit-text-muted mb-6">
              Users agree to use the platform in compliance with all applicable laws and regulations. Prohibited activities include but are not limited to: fraud, misrepresentation, harassment, or any activity that violates the rights of others.
            </p>
            
            <h2 className="text-2xl font-bold taskrabbit-text mb-4">5. Payment Terms</h2>
            <p className="taskrabbit-text-muted mb-6">
              Payment terms are specified in individual job agreements. Companies are responsible for payment for services rendered. Workers are independent contractors and are responsible for their own taxes and insurance.
            </p>
            
            <h2 className="text-2xl font-bold taskrabbit-text mb-4">6. Limitation of Liability</h2>
            <p className="taskrabbit-text-muted mb-6">
              Tolstoy Staffing provides the platform "as is" and makes no warranties regarding the quality, safety, or legality of jobs or workers. We are not liable for any disputes between companies and workers.
            </p>
            
            <h2 className="text-2xl font-bold taskrabbit-text mb-4">7. Intellectual Property</h2>
            <p className="taskrabbit-text-muted mb-6">
              All content on the platform, including logos, text, graphics, and software, is the property of Tolstoy Staffing and protected by copyright and trademark laws.
            </p>
            
            <h2 className="text-2xl font-bold taskrabbit-text mb-4">8. Termination</h2>
            <p className="taskrabbit-text-muted mb-6">
              We reserve the right to suspend or terminate accounts that violate these terms or engage in fraudulent or illegal activity.
            </p>
            
            <h2 className="text-2xl font-bold taskrabbit-text mb-4">9. Changes to Terms</h2>
            <p className="taskrabbit-text-muted mb-6">
              We may update these terms from time to time. Continued use of the platform after changes constitutes acceptance of the new terms.
            </p>
            
            <h2 className="text-2xl font-bold taskrabbit-text mb-4">10. Contact Information</h2>
            <p className="taskrabbit-text-muted mb-6">
              For questions about these terms, please contact us at <a href="mailto:legal@tolstoystaffing.com" className="text-[#00A86B] hover:underline">legal@tolstoystaffing.com</a>.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
