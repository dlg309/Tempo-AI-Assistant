import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "Tempo · Make time for what matters",
  description:
    "Turn your tasks, deadlines and commitments into a realistic plan.",
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
