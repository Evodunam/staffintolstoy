import { Link, useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { 
  User as UserIcon, 
  Menu,
  X,
  MoreVertical,
  Shield,
  ChevronRight,
  LogOut,
  Briefcase,
  Users,
  Clock,
  Calendar,
  MessageSquare,
  Plus,
  Settings,
  Building2,
  Search
} from "lucide-react";
import { motion, LayoutGroup } from "motion/react";
import { useState, useEffect, useRef } from "react";
import { useScrollHeader } from "@/hooks/use-scroll-header";
import { useIsMobile } from "@/hooks/use-mobile";
import { Button } from "@/components/ui/button";
import { useProfile } from "@/hooks/use-profiles";
import { NotificationPopup } from "@/components/NotificationPopup";
import { NotificationBanner } from "@/components/NotificationBanner";
import { DevAccountSwitcher } from "@/components/DevAccountSwitcher";
import { useTranslation } from "react-i18next";
import { getUrlForPath } from "@/lib/subdomain-utils";
import { useToast } from "@/hooks/use-toast";
import { isWorkerOnboardingComplete } from "@/lib/worker-onboarding";
import { useAdminCheck } from "@/hooks/use-admin";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export interface SidebarNavItem {
  id: string;
  label: string;
  onClick?: () => void;
}

interface NavigationProps {
  tabs?: React.ReactNode;
  /** Nav items for the left sidebar (when hamburger is shown due to overflow). Each item should have onClick. */
  sidebarNavItems?: SidebarNavItem[];
  /** Called when a sidebar nav item without its own onClick is selected. Use with sidebarNavItems. */
  onSidebarNavSelect?: (id: string) => void;
  /** When true, hide the standalone "Post a Job" link (e.g. when it's included in tabs as "+ New Job"). */
  hidePostJobLink?: boolean;
}

export function Navigation({ tabs, sidebarNavItems, onSidebarNavSelect, hidePostJobLink }: NavigationProps) {
  const [location, setLocation] = useLocation();
  const { user, logout } = useAuth();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [showSignOutConfirm, setShowSignOutConfirm] = useState(false);
  const [useHamburgerForTabs, setUseHamburgerForTabs] = useState(false);
  const navContainerRef = useRef<HTMLDivElement>(null);
  const navRowRef = useRef<HTMLDivElement>(null);
  const { data: profile } = useProfile(user?.id);
  const { data: adminCheck } = useAdminCheck();
  const isAdmin = adminCheck?.isAdmin ?? false;
  const { t } = useTranslation();
  const isMobile = useIsMobile();
  const isScrolled = useScrollHeader();
  const { toast } = useToast();

  const isAuth = !!user;
  const jobsPath = profile?.role === "company" ? "/company-dashboard/jobs" : "/dashboard";

  const isWorkerWithIncompleteOnboarding = profile?.role === "worker" && !isWorkerOnboardingComplete(profile);

  // Show hamburger only when tabs/buttons would overflow or wrap (desktop/tablet)
  const hasTabs = !!tabs;
  const lastWidthRef = useRef(0);
  const useHamburgerRef = useRef(useHamburgerForTabs);
  useHamburgerRef.current = useHamburgerForTabs;
  useEffect(() => {
    if (!hasTabs) {
      setUseHamburgerForTabs(false);
      return;
    }
    const container = navContainerRef.current;
    if (!container) return;

    const checkOverflow = () => {
      const row = navRowRef.current;
      if (!row || useHamburgerRef.current) return; // Don't check when hamburger is shown - tabs are hidden
      const overflows = row.scrollWidth > row.clientWidth;
      if (overflows) {
        lastWidthRef.current = container.clientWidth;
        setUseHamburgerForTabs(true);
      }
    };

    const tryShowTabs = () => {
      const w = container.clientWidth;
      if (useHamburgerRef.current && w > lastWidthRef.current + 20) {
        setUseHamburgerForTabs(false);
      }
    };

    const ro = new ResizeObserver(() => {
      requestAnimationFrame(() => {
        tryShowTabs();
        checkOverflow();
      });
    });
    ro.observe(container);
    checkOverflow();

    const handleResize = () => tryShowTabs();
    window.addEventListener("resize", handleResize);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", handleResize);
    };
  }, [hasTabs]);

  /* Show hamburger only when tabs/buttons would overflow; otherwise show full header on any viewport. */
  const showHamburger = hasTabs && useHamburgerForTabs;
  const closeSidebar = () => setSidebarOpen(false);

  const navIconMap: Record<string, React.ComponentType<{ className?: string }>> = {
    jobs: Briefcase,
    team: Users,
    timesheets: Clock,
    calendar: Calendar,
    chats: MessageSquare,
  };
  const getNavIcon = (id: string) => navIconMap[id] || Briefcase;

  const handleSignOutClick = () => {
    setShowSignOutConfirm(true);
    setMobileMenuOpen(false);
    closeSidebar();
  };

  const handleSignOutConfirm = () => {
    setShowSignOutConfirm(false);
    logout();
  };

  const handleAvatarClick = (e: React.MouseEvent) => {
    if (isWorkerWithIncompleteOnboarding) {
      e.preventDefault();
      toast({
        title: "Complete onboarding required",
        description: "Please finish setting up your account to access the menu. Your progress has been saved.",
        variant: "default",
      });
      setLocation("/worker-onboarding");
    }
  };

  const toggleMenu = () => setMobileMenuOpen(!mobileMenuOpen);

  const sidebarNavContent = (sidebarNavItems && sidebarNavItems.length > 0)
    ? sidebarNavItems.map((item) => {
        const Icon = getNavIcon(item.id);
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => {
              if (item.onClick) item.onClick();
              else onSidebarNavSelect?.(item.id);
              closeSidebar();
            }}
            className="w-full text-left flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium hover:bg-muted transition-colors"
          >
            <Icon className="w-5 h-5 text-muted-foreground flex-shrink-0" />
            {item.label}
          </button>
        );
      })
    : null;

  return (
    <LayoutGroup>
    <nav className={`border-b border-border bg-background/80 backdrop-blur-md sticky top-0 z-50 transition-all duration-300 ease-in-out overflow-hidden ${
      isScrolled ? 'py-1' : 'py-2'
    }`}>
      <div ref={navContainerRef} className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 min-w-0">
        <div ref={navRowRef} className={`flex justify-between items-center gap-4 transition-all duration-300 ease-in-out flex-nowrap ${
          isScrolled ? 'h-12 scale-[0.95]' : 'h-16 scale-100'
        }`}>
          <div className="flex items-center gap-2 sm:gap-4 min-w-0 flex-1">
            {/* Hamburger (when closed) - opens panel */}
            {showHamburger && !sidebarOpen ? (
              <motion.button
                type="button"
                layoutId="nav-menu-toggle"
                onClick={() => setSidebarOpen(true)}
                transition={{ type: "spring", stiffness: 400, damping: 30 }}
                className="flex-shrink-0 p-2 -ml-2 rounded-lg text-foreground hover:bg-muted focus:outline-none focus:ring-2 focus:ring-ring flex items-center justify-center origin-center"
                aria-label="Open menu"
              >
                <Menu className="h-6 w-6" />
              </motion.button>
            ) : null}
            <Link href={isAuth ? jobsPath : "/"} className="flex-shrink-0 flex items-center cursor-pointer group" data-testid="link-logo-home">
              <div className="w-9 h-9 bg-neutral-900 hover:bg-neutral-800 rounded-lg flex items-center justify-center text-white font-display font-bold text-xl transition-all duration-200 shadow-sm">
                T
              </div>
            </Link>
            {tabs && (!showHamburger || sidebarOpen) ? (
              <div className={`min-w-0 overflow-x-auto scrollbar-hide flex-1 ${sidebarOpen ? 'block' : 'hidden md:block'}`}>
                {tabs}
              </div>
            ) : null}
          </div>

          {/* Right-side buttons: show when tabs fit (any viewport), or on md+ when hamburger */}
          <div className={`flex items-center space-x-4 flex-shrink-0 ${showHamburger ? 'hidden md:flex' : ''}`}>
            {isAuth ? (
              <>
                {profile?.role === "company" && !hidePostJobLink && (
                  <Link href="/post-job" className={`text-sm font-medium hover-nav-link ${location === '/post-job' ? 'text-primary' : 'text-muted-foreground'}`}>
                    {t("nav.postJob")}
                  </Link>
                )}
                <div className="flex items-center gap-2 ml-4">
                  <DevAccountSwitcher />
                  <NotificationPopup profileId={profile?.id} />
                  {isWorkerWithIncompleteOnboarding ? (
                    <button
                      type="button"
                      onClick={handleAvatarClick}
                      className="flex items-center gap-2 text-sm font-medium cursor-pointer hover:opacity-80 transition-opacity focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 rounded-full"
                      data-testid="link-avatar-menu"
                      aria-label="Open menu (complete onboarding required)"
                    >
                      {profile?.avatarUrl ? (
                        <img src={profile.avatarUrl} alt="Profile" className="w-8 h-8 rounded-full border border-border object-cover hover-avatar" />
                      ) : (
                        <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-xs font-semibold text-primary hover-avatar">
                          {profile?.firstName?.[0] || user?.firstName?.[0] || "W"}
                        </div>
                      )}
                    </button>
                  ) : (
                    <Link 
                      href={profile?.role === "company" ? "/company-dashboard/menu" : "/dashboard/menu"} 
                      className="flex items-center gap-2 text-sm font-medium cursor-pointer hover:opacity-80 transition-opacity" 
                      data-testid="link-avatar-menu"
                    >
                      {profile?.avatarUrl ? (
                        <img src={profile.avatarUrl} alt="Profile" className="w-8 h-8 rounded-full border border-border object-cover hover-avatar" />
                      ) : (
                        <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-xs font-semibold text-primary hover-avatar">
                          {profile?.role === "company" ? (profile?.companyName?.[0] || "C") : (profile?.firstName?.[0] || user?.firstName?.[0] || "U")}
                        </div>
                      )}
                    </Link>
                  )}
                </div>
              </>
            ) : (
              <div className="flex items-center gap-3">
                <Link href="/worker-onboarding" className="text-sm font-medium text-muted-foreground hover-nav-link">
                  {t("nav.findWork")}
                </Link>
                <Link href="/company-onboarding" className="text-sm font-medium text-muted-foreground hover-nav-link">
                  {t("company.postJob")}
                </Link>
                <DevAccountSwitcher />
                <button
                  onClick={() => {
                    const loginUrl = getUrlForPath("/api/login", true);
                    window.location.replace(loginUrl);
                  }}
                  className="w-8 h-8 rounded-full bg-primary/10 hover:bg-primary/20 flex items-center justify-center text-primary transition-all duration-200 cursor-pointer hover-avatar hover-shadow-lift"
                  title={t("nav.signIn")}
                  aria-label={t("nav.signIn")}
                >
                  <UserIcon className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>

          {/* Mobile right side when hamburger: avatar etc. (no dropdown hamburger when tabs fit) */}
          {isMobile && showHamburger ? (
            <div className="flex items-center md:hidden">
              <DevAccountSwitcher />
              <NotificationPopup profileId={profile?.id} />
              {isAuth ? (
                isWorkerWithIncompleteOnboarding ? (
                  <button
                    type="button"
                    onClick={handleAvatarClick}
                    className="flex items-center gap-2 text-sm font-medium cursor-pointer"
                    data-testid="link-avatar-menu"
                  >
                    {profile?.avatarUrl ? (
                      <img src={profile.avatarUrl} alt="Profile" className="w-8 h-8 rounded-full border border-border object-cover" />
                    ) : (
                      <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-xs font-semibold text-primary">
                        {profile?.firstName?.[0] || user?.firstName?.[0] || "W"}
                      </div>
                    )}
                  </button>
                ) : (
                  <Link href={profile?.role === "company" ? "/company-dashboard/menu" : "/dashboard/menu"} className="flex items-center" data-testid="link-avatar-menu">
                    {profile?.avatarUrl ? (
                      <img src={profile.avatarUrl} alt="Profile" className="w-8 h-8 rounded-full border border-border object-cover" />
                    ) : (
                      <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-xs font-semibold text-primary">
                        {profile?.role === "company" ? (profile?.companyName?.[0] || "C") : (profile?.firstName?.[0] || user?.firstName?.[0] || "U")}
                      </div>
                    )}
                  </Link>
                )
              ) : (
                <button
                  onClick={() => { const u = getUrlForPath("/api/login", true); window.location.replace(u); }}
                  className="w-8 h-8 rounded-full bg-primary/10 hover:bg-primary/20 flex items-center justify-center text-primary"
                  aria-label={t("nav.signIn")}
                >
                  <UserIcon className="w-4 h-4" />
                </button>
              )}
            </div>
          ) : null}
        </div>
      </div>

      {/* Mobile dropdown (only when no tabs / no hamburger mode) */}
      {mobileMenuOpen && isMobile && !showHamburger && (
        <div className="md:hidden border-t border-border bg-background">
          <div className="px-2 pt-2 pb-3 space-y-1 sm:px-3">
            {isAuth ? (
              <>
                {profile?.role === "company" && (
                  <Link href="/post-job" className="flex items-center gap-3 px-3 py-2 rounded-md text-base font-medium text-foreground hover:bg-secondary" onClick={() => setMobileMenuOpen(false)}>
                    <Plus className="w-5 h-5 text-muted-foreground flex-shrink-0" />
                    {t("nav.postJob")}
                  </Link>
                )}
                <button
                  onClick={handleSignOutClick}
                  className="w-full text-left flex items-center gap-3 px-3 py-2 rounded-md text-base font-medium text-muted-foreground hover:bg-secondary hover:text-destructive"
                >
                  <LogOut className="w-5 h-5 text-muted-foreground flex-shrink-0" />
                  {t("settings.signOut")}
                </button>
              </>
            ) : (
              <>
                <Link href="/worker-onboarding" className="flex items-center gap-3 px-3 py-2 rounded-md text-base font-medium text-foreground hover:bg-secondary" onClick={() => setMobileMenuOpen(false)}>
                  <Search className="w-5 h-5 text-muted-foreground flex-shrink-0" />
                  {t("nav.findWork")}
                </Link>
                <Link href="/company-onboarding" className="flex items-center gap-3 px-3 py-2 rounded-md text-base font-medium text-foreground hover:bg-secondary" onClick={() => setMobileMenuOpen(false)}>
                  <Building2 className="w-5 h-5 text-muted-foreground flex-shrink-0" />
                  {t("company.postJob")}
                </Link>
                <button
                  onClick={() => {
                    const loginUrl = getUrlForPath("/api/login", true);
                    window.location.replace(loginUrl);
                  }}
                  className="w-full text-left flex items-center gap-3 px-3 py-2 rounded-md text-base font-medium text-primary hover:bg-secondary"
                >
                  <UserIcon className="w-5 h-5 flex-shrink-0" />
                  {t("nav.signIn")}
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* Left sidebar panel (hamburger menu) - X close is part of panel, morphs from hamburger */}
      <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
        <SheetContent side="left" className="w-[280px] sm:w-[320px] p-0 flex flex-col bg-card border-r shadow-xl" hideCloseButton>
          <SheetHeader className="px-3 py-4 border-b border-border flex flex-row items-center gap-3 bg-background/50">
            <motion.button
              type="button"
              layoutId="nav-menu-toggle"
              onClick={closeSidebar}
              transition={{ type: "spring", stiffness: 400, damping: 30 }}
              className="flex-shrink-0 p-2 -ml-1 rounded-lg text-foreground hover:bg-muted focus:outline-none focus:ring-2 focus:ring-ring flex items-center justify-center origin-center"
              aria-label="Close menu"
            >
              <motion.span
                key="x-icon"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.15 }}
                className="flex items-center justify-center"
              >
                <X className="h-6 w-6" />
              </motion.span>
            </motion.button>
            <div className="w-9 h-9 bg-neutral-900 rounded-lg flex items-center justify-center text-white font-display font-bold text-xl flex-shrink-0 shadow-sm">
              T
            </div>
            <SheetTitle className="text-left font-semibold">Menu</SheetTitle>
          </SheetHeader>
          <div className="flex-1 min-h-0 overflow-y-auto py-4 px-2">
            {isAdmin && sidebarNavItems && sidebarNavItems.length > 0 ? (
              <Accordion type="multiple" className="border-0 space-y-0.5" defaultValue={[sidebarNavItems[0].id]}>
                {sidebarNavItems.map((item) => {
                  const Icon = getNavIcon(item.id);
                  return (
                  <AccordionItem key={item.id} value={item.id} className="border-0">
                    <AccordionTrigger className="py-3 px-3 rounded-lg hover:bg-muted/50 hover:no-underline">
                      <div className="flex items-center gap-3">
                        <Icon className="w-5 h-5 text-muted-foreground flex-shrink-0" />
                        <span className="text-sm font-medium">{item.label}</span>
                      </div>
                    </AccordionTrigger>
                    <AccordionContent className="pb-2 pt-0 px-3">
                      <button
                        type="button"
                        onClick={() => {
                          if (item.onClick) item.onClick();
                          else onSidebarNavSelect?.(item.id);
                          closeSidebar();
                        }}
                        className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground w-full py-1.5"
                      >
                        <ChevronRight className="w-4 h-4" />
                        Go to {item.label}
                      </button>
                    </AccordionContent>
                  </AccordionItem>
                  );
                })}
                <div className="border-t border-border my-3" />
                <Link href="/admin" onClick={closeSidebar} className="flex items-center gap-3 py-3 px-3 rounded-lg hover:bg-muted/50 transition-colors">
                  <Shield className="w-5 h-5 text-red-600 dark:text-red-400 flex-shrink-0" />
                  <span className="text-sm font-medium">{t("settings.adminTools")}</span>
                  <ChevronRight className="w-5 h-5 text-muted-foreground flex-shrink-0 ml-auto" />
                </Link>
              </Accordion>
            ) : sidebarNavContent ? (
              <div className="space-y-0.5">
                {sidebarNavContent}
              </div>
            ) : null}
            <div className="mt-4 pt-4 border-t border-border space-y-0.5">
              {isAuth ? (
                <>
                  {profile?.role === "company" && (
                    <Link href="/post-job" onClick={closeSidebar} className="flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium hover:bg-muted transition-colors">
                      <Plus className="w-5 h-5 text-muted-foreground flex-shrink-0" />
                      {t("nav.postJob")}
                    </Link>
                  )}
                  <Link href={profile?.role === "company" ? "/company-dashboard/menu" : "/dashboard/menu"} onClick={closeSidebar} className="flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium hover:bg-muted transition-colors">
                    <Settings className="w-5 h-5 text-muted-foreground flex-shrink-0" />
                    {t("nav.menu") || "Menu"}
                  </Link>
                </>
              ) : (
                <>
                  <Link href="/worker-onboarding" onClick={closeSidebar} className="flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium hover:bg-muted transition-colors">
                    <Search className="w-5 h-5 text-muted-foreground flex-shrink-0" />
                    {t("nav.findWork")}
                  </Link>
                  <Link href="/company-onboarding" onClick={closeSidebar} className="flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium hover:bg-muted transition-colors">
                    <Building2 className="w-5 h-5 text-muted-foreground flex-shrink-0" />
                    {t("company.postJob")}
                  </Link>
                  <button
                    onClick={() => { const u = getUrlForPath("/api/login", true); window.location.replace(u); closeSidebar(); }}
                    className="w-full text-left flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium text-primary hover:bg-muted transition-colors"
                  >
                    <UserIcon className="w-5 h-5 flex-shrink-0" />
                    {t("nav.signIn")}
                  </button>
                </>
              )}
            </div>
          </div>
          {isAuth && (
            <div className="flex-shrink-0 border-t border-border bg-muted/30 pb-4">
              <div className="flex items-center gap-3 p-3 rounded-xl bg-background/80 shadow-sm border border-border/50">
                <Avatar className="h-10 w-10 flex-shrink-0 ring-2 ring-border/50">
                  <AvatarImage src={profile?.avatarUrl ?? undefined} alt="" />
                  <AvatarFallback className="text-sm font-medium bg-primary/10 text-primary">
                    {profile?.companyName?.[0] || profile?.firstName?.[0] || user?.firstName?.[0] || "U"}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{profile?.companyName || [profile?.firstName, profile?.lastName].filter(Boolean).join(" ") || user?.email || "Account"}</p>
                  <p className="text-xs text-muted-foreground truncate">{user?.email}</p>
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button type="button" className="p-1.5 rounded-lg hover:bg-muted transition-colors text-muted-foreground hover:text-foreground" aria-label="Account options">
                      <MoreVertical className="w-4 h-4" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" side="top" className="min-w-[160px]">
                    <DropdownMenuItem onClick={handleSignOutClick} className="text-destructive focus:text-destructive">
                      <LogOut className="w-4 h-4 mr-2" />
                      {t("settings.signOut")}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>

      {/* Sign out confirmation */}
      <AlertDialog open={showSignOutConfirm} onOpenChange={setShowSignOutConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("settings.signOut")}?</AlertDialogTitle>
            <AlertDialogDescription>
              {t("settings.signOutConfirmDesc", "Are you sure you want to sign out? You will need to sign in again to access your account.")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel", "Cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleSignOutConfirm}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {t("settings.signOut")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      
      {/* Notification Banner for logged in users */}
      {isAuth && profile && (
        <NotificationBanner profileId={profile.id} />
      )}
    </nav>
    </LayoutGroup>
  );
}
