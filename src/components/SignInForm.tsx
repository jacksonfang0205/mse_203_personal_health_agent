"use client";

/** Sign in or create an account with email and password, or continue with Google. */
import { signIn } from "next-auth/react";
import { useState, useSyncExternalStore } from "react";
import { clearDemoFlag } from "@/lib/demo";
import { PivotMark } from "./icons";
import { Button, cx } from "./ui";

const ERRORS: Record<string, string> = {
  CredentialsSignin: "Wrong email or password.",
  OAuthAccountNotLinked:
    "This email already has a Pivot password. Sign in with your password; you can connect Google later for calendar import.",
  AccessDenied: "Sign-in was cancelled.",
};

const noop = () => () => {};
const readSearch = () => window.location.search;

export function SignInForm({ next: nextProp }: { next?: string }) {
  const search = useSyncExternalStore(noop, readSearch, () => "");
  const params = new URLSearchParams(search);
  const next = nextProp ?? (params.get("next") || params.get("callbackUrl") || "/week");
  const urlError = params.get("error");

  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const shownError = error ?? (urlError ? ERRORS[urlError] ?? "Sign-in didn't work. Please try again." : null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      if (mode === "signup") {
        const r = await fetch("/api/signup", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ email, password, name: name || undefined }),
        });
        const data = await r.json().catch(() => ({}));
        if (!r.ok) {
          setError(data.error ?? "Couldn't create your account.");
          return;
        }
      }
      const res = await signIn("credentials", { email, password, redirect: false });
      if (!res || res.error) {
        setError(ERRORS.CredentialsSignin);
        return;
      }
      clearDemoFlag();
      // A full load so the app picks up the new session and loads (or starts) this account's data.
      window.location.assign(next);
    } finally {
      setBusy(false);
    }
  };

  const input =
    "h-11 w-full rounded-xl border border-line-strong bg-card px-4 text-sm placeholder:text-ink-faint focus:border-ink focus:outline-none";

  return (
    <div className="mx-auto flex w-full max-w-sm flex-col gap-5 px-5 py-16">
      <div className="flex flex-col items-center gap-3 text-center">
        <PivotMark width={40} height={40} className="text-coral" />
        <h1 className="font-display text-3xl font-medium tracking-tight">
          {mode === "signin" ? "Sign in to Pivot" : "Create your account"}
        </h1>
      </div>

      <div className="grid grid-cols-2 rounded-full bg-ink/5 p-1 text-sm font-medium">
        {(["signin", "signup"] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => {
              setMode(m);
              setError(null);
            }}
            className={cx("rounded-full py-1.5", mode === m ? "bg-card text-ink shadow-sm" : "text-ink-soft")}
          >
            {m === "signin" ? "Sign in" : "Create account"}
          </button>
        ))}
      </div>

      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        {mode === "signup" && (
          <input className={input} placeholder="Name (optional)" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />
        )}
        <input
          className={input}
          type="email"
          required
          placeholder="Email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <input
          className={input}
          type="password"
          required
          minLength={mode === "signup" ? 8 : undefined}
          placeholder={mode === "signup" ? "Password (at least 8 characters)" : "Password"}
          autoComplete={mode === "signup" ? "new-password" : "current-password"}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {shownError && (
          <p role="alert" className="text-sm font-medium text-coral-deep">
            {shownError}
          </p>
        )}
        <Button type="submit" disabled={busy} className="h-11">
          {busy ? "One moment…" : mode === "signin" ? "Sign in" : "Create account"}
        </Button>
      </form>

      <div className="flex items-center gap-3 text-xs text-ink-faint">
        <span className="h-px flex-1 bg-line" /> or <span className="h-px flex-1 bg-line" />
      </div>
      <Button
        variant="secondary"
        className="h-11"
        onClick={() => {
          clearDemoFlag();
          void signIn("google", { redirectTo: next });
        }}
      >
        Continue with Google
      </Button>
    </div>
  );
}
