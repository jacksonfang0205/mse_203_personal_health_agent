"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { endDemo } from "@/lib/demo";
import { useAccount } from "./AccountProvider";
import { PivotMark } from "./icons";
import { cx } from "./ui";

const NAV = [
  { href: "/week", label: "My week" },
  { href: "/form", label: "Form correction" },
  { href: "/preferences", label: "Preferences" },
];

export function AppHeader() {
  const pathname = usePathname();
  const { enabled, user, demo, signIn, signOut } = useAccount();
  const router = useRouter();
  if (pathname === "/onboarding") return null;
  // z-50: above everything on the page, including the week header (z-30), which sits above the workout cards for its popover.
  return (
    <header className="sticky top-0 z-50 bg-ink text-white shadow-[0_6px_20px_-12px_rgb(33_50_105/0.6)]">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 px-5 sm:px-8">
        <Link href="/" aria-label="Pivot home" className="flex items-center gap-2.5 text-white">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-white sm:h-9 sm:w-9">
            <PivotMark width={20} height={20} className="text-sky" />
          </span>
          <span className="hidden font-display text-2xl font-semibold uppercase tracking-wide sm:inline">Pivot</span>
        </Link>
        <nav className="flex items-center gap-0.5 sm:gap-1">
          {(enabled === false || user || demo) && NAV.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              className={cx(
                "whitespace-nowrap rounded-full px-2.5 py-2 text-[13px] font-medium transition-colors sm:px-3.5 sm:text-sm",
                pathname === n.href ? "bg-sky text-ink" : "text-white/75 hover:bg-white/10 hover:text-white",
              )}
            >
              {n.label}
            </Link>
          ))}
          {enabled && user !== undefined && (
            <button
              type="button"
              onClick={() => (user ? signOut() : signIn())}
              title={user?.email ?? undefined}
              className="ml-1 rounded-full border border-white/30 px-3.5 py-2 text-sm font-medium text-white/80 hover:border-white/60 hover:text-white"
            >
              {user ? "Sign out" : "Sign in"}
            </button>
          )}
        </nav>
      </div>
      {demo && !user && (
        <div className="border-t border-butter/50 bg-butter-soft text-butter-ink">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-5 py-2 text-sm sm:px-8">
            <span>
              <strong>Demo mode.</strong> Sample data in this browser only; nothing is saved.
            </span>
            <span className="flex items-center gap-3">
              {enabled && (
                <button type="button" onClick={() => signIn("/week")} className="font-semibold underline-offset-4 hover:underline">
                  Sign in to save
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  endDemo();
                  router.push("/");
                }}
                className="underline-offset-4 hover:underline"
              >
                Exit demo
              </button>
            </span>
          </div>
        </div>
      )}
    </header>
  );
}
