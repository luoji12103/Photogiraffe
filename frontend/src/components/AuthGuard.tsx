"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { Aperture } from "lucide-react";

interface AuthGuardProps {
  children: React.ReactNode;
  /** If true, only SuperAdmin can access this page. */
  adminOnly?: boolean;
}

export default function AuthGuard({ children, adminOnly = false }: AuthGuardProps) {
  const { user, isLoading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (isLoading) return;
    if (!user) {
      router.replace("/login");
      return;
    }
    if (adminOnly && user.role !== "SuperAdmin") {
      router.replace("/");
    }
  }, [user, isLoading, adminOnly, router]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "var(--pg-bg-base)" }}>
        <div className="flex flex-col items-center gap-4">
          <Aperture className="w-10 h-10 animate-spin" style={{ color: "var(--pg-accent)", animationDuration: "3s" }} />
          <div className="flex items-center gap-1.5">
            <div className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: "var(--pg-accent)", animationDelay: "0ms" }} />
            <div className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: "var(--pg-accent)", animationDelay: "200ms" }} />
            <div className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: "var(--pg-accent)", animationDelay: "400ms" }} />
          </div>
        </div>
      </div>
    );
  }

  if (!user || (adminOnly && user.role !== "SuperAdmin")) {
    return null; // will redirect
  }

  return <>{children}</>;
}
