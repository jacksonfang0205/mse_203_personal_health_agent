"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
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
  const { enabled, user, signIn, signOut } = useAccount();
  if (pathname === "/onboarding") return null;
  return (
    <header className="sticky top-0 z-30 border-b border-line/70 bg-paper/85 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5 sm:px-8">
        <Link href="/" className="flex items-center gap-2 text-ink">
          <PivotMark width={26} height={26} className="text-coral" />
          <span className="font-display text-2xl font-semibold italic tracking-tight">Pivot</span>
        </Link>
        <nav className="flex items-center gap-1">
          {(enabled === false || user) && NAV.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              className={cx(
                "rounded-full px-3.5 py-2 text-sm font-medium transition-colors",
                pathname === n.href ? "bg-ink text-paper" : "text-ink-soft hover:bg-ink/5 hover:text-ink",
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
              className="ml-1 rounded-full border border-line-strong px-3.5 py-2 text-sm font-medium text-ink-soft hover:text-ink"
            >
              {user ? "Sign out" : "Sign in"}
            </button>
          )}
        </nav>
      </div>
    </header>
  );
}
