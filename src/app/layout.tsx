import type { Metadata } from "next";
import { Geist_Mono, Roboto, Roboto_Condensed } from "next/font/google";
import { AccountGate, AccountProvider } from "@/components/AccountProvider";
import { AppHeader } from "@/components/AppHeader";
import "./globals.css";

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const roboto = Roboto({
  variable: "--font-roboto",
  subsets: ["latin"],
});

const robotoCondensed = Roboto_Condensed({
  variable: "--font-roboto-condensed",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Pivot — Fitness that fits your life",
  description: "An AI workout planner that adapts when your week changes.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${roboto.variable} ${geistMono.variable} ${robotoCondensed.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <AccountProvider>
          <AppHeader />
          <main className="flex-1">
            <AccountGate>{children}</AccountGate>
          </main>
        </AccountProvider>
        <footer className="border-t border-line px-5 py-6 text-xs text-ink-faint sm:px-8">
          <div className="mx-auto flex max-w-6xl flex-col gap-1 sm:flex-row sm:justify-between">
            <span>Pivot is a student prototype for Stanford MS&amp;E 203.</span>
            <span className="flex flex-wrap gap-x-4">
              <span>General fitness suggestions only, not medical advice.</span>
              <a href="/privacy" className="underline-offset-4 hover:underline">
                Privacy
              </a>
              <a href="/terms" className="underline-offset-4 hover:underline">
                Terms
              </a>
            </span>
          </div>
        </footer>
      </body>
    </html>
  );
}
