import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "Tempo · Make time for what matters",
  description:
    "Turn your tasks, deadlines and commitments into a realistic plan.",
};
export default function Layout({ children }: { children: React.ReactNode }) {
  // Writing extensions modify these document attributes before React hydrates.
  // Keep the escape hatch on the roots; descendant mismatches still surface.
  return (
    <html lang="en" suppressHydrationWarning>
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
