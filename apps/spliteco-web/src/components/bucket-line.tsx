import { BucketLine as SharedBucketLine } from "@saas/spliteco-ui/components";

/** "Kitchen +₹120.00 · Other −₹40.00" for a Cookpool-made group; nothing otherwise (packages/spliteco-ui, in Deep ocean). */
export function BucketLine({ myBuckets, currency, size = 13 }: { myBuckets: { kitchen: number; other: number } | null; currency: string; size?: number }) {
  return <SharedBucketLine myBuckets={myBuckets} currency={currency} style={{ fontSize: size }} />;
}
