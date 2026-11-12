import Link from "next/link";

export default function NotFound() {
  return (
    <div className="app">
      <main className="page" style={{ minHeight: "100dvh", justifyContent: "center" }}>
        <h1 className="h1">Nothing here</h1>
        <p className="muted">That page doesn&apos;t exist in Spliteco.</p>
        <Link href="/" className="btn big">Go home</Link>
      </main>
    </div>
  );
}
