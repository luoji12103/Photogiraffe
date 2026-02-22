"use client";

import { LayoutGroup } from "framer-motion";
import { usePathname } from "next/navigation";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import AuthGuard from "@/components/AuthGuard";
import Link from "next/link";
import { Aperture, LogOut, Settings } from "lucide-react";

const PUBLIC_PATHS = ["/login", "/register"];

function AppHeader() {
  const { user, logout } = useAuth();
  if (!user) return null;
  return (
    <header className="fixed top-0 left-0 right-0 z-40 h-12 flex items-center justify-between px-4 bg-zinc-950/80 backdrop-blur-md border-b border-zinc-800/50">
      <Link href="/" className="flex items-center gap-2 text-zinc-300 hover:text-zinc-100 transition-colors">
        <Aperture className="w-5 h-5" />
        <span className="text-sm font-medium tracking-tight">Photogiraffe</span>
      </Link>
      <div className="flex items-center gap-3">
        {user.role === "SuperAdmin" && (
          <Link href="/settings" className="text-zinc-500 hover:text-zinc-300 transition-colors" title="Settings">
            <Settings className="w-4 h-4" />
          </Link>
        )}
        <span className="text-xs text-zinc-500">{user.username}</span>
        <button
          onClick={logout}
          className="text-zinc-500 hover:text-zinc-300 transition-colors"
          title="Sign out"
        >
          <LogOut className="w-4 h-4" />
        </button>
      </div>
    </header>
  );
}

function InnerLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isPublic = PUBLIC_PATHS.some((p) => pathname.startsWith(p));

  return (
    <>
      <AppHeader />
      <div className="pt-12">
        <LayoutGroup>
          {isPublic ? children : <AuthGuard>{children}</AuthGuard>}
        </LayoutGroup>
      </div>
    </>
  );
}

export default function ClientLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <InnerLayout>{children}</InnerLayout>
    </AuthProvider>
  );
}
