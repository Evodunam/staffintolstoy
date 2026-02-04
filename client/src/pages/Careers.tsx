import { Navigation } from "@/components/Navigation";
import { Briefcase, MapPin, Clock } from "lucide-react";

export default function Careers() {
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
          <h1 className="text-4xl sm:text-5xl font-bold mb-6 taskrabbit-text">Careers</h1>
          
          <div className="prose prose-lg max-w-none">
            <p className="text-lg taskrabbit-text-muted mb-8">
              Join the team building the future of on-demand contract labor. We're looking for talented individuals who are passionate about connecting businesses with skilled workers.
            </p>
            
            <h2 className="text-2xl font-bold taskrabbit-text mb-4">Open Positions</h2>
            <p className="taskrabbit-text-muted mb-8">
              We're always looking for great talent. Check back soon for open positions, or send us your resume at <a href="mailto:careers@tolstoystaffing.com" className="taskrabbit-green hover:underline">careers@tolstoystaffing.com</a>.
            </p>
            
            <div className="space-y-6 mb-12">
              <div className="p-6 border-2 border-gray-200 rounded-xl hover:border-[#00A86B] transition-all">
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <h3 className="text-xl font-bold taskrabbit-text mb-2">Software Engineer</h3>
                    <div className="flex items-center gap-4 text-sm taskrabbit-text-muted">
                      <span className="flex items-center gap-1">
                        <MapPin className="w-4 h-4" />
                        Remote / San Francisco
                      </span>
                      <span className="flex items-center gap-1">
                        <Clock className="w-4 h-4" />
                        Full-time
                      </span>
                    </div>
                  </div>
                  <Briefcase className="w-6 h-6 taskrabbit-green" />
                </div>
                <p className="taskrabbit-text-muted mb-4">
                  We're looking for a full-stack engineer to help build and scale our platform. Experience with React, Node.js, and PostgreSQL preferred.
                </p>
                <a href="mailto:careers@tolstoystaffing.com?subject=Software Engineer Application" className="inline-block px-6 py-2 taskrabbit-green-bg text-white rounded-lg hover:bg-[#008A57] transition-colors">
                  Apply Now
                </a>
              </div>
              
              <div className="p-6 border-2 border-gray-200 rounded-xl hover:border-[#00A86B] transition-all">
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <h3 className="text-xl font-bold taskrabbit-text mb-2">Customer Success Manager</h3>
                    <div className="flex items-center gap-4 text-sm taskrabbit-text-muted">
                      <span className="flex items-center gap-1">
                        <MapPin className="w-4 h-4" />
                        Remote / New York
                      </span>
                      <span className="flex items-center gap-1">
                        <Clock className="w-4 h-4" />
                        Full-time
                      </span>
                    </div>
                  </div>
                  <Briefcase className="w-6 h-6 taskrabbit-green" />
                </div>
                <p className="taskrabbit-text-muted mb-4">
                  Help our business clients succeed by providing exceptional support and building strong relationships. B2B experience preferred.
                </p>
                <a href="mailto:careers@tolstoystaffing.com?subject=Customer Success Manager Application" className="inline-block px-6 py-2 taskrabbit-green-bg text-white rounded-lg hover:bg-[#008A57] transition-colors">
                  Apply Now
                </a>
              </div>
            </div>
            
            <h2 className="text-2xl font-bold taskrabbit-text mb-4">Why Work With Us</h2>
            <ul className="list-disc pl-6 taskrabbit-text-muted mb-8 space-y-2">
              <li>Competitive compensation and benefits</li>
              <li>Remote-friendly work environment</li>
              <li>Opportunity to shape the future of contract labor</li>
              <li>Collaborative and inclusive team culture</li>
              <li>Growth opportunities and professional development</li>
            </ul>
          </div>
        </div>
      </section>
    </div>
  );
}
