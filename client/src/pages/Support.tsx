import { Navigation } from "@/components/Navigation";
import { HelpCircle, Mail, MessageCircle, Book } from "lucide-react";

export default function Support() {
  return (
    <div className="min-h-screen bg-white font-sans">
      <style>{`
        .taskrabbit-green {
          color: #00A86B;
        }
        .taskrabbit-green-bg {
          background-color: #00A86B;
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
          <h1 className="text-4xl sm:text-5xl font-bold mb-6 taskrabbit-text">Support</h1>
          
          <div className="prose prose-lg max-w-none">
            <p className="text-lg taskrabbit-text-muted mb-8">
              We're here to help! Get assistance with your account, platform questions, or technical issues.
            </p>
            
            <div className="grid sm:grid-cols-2 gap-6 mb-12">
              <div className="p-6 border-2 border-gray-200 rounded-xl hover:border-[#00A86B] transition-all">
                <Mail className="w-8 h-8 taskrabbit-green mb-4" />
                <h3 className="text-xl font-bold taskrabbit-text mb-2">Email Support</h3>
                <p className="taskrabbit-text-muted mb-4">
                  Send us an email and we'll get back to you within 24 hours.
                </p>
                <a href="mailto:support@tolstoystaffing.com" className="text-[#00A86B] hover:underline font-medium">
                  support@tolstoystaffing.com
                </a>
              </div>
              
              <div className="p-6 border-2 border-gray-200 rounded-xl hover:border-[#00A86B] transition-all">
                <MessageCircle className="w-8 h-8 taskrabbit-green mb-4" />
                <h3 className="text-xl font-bold taskrabbit-text mb-2">In-App Support</h3>
                <p className="taskrabbit-text-muted mb-4">
                  Contact support directly from your dashboard for faster assistance.
                </p>
                <a href="/dashboard" className="text-[#00A86B] hover:underline font-medium">
                  Go to Dashboard
                </a>
              </div>
            </div>
            
            <h2 className="text-2xl font-bold taskrabbit-text mb-4">Frequently Asked Questions</h2>
            <div className="space-y-4 mb-8">
              <div className="p-6 taskrabbit-bg-light rounded-xl">
                <h3 className="font-bold taskrabbit-text mb-2">How do I post a job?</h3>
                <p className="taskrabbit-text-muted">
                  Companies can post jobs through the "Post Job" option in the dashboard. Fill out the job details, requirements, and timeline, then workers can apply.
                </p>
              </div>
              
              <div className="p-6 taskrabbit-bg-light rounded-xl">
                <h3 className="font-bold taskrabbit-text mb-2">How are workers vetted?</h3>
                <p className="taskrabbit-text-muted">
                  All workers undergo background checks before joining the platform. We verify identity, work authorization, and conduct criminal background screenings.
                </p>
              </div>
              
              <div className="p-6 taskrabbit-bg-light rounded-xl">
                <h3 className="font-bold taskrabbit-text mb-2">What are the payment terms?</h3>
                <p className="taskrabbit-text-muted">
                  Payments are processed within 3-5 business days after job completion and timesheet approval. Workers are paid their full hourly rate as independent contractors.
                </p>
              </div>
              
              <div className="p-6 taskrabbit-bg-light rounded-xl">
                <h3 className="font-bold taskrabbit-text mb-2">Can I staff multiple locations?</h3>
                <p className="taskrabbit-text-muted">
                  Yes! You can post jobs for multiple locations simultaneously. Each location can have its own requirements and timeline.
                </p>
              </div>
            </div>
            
            <h2 className="text-2xl font-bold taskrabbit-text mb-4">Additional Resources</h2>
            <div className="space-y-3">
              <a href="/terms" className="flex items-center gap-3 text-[#00A86B] hover:underline">
                <Book className="w-5 h-5" />
                Terms of Service
              </a>
              <a href="/privacy" className="flex items-center gap-3 text-[#00A86B] hover:underline">
                <Book className="w-5 h-5" />
                Privacy Policy
              </a>
              <a href="/contact" className="flex items-center gap-3 text-[#00A86B] hover:underline">
                <HelpCircle className="w-5 h-5" />
                Contact Us
              </a>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
