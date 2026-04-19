import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import { ReleaseNotesBell } from "@/components/ReleaseNotesBell";
import { ShieldAlert, LogOut, LayoutDashboard, Activity } from "lucide-react";

/**
 * Minimal chrome wrapped around admin pages on admin.estimatrix.io.
 * Replaces the worker/company nav so the admin host visually communicates
 * "this is the admin console, nothing else."
 */
export function AdminHostShell({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const { user } = useAuth();

  const onLogout = () => {
    window.location.href = "/api/logout";
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-40 bg-background border-b border-border">
        <div className="max-w-7xl mx-auto px-4 py-2.5 flex items-center gap-3">
          <div className="flex items-center gap-2">
            <ShieldAlert className="w-5 h-5 text-primary" />
            <div>
              <p className="text-sm font-semibold leading-tight">Tolstoy Admin</p>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground leading-tight">admin.estimatrix.io</p>
            </div>
          </div>

          <nav className="ml-6 flex items-center gap-1">
            <NavLink href="/admin" current={location === "/admin"}>
              <LayoutDashboard className="w-3.5 h-3.5 mr-1" /> Dashboard
            </NavLink>
            <NavLink href="/admin/compliance" current={location.startsWith("/admin/compliance")}>
              <Activity className="w-3.5 h-3.5 mr-1" /> Compliance
            </NavLink>
          </nav>

          <div className="ml-auto flex items-center gap-3">
            <ReleaseNotesBell />
            <span className="text-xs text-muted-foreground hidden md:inline">{user?.email}</span>
            <Button variant="outline" size="sm" onClick={onLogout} className="gap-1">
              <LogOut className="w-3.5 h-3.5" /> Sign out
            </Button>
          </div>
        </div>
      </header>

      <main>{children}</main>
    </div>
  );
}

// Local helper: nav link button that shows current state.
function NavLink({ href, current, children }: { href: string; current: boolean; children: React.ReactNode }) {
  return (
    <Link href={href}>
      <button
        type="button"
        className={`flex items-center text-xs px-3 py-1.5 rounded-md transition ${
          current ? "bg-primary text-primary-foreground" : "hover:bg-muted text-foreground"
        }`}
      >
        {children}
      </button>
    </Link>
  );
}
