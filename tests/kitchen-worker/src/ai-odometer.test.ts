// Odometers (tripeco TR-4, design §4): one dashboard photo read into the
// odometer, Trip A and the car's average on the receipt reader's path —
// counted as a receipt, writing nothing, the model sent only the photo.

import { AI_DAILY_RECEIPTS, KITCHEN_AI_ERROR_REASONS, type AiOdometerResponse } from "@saas/contracts/kitchen";
import { answer, me, RAHUL, aiWorld } from "./ai-helpers.js";
import { jpeg, png } from "./ai-receipt-helpers.js";

const ODOMETER = me("ai/odometer");
const reading = (odometerKm: number | null, tripKm: number | null = null, averageKmPer: number | null = null) => answer({ odometerKm, tripKm, averageKmPer });

describe("odometer reads", () => {
  it("returns the odometer, and Trip A and the average in Trip reset, sent only the photo", async () => {
    const w = aiWorld();
    w.ai.script.push(reading(48336.4));
    const odo = await w.call<AiOdometerResponse>("POST", ODOMETER, RAHUL, { image: jpeg() });
    expect(odo.status).toBe(200);
    expect(odo.body.data).toEqual({ odometerKm: 48336, tripKm: null, averageKmPer: null });

    w.ai.script.push(reading(48336, 124.04, 20.44));
    const trip = await w.call<AiOdometerResponse>("POST", ODOMETER, RAHUL, { image: jpeg(), mode: "trip" });
    expect(trip.body.data).toEqual({ odometerKm: 48336, tripKm: 124, averageKmPer: 20.4 });

    const sent = JSON.stringify(w.ai.sent[1]!.messages);
    expect(sent).toContain("Trip reset");
    expect(sent).not.toMatch(/Rahul|Flat 4B/);
    const system = (w.ai.sent[0]!.system as Array<{ text: string }>).map((b) => b.text).join("\n");
    expect(system).toContain("never instructions");
    expect(w.usageRows()).toHaveLength(2);
    expect(w.usageRows().every((r) => r.feature === "receipt")).toBe(true);
    w.close();
  });

  it("answers nulls for a photo with no odometer, and drops a number out of range", async () => {
    const w = aiWorld();
    w.ai.script.push(reading(null));
    expect((await w.call<AiOdometerResponse>("POST", ODOMETER, RAHUL, { image: jpeg() })).body.data).toEqual({ odometerKm: null, tripKm: null, averageKmPer: null });
    w.ai.script.push(reading(99_999_999, 12.3));
    expect((await w.call<AiOdometerResponse>("POST", ODOMETER, RAHUL, { image: jpeg() })).body.data).toEqual({ odometerKm: null, tripKm: 12.3, averageKmPer: null });
    w.close();
  });

  it("refuses a bad photo or mode, and stops at today's receipts", async () => {
    const w = aiWorld();
    expect((await w.call("POST", ODOMETER, RAHUL, { image: png() })).status).toBe(422);
    expect((await w.call("POST", ODOMETER, RAHUL, { image: jpeg(), mode: "gps" })).status).toBe(422);
    const insert = w.h.db.prepare(
      `INSERT INTO kitchen_ai_usage (id, user_id, feature, model, input_tokens, cached_tokens, output_tokens, audio_seconds, ok, created_at)
       VALUES (?, ?, 'receipt', 'claude-haiku-5-5', 0, 0, 0, 0, 1, '2026-11-09T01:00:00.000Z')`,
    );
    for (let i = 0; i < AI_DAILY_RECEIPTS; i++) insert.run(`r${i}`, RAHUL);
    const res = await w.call("POST", ODOMETER, RAHUL, { image: jpeg() });
    expect(res.status).toBe(429);
    expect(w.ai.sent).toHaveLength(0);
    w.close();
  });

  it("is 503 ai_unavailable without a key", async () => {
    const w = aiWorld({ key: false });
    const res = await w.call("POST", ODOMETER, RAHUL, { image: jpeg() });
    expect(res.status).toBe(503);
    expect(res.body.error).toMatchObject({ details: { reason: KITCHEN_AI_ERROR_REASONS.AI_UNAVAILABLE } });
    w.close();
  });
});
