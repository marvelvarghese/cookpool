"use client";

// A Tripeco ride in Spliteco (tripeco TR-7, design §7): the one line that
// explains the amount ("124 km · Swift · 18.6 km/l · ₹104/L"), the start and
// end odometer photos as proof, and Edit in Tripeco. The numbers and photos
// come from tripeco-worker, which shows them to the group's members only.

import * as React from "react";
import type { TripecoProof } from "@saas/sdk";
import { Icon } from "./icons";
import { useSession } from "@/lib/session";
import { tripecoRideHref } from "@/lib/tripeco-link";
import { rideLine } from "@/lib/ride-view";

export function useRideProof(rideId: string | null): TripecoProof | null {
  const { client } = useSession();
  const [proof, setProof] = React.useState<TripecoProof | null>(null);
  React.useEffect(() => {
    if (!rideId) return;
    let live = true;
    void client.tripeco.proof(rideId).then(
      (r) => live && setProof(r.proof),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [client, rideId]);
  return proof;
}

function Photo({ id, label }: { id: string; label: string }) {
  const { client } = useSession();
  const [src, setSrc] = React.useState<string | null>(null);
  React.useEffect(() => {
    let live = true;
    void client.tripeco.photo(id).then(
      (r) => live && setSrc(`data:${r.photo.mediaType};base64,${r.photo.image}`),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [client, id]);
  return (
    <figure style={{ margin: 0, flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 4 }}>
      <div style={{ aspectRatio: "4 / 3", borderRadius: 14, overflow: "hidden", background: "rgba(255,255,255,0.06)" }}>
        {src ? <img src={src} alt={`${label} odometer photo`} style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : null}
      </div>
      <figcaption style={{ fontSize: 12, color: "var(--dim)" }}>{label}</figcaption>
    </figure>
  );
}

/** The ride's line, photos and Edit in Tripeco (only the driver can edit, in Tripeco). */
export function RideProof({ rideId, me, onComment }: { rideId: string; me: string | null; onComment?: () => void }) {
  const proof = useRideProof(rideId);
  const [href, setHref] = React.useState<string | null>(null);
  React.useEffect(() => setHref(tripecoRideHref(window.location.host, rideId)), [rideId]);
  return (
    <div className="stack" style={{ gap: 12 }}>
      <p style={{ margin: 0, fontSize: 14, color: "var(--dim)" }}>{proof ? rideLine(proof) : "Tripeco ride"}</p>
      {proof && proof.photos.length > 0 ? (
        <div style={{ display: "flex", gap: 10 }}>
          {proof.photos.map((p) => (
            <Photo key={p.id} id={p.id} label={p.role === "start" ? "Start" : "End"} />
          ))}
        </div>
      ) : null}
      <div className="atiles" style={{ gridTemplateColumns: `repeat(${onComment ? 2 : 1}, minmax(0, 1fr))` }}>
        {href && proof?.ownerSubject === me ? (
          <a href={href} className="atile">
            <span className="i-edit" style={{ display: "inline-flex" }}>
              <Icon name="edit" size={20} />
            </span>
            Edit in Tripeco
          </a>
        ) : null}
        {onComment ? (
          <button type="button" className="atile" onClick={onComment}>
            <span className="i-comment" style={{ display: "inline-flex" }}>
              <Icon name="comment" size={20} />
            </span>
            Comment
          </button>
        ) : null}
      </div>
    </div>
  );
}
