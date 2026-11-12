// Stroke icons as on the canvas (24×24, round caps). Decorative: every one is
// aria-hidden, and the button or link around it carries the label.

import * as React from "react";

const PATHS: Record<string, React.ReactNode> = {
  home: <path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" />,
  groups: (
    <>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5" />
      <path d="M16 4.8a3.5 3.5 0 0 1 0 6.4M18 14.8c1.9.7 3.1 2.4 3.5 5.2" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  activity: <path d="M3 12h4l3-7 4 14 3-7h4" />,
  you: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c1-4 4.2-6 8-6s7 2 8 6" />
    </>
  ),
  back: <path d="M15 5l-7 7 7 7" />,
  close: <path d="M6 6l12 12M18 6 6 18" />,
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m20 20-4.2-4.2" />
    </>
  ),
  bell: (
    <>
      <path d="M6 16v-5a6 6 0 1 1 12 0v5l1.5 2h-15z" />
      <path d="M10 20.5a2 2 0 0 0 4 0" />
    </>
  ),
  pie: (
    <>
      <path d="M12 3a9 9 0 1 0 9 9h-9z" />
      <path d="M15 3.5A9 9 0 0 1 20.5 9H15z" />
    </>
  ),
  list: <path d="M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01" />,
  share: (
    <>
      <path d="M12 3v12M7 8l5-5 5 5" />
      <path d="M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6" />
    </>
  ),
  move: <path d="M4 12h14M13 6l6 6-6 6" />,
  edit: <path d="M4 20h4L19 9l-4-4L4 16zM14 6l4 4" />,
  trash: <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" />,
  check: <path d="m5 12 5 5 9-10" />,
  invite: (
    <>
      <circle cx="10" cy="8" r="3.5" />
      <path d="M3.5 20c.8-3.6 3.4-5.5 6.5-5.5 1.4 0 2.6.4 3.6 1M18 14v6M15 17h6" />
    </>
  ),
  key: (
    <>
      <circle cx="8" cy="15" r="4" />
      <path d="m11 12 9-9M16 7l3 3" />
    </>
  ),
  calendar: (
    <>
      <rect x="4" y="5" width="16" height="16" rx="3" />
      <path d="M4 10h16M9 3v4M15 3v4" />
    </>
  ),
  noteIcon: <path d="M5 4h14v12l-4 4H5zM15 20v-4h4M8 9h8M8 13h5" />,
  sparkle: <path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6" />,
  chevron: <path d="m9 6 6 6-6 6" />,
  down: <path d="m6 9 6 6 6-6" />,
  more: (
    <>
      <circle cx="5" cy="12" r="1.2" />
      <circle cx="12" cy="12" r="1.2" />
      <circle cx="19" cy="12" r="1.2" />
    </>
  ),
  swap: <path d="M4 8h13l-3-3M20 16H7l3 3" />,
  lock: (
    <>
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </>
  ),
  send: <path d="M4 12 20 4l-6 16-3-7z" />,
  food: <path d="M7 3v8a2 2 0 0 0 2 2v8M11 3v8M7 7h4M16 21V3c2 1 3 4 3 7h-3" />,
  groceries: <path d="M3 4h2l2 12h11l2-8H6M9 20.5h.01M17 20.5h.01" />,
  stay: <path d="M3 18V8M3 14h18v4M21 14v-3a3 3 0 0 0-3-3h-7v6M7 11.5h.01" />,
  transport: <path d="M5 16V9l2-4h10l2 4v7zM5 16v3M19 16v3M5 11h14M8 13.5h.01M16 13.5h.01" />,
  shopping: <path d="M6 7h12l-1 14H7zM9 7a3 3 0 0 1 6 0" />,
  entertainment: <path d="M4 6h16v12H4zM9 9l6 3-6 3z" />,
  bills: <path d="M6 3h12v18l-2-1.4-2 1.4-2-1.4-2 1.4-2-1.4L6 21zM9 8h6M9 12h6M9 16h3" />,
  other: <circle cx="12" cy="12" r="3" />,
  cookpool: <path d="M4 11h16l-1.5 8a2 2 0 0 1-2 1.6h-9A2 2 0 0 1 5.5 19zM8 11V8a4 4 0 0 1 8 0v3" />,
  payment: <path d="M4 8h13l-3-3M20 16H7l3 3" />,
  trip: <path d="M5 8h14v12H5zM9 8V5h6v3M9 12v5M15 12v5" />,
  kitchen: <path d="M4 11h16l-1.5 8a2 2 0 0 1-2 1.6h-9A2 2 0 0 1 5.5 19zM8 11V8a4 4 0 0 1 8 0v3" />,
  couple: <path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z" />,
  download: <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />,
  copy: (
    <>
      <rect x="8" y="8" width="12" height="12" rx="2" />
      <path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3" />
    </>
  ),
};

export function Icon({ name, size = 20, stroke = 1.9, color }: { name: string; size?: number; stroke?: number; color?: string }) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color ?? "currentColor"}
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {PATHS[name] ?? PATHS.other}
    </svg>
  );
}

/** The Spliteco mark: a ring and a gold disc, overlapping. */
export function Mark({ size = 32 }: { size?: number }) {
  const d = Math.round(size * 0.69);
  return (
    <div aria-hidden="true" style={{ width: size, height: size, position: "relative", flex: "none" }}>
      <div style={{ position: "absolute", left: 0, top: size / 8, width: d, height: d, borderRadius: "50%", border: "2.5px solid #93C5FD" }} />
      <div style={{ position: "absolute", right: 0, top: size / 8, width: d, height: d, borderRadius: "50%", background: "#FFC857", opacity: 0.92 }} />
    </div>
  );
}
