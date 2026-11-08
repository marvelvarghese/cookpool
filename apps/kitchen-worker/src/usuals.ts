// Usuals by time of day (PN-2, cookpool-pantry design §2.1): the `tzOffset`
// parameter, the bucket a read asks the repository for, and a usual's `now`
// and `strip` from what the repository found in that bucket.
//
// The last-use fields keep their 90 days (USUALS_DAYS), so every usual a
// caller had before PN-2 is still there; a bucket usual looks back
// USUALS_NOW_DAYS (60), as the design says.

import {
  TZ_OFFSET_MAX,
  TZ_OFFSET_MIN,
  USUALS_NOW_DAYS,
  USUAL_BUCKET_HOURS,
  USUAL_NOW_MIN_USES,
  USUAL_STRIP_MIN_USES,
  isTzOffset,
  usualBucketAt,
  type UsualBucket,
  type UsualNow,
} from "@saas/contracts/kitchen-usuals";
import type { KitchenItemRecord, KitchenUsualRecord, KitchenUsualsBucketQuery } from "@saas/db/kitchen";
import { isUnit } from "@saas/kitchen-engine/units";
import { displayQuantity } from "./pantry.js";
import type { Fields } from "./validate.js";

const DAY_MS = 86_400_000;

/** `?tzOffset=`: whole minutes east of UTC, TZ_OFFSET_MIN…TZ_OFFSET_MAX; absent or empty, 0. */
export function tzOffsetParam(fields: Fields, url: URL): number {
  const raw = url.searchParams.get("tzOffset");
  if (raw === null || raw === "") return 0;
  const n = Number(raw);
  if (/^-?\d{1,4}$/.test(raw) && isTzOffset(n)) return n === 0 ? 0 : n;
  fields.add("tzOffset", `Must be a whole number of minutes from ${TZ_OFFSET_MIN} to ${TZ_OFFSET_MAX}`);
  return 0;
}

/** The current bucket at `tzOffset`, and what the repository reads for it. */
export function usualsBucket(now: Date, tzOffset: number): { bucket: UsualBucket; query: KitchenUsualsBucketQuery } {
  const bucket = usualBucketAt(now, tzOffset);
  return {
    bucket,
    query: { hours: USUAL_BUCKET_HOURS[bucket], tzOffsetMinutes: tzOffset, since: new Date(now.getTime() - USUALS_NOW_DAYS * DAY_MS) },
  };
}

/**
 * A usual's `now` (USUAL_NOW_MIN_USES uses of its food in the bucket: the
 * most frequent amount, as it was last logged) and `strip` (USUAL_STRIP_MIN_USES).
 */
export function usualNow(
  record: KitchenUsualRecord,
  bucket: UsualBucket,
  item: KitchenItemRecord,
  actor: string,
): { now: UsualNow | null; strip: boolean } {
  const found = record.bucket;
  if (!found || found.count < USUAL_NOW_MIN_USES) return { now: null, strip: false };
  const unit = found.unit && isUnit(found.unit) ? found.unit : item.displayUnit;
  return {
    now: {
      bucket,
      qtyMilli: found.qtyMilli,
      quantity: displayQuantity(found.qtyMilli, unit),
      unit,
      label: found.label,
      consumerIds: found.consumers ?? [actor],
      count: found.count,
    },
    strip: found.count >= USUAL_STRIP_MIN_USES,
  };
}
