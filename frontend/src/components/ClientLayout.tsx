"use client";

import { LayoutGroup } from "framer-motion";
import { usePathname } from "next/navigation";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import AuthGuard from "@/components/AuthGuard";
import Link from "next/link";
import { Aperture, LogOut, Settings, Shield, MapPin, Images } from "lucide-react";

const PUBLIC_PATHS = ["/login", "/register", "/share/"];

function AppHeader() {
  const { user, logout } = useAuth();
  if (!user) return null;
  return (
    <header className="fixed top-0 left-0 right-0 z-40 h-12 flex items-center justify-between px-3 sm:px-4 bg-zinc-950/80 backdrop-blur-md border-b border-zinc-800/50">
      <Link href="/" className="flex items-center gap-2 text-zinc-300 hover:text-zinc-100 transition-colors">
        <Aperture className="w-5 h-5 flex-shrink-0" />
        <span className="text-sm font-medium tracking-tight hidden xs:inline sm:inline">Photogiraffe</span>
      </Link>
      <div className="flex items-center gap-2 sm:gap-3">
        <Link href="/map" className="text-zinc-500 hover:text-zinc-300 transition-colors p-1" title="照片地图">
          <MapPin className="w-4 h-4" />
        </Link>
        <Link href="/albums" className="text-zinc-500 hover:text-zinc-300 transition-colors p-1" title="我的相册">
          <Images className="w-4 h-4" />
        </Link>
        {user.role === "SuperAdmin" && (
          <>
            <Link href="/admin" className="text-zinc-500 hover:text-zinc-300 transition-colors p-1" title="Admin Panel">
              <Shield className="w-4 h-4" />
            </Link>
            <Link href="/settings" className="text-zinc-500 hover:text-zinc-300 transition-colors p-1" title="Settings">
              <Settings className="w-4 h-4" />
            </Link>
          </>
        )}
        <span className="text-xs text-zinc-500 hidden sm:block max-w-[120px] truncate">{user.username}</span>
        <button
          onClick={logout}
          className="text-zinc-500 hover:text-zinc-300 transition-colors p-1"
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
