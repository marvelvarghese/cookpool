// How a ride reads in a list (tripeco TR-5). Pure.

import type { TripecoProof, TripecoRide } from "@saas/contracts/tripeco";
import { rupees, signedRupees } from "./money";

/** What others owe the owner on a ride (their shares). */
export function othersOwe(ride: Pick<TripecoRide, "riders"> & { ownerSubject?: string }, owner: string | null): number {
  return ride.riders.filter((r) => r.on && r.subjectId !== owner).reduce((s, r) => s + r.shareMinor, 0);
}

/** A ride row's amount: posted → +what riders owe (get back); solo → the cost, dim; otherwise the total to post. */
export function rideAmount(ride: TripecoRide): { text: string; tone: "get" | "dim" | "money" } {
  const owner = ride.riders[0]?.subjectId ?? null;
  if (ride.state === "posted") return { text: signedRupees(othersOwe(ride, ownerOf(ride) ?? owner)), tone: "get" };
  if (ride.solo || ride.state === "open") return { text: ride.state === "open" ? "—" : rupees(ride.totalMinor), tone: "dim" };
  return { text: rupees(ride.totalMinor), tone: "money" };
}

/** The owner is the rider the ride was started with (always first). */
export function ownerOf(ride: Pick<TripecoRide, "riders">): string | null {
  return ride.riders[0]?.subjectId ?? null;
}

/** Your side of a posted ride in a group: + what the others owe you on your ride, − your share of someone else's. */
export function myNet(proof: TripecoProof, me: string | null): number {
  if (!me) return 0;
  if (proof.ownerSubject === me) return proof.riders.filter((r) => r.subjectId !== me).reduce((s, r) => s + r.shareMinor, 0);
  return -(proof.riders.find((r) => r.subjectId === me)?.shareMinor ?? 0);
}
