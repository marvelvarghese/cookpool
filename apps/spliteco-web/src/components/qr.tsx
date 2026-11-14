"use client";

import * as React from "react";
import { qrPath } from "../lib/qr";

/** A real, scannable QR code: dark modules on white, with the quiet zone the standard asks for. */
export function QrCode({ text, size = 104, label }: { text: string; size?: number; label: string }) {
  const { size: n, d } = React.useMemo(() => qrPath(text), [text]);
  const quiet = 2;
  return (
    <svg role="img" aria-label={label} width={size} height={size} viewBox={`${-quiet} ${-quiet} ${n + quiet * 2} ${n + quiet * 2}`} shapeRendering="crispEdges" style={{ background: "#ffffff", borderRadius: 12, flex: "none" }}>
      <path d={d} fill="#08111f" />
    </svg>
  );
}
