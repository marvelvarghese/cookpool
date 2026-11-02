/// <reference types="@cloudflare/workers-types" />
// People by id for sibling workers (Cookpool CP-9):
// POST /v1/internal/identity/users/lookup. kitchen-worker reads it to show a
// group's members by name.

import type { UsersLookupResponse } from "@saas/contracts/auth";
import { createFakeRepository } from "./helpers/fake-repository";
import type { Env } from "../../../apps/identity-worker/src/env";
import { handleInternalUsersLookup } from "../../../apps/identity-worker/src/handlers/internal-users-lookup";
import { route } from "../../../apps/identity-worker/src/router";

const ANU = "0a0a0a0a-1b1b-4c2c-8d3d-4e4e4e4e4e4e";
const DEV = "0b0b0b0b-1b1b-4c2c-8d3d-4e4e4e4e4e4e";
const pub = (uuid: string) => `usr_${uuid.replace(/-/g, "")}`;
const T0 = new Date("2026-11-02T08:00:00.000Z");

const env = { ENVIRONMENT: "test" } as Env;

async function seeded() {
  const repo = createFakeRepository();
  await repo.createUser({ id: ANU, email: "Anu.K@example.com", emailLower: "anu.k@example.com", displayName: "Anu", createdAt: T0 });
  await repo.createUser({ id: DEV, email: "dev@example.com", emailLower: "dev@example.com", displayName: null, createdAt: T0 });
  return repo;
}

function lookup(body: unknown): Request {
  return new Request("http://identity-worker/v1/internal/identity/users/lookup", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

async function users(res: Response): Promise<UsersLookupResponse["users"]> {
  expect(res.status).toBe(200);
  return ((await res.json()) as { data: UsersLookupResponse }).data.users;
}

describe("identity-worker: people by id (internal)", () => {
  it("answers each known person's name and email, in the order asked", async () => {
    const repo = await seeded();
    const res = await handleInternalUsersLookup(lookup({ subjectIds: [pub(DEV), pub(ANU)] }), env, "req_1", { repo });
    expect(await users(res)).toEqual([
      { subjectId: pub(DEV), displayName: null, email: "dev@example.com" },
      { subjectId: pub(ANU), displayName: "Anu", email: "Anu.K@example.com" },
    ]);
  });

  it("leaves out unknown and malformed ids, and reads a repeated id once", async () => {
    const repo = await seeded();
    const unknown = pub("0c0c0c0c-1b1b-4c2c-8d3d-4e4e4e4e4e4e");
    const res = await handleInternalUsersLookup(
      lookup({ subjectIds: [pub(ANU), unknown, "sp_bot", "usr_nothex", pub(ANU)] }),
      env,
      "req_1",
      { repo },
    );
    expect((await users(res)).map((u) => u.subjectId)).toEqual([pub(ANU)]);
  });

  it("matches an id whatever the case of its hex, answering it as asked", async () => {
    const repo = await seeded();
    const upper = `usr_${ANU.replace(/-/g, "").toUpperCase()}`;
    const res = await handleInternalUsersLookup(lookup({ subjectIds: [upper] }), env, "req_1", { repo });
    expect(await users(res)).toEqual([{ subjectId: upper, displayName: "Anu", email: "Anu.K@example.com" }]);
  });

  it("is 422 for a body without ids, with ids that are not strings, or with more than 100", async () => {
    const repo = await seeded();
    for (const body of ["not json", { subjectIds: [] }, { subjectIds: "usr_1" }, { subjectIds: [1] }, [pub(ANU)]]) {
      const res = await handleInternalUsersLookup(lookup(body), env, "req_1", { repo });
      expect(res.status).toBe(422);
    }
    const many = Array.from({ length: 101 }, (_, i) => `usr_${String(i).padStart(32, "0")}`);
    expect((await handleInternalUsersLookup(lookup({ subjectIds: many }), env, "req_1", { repo })).status).toBe(422);
    // Duplicates count once.
    const repeated = Array.from({ length: 150 }, () => pub(ANU));
    expect((await users(await handleInternalUsersLookup(lookup({ subjectIds: repeated }), env, "req_1", { repo })))).toHaveLength(1);
  });

  it("reads a failing lookup as an unknown person", async () => {
    const repo = await seeded();
    const failing = { getUserById: async () => ({ ok: false as const, error: { kind: "internal" as const, message: "boom" } }) };
    const res = await handleInternalUsersLookup(lookup({ subjectIds: [pub(ANU)] }), env, "req_1", { repo: failing });
    expect(await users(res)).toEqual([]);
    expect(repo._users.size).toBe(2);
  });

  it("is routed for POST only, and is a 503 without a database", async () => {
    expect((await route(lookup({ subjectIds: [pub(ANU)] }), env)).status).toBe(503);
    const get = new Request("http://identity-worker/v1/internal/identity/users/lookup");
    expect((await route(get, env)).status).toBe(405);
  });
});
