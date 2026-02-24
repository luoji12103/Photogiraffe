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

const BORDER: Record<ToastType, string> = {
  success: "border-emerald-500/40",
  error: "border-red-500/40",
  warning: "border-amber-500/40",
  info: "border-sky-500/40",
};

function ToastItem({ toast }: { toast: Toast }) {
  const { removeToast } = useToast();
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 24, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 8, scale: 0.96 }}
      transition={{ duration: 0.22, ease: "easeOut" }}
      className={`flex items-start gap-3 w-80 rounded-xl border bg-zinc-900/95 backdrop-blur px-4 py-3 shadow-xl ${BORDER[toast.type]}`}
    >
      {ICONS[toast.type]}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-white leading-tight">
          {toast.title}
        </p>
        {toast.message && (
          <p className="text-xs text-zinc-400 mt-0.5 leading-tight truncate">
            {toast.message}
          </p>
        )}
      </div>
      <button
        onClick={() => removeToast(toast.id)}
        className="text-zinc-500 hover:text-zinc-300 transition-colors shrink-0"
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
