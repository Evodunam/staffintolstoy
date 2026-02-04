import { Navigation } from "@/components/Navigation";
import { FileText, Mail } from "lucide-react";

export default function Press() {
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
          <h1 className="text-4xl sm:text-5xl font-bold mb-6 taskrabbit-text">Press</h1>
          
          <div className="prose prose-lg max-w-none">
            <p className="text-lg taskrabbit-text-muted mb-8">
              For media inquiries, press releases, and partnership opportunities, please contact our press team.
            </p>
            
            <div className="p-6 taskrabbit-bg-light rounded-xl mb-8">
              <div className="flex items-center gap-3 mb-4">
                <Mail className="w-6 h-6 taskrabbit-green" />
                <h2 className="text-xl font-bold taskrabbit-text">Media Contact</h2>
              </div>
              <p className="taskrabbit-text-muted mb-2">
                <strong>Email:</strong> <a href="mailto:press@tolstoystaffing.com" className="taskrabbit-green hover:underline">press@tolstoystaffing.com</a>
              </p>
              <p className="taskrabbit-text-muted">
                For press inquiries, interview requests, or media kit requests, please reach out to our press team.
              </p>
            </div>
            
            <h2 className="text-2xl font-bold taskrabbit-text mb-4">Press Releases</h2>
            <p className="taskrabbit-text-muted mb-8">
              Check back soon for our latest press releases and company announcements.
            </p>
            
            <h2 className="text-2xl font-bold taskrabbit-text mb-4">Company Information</h2>
            <div className="space-y-4 taskrabbit-text-muted">
              <p><strong>Company Name:</strong> Tolstoy Staffing LLC</p>
              <p><strong>Founded:</strong> 2024</p>
              <p><strong>Headquarters:</strong> United States</p>
              <p><strong>Industry:</strong> B2B On-Demand Contract Labor Platform</p>
            </div>
            
            <h2 className="text-2xl font-bold taskrabbit-text mb-4 mt-8">Brand Assets</h2>
            <p className="taskrabbit-text-muted mb-4">
              For logo files, brand guidelines, and other assets, please contact <a href="mailto:press@tolstoystaffing.com" className="taskrabbit-green hover:underline">press@tolstoystaffing.com</a>.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
