// A QR code for the live split's join address, from qrcode-generator (MIT,
// no dependencies): the dark modules as one SVG path, error correction M.

import qrcode from "qrcode-generator";

export function qrPath(text: string): { size: number; d: string } {
  const q = qrcode(0, "M");
  q.addData(text);
  q.make();
  const n = q.getModuleCount();
  let d = "";
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) if (q.isDark(r, c)) d += `M${c} ${r}h1v1h-1z`;
  }
  return { size: n, d };
}
