import { Switch, Route, useLocation } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useAuth } from "@/hooks/use-auth";
import { useProfile } from "@/hooks/use-profiles";
import { AppLoading } from "@/components/AppLoading";
import { redirectToAppSubdomain, getUrlForPath } from "@/lib/subdomain-utils";
import React, { useState, useEffect, useRef } from "react";
import '@/lib/i18n';
import { useLanguageInit } from "@/hooks/use-language-init";
import { useGlobalScrollbarPill } from "@/hooks/use-global-scrollbar-pill";
import { isWorkerOnboardingComplete } from "@/lib/worker-onboarding";

import Home from "@/pages/Home";
import CompanyDashboard from "@/pages/CompanyDashboard";
import WorkerDashboard from "@/pages/WorkerDashboard";
import JobsList from "@/pages/JobsList";
import JobDetail from "@/pages/JobDetail";
import PostJob from "@/pages/PostJob";
import Onboarding from "@/pages/Onboarding";
import WorkerOnboarding from "@/pages/WorkerOnboarding";
import CompanyOnboarding from "@/pages/CompanyOnboarding";
import ProfileSettings from "@/pages/worker/ProfileSettings";
import AccountSettings from "@/pages/worker/AccountSettings";
import NotificationSettings from "@/pages/worker/NotificationSettings";
import PayoutSettings from "@/pages/worker/PayoutSettings";
import TermsOfService from "@/pages/worker/TermsOfService";
import PrivacyPolicy from "@/pages/worker/PrivacyPolicy";
import LegalDocuments from "@/pages/worker/LegalDocuments";
import WorkerDocuments from "@/pages/worker/WorkerDocuments";
import BusinessOperator from "@/pages/worker/BusinessOperator";
import StrikesPage from "@/pages/worker/StrikesPage";
import PaymentHistory from "@/pages/worker/PaymentHistory";
import AccountDocumentsPage from "@/pages/worker/AccountDocumentsPage";
import ReviewsPage from "@/pages/worker/ReviewsPage";
import JoinTeam from "@/pages/JoinTeam";
import JoinWorkerTeam from "@/pages/JoinWorkerTeam";
import TeamOnboard from "@/pages/TeamOnboard";
import AdminDashboard from "@/pages/AdminDashboard";
import AcceptedJobPage from "@/pages/AcceptedJobPage";
import ChatsPage from "@/pages/ChatsPage";
import TodayPage from "@/pages/TodayPage";
import FindWorkPage from "@/pages/FindWorkPage";
import Login from "@/pages/Login";
import ResetPassword from "@/pages/ResetPassword";
import NotFound from "@/pages/not-found";
import AboutUs from "@/pages/AboutUs";
import Careers from "@/pages/Careers";
import Press from "@/pages/Press";
import TermsOfServicePublic from "@/pages/legal/TermsOfService";
import PrivacyPolicyPublic from "@/pages/legal/PrivacyPolicy";
import Legal from "@/pages/legal/Legal";
import Support from "@/pages/Support";
import ContactUs from "@/pages/ContactUs";
import ForServiceProfessionals from "@/pages/ForServiceProfessionals";
import ForAffiliates from "@/pages/ForAffiliates";
import AffiliateOnboarding from "@/pages/AffiliateOnboarding";
import AffiliateDashboard from "@/pages/AffiliateDashboard";
import HowTimeKeepingWorks from "@/pages/HowTimeKeepingWorks";
import { WorkerOnboardingRequiredModal } from "@/components/WorkerOnboardingRequiredModal";
import { WorkerLocationRequiredModal } from "@/components/WorkerLocationRequiredModal";
import { IncomingCallPopup } from "@/components/IncomingCallPopup";
import { DevServerStatus } from "@/components/DevServerStatus";
import { ImpersonationBanner } from "@/components/ImpersonationBanner";
import { CombinedGlobalBanners } from "@/components/CombinedGlobalBanners";

// Protected Route Wrapper
function ProtectedRoute({ component: Component }: { component: React.ComponentType }) {
  const [path, setLocation] = useLocation();
  const { user, isAuthenticated, isLoading } = useAuth();
  const { data: profile, isLoading: profileLoading } = useProfile(user?.id);
  const redirectingRef = useRef(false);

  // Worker with incomplete onboarding: we no longer redirect to /worker-onboarding. The global WorkerOnboardingRequiredModal shows a multi-step wizard in a pop-up instead; the worker stays on the current page.
  const isWorkerDashboard = path.startsWith("/dashboard") && !path.startsWith("/dashboard/company");
  const isWorkerOnboardingPath = path === "/worker-onboarding" || path.startsWith("/worker-onboarding");
  const isWorkerRoute =
    profile?.role === "worker" &&
    (path.startsWith("/dashboard") || path.startsWith("/accepted-job"));
  const isWorkerWithIncompleteOnboarding =
    isAuthenticated &&
    isWorkerDashboard &&
    !isWorkerOnboardingPath &&
    !profileLoading &&
    profile != null &&
    profile.role === "worker" &&
    !isWorkerOnboardingComplete(profile);

  if (isLoading) return <AppLoading />;

  if (!isAuthenticated) {
    // Prevent redirect loops
    if (!redirectingRef.current) {
      redirectingRef.current = true;
      // Redirect to login on main domain (not app subdomain)
      const loginUrl = getUrlForPath("/api/login", true);
      // Use setTimeout to prevent immediate re-render loops
      setTimeout(() => {
        window.location.href = loginUrl;
      }, 0);
    }
    return null;
  }

  // Reset redirect flag when authenticated
  redirectingRef.current = false;

  if (profileLoading && isWorkerDashboard && !isWorkerOnboardingPath) return <AppLoading />;
  // Workers with incomplete onboarding stay on the current page and see the global modal wizard (no redirect to /worker-onboarding).

  // Don't check subdomain here - let AppSubdomainRedirect handle it
  // This prevents double redirects and loops

  return (
    <>
      <CombinedGlobalBanners
        profileId={profile?.id}
        profile={profile ?? undefined}
        show={!!isWorkerRoute && !isWorkerOnboardingPath}
        isEmployee={profile?.role === "worker" && !!(profile as { teamId?: number })?.teamId}
      />
      <ImpersonationBanner />
      <IncomingCallPopup />
      <Component />
    </>
  );
}

// Component to ensure app pages are on app subdomain
function AppSubdomainRedirect() {
  const [location] = useLocation();
  const redirectRef = useRef<string | null>(null);
  
  // List of routes that should be on main domain (login/auth pages and public pages)
  const mainDomainRoutes = [
    '/api/login', '/login', '/company-onboarding', '/worker-onboarding', '/affiliate-onboarding', '/reset-password',
    '/about', '/careers', '/press', '/terms', '/privacy', '/legal', '/support', '/contact', '/for-service-professionals', '/for-affiliates', '/how-time-keeping-works'
  ];
  
  // Check if current route should be on app subdomain
  const shouldBeOnAppSubdomain = !mainDomainRoutes.some(route => location.startsWith(route));
  
  useEffect(() => {
    // Prevent infinite redirect loops - only redirect once per location
    if (redirectRef.current === location) return;
    
    if (typeof window !== 'undefined' && shouldBeOnAppSubdomain) {
      // Check if we're on localhost - no subdomain redirect needed in dev
      const hostname = window.location.hostname;
      const isLocalhost = hostname === 'localhost' || 
                          hostname === '127.0.0.1' ||
                          hostname.startsWith('192.168.') ||
                          hostname.startsWith('10.');
      
      // Only redirect if NOT on localhost, NOT already on app subdomain, and NOT on home page
      if (!isLocalhost && !hostname.startsWith('app.') && location !== '/') {
        redirectRef.current = location;
        redirectToAppSubdomain(location);
      }
    }
  }, [location, shouldBeOnAppSubdomain]);
  
  return null;
}

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/login" component={Login} />
      <Route path="/api/login" component={Login} />
      <Route path="/reset-password" component={ResetPassword} />
      <Route path="/find-work" component={FindWorkPage} />
      <Route path="/jobs" component={JobsList} />
      <Route path="/jobs/:id" component={JobDetail} />
      <Route path="/worker-onboarding" component={WorkerOnboarding} />
      <Route path="/company/join/:token" component={JoinTeam} />
      <Route path="/team/join/:token" component={JoinWorkerTeam} />
      <Route path="/team/onboard/:id" component={TeamOnboard} />
      
      {/* Worker Dashboard Routes - path based sections */}
      <Route path="/dashboard/find">
        {() => <ProtectedRoute component={WorkerDashboard} />}
      </Route>
      <Route path="/dashboard/jobs">
        {() => <ProtectedRoute component={WorkerDashboard} />}
      </Route>
      <Route path="/dashboard/calendar">
        {() => <ProtectedRoute component={WorkerDashboard} />}
      </Route>
      <Route path="/dashboard/menu">
        {() => <ProtectedRoute component={WorkerDashboard} />}
      </Route>
      <Route path="/dashboard/settings/profile">
        {() => <ProtectedRoute component={ProfileSettings} />}
      </Route>
      <Route path="/dashboard/settings/account">
        {() => <ProtectedRoute component={AccountSettings} />}
      </Route>
      <Route path="/dashboard/settings/notifications">
        {() => <ProtectedRoute component={NotificationSettings} />}
      </Route>
      <Route path="/dashboard/settings/payouts">
        {() => <ProtectedRoute component={PayoutSettings} />}
      </Route>
      <Route path="/dashboard/settings/terms">
        {() => <ProtectedRoute component={TermsOfService} />}
      </Route>
      <Route path="/dashboard/settings/privacy">
        {() => <ProtectedRoute component={PrivacyPolicy} />}
      </Route>
      <Route path="/dashboard/settings/legal">
        {() => <ProtectedRoute component={LegalDocuments} />}
      </Route>
      <Route path="/dashboard/documents">
        {() => <ProtectedRoute component={WorkerDocuments} />}
      </Route>
      <Route path="/dashboard/business-operator">
        {() => <ProtectedRoute component={BusinessOperator} />}
      </Route>
      <Route path="/dashboard/strikes">
        {() => <ProtectedRoute component={StrikesPage} />}
      </Route>
      <Route path="/dashboard/account-documents">
        {() => <ProtectedRoute component={AccountDocumentsPage} />}
      </Route>
      <Route path="/dashboard/reviews">
        {() => <ProtectedRoute component={ReviewsPage} />}
      </Route>
      <Route path="/dashboard/payment-history">
        {() => <ProtectedRoute component={PaymentHistory} />}
      </Route>
      <Route path="/dashboard/today">
        {() => <ProtectedRoute component={TodayPage} />}
      </Route>
      <Route path="/dashboard/chats/:jobId?">
        {() => <ProtectedRoute component={ChatsPage} />}
      </Route>
      <Route path="/dashboard">
        {() => <ProtectedRoute component={WorkerDashboard} />}
      </Route>
      
      {/* Company Dashboard - Route-based sections (chats is a section, no separate header) */}
      <Route path="/company-dashboard/:section?/:subsection?">
        {() => <ProtectedRoute component={CompanyDashboard} />}
      </Route>
      <Route path="/post-job">
        {() => <ProtectedRoute component={PostJob} />}
      </Route>
      <Route path="/accepted-job/:id">
        {() => <ProtectedRoute component={AcceptedJobPage} />}
      </Route>
      <Route path="/chats/:jobId?">
        {() => <ProtectedRoute component={ChatsPage} />}
      </Route>
      <Route path="/onboarding">
        {() => <ProtectedRoute component={Onboarding} />}
      </Route>
      <Route path="/company-onboarding" component={CompanyOnboarding} />
      
      {/* Public Pages */}
      <Route path="/about" component={AboutUs} />
      <Route path="/careers" component={Careers} />
      <Route path="/press" component={Press} />
      <Route path="/terms" component={TermsOfServicePublic} />
      <Route path="/privacy" component={PrivacyPolicyPublic} />
      <Route path="/legal" component={Legal} />
      <Route path="/support" component={Support} />
      <Route path="/contact" component={ContactUs} />
      <Route path="/for-service-professionals" component={ForServiceProfessionals} />
      <Route path="/for-affiliates" component={ForAffiliates} />
      <Route path="/affiliate-onboarding" component={AffiliateOnboarding} />
      <Route path="/affiliate-dashboard/analytics">
        {() => <ProtectedRoute component={AffiliateDashboard} />}
      </Route>
      <Route path="/affiliate-dashboard/sales">
        {() => <ProtectedRoute component={AffiliateDashboard} />}
      </Route>
      <Route path="/affiliate-dashboard/menu">
        {() => <ProtectedRoute component={AffiliateDashboard} />}
      </Route>
      <Route path="/affiliate-dashboard">
        {() => <ProtectedRoute component={AffiliateDashboard} />}
      </Route>
      <Route path="/how-time-keeping-works" component={HowTimeKeepingWorks} />
      
      {/* Admin Route */}
      <Route path="/admin">
        {() => <ProtectedRoute component={AdminDashboard} />}
      </Route>
      
      <Route component={NotFound} />
    </Switch>
  );
}

// Inner component to handle language initialization after QueryClientProvider is set up
function AppContent() {
  useLanguageInit();
  useGlobalScrollbarPill();
  const [path] = useLocation();
  const isWorkerOnboarding = path === "/worker-onboarding" || path.startsWith("/worker-onboarding");

  return (
    <TooltipProvider>
      <Toaster />
      <DevServerStatus />
      <AppSubdomainRedirect />
      {/* Skip WorkerOnboardingRequiredModal on worker-onboarding to avoid Radix Presence max update depth */}
      {!isWorkerOnboarding && <WorkerOnboardingRequiredModal />}
      <WorkerLocationRequiredModal />
      <Router />
    </TooltipProvider>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AppContent />
    </QueryClientProvider>
  );
}

export default App;
