"use client";

import { LayoutGroup } from "framer-motion";

export default function ClientLayout({ children }: { children: React.ReactNode }) {
  return <LayoutGroup>{children}</LayoutGroup>;
}
