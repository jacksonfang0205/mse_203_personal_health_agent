import type { Metadata } from "next";
import { Fraunces, Geist, Geist_Mono } from "next/font/google";
import { AppHeader } from "@/components/AppHeader";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
  axes: ["SOFT", "opsz"],
});

export const metadata: Metadata = {
  title: "Pivot — Fitness that fits your life",
  description: "An AI workout planner that adapts when your week changes.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${fraunces.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <AppHeader />
        <main className="flex-1">{children}</main>
        <footer className="border-t border-line px-5 py-6 text-xs text-ink-faint sm:px-8">
          <div className="mx-auto flex max-w-6xl flex-col gap-1 sm:flex-row sm:justify-between">
            <span>Pivot is a student prototype for Stanford MS&amp;E 203.</span>
            <span>General fitness suggestions only, not medical advice.</span>
          </div>
        </footer>
      </body>
    </html>
  );
}
