"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icons";
import { Avatar, Screen, Sheet } from "@/components/ui";
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

  const soon = (label: string, note: string) => (
    <div className="row-between soon" style={{ minHeight: 52, borderBottom: "1px solid var(--line-soft)" }} aria-disabled="true">
      <span className="stack" style={{ gap: 1 }}>
        <span style={{ fontSize: 15, fontWeight: 600 }}>{label}</span>
        <span className="small dim">{note}</span>
      </span>
      <span className="small dim">Coming soon</span>
    </div>
  );

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
        {soon("AI assistants", "Let Claude or ChatGPT log splits for you")}
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
        {soon("UPI ID", "Get paid by UPI from Settle up")}
        {soon("Reminders", "Nudge a friend at most once a day")}
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
