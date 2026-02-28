"use client";

import { LayoutGroup, motion, AnimatePresence } from "framer-motion";
import { usePathname } from "next/navigation";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import { ThemeProvider, useTheme } from "@/context/ThemeContext";
import { ToastProvider } from "@/context/ToastContext";
import AuthGuard from "@/components/AuthGuard";
import ToastContainer from "@/components/ToastContainer";
import SSEListener from "@/components/SSEListener";
import Link from "next/link";
import { useState, useEffect, useCallback } from "react";
import {
  Aperture, LogOut, Settings, Shield, MapPin, Images,
  UserCircle, Search, LayoutDashboard, Sun, Moon, Monitor,
  PanelLeftClose, PanelLeftOpen, ImageIcon, ChevronDown, Copy, Download, CalendarDays, Heart, Sparkles, BarChart3, HardDrive,
} from "lucide-react";
import InstallPrompt from "./InstallPrompt";

const PUBLIC_PATHS = ["/login", "/register", "/share/", "/p/"];

/* ── Navigation Items ── */
interface NavItem {
  href: string;
  icon: React.ElementType;
  label: string;
  adminOnly?: boolean;
  mobile?: boolean; // show in mobile bottom nav
}

const NAV_ITEMS: NavItem[] = [
  { href: "/", icon: ImageIcon, label: "画廊", mobile: true },
  { href: "/search", icon: Search, label: "搜索", mobile: true },
  { href: "/favorites", icon: Heart, label: "收藏", mobile: true },
  { href: "/timeline", icon: CalendarDays, label: "时间轴", mobile: false },
  { href: "/dashboard", icon: LayoutDashboard, label: "仪表盘", mobile: false },
  { href: "/albums", icon: Images, label: "相册", mobile: true },
  { href: "/smart-albums", icon: Sparkles, label: "智能相册", mobile: false },
  { href: "/analytics", icon: BarChart3, label: "统计", mobile: false },
  { href: "/backup", icon: HardDrive, label: "备份", mobile: false },
  { href: "/map", icon: MapPin, label: "地图", mobile: false },
  { href: "/duplicates", icon: Copy, label: "去重", mobile: false },
  { href: "/exports", icon: Download, label: "导出", mobile: false },
  { href: "/profile", icon: UserCircle, label: "个人", mobile: true },
  { href: "/admin", icon: Shield, label: "管理", adminOnly: true, mobile: false },
  { href: "/settings", icon: Settings, label: "设置", adminOnly: true, mobile: false },
];

/* ── Theme Switcher ── */
function ThemeSwitcher({ collapsed }: { collapsed: boolean }) {
  const { theme, setTheme } = useTheme();
  const options: { value: "light" | "dark" | "system"; icon: React.ElementType; label: string }[] = [
    { value: "light", icon: Sun, label: "浅色" },
    { value: "dark", icon: Moon, label: "深色" },
    { value: "system", icon: Monitor, label: "系统" },
  ];

  if (collapsed) {
    const current = options.find((o) => o.value === theme) || options[1];
    const Icon = current.icon;
    return (
      <button
        onClick={() => {
          const idx = options.findIndex((o) => o.value === theme);
          setTheme(options[(idx + 1) % options.length].value);
        }}
        className="w-9 h-9 flex items-center justify-center rounded-lg transition-colors"
        style={{ color: "var(--pg-text-tertiary)" }}
        title={`主题: ${current.label}`}
      >
        <Icon className="w-4 h-4" />
      </button>
    );
  }

  return (
    <div
      className="flex items-center gap-1 p-1 rounded-lg"
      style={{ background: "var(--pg-bg-elevated)" }}
    >
      {options.map(({ value, icon: Icon, label }) => (
        <button
          key={value}
          onClick={() => setTheme(value)}
          className="flex-1 flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-md text-xs transition-all"
          style={{
            background: theme === value ? "var(--pg-bg-surface)" : "transparent",
            color: theme === value ? "var(--pg-text-primary)" : "var(--pg-text-tertiary)",
            boxShadow: theme === value ? "var(--pg-shadow-sm)" : "none",
          }}
          title={label}
        >
          <Icon className="w-3.5 h-3.5" />
          <span className="hidden xl:inline">{label}</span>
        </button>
      ))}
    </div>
  );
}

/* ── Sidebar Nav Item ── */
function SidebarLink({
  item, active, collapsed,
}: {
  item: NavItem; active: boolean; collapsed: boolean;
}) {
  const Icon = item.icon;

  return (
    <Link
      href={item.href}
      className="relative flex items-center gap-3 rounded-lg transition-all duration-200 group"
      style={{
        padding: collapsed ? "8px" : "8px 12px",
        justifyContent: collapsed ? "center" : "flex-start",
        color: active ? "var(--pg-text-primary)" : "var(--pg-text-tertiary)",
        background: active ? "var(--pg-accent-soft)" : "transparent",
      }}
      title={collapsed ? item.label : undefined}
    >
      {active && (
        <motion.div
          layoutId="sidebar-active"
          className="absolute inset-0 rounded-lg"
          style={{ background: "var(--pg-accent-soft)" }}
          transition={{ type: "spring", bounce: 0.15, duration: 0.5 }}
        />
      )}
      <Icon
        className="w-[18px] h-[18px] relative z-10 transition-colors"
        style={{ color: active ? "var(--pg-accent)" : undefined }}
      />
      {!collapsed && (
        <span className="text-sm font-medium relative z-10 whitespace-nowrap">
          {item.label}
        </span>
      )}
      {/* Hover highlight */}
      {!active && (
        <div
          className="absolute inset-0 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity"
          style={{ background: "var(--pg-bg-hover)" }}
        />
      )}
    </Link>
  );
}

/* ── Desktop Sidebar ── */
function Sidebar({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  const { user, logout } = useAuth();
  const pathname = usePathname();
  const [showUserMenu, setShowUserMenu] = useState(false);

  if (!user) return null;

  const filteredItems = NAV_ITEMS.filter(
    (item) => !item.adminOnly || user.role === "SuperAdmin"
  );

  const isActive = (href: string) => {
    if (href === "/") return pathname === "/";
    return pathname.startsWith(href);
  };

  return (
    <aside
      className="hidden md:flex flex-col fixed top-0 left-0 bottom-0 z-50 transition-all duration-300"
      style={{
        width: collapsed ? "var(--pg-sidebar-collapsed)" : "var(--pg-sidebar-width)",
        background: "var(--pg-bg-surface)",
        borderRight: "1px solid var(--pg-border-subtle)",
      }}
    >
      {/* Logo */}
      <div
        className="flex items-center gap-3 shrink-0"
        style={{
          height: "var(--pg-topbar-height)",
          padding: collapsed ? "0 14px" : "0 16px",
          justifyContent: collapsed ? "center" : "flex-start",
        }}
      >
        <Aperture
          className="w-6 h-6 shrink-0"
          style={{ color: "var(--pg-accent)" }}
        />
        {!collapsed && (
          <motion.span
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            className="text-sm font-semibold tracking-tight whitespace-nowrap"
            style={{ color: "var(--pg-text-primary)" }}
          >
            Photogiraffe
          </motion.span>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-2 py-2 space-y-0.5">
        {filteredItems.map((item) => (
          <SidebarLink
            key={item.href}
            item={item}
            active={isActive(item.href)}
            collapsed={collapsed}
          />
        ))}
      </nav>

      {/* Bottom Section */}
      <div
        className="shrink-0 px-2 pb-3 space-y-2"
        style={{ borderTop: "1px solid var(--pg-border-subtle)", paddingTop: "12px" }}
      >
        {/* Theme Switcher */}
        <ThemeSwitcher collapsed={collapsed} />

        {/* User Menu */}
        <div className="relative">
          <button
            onClick={() => setShowUserMenu(!showUserMenu)}
            className="w-full flex items-center gap-2.5 rounded-lg transition-colors"
            style={{
              padding: collapsed ? "8px" : "8px 10px",
              justifyContent: collapsed ? "center" : "flex-start",
              background: showUserMenu ? "var(--pg-bg-hover)" : "transparent",
            }}
          >
            <div
              className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-medium shrink-0"
              style={{
                background: "var(--pg-accent-soft)",
                color: "var(--pg-accent)",
              }}
            >
              {user.username.charAt(0).toUpperCase()}
            </div>
            {!collapsed && (
              <>
                <div className="flex-1 min-w-0 text-left">
                  <p
                    className="text-sm font-medium truncate"
                    style={{ color: "var(--pg-text-primary)" }}
                  >
                    {user.username}
                  </p>
                  <p
                    className="text-xs truncate"
                    style={{ color: "var(--pg-text-tertiary)" }}
                  >
                    {user.role === "SuperAdmin" ? "管理员" : "用户"}
                  </p>
                </div>
                <ChevronDown
                  className="w-3.5 h-3.5 shrink-0 transition-transform"
                  style={{
                    color: "var(--pg-text-muted)",
                    transform: showUserMenu ? "rotate(180deg)" : undefined,
                  }}
                />
              </>
            )}
          </button>

          <AnimatePresence>
            {showUserMenu && (
              <motion.div
                initial={{ opacity: 0, y: 4, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 4, scale: 0.96 }}
                transition={{ duration: 0.15 }}
                className="absolute bottom-full left-0 right-0 mb-1 rounded-lg overflow-hidden z-50"
                style={{
                  background: "var(--pg-bg-elevated)",
                  border: "1px solid var(--pg-border)",
                  boxShadow: "var(--pg-shadow-lg)",
                  minWidth: collapsed ? "160px" : undefined,
                }}
              >
                <button
                  onClick={() => { logout(); setShowUserMenu(false); }}
                  className="w-full flex items-center gap-2 px-3 py-2.5 text-sm transition-colors"
                  style={{ color: "var(--pg-error)" }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "var(--pg-bg-hover)")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                >
                  <LogOut className="w-4 h-4" />
                  退出登录
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Collapse Toggle */}
        <button
          onClick={onToggle}
          className="w-full flex items-center justify-center gap-2 rounded-lg py-1.5 transition-colors"
          style={{ color: "var(--pg-text-muted)" }}
          onMouseEnter={(e) => (e.currentTarget.style.background = "var(--pg-bg-hover)")}
          onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
          title={collapsed ? "展开侧边栏" : "收起侧边栏"}
        >
          {collapsed ? (
            <PanelLeftOpen className="w-4 h-4" />
          ) : (
            <>
              <PanelLeftClose className="w-4 h-4" />
              <span className="text-xs">收起</span>
            </>
          )}
        </button>
      </div>
    </aside>
  );
}

/* ── Mobile Bottom Nav ── */
function MobileBottomNav() {
  const { user } = useAuth();
  const pathname = usePathname();

  if (!user) return null;

  const mobileItems = NAV_ITEMS.filter((item) => item.mobile && (!item.adminOnly || user.role === "SuperAdmin"));

  const isActive = (href: string) => {
    if (href === "/") return pathname === "/";
    return pathname.startsWith(href);
  };

  return (
    <nav
      className="md:hidden fixed bottom-0 left-0 right-0 z-50 flex items-center justify-around"
      style={{
        height: "60px",
        background: "var(--pg-nav-bg)",
        backdropFilter: "blur(20px)",
        WebkitBackdropFilter: "blur(20px)",
        borderTop: "1px solid var(--pg-border-subtle)",
        paddingBottom: "env(safe-area-inset-bottom, 0px)",
      }}
    >
      {mobileItems.map((item) => {
        const Icon = item.icon;
        const active = isActive(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            className="flex flex-col items-center gap-0.5 px-3 py-1.5 transition-colors relative"
          >
            {active && (
              <motion.div
                layoutId="mobile-nav-active"
                className="absolute -top-px left-1/2 -translate-x-1/2 w-8 h-0.5 rounded-full"
                style={{ background: "var(--pg-accent)" }}
                transition={{ type: "spring", bounce: 0.2, duration: 0.5 }}
              />
            )}
            <Icon
              className="w-5 h-5"
              style={{ color: active ? "var(--pg-accent)" : "var(--pg-text-tertiary)" }}
            />
            <span
              className="text-[10px]"
              style={{ color: active ? "var(--pg-accent)" : "var(--pg-text-muted)" }}
            >
              {item.label}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}

/* ── Inner Layout ── */
function InnerLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { user } = useAuth();
  const isPublic = PUBLIC_PATHS.some((p) => pathname.startsWith(p));
  const [collapsed, setCollapsed] = useState(false);

  // Persist sidebar state
  useEffect(() => {
    const stored = localStorage.getItem("pg-sidebar-collapsed");
    if (stored === "true") setCollapsed(true);
  }, []);

  const toggleSidebar = useCallback(() => {
    setCollapsed((prev) => {
      localStorage.setItem("pg-sidebar-collapsed", String(!prev));
      return !prev;
    });
  }, []);

  if (isPublic || !user) {
    return (
      <LayoutGroup>
        {isPublic ? children : <AuthGuard>{children}</AuthGuard>}
      </LayoutGroup>
    );
  }

  return (
    <>
      <Sidebar collapsed={collapsed} onToggle={toggleSidebar} />
      <MobileBottomNav />
      <div
        className="min-h-screen transition-all duration-300"
        style={{
          marginLeft: `var(--pg-sidebar-${collapsed ? "collapsed" : "width"})`,
          paddingBottom: "60px", // mobile bottom nav space
        }}
      >
        <LayoutGroup>
          <AuthGuard>{children}</AuthGuard>
        </LayoutGroup>
      </div>
    </>
  );
}

export default function ClientLayout({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
      <AuthProvider>
        <ToastProvider>
          <InnerLayout>{children}</InnerLayout>
          <ToastContainer />
          <SSEListener />
          <InstallPrompt />
        </ToastProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}
