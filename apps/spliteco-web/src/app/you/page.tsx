"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icons";
import { Avatar, Screen, Sheet, useLoad } from "@/components/ui";
import { isUpiVpa } from "@saas/contracts/spliteco";
import { applyTheme, readTheme, type ThemeChoice } from "@/lib/theme";
import { errorText, useSession } from "@/lib/session";
import { useMe } from "@/lib/me";

export default function YouPage() {
  const { client, signOut } = useSession();
  const { me, setMe } = useMe();
  const router = useRouter();
  const [theme, setTheme] = React.useState<ThemeChoice>("dark");
  const [editing, setEditing] = React.useState(false);
  const [name, setName] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => setTheme(readTheme()), []);
  // SE2: your UPI ID, where people who share a group with you pay you.
  const profile = useLoad((c) => c.spliteco.profile(), []);
  const [upiOpen, setUpiOpen] = React.useState(false);
  const [upiText, setUpiText] = React.useState("");
  const upiTyped = upiText.trim();
  const upiValid = upiTyped === "" || isUpiVpa(upiTyped);

  async function saveUpi(e: React.FormEvent) {
    e.preventDefault();
    if (!upiValid) return;
    setBusy(true);
    setError(null);
    try {
      await client.spliteco.setProfile({ upiVpa: upiTyped || null });
      setUpiOpen(false);
      profile.reload();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }
  const myUpi = profile.data?.profile.upiVpa ?? null;

  const display = me?.displayName?.trim() || me?.email.split("@")[0] || "You";

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await client.auth.updateProfile({ displayName: name.trim() || null });
      setMe(r.user);
      setEditing(false);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <header className="hdr"><h1 className="h1">You</h1></header>
      <section className="panel" style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
        {me ? <Avatar id={me.id} name={display} me={me.id} size={56} /> : null}
        <div className="stack" style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <span style={{ fontSize: 18, fontWeight: 800 }} className="ellipsis">{display}</span>
          <span className="small dim ellipsis">{me?.email ?? ""}</span>
          <span className="small dim">Same account as Cookpool</span>
        </div>
        <button
          className="iconbtn"
          aria-label="Edit profile"
          onClick={() => {
            setName(me?.displayName ?? "");
            setEditing(true);
          }}
        >
          <Icon name="edit" />
        </button>
      </section>

      <section aria-label="Connected apps" className="stack s4">
        <h2 className="eyebrow">Connected apps</h2>
        <Link href="/groups" className="lrow">
          <span className="cat" style={{ background: "rgba(76,201,138,0.14)", color: "#4CC98A" }}><Icon name="cookpool" /></span>
          <span className="main">
            <span className="title">Cookpool</span>
            <span className="sub">Connected · every kitchen you&apos;re in is a group here</span>
          </span>
          <Icon name="chevron" />
        </Link>
        <Link href="/you/assistants" className="lrow">
          <span className="cat" style={{ background: "var(--cobalt-soft)", color: "var(--text)" }}><Icon name="sparkle" /></span>
          <span className="main">
            <span className="title">AI assistants</span>
            <span className="sub">Let Claude, ChatGPT or Gemini log splits for you</span>
          </span>
          <Icon name="chevron" />
        </Link>
      </section>

      <section aria-label="Preferences" className="stack s4">
        <h2 className="eyebrow">Preferences</h2>
        <div className="row-between" style={{ minHeight: 52 }}>
          <span style={{ fontSize: 15, fontWeight: 600 }} id="theme-label">Theme</span>
          <div role="radiogroup" aria-labelledby="theme-label" className="seg" style={{ width: 210 }}>
            {(["dark", "light", "auto"] as const).map((t) => (
              <button
                key={t}
                role="radio"
                aria-checked={theme === t}
                onClick={() => {
                  setTheme(t);
                  applyTheme(t);
                }}
                style={{ height: 38 }}
              >
                {t === "dark" ? "Dark" : t === "light" ? "Light" : "Auto"}
              </button>
            ))}
          </div>
        </div>
        <button
          className="row-between"
          style={{ minHeight: 52, borderBottom: "1px solid var(--line-soft)", background: "transparent", border: 0, color: "inherit", padding: 0, textAlign: "left", width: "100%" }}
          onClick={() => {
            setUpiText(myUpi ?? "");
            setError(null);
            setUpiOpen(true);
          }}
          aria-label={myUpi ? `UPI ID ${myUpi}, change it` : "Add your UPI ID"}
        >
          <span className="stack" style={{ gap: 1 }}>
            <span style={{ fontSize: 15, fontWeight: 600 }}>UPI ID</span>
            <span className="small dim">{myUpi ? `Receive at ${myUpi}` : "Add one so friends can pay you by UPI"}</span>
          </span>
          <span className="small" style={{ color: "var(--link)", fontWeight: 600 }}>{myUpi ? "Change" : "Add"}</span>
        </button>
        <div className="row-between" style={{ minHeight: 52, borderBottom: "1px solid var(--line-soft)" }}>
          <span className="stack" style={{ gap: 1 }}>
            <span style={{ fontSize: 15, fontWeight: 600 }}>Reminders</span>
            <span className="small dim">Friends can nudge you at most once a day, by email</span>
          </span>
        </div>
      </section>

      <section aria-label="Your data" className="stack s4">
        <h2 className="eyebrow">Your data</h2>
        <p className="note">Export any group as CSV or JSON from the group&apos;s Share button.</p>
      </section>

      <button
        className="btn danger big"
        onClick={async () => {
          await signOut();
          router.replace("/sign-in");
        }}
      >
        Sign out
      </button>

      {upiOpen ? (
        <Sheet label="Your UPI ID" onClose={() => setUpiOpen(false)}>
          <form className="stack s14" onSubmit={saveUpi}>
            <h2 className="h1" style={{ fontSize: 22 }}>Your UPI ID</h2>
            <label className="stack s8">
              <span className="small muted bold">Like name@okaxis or 98100xxxxx@ybl</span>
              <input
                className="input"
                inputMode="email"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                maxLength={100}
                value={upiText}
                onChange={(e) => setUpiText(e.target.value)}
                aria-invalid={!upiValid}
                autoFocus
              />
            </label>
            {!upiValid ? <p className="error" role="alert">That doesn&apos;t look like a UPI ID (name@bank).</p> : null}
            <p className="note">Only people who share a group with you see it, when they pay you. Leave it empty to remove it.</p>
            {error ? <p className="error" role="alert">{error}</p> : null}
            <button className="btn big" type="submit" disabled={busy || !upiValid}>{busy ? "Saving…" : "Save"}</button>
          </form>
        </Sheet>
      ) : null}

      {editing ? (
        <Sheet label="Edit profile" onClose={() => setEditing(false)}>
          <form className="stack s14" onSubmit={save}>
            <h2 className="h1" style={{ fontSize: 22 }}>Your name</h2>
            <label className="stack s8">
              <span className="small muted bold">What friends see</span>
              <input className="input" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} autoFocus />
            </label>
            <p className="note">It&apos;s the same name in Cookpool.</p>
            {error ? <p className="error" role="alert">{error}</p> : null}
            <button className="btn big" type="submit" disabled={busy}>{busy ? "Saving…" : "Save"}</button>
          </form>
        </Sheet>
      ) : null}
    </Screen>
  );
}
