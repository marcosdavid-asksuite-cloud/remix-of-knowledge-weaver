import { Link } from "@tanstack/react-router";
import { Toaster } from "@/components/ui/sonner";
import type { ReactNode } from "react";

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3">
          <Link to="/" className="flex items-center gap-2 font-semibold">
            <span className="inline-block size-2 rounded-full bg-primary" />
            Hybrid KB Lab
          </Link>
          <nav className="flex items-center gap-4 text-sm">
            <Link to="/" className="text-muted-foreground hover:text-foreground" activeProps={{ className: "text-foreground" }}>
              Projects
            </Link>
            <Link to="/settings" className="text-muted-foreground hover:text-foreground" activeProps={{ className: "text-foreground" }}>
              Settings
            </Link>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
      <Toaster richColors position="top-right" />
    </div>
  );
}
