import Link from "next/link";

export default function NotFound() {
  return (
    <div className="app">
      <main className="page" style={{ minHeight: "100dvh", justifyContent: "center" }}>
        <h1 className="h1">Nothing here</h1>
        <Link href="/" className="btn">Home</Link>
      </main>
    </div>
  );
}
