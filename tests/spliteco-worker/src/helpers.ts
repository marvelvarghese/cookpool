import type { SplitecoExpenseRequest, SplitecoWriteResponse } from "@saas/contracts/spliteco";
import { createHarness, envelope, usr, type Group, type Harness, type HarnessOptions } from "./harness.js";

export const ME = usr(1);
export const ANU = usr(2);
export const DEV = usr(3);
export const MEERA = usr(4);
export const OUTSIDER = usr(9);

export interface World {
  h: Harness;
  flat: Group; // a Cookpool kitchen: me, Anu, Dev
  goa: Group; // a Spliteco trip: me, Anu, Dev, Meera
}

export function world(options: HarnessOptions = {}): World {
  const h = createHarness(options);
  const flat = h.group("Flat 4B");
  const goa = h.group("Goa Trip", { madeIn: "spliteco", kind: "trip" });
  for (const id of [ME, ANU, DEV]) h.grant(id, flat, id === ME ? "owner" : "builder");
  for (const id of [ME, ANU, DEV, MEERA]) h.grant(id, goa, id === ME ? "owner" : "builder");
  h.profile(ME, { displayName: "You", email: "you@spliteco.test" });
  h.profile(ANU, { displayName: "Anu", email: "anu@spliteco.test" });
  h.profile(DEV, { displayName: "Dev", email: "dev@spliteco.test" });
  h.profile(MEERA, { displayName: "Meera", email: "meera@spliteco.test" });
  return { h, flat, goa };
}

let keys = 0;
export const key = (): string => `ikey_test_${++keys}_${Date.now()}`;

export function equal(totalMinor: number, payer: string, people: string[], extra: Partial<SplitecoExpenseRequest> = {}): SplitecoExpenseRequest {
  return {
    title: "Dinner",
    totalMinor,
    category: "food",
    payers: [{ subjectId: payer, amountMinor: totalMinor }],
    split: { method: "equal", participants: people },
    ...extra,
  };
}

export async function add(h: Harness, group: Group, body: SplitecoExpenseRequest, as = ME): Promise<SplitecoWriteResponse["expense"]> {
  const res = await h.call("POST", `/v1/spliteco/groups/${group.publicId}/expenses`, { as, body, headers: { "idempotency-key": key() } });
  const env = await envelope<SplitecoWriteResponse>(res);
  if (res.status !== 201) throw new Error(`add failed ${res.status} ${JSON.stringify(env.error)}`);
  return env.data.expense;
}

export { envelope, usr };
