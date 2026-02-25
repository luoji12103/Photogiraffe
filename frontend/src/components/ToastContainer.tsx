"use client";

import { AnimatePresence, motion } from "framer-motion";
import { CheckCircle, Info, TriangleAlert, XCircle, X } from "lucide-react";
import { useToast, type Toast, type ToastType } from "@/context/ToastContext";

const ICONS: Record<ToastType, React.ReactNode> = {
  success: <CheckCircle className="w-5 h-5 text-emerald-400 shrink-0" />,
  error: <XCircle className="w-5 h-5 text-red-400 shrink-0" />,
  warning: <TriangleAlert className="w-5 h-5 text-amber-400 shrink-0" />,
  info: <Info className="w-5 h-5 text-sky-400 shrink-0" />,
};

const BORDER_COLOR: Record<ToastType, string> = {
  success: "rgba(16,185,129,0.4)",
  error: "rgba(239,68,68,0.4)",
  warning: "rgba(245,158,11,0.4)",
  info: "rgba(6,182,212,0.4)",
};

function ToastItem({ toast }: { toast: Toast }) {
  const { removeToast } = useToast();
  const borderColor = BORDER_COLOR[toast.type];
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 24, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 8, scale: 0.96 }}
      transition={{ duration: 0.22, ease: "easeOut" }}
      className="flex items-start gap-3 w-80 rounded-xl border backdrop-blur px-4 py-3"
      style={{
        background: "var(--pg-bg-elevated)",
        borderColor: borderColor,
        boxShadow: "var(--pg-shadow-lg)",
      }}
    >
      {ICONS[toast.type]}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium leading-tight" style={{ color: "var(--pg-text-primary)" }}>
          {toast.title}
        </p>
        {toast.message && (
          <p className="text-xs mt-0.5 leading-tight truncate" style={{ color: "var(--pg-text-tertiary)" }}>
            {toast.message}
          </p>
        )}
      </div>
      <button
        onClick={() => removeToast(toast.id)}
        className="transition-colors shrink-0"
        style={{ color: "var(--pg-text-muted)" }}
        aria-label="Dismiss"
      >
        <X className="w-4 h-4" />
      </button>
    </motion.div>
  );
}

export default function ToastContainer() {
  const { toasts } = useToast();
  return (
    <div className="fixed bottom-6 right-6 z-[9999] flex flex-col gap-2 pointer-events-none">
      <AnimatePresence mode="popLayout">
        {toasts.map((t) => (
          <div key={t.id} className="pointer-events-auto">
            <ToastItem toast={t} />
          </div>
        ))}
      </AnimatePresence>
    </div>
  );
}
