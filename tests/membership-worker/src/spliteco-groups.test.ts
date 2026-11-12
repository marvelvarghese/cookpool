// cookpool-spliteco SE1 in membership-worker: groups made in Spliteco, the
// hidden two-person direct groups, and the open-groups cap that ignores them.
// (tests/spliteco-worker drives the same routes end to end over SQLite.)

import { directSlug, handleDirectGroup } from "@membership-worker/handlers/direct-groups";
import { countsTowardCap, isDirectGroup } from "@membership-worker/open-groups";

const env = { ENVIRONMENT: "test" } as never;
const post = (body: unknown) =>
  new Request("http://membership-worker/v1/internal/membership/direct-groups", { method: "POST", body: JSON.stringify(body) });

describe("direct groups", () => {
  it("gives a pair one slug, whichever of the two asks", async () => {
    const ab = await directSlug("usr_a", "usr_b");
    expect(ab).toBe(await directSlug("usr_b", "usr_a"));
    expect(ab).toMatch(/^direct-[0-9a-f]{40}$/);
    expect(ab).not.toBe(await directSlug("usr_a", "usr_c"));
  });

  it("needs two different, well-formed people", async () => {
    for (const subjects of [[], [{ id: "usr_a", type: "user" }], [{ id: "usr_a", type: "user" }, { id: "usr_a", type: "user" }], [{ id: "bad id", type: "user" }, { id: "usr_b", type: "user" }]]) {
      const res = await handleDirectGroup(post({ subjects }), env, "req_1");
      expect(res.status).toBe(422);
    }
  });

  it("never counts toward the cap", () => {
    expect(countsTowardCap([{ kind: "kitchen" }, { kind: "direct" }, { kind: "trip" }, {}])).toBe(3);
    expect(isDirectGroup({ kind: "direct" })).toBe(true);
    expect(isDirectGroup({})).toBe(false);
  });
});
