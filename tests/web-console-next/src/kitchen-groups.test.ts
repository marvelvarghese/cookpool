import {
  GROUP_CURRENCIES,
  WASTE_RULES,
  canManageGroup,
  filterGroups,
  foldForSearch,
  groupInitials,
  groupSlug,
  pushRecentSlug,
  recentGroups,
  roleFromAssignments,
  sortGroups,
  validateGroupName,
} from "@web-console-next/components/kitchen/groups";

const g = (slug: string, name: string, createdAt: string) => ({ id: `org_${slug}`, slug, name, createdAt });

const GROUPS = [
  g("flat-4b", "Flat 4B", "2026-03-01T00:00:00Z"),
  g("lunch", "Lunch club", "2026-05-01T00:00:00Z"),
  g("cafe", "Café Crew", "2026-01-01T00:00:00Z"),
  g("flat-12", "flat 12", "2026-04-01T00:00:00Z"),
  g("flat-2", "Flat 2", "2026-02-01T00:00:00Z"),
];
const slugs = (list: { slug: string }[]) => list.map((x) => x.slug);

describe("filterGroups", () => {
  it("keeps everything for an empty or blank query, in input order", () => {
    expect(slugs(filterGroups(GROUPS, ""))).toEqual(slugs(GROUPS));
    expect(slugs(filterGroups(GROUPS, "   "))).toEqual(slugs(GROUPS));
  });

  it("matches names case-insensitively", () => {
    expect(slugs(filterGroups(GROUPS, "LUNCH"))).toEqual(["lunch"]);
    expect(slugs(filterGroups(GROUPS, "flat"))).toEqual(["flat-4b", "flat-12", "flat-2"]);
  });

  it("matches every word in any order", () => {
    expect(slugs(filterGroups(GROUPS, "4b flat"))).toEqual(["flat-4b"]);
    expect(slugs(filterGroups(GROUPS, "flat  lunch"))).toEqual([]);
  });

  it("ignores accents", () => {
    expect(slugs(filterGroups(GROUPS, "cafe"))).toEqual(["cafe"]);
    expect(foldForSearch("  Café   Crew ")).toBe("cafe crew");
  });

  it("filters by name only, not slug", () => {
    expect(filterGroups(GROUPS, "flat-4b")).toEqual([]);
  });

  it("does not mutate its input", () => {
    const copy = [...GROUPS];
    filterGroups(GROUPS, "flat");
    expect(GROUPS).toEqual(copy);
  });
});

describe("sortGroups", () => {
  it("A–Z: by name, case- and accent-insensitive, numbers in numeric order", () => {
    expect(slugs(sortGroups(GROUPS, "az"))).toEqual(["cafe", "flat-2", "flat-4b", "flat-12", "lunch"]);
  });

  it("Recent: groups opened on this device first, in that order, then newest first", () => {
    expect(slugs(sortGroups(GROUPS, "recent", ["cafe", "flat-4b"]))).toEqual([
      "cafe",
      "flat-4b",
      "lunch",
      "flat-12",
      "flat-2",
    ]);
  });

  it("Recent with no history is newest first", () => {
    expect(slugs(sortGroups(GROUPS, "recent"))).toEqual(["lunch", "flat-12", "flat-4b", "flat-2", "cafe"]);
  });

  it("ignores remembered slugs the person is no longer in", () => {
    expect(slugs(sortGroups(GROUPS, "recent", ["gone", "flat-2"]))[0]).toBe("flat-2");
  });

  it("does not mutate its input", () => {
    const copy = [...GROUPS];
    sortGroups(GROUPS, "az");
    sortGroups(GROUPS, "recent", ["cafe"]);
    expect(GROUPS).toEqual(copy);
  });

  it("composes with filtering", () => {
    expect(slugs(sortGroups(filterGroups(GROUPS, "flat"), "az"))).toEqual(["flat-2", "flat-4b", "flat-12"]);
  });
});

describe("recent groups", () => {
  it("the sidebar shows at most four, recent first", () => {
    expect(slugs(recentGroups(GROUPS, ["flat-2"]))).toEqual(["flat-2", "lunch", "flat-12", "flat-4b"]);
    expect(recentGroups(GROUPS, [], 2)).toHaveLength(2);
  });

  it("a visit moves the slug to the front without duplicates, capped", () => {
    expect(pushRecentSlug(["a", "b", "c"], "b")).toEqual(["b", "a", "c"]);
    expect(pushRecentSlug(["a", "b"], "z", 2)).toEqual(["z", "a"]);
    expect(pushRecentSlug(["a"], "")).toEqual(["a"]);
  });
});

describe("roles", () => {
  const ra = (role: string, scopeKind = "organization") => ({ role, scopeKind });

  it("takes the strongest organization role, builder reading as member", () => {
    expect(roleFromAssignments([ra("builder")])).toBe("member");
    expect(roleFromAssignments([ra("viewer"), ra("admin")])).toBe("admin");
    expect(roleFromAssignments([ra("admin"), ra("owner")])).toBe("owner");
  });

  it("ignores project-scope and unknown roles", () => {
    expect(roleFromAssignments([ra("owner", "project"), ra("viewer")])).toBe("viewer");
    expect(roleFromAssignments([ra("billing_admin")])).toBeNull();
    expect(roleFromAssignments([])).toBeNull();
  });

  it("permissions", () => {
    expect(canManageGroup("owner")).toBe(true);
    expect(canManageGroup("admin")).toBe(true);
    expect(canManageGroup("member")).toBe(false);
    expect(canManageGroup("viewer")).toBe(false);
    expect(canManageGroup(null)).toBe(false);
  });
});

describe("new group", () => {
  it("validates the name", () => {
    expect(validateGroupName("Flat 4B")).toBeNull();
    expect(validateGroupName("   ")).toMatch(/name/);
    expect(validateGroupName("x".repeat(61))).toMatch(/60/);
  });

  it("slugs always carry a suffix and fit the server's slug rule", () => {
    const re = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
    for (const [name, slug] of [
      ["Flat 4B", "flat-4b-k3x9"],
      ["  Café — Crew!! ", "cafe-crew-k3x9"],
      ["फ्लैट", "group-k3x9"],
    ] as const) {
      const out = groupSlug(name, "k3x9");
      expect(out).toBe(slug);
      expect(out).toMatch(re);
    }
    const long = groupSlug("a".repeat(100), "abcdef");
    expect(long.length).toBeLessThanOrEqual(63);
    expect(long).toMatch(re);
    expect(groupSlug("Flat", "!!")).toBe("flat-x");
  });

  it("offers INR first and both waste rules", () => {
    expect(GROUP_CURRENCIES[0]!.code).toBe("INR");
    expect(WASTE_RULES.map((r) => [r.id, r.label])).toEqual([
      ["split_equally", "Split equally"],
      ["buyer_absorbs", "The buyer absorbs it"],
    ]);
  });

  it("group initials", () => {
    expect(groupInitials("Flat 4B")).toBe("F4");
    expect(groupInitials("lunch")).toBe("LU");
    expect(groupInitials("  ")).toBe("?");
  });
});
