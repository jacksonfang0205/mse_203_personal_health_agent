import Link from "next/link";
import type { ButtonHTMLAttributes, ReactNode } from "react";

export function cx(...classes: (string | false | null | undefined)[]) {
  return classes.filter(Boolean).join(" ");
}

type Variant = "primary" | "secondary" | "ghost" | "dark";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-coral text-white hover:bg-coral-deep shadow-[0_6px_16px_-8px_rgb(238_93_59/0.7)]",
  dark: "bg-ink text-paper hover:bg-ink/85",
  secondary: "bg-card text-ink border border-line-strong hover:border-ink/40",
  ghost: "text-ink-soft hover:text-ink hover:bg-ink/5",
};

const BUTTON =
  "inline-flex items-center justify-center gap-2 rounded-full px-5 h-11 text-sm font-semibold transition-all duration-200 active:scale-[0.98] disabled:opacity-40 disabled:pointer-events-none";

export function Button({
  variant = "primary",
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return <button type="button" className={cx(BUTTON, VARIANTS[variant], className)} {...props} />;
}

export function ButtonLink({
  href,
  variant = "primary",
  className,
  children,
}: {
  href: string;
  variant?: Variant;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Link href={href} className={cx(BUTTON, VARIANTS[variant], className)}>
      {children}
    </Link>
  );
}

/** Toggleable pill used across onboarding and preferences. */
export function Chip({
  selected,
  onClick,
  children,
  className,
}: {
  selected: boolean;
  onClick: () => void;
  children: ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={cx(
        "inline-flex items-center gap-1.5 rounded-full border px-4 py-2 text-sm font-medium transition-all duration-150",
        selected
          ? "border-ink bg-ink text-paper"
          : "border-line-strong bg-card text-ink-soft hover:border-ink/50 hover:text-ink",
        className,
      )}
    >
      {children}
    </button>
  );
}

/** Larger selectable card with a title and blurb. */
export function OptionCard({
  selected,
  onClick,
  title,
  blurb,
}: {
  selected: boolean;
  onClick: () => void;
  title: string;
  blurb: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={cx(
        "flex flex-col items-start gap-1 rounded-2xl border p-4 text-left transition-all duration-150",
        selected
          ? "border-ink bg-ink text-paper shadow-lift"
          : "border-line-strong bg-card hover:-translate-y-0.5 hover:border-ink/40",
      )}
    >
      <span className="font-semibold">{title}</span>
      <span className={cx("text-sm", selected ? "text-paper/70" : "text-ink-soft")}>{blurb}</span>
    </button>
  );
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cx("rounded-[var(--radius-card)] border border-line bg-card shadow-card", className)}>{children}</div>;
}

export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cx("text-xs font-semibold uppercase tracking-[0.14em] text-ink-faint", className)}>{children}</p>;
}

/** Makes clear that content is sample data, not AI output. */
export function MockBadge({ children = "Sample data" }: { children?: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-ink-faint/60 bg-paper-deep px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider text-ink-soft">
      <span className="h-1.5 w-1.5 rounded-full bg-butter" />
      {children}
    </span>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx("animate-pulse rounded-2xl bg-paper-deep", className)} />;
}
