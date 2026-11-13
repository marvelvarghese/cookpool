import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { manifest } from "@saas/db";
import { D1ApiAdapter } from "@saas/db/runner";

// Tripeco (tripeco TR-2): 610_tripeco_drive — six new tables, nothing
// existing touched. Checked as text (additive) and against a real SQLite
// engine (the CHECKs that keep a ride, a fill-up and a photo honest).

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_ROOT = resolve(__dirname, "../../..", "packages/db/src/migrations");
const ID = "610_tripeco_drive";
const raw = () => readFileSync(resolve(MIGRATIONS_ROOT, `${ID}/up.sql`), "utf8");
const statements = (sql: string) => D1ApiAdapter.splitStatements(sql);

function migrated(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  for (const m of manifest.migrations) for (const s of statements(readFileSync(join(MIGRATIONS_ROOT, m.path), "utf8"))) db.exec(s);
  return db;
}

const AT = "2026-11-13T00:00:00.000Z";
const VEH = `veh_${"1".repeat(32)}`;
const TRP = `trp_${"2".repeat(32)}`;

function vehicle(db: DatabaseSync, overrides: Record<string, unknown> = {}): void {
  const v = { id: VEH, owner: "usr_1", name: "Swift", fuel: "petrol", mileage: 18.6, price: 10400, ...overrides };
  db.prepare(
    `INSERT INTO tripeco_vehicles (id, owner_subject, name, fuel, estimate_mileage, estimate_price_minor, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(v.id as string, v.owner as string, v.name as string, v.fuel as string, v.mileage as number, v.price as number, AT, AT);
}

function ride(db: DatabaseSync, overrides: Record<string, unknown> = {}): void {
  const r = { id: TRP, state: "open", posted: null, ...overrides };
  db.prepare(
    `INSERT INTO tripeco_rides (id, vehicle_id, owner_subject, state, mode, mileage, mileage_source, price_minor, posted_txn_id, started_at, created_at, updated_at)
     VALUES (?, ?, 'usr_1', ?, 'odo', 18.6, 'learned', 10400, ?, ?, ?, ?)`,
  ).run(r.id as string, VEH, r.state as string, r.posted as string | null, AT, AT, AT);
}

describe("610_tripeco_drive", () => {
  it("is registered last, in the kitchen context", () => {
    const entry = manifest.migrations.find((m) => m.id === ID);
    expect(entry).toMatchObject({ context: "kitchen", path: `${ID}/up.sql` });
  });

  it("is additive: new tables and indexes only", () => {
    const sql = raw().replace(/--.*$/gm, "");
    expect(sql).not.toMatch(/\b(ALTER|DROP|UPDATE|DELETE)\b/i);
    const tables = [...sql.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)/g)].map((m) => m[1]);
    expect(tables).toEqual(["tripeco_vehicles", "tripeco_fuel_logs", "tripeco_rides", "tripeco_ride_riders", "tripeco_ride_extras", "tripeco_photos"]);
  });

  it("keeps a vehicle, a ride and a photo honest", () => {
    const db = migrated();
    expect(() => vehicle(db, { fuel: "steam" })).toThrow(/CHECK/);
    expect(() => vehicle(db, { id: "car_1" })).toThrow(/CHECK/);
    vehicle(db);
    // A posted ride says where it posted, and only a posted one does.
    expect(() => ride(db, { state: "posted" })).toThrow(/CHECK/);
    expect(() => ride(db, { posted: "txn" })).toThrow(/CHECK/);
    ride(db);
    expect(() =>
      db.prepare(`INSERT INTO tripeco_fuel_logs (id, vehicle_id, owner_subject, amount_minor, quantity_milli, odometer_km, full, logged_at, created_at) VALUES (?, ?, 'usr_1', 100, 0, 1, 1, ?, ?)`).run(`ful_${"3".repeat(32)}`, VEH, AT, AT),
    ).toThrow(/CHECK/);
    const photo = (id: string) =>
      db.prepare(`INSERT INTO tripeco_photos (id, ride_id, role, media_type, data, bytes, created_at) VALUES (?, ?, 'start', 'image/jpeg', 'x', 10, ?)`).run(id, TRP, AT);
    photo(`pho_${"4".repeat(32)}`);
    expect(() => photo(`pho_${"5".repeat(32)}`)).toThrow(/UNIQUE/);
    db.close();
  });
});
