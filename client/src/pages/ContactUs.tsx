import { Navigation } from "@/components/Navigation";
import { Mail, Phone, MapPin, Send } from "lucide-react";
import { useState } from "react";

export default function ContactUs() {
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    subject: '',
    message: ''
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // In a real app, this would send to an API endpoint
    const mailtoLink = `mailto:contact@tolstoystaffing.com?subject=${encodeURIComponent(formData.subject)}&body=${encodeURIComponent(`Name: ${formData.name}\nEmail: ${formData.email}\n\nMessage:\n${formData.message}`)}`;
    window.location.href = mailtoLink;
  };

  return (
    <div className="min-h-screen bg-white font-sans">
      <style>{`
        .taskrabbit-green {
          color: #00A86B;
        }
        .taskrabbit-green-bg {
          background-color: #00A86B;
        }
        .taskrabbit-green-hover:hover {
          background-color: #008A57;
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
          <h1 className="text-4xl sm:text-5xl font-bold mb-6 taskrabbit-text">Contact Us</h1>
          
          <div className="prose prose-lg max-w-none">
            <p className="text-lg taskrabbit-text-muted mb-8">
              Have a question or need assistance? We'd love to hear from you. Get in touch with our team.
            </p>
            
            <div className="grid sm:grid-cols-3 gap-6 mb-12">
              <div className="p-6 border-2 border-gray-200 rounded-xl text-center">
                <Mail className="w-8 h-8 taskrabbit-green mx-auto mb-4" />
                <h3 className="font-bold taskrabbit-text mb-2">Email</h3>
                <a href="mailto:contact@tolstoystaffing.com" className="text-sm taskrabbit-text-muted hover:text-[#00A86B]">
                  contact@tolstoystaffing.com
                </a>
              </div>
              
              <div className="p-6 border-2 border-gray-200 rounded-xl text-center">
                <Phone className="w-8 h-8 taskrabbit-green mx-auto mb-4" />
                <h3 className="font-bold taskrabbit-text mb-2">Phone</h3>
                <p className="text-sm taskrabbit-text-muted">
                  Available via email
                </p>
              </div>
              
              <div className="p-6 border-2 border-gray-200 rounded-xl text-center">
                <MapPin className="w-8 h-8 taskrabbit-green mx-auto mb-4" />
                <h3 className="font-bold taskrabbit-text mb-2">Location</h3>
                <p className="text-sm taskrabbit-text-muted">
                  United States
                </p>
              </div>
            </div>
            
            <div className="bg-white border-2 border-gray-200 rounded-xl p-8">
              <h2 className="text-2xl font-bold taskrabbit-text mb-6">Send us a message</h2>
              <form onSubmit={handleSubmit} className="space-y-6">
                <div>
                  <label htmlFor="name" className="block text-sm font-medium taskrabbit-text mb-2">
                    Name
                  </label>
                  <input
                    type="text"
                    id="name"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    required
                    className="w-full px-4 py-2 border-2 border-gray-200 rounded-lg focus:border-[#00A86B] focus:outline-none"
                  />
                </div>
                
                <div>
                  <label htmlFor="email" className="block text-sm font-medium taskrabbit-text mb-2">
                    Email
                  </label>
                  <input
                    type="email"
                    id="email"
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    required
                    className="w-full px-4 py-2 border-2 border-gray-200 rounded-lg focus:border-[#00A86B] focus:outline-none"
                  />
                </div>
                
                <div>
                  <label htmlFor="subject" className="block text-sm font-medium taskrabbit-text mb-2">
                    Subject
                  </label>
                  <input
                    type="text"
                    id="subject"
                    value={formData.subject}
                    onChange={(e) => setFormData({ ...formData, subject: e.target.value })}
                    required
                    className="w-full px-4 py-2 border-2 border-gray-200 rounded-lg focus:border-[#00A86B] focus:outline-none"
                  />
                </div>
                
                <div>
                  <label htmlFor="message" className="block text-sm font-medium taskrabbit-text mb-2">
                    Message
                  </label>
                  <textarea
                    id="message"
                    value={formData.message}
                    onChange={(e) => setFormData({ ...formData, message: e.target.value })}
                    required
                    rows={6}
                    className="w-full px-4 py-2 border-2 border-gray-200 rounded-lg focus:border-[#00A86B] focus:outline-none resize-none"
                  />
                </div>
                
                <button
                  type="submit"
                  className="w-full sm:w-auto px-8 py-3 taskrabbit-green-bg text-white rounded-lg font-semibold taskrabbit-green-hover transition-colors inline-flex items-center gap-2"
                >
                  <Send className="w-5 h-5" />
                  Send Message
                </button>
              </form>
            </div>
            
            <div className="mt-12 p-6 taskrabbit-bg-light rounded-xl">
              <h3 className="font-bold taskrabbit-text mb-4">Other Ways to Reach Us</h3>
              <div className="space-y-2 text-sm taskrabbit-text-muted">
                <p><strong>Support:</strong> <a href="mailto:support@tolstoystaffing.com" className="text-[#00A86B] hover:underline">support@tolstoystaffing.com</a></p>
                <p><strong>Press:</strong> <a href="mailto:press@tolstoystaffing.com" className="text-[#00A86B] hover:underline">press@tolstoystaffing.com</a></p>
                <p><strong>Legal:</strong> <a href="mailto:legal@tolstoystaffing.com" className="text-[#00A86B] hover:underline">legal@tolstoystaffing.com</a></p>
                <p><strong>Careers:</strong> <a href="mailto:careers@tolstoystaffing.com" className="text-[#00A86B] hover:underline">careers@tolstoystaffing.com</a></p>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
