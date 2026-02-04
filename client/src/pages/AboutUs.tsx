import { Navigation } from "@/components/Navigation";
import { Building, Users, Target, HeartHandshake } from "lucide-react";

export default function AboutUs() {
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
          <h1 className="text-4xl sm:text-5xl font-bold mb-6 taskrabbit-text">About Us</h1>
          
          <div className="prose prose-lg max-w-none">
            <p className="text-lg taskrabbit-text-muted mb-8">
              Tolstoy Staffing is a B2B on-demand contract labor platform connecting businesses, contractors, and organizations with skilled workers. We specialize in providing reliable, vetted contract labor for local locations and project-based staffing needs.
            </p>
            
            <h2 className="text-2xl font-bold taskrabbit-text mb-4">Our Mission</h2>
            <p className="taskrabbit-text-muted mb-8">
              To revolutionize how businesses access contract labor by providing a seamless, reliable platform that connects companies with qualified workers instantly. We believe in empowering businesses to scale their workforce on demand while ensuring workers are fairly compensated and properly vetted.
            </p>
            
            <h2 className="text-2xl font-bold taskrabbit-text mb-4">What We Do</h2>
            <p className="taskrabbit-text-muted mb-6">
              We serve contractors, businesses, and organizations across multiple industries including construction, manufacturing, retail, housekeeping, event planning, and management. Our platform enables businesses to:
            </p>
            <ul className="list-disc pl-6 taskrabbit-text-muted mb-8 space-y-2">
              <li>Staff multiple local locations simultaneously</li>
              <li>Find qualified workers on short notice</li>
              <li>Scale workforce up or down based on project needs</li>
              <li>Access vetted workers with background checks</li>
              <li>Manage contract labor without long-term commitments</li>
            </ul>
            
            <div className="grid sm:grid-cols-2 gap-6 mt-12">
              <div className="p-6 taskrabbit-bg-light rounded-xl">
                <Building className="w-8 h-8 taskrabbit-green mb-4" />
                <h3 className="font-bold text-lg taskrabbit-text mb-2">B2B Focused</h3>
                <p className="text-sm taskrabbit-text-muted">Built specifically for businesses, contractors, and organizations.</p>
              </div>
              <div className="p-6 taskrabbit-bg-light rounded-xl">
                <Users className="w-8 h-8 taskrabbit-green mb-4" />
                <h3 className="font-bold text-lg taskrabbit-text mb-2">Vetted Workers</h3>
                <p className="text-sm taskrabbit-text-muted">All workers undergo background checks before joining.</p>
              </div>
              <div className="p-6 taskrabbit-bg-light rounded-xl">
                <Target className="w-8 h-8 taskrabbit-green mb-4" />
                <h3 className="font-bold text-lg taskrabbit-text mb-2">On-Demand</h3>
                <p className="text-sm taskrabbit-text-muted">No long-term commitments. Hire when you need, for as long as you need.</p>
              </div>
              <div className="p-6 taskrabbit-bg-light rounded-xl">
                <HeartHandshake className="w-8 h-8 taskrabbit-green mb-4" />
                <h3 className="font-bold text-lg taskrabbit-text mb-2">Reliable</h3>
                <p className="text-sm taskrabbit-text-muted">Dedicated support and satisfaction guarantee for all clients.</p>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
