"use client";

/**
 * Accounts: who is signed in, loading and saving their data, and the sign-in gate.
 *
 * When Google sign-in and the database are configured (/api/status says
 * `accounts: true`), the app runs in this order: sign in, then setup, then the
 * app. Every page except the landing page asks for sign-in first, the user's
 * saved data is loaded from the database before anything renders (a new
 * account starts empty and goes to setup), and every change is saved back. Without accounts configured, everything works as
 * before, in this browser only.
 */
import { signIn, signOut } from "next-auth/react";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useAiStatus } from "@/lib/agentClient";
import { clearDemoFlag, useDemo } from "@/lib/demo";
import { pivot, usePivotState } from "@/lib/store";
import { SignInForm } from "./SignInForm";
import { Skeleton } from "./ui";

export interface Account {
  name?: string | null;
  email?: string | null;
  image?: string | null;
}

interface AccountState {
  /** Accounts are configured on the server. Null while loading. */
  enabled: boolean | null;
  /** Undefined while loading, null when signed out. */
  user: Account | null | undefined;
  /** The user's saved data has been loaded (or there was none). */
  ready: boolean;
  /** Demo mode: sample data in this browser only, no account. */
  demo: boolean;
  /** Open the sign-in page (email/password or Google), then go to `redirectTo`. */
  signIn: (redirectTo?: string) => void;
  /** Go straight to Google sign-in. */
  signInWithGoogle: (redirectTo?: string) => void;
  signOut: () => void;
}

const Ctx = createContext<AccountState>({
  enabled: null,
  user: undefined,
  ready: false,
  demo: false,
  signIn: () => {},
  signInWithGoogle: () => {},
  signOut: () => {},
});
export const useAccount = () => useContext(Ctx);

/** Pages that need a profile; without one, a signed-in user goes to setup. */
const NEEDS_PROFILE = ["/week", "/preferences", "/form"];

const put = () =>
  fetch("/api/state", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(pivot.get()) }).catch(
    () => undefined,
  );

export function AccountProvider({ children }: { children: ReactNode }) {
  const status = useAiStatus();
  const enabled = status ? Boolean(status.accounts) : null;
  const [user, setUser] = useState<Account | null | undefined>(undefined);
  const [ready, setReady] = useState(false);
  const demo = useDemo();
  const router = useRouter();

  // Who is signed in.
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    fetch("/api/auth/session")
      .then((r) => r.json())
      .then((s) => live && setUser(s?.user ?? null))
      .catch(() => live && setUser(null));
    return () => {
      live = false;
    };
  }, [enabled]);

  // Load the account's saved data (it wins over this browser's), then save every change.
  useEffect(() => {
    if (!user) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const off = pivot.onChange(() => {
      if (!ready) return;
      clearTimeout(timer);
      timer = setTimeout(put, 1000);
    });
    if (!ready)
      fetch("/api/state")
        .then(async (r) => {
          if (r.status === 200) pivot.replaceAll(await r.json());
          // A new account starts clean: anything left in this browser (another person, old tests)
          // is cleared, so the user goes through setup with their own answers.
          else if (r.status === 204) pivot.reset();
        })
        .catch(() => undefined)
        .finally(() => live && setReady(true));
    return () => {
      live = false;
      off();
      clearTimeout(timer);
    };
  }, [user, ready]);

  const value: AccountState = {
    enabled,
    user: enabled ? user : null,
    ready: enabled === false || ready,
    demo,
    signIn: (redirectTo = "/week") => {
      router.push(`/signin?next=${encodeURIComponent(redirectTo)}`);
    },
    signInWithGoogle: (redirectTo = "/week") => {
      // Signing in leaves demo mode; the account's own data (or setup) replaces the sample.
      clearDemoFlag();
      void signIn("google", { redirectTo });
    },
    signOut: () => {
      // Clear this browser so the next person doesn't see this account's data.
      pivot.reset();
      signOut({ redirectTo: "/" });
    },
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Renders its children only once the user may use the app: signed in, in the demo, or accounts are off. */
export function SignedInOnly({ children }: { children: ReactNode }) {
  const { enabled, user, demo } = useAccount();
  return enabled === false || user || demo ? children : null;
}

/** Wraps page content: asks for sign-in, waits for saved data, and sends new users to setup. */
export function AccountGate({ children }: { children: ReactNode }) {
  const { enabled, user, ready, demo } = useAccount();
  const state = usePivotState();
  const pathname = usePathname();
  const router = useRouter();
  // Public pages: the home page, and the privacy policy and terms Google's consent screen links to.
  const open = ["/", "/privacy", "/terms", "/signin"].includes(pathname);
  const toSetup = Boolean(enabled && user && ready && state && !state.profile && NEEDS_PROFILE.includes(pathname));

  useEffect(() => {
    if (toSetup) router.replace("/onboarding");
  }, [toSetup, router]);

  if (open || enabled === false || (demo && !user)) return children;
  if (enabled === null || user === undefined || (user && !ready) || toSetup) {
    return (
      <div className="mx-auto max-w-3xl px-5 py-12" aria-busy="true">
        <Skeleton className="h-64" />
      </div>
    );
  }
  if (!user) return <SignInForm next={pathname} />;
  return children;
}
