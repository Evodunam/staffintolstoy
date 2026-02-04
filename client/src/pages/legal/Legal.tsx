import { Navigation } from "@/components/Navigation";
import { FileText, Scale } from "lucide-react";

export default function Legal() {
  return (
    <div className="min-h-screen bg-white font-sans">
      <style>{`
        .taskrabbit-green {
          color: #00A86B;
        }
        .taskrabbit-text {
          color: #222222;
        }
        .taskrabbit-text-muted {
          color: #717171;
        }
        .taskrabbit-bg-light {
          background-color: #F7F7F7;
        }
      `}</style>
      
      <Navigation />
      
      <section className="pt-24 pb-16 bg-white">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <h1 className="text-4xl sm:text-5xl font-bold mb-6 taskrabbit-text">Legal</h1>
          
          <div className="prose prose-lg max-w-none">
            <p className="text-lg taskrabbit-text-muted mb-8">
              Legal information and documents for Tolstoy Staffing platform users.
            </p>
            
            <div className="space-y-6 mb-12">
              <a href="/terms" className="block p-6 border-2 border-gray-200 rounded-xl hover:border-[#00A86B] transition-all">
                <div className="flex items-center gap-4">
                  <FileText className="w-8 h-8 taskrabbit-green" />
                  <div>
                    <h3 className="text-xl font-bold taskrabbit-text mb-2">Terms of Service</h3>
                    <p className="taskrabbit-text-muted">Read our terms and conditions for using the platform.</p>
                  </div>
                </div>
              </a>
              
              <a href="/privacy" className="block p-6 border-2 border-gray-200 rounded-xl hover:border-[#00A86B] transition-all">
                <div className="flex items-center gap-4">
                  <Scale className="w-8 h-8 taskrabbit-green" />
                  <div>
                    <h3 className="text-xl font-bold taskrabbit-text mb-2">Privacy Policy</h3>
                    <p className="taskrabbit-text-muted">Learn how we collect, use, and protect your information.</p>
                  </div>
                </div>
              </a>
            </div>
            
            <h2 className="text-2xl font-bold taskrabbit-text mb-4">Legal Notices</h2>
            <div className="p-6 taskrabbit-bg-light rounded-xl mb-8">
              <p className="taskrabbit-text-muted mb-4">
                <strong>Company Name:</strong> Tolstoy Staffing LLC
              </p>
              <p className="taskrabbit-text-muted mb-4">
                <strong>Entity Type:</strong> Limited Liability Company
              </p>
              <p className="taskrabbit-text-muted mb-4">
                <strong>Jurisdiction:</strong> Delaware, United States
              </p>
            </div>
            
            <h2 className="text-2xl font-bold taskrabbit-text mb-4">Dispute Resolution</h2>
            <p className="taskrabbit-text-muted mb-6">
              Any disputes arising from use of the platform will be resolved through binding arbitration in accordance with the Commercial Arbitration Rules of the American Arbitration Association, unless otherwise specified in your service agreement.
            </p>
            
            <h2 className="text-2xl font-bold taskrabbit-text mb-4">Contact Legal</h2>
            <p className="taskrabbit-text-muted mb-6">
              For legal inquiries, please contact us at <a href="mailto:legal@tolstoystaffing.com" className="text-[#00A86B] hover:underline">legal@tolstoystaffing.com</a>.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
