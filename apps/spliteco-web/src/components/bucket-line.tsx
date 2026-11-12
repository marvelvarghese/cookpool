import { bucketParts } from "@/lib/groups";

/** "Kitchen +₹120.00 · Other −₹40.00" for a Cookpool-made group; nothing otherwise. */
export function BucketLine({ myBuckets, currency, size = 13 }: { myBuckets: { kitchen: number; other: number } | null; currency: string; size?: number }) {
  const parts = bucketParts(myBuckets, currency);
  if (!parts) return null;
  return (
    <span className="dim" style={{ fontSize: size }} aria-label={parts.map((p) => `${p.label} ${p.amount}`).join(", ")}>
      {parts.map((p, i) => (
        <span key={p.label}>
          {i > 0 ? " · " : ""}
          {p.label} <b className={p.tone}>{p.amount}</b>
        </span>
      ))}
    </span>
  );
}
