"use client";

import { SecurityScreen } from "@/components/kitchen/passkey-security-ui";

/**
 * You → Sign-in and security (cookpool-passkeys PK-4, `PasskeyManage`): your
 * passkeys, adding one on this device, and the other ways in. In every frame
 * (sign-in is shared): You's row opens it in today's frame, Settings' in the
 * new one.
 */
export default function SecurityPage() {
  return <SecurityScreen />;
}
