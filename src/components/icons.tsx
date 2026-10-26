import type { SVGProps } from "react";
import type { WorkoutCategory } from "@/lib/schemas";

type IconProps = SVGProps<SVGSVGElement>;

const base = (props: IconProps) => ({
  width: 18,
  height: 18,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
  ...props,
});

export const PivotMark = (p: IconProps) => (
  <svg {...base(p)} viewBox="0 0 32 32" strokeWidth={2.6}>
    <path d="M6 22c0-8 5-13 13-13h5" />
    <path d="m20 4 5 5-5 5" />
    <circle cx="8" cy="25" r="2.4" fill="currentColor" stroke="none" />
  </svg>
);

export const Sparkle = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6" />
  </svg>
);

export const Check = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="m5 12.5 4.5 4.5L19 7.5" />
  </svg>
);

export const SkipIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M6 6l12 12M18 6 6 18" />
  </svg>
);

export const Clock = (p: IconProps) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5V12l3 2" />
  </svg>
);

export const ArrowRight = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M5 12h14M13 6l6 6-6 6" />
  </svg>
);

export const ArrowLeft = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M19 12H5M11 6l-6 6 6 6" />
  </svg>
);

export const Shield = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M12 3 5 6v5c0 4.5 3 8 7 10 4-2 7-5.5 7-10V6l-7-3Z" />
    <path d="m9 12 2 2 4-4" />
  </svg>
);

export const CalendarIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <rect x="4" y="5" width="16" height="15" rx="2.5" />
    <path d="M4 10h16M9 3v4M15 3v4" />
  </svg>
);

const Dumbbell = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M6.5 7v10M17.5 7v10M3.5 9.5v5M20.5 9.5v5M6.5 12h11" />
  </svg>
);
const Shoe = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M3 16.5h17a1 1 0 0 0 1-1c0-1.6-1.3-2.6-3-3l-4-1-2-4H8l-.5 2L4 8.5c-.6 0-1 .4-1 1v7Z" />
    <path d="M3 19.5h18" />
  </svg>
);
const Flame = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M12 21c3.6 0 6-2.4 6-5.6 0-4-3.3-5.6-4-9.4-2 1.2-3.4 3.3-3.4 5.5-1-.5-1.6-1.6-1.8-2.6C7.2 10.2 6 12.3 6 15.4 6 18.6 8.4 21 12 21Z" />
  </svg>
);
const Ring = (p: IconProps) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="7.5" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);
const Leaf = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M5 19c0-8 5-14 14-14 0 9-6 14-14 14Z" />
    <path d="M5 19 13 11" />
  </svg>
);
const Wave = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M3 12c2-3 4-3 6 0s4 3 6 0 4-3 6 0" />
    <path d="M3 17c2-3 4-3 6 0s4 3 6 0 4-3 6 0" opacity={0.5} />
  </svg>
);

export const CategoryIcon = ({ category, ...p }: IconProps & { category: WorkoutCategory }) => {
  const Icon = { strength: Dumbbell, cardio: Shoe, hiit: Flame, pilates: Ring, yoga: Leaf, mobility: Wave }[category];
  return <Icon {...p} />;
};
