"use client";

import * as React from "react";
import { useSearchParams } from "next/navigation";
import type { OAuthProviderInfo } from "@saas/contracts/auth";
import { cn } from "@/lib/cn";
import { wrap } from "@/lib/api";
import { appConfig } from "@/lib/app-config";
import { useSession } from "@/lib/session";
import { loginPathFor, safeNextPath } from "@/lib/safe-next";
import { rememberLoginNext, rememberOAuthProvider } from "@/lib/login-return";
import { typedEmail } from "@/lib/remembered-account";
import { KITCHEN_NEW_LOOK_CLASS, KITCHEN_THEME_CLASSES } from "@/components/kitchen/theme";
import { useKitchenBodyTheme } from "@/components/kitchen/theme-scope";
import { DEFAULT_HEADLINE, oauthReturnTo, offersGoogle } from "@/components/kitchen/sign-in";
import { helpItems, privacyMailHref, writeToUsHref } from "@/components/kitchen/sign-in-screens";
import { PitchPanel } from "@/components/kitchen/sign-in-ui";
import { HelpScreen } from "@/components/kitchen/sign-in-help-ui";
import { useSignInNewLook } from "@/components/kitchen/sign-in-screens-ui";

/**
 * Can't sign in? (Cookpool PK-3, cookpool-passkeys design §3): a static page
 * at `/login/help`, reached from Sign in and the code screen. It carries the
 * sign-in's safe `next` there and back, and reads only what this tab typed on
 * the sign-in page: it asks the API nothing about any address, so it never
 * says whether an email has an account. Google is offered when the API lists
 * it, as on Sign in.
 */
export default function LoginHelpPage() {
  return (
    <React.Suspense fallback={<Help rawNext={null} />}>
      <HelpWithQuery />
    </React.Suspense>
  );
}

function HelpWithQuery() {
  return <Help rawNext={useSearchParams().get("next")} />;
}

function Help({ rawNext }: { rawNext: string | null }) {
  // RV-6: dark follows the device where the new frame is on, as on Sign in.
  const newLook = useSignInNewLook();
  useKitchenBodyTheme(newLook);
  const { client, target, token } = useSession();
  const clientRef = React.useRef(client);
  clientRef.current = client;

  const [providers, setProviders] = React.useState<OAuthProviderInfo[]>([]);
  React.useEffect(() => {
    let cancelled = false;
    void wrap(() => clientRef.current.auth.listOAuthProviders()).then((r) => {
      if (!cancelled && r.ok) setProviders(r.data.providers);
    });
    return () => {
      cancelled = true;
    };
  }, [target.url]);

  const [typed, setTyped] = React.useState<string | null>(null);
  const [contact, setContact] = React.useState("");
  React.useEffect(() => {
    setTyped(typedEmail());
    setContact(appConfig().supportEmail);
  }, []);

  const [leaving, setLeaving] = React.useState(false);
  const startGoogle = () => {
    setLeaving(true);
    rememberLoginNext(rawNext);
    rememberOAuthProvider("google");
    window.location.href = client.auth.oauthStartUrl("google", oauthReturnTo(window.location.origin, rawNext));
  };

  const signInHref = loginPathFor(rawNext);
  // RV-18: You's Help rows open this page signed in (`?next=/you`); there Back
  // returns to `next` rather than to the sign-in page. Read after mount (the
  // page is a prerendered file), so the first render matches it.
  const [signedIn, setSignedIn] = React.useState(false);
  React.useEffect(() => setSignedIn(!!token), [token]);
  const backHref = signedIn ? (safeNextPath(rawNext) ?? "/home") : signInHref;
  return (
    <div className={cn(...KITCHEN_THEME_CLASSES, newLook && KITCHEN_NEW_LOOK_CLASS, "min-h-dvh bg-background text-foreground min-[900px]:flex")}>
      <PitchPanel title={DEFAULT_HEADLINE} className="hidden min-[900px]:flex" />
      <main
        className={cn(
          "flex justify-center px-5 pb-[calc(env(safe-area-inset-bottom)+1.75rem)] pt-[calc(env(safe-area-inset-top)+1rem)]",
          "min-[900px]:flex-[1_1_420px] min-[900px]:items-center min-[900px]:px-6 min-[900px]:py-10",
        )}
      >
        <div className="w-full max-w-md min-[900px]:max-w-[26rem]">
          <HelpScreen
            items={helpItems({ typedEmail: typed, googleOffered: offersGoogle(providers), supportEmail: contact })}
            backHref={backHref}
            signInHref={signInHref}
            writeHref={writeToUsHref(contact)}
            onGoogle={startGoogle}
            googleBusy={leaving}
            privacyWriteHref={privacyMailHref(contact)}
          />
        </div>
      </main>
    </div>
  );
}
