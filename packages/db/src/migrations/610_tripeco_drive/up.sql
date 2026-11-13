-- 610_tripeco_drive: Tripeco's vehicles, fuel log and rides.
--
-- Context: kitchen (the ledger's neighbours; Tripeco keeps no money of its own)
-- Epic: tripeco (TR-2) — a car's owner keeps vehicles and a private fuel log,
--       and turns two odometer readings into a ride whose shares post into a
--       Spliteco group (design §1).
--
-- Design rules:
--   * Additive: six new tables, their indexes; nothing existing changes.
--   * Everything is its owner's: every row carries owner_subject (usr_…) and
--     every read is scoped by it. A ride's proof (numbers and photos) is shown
--     to the members of the group it posted to, which tripeco-worker checks
--     through spliteco-worker before reading.
--   * No money of Tripeco's own: a posted ride is a Spliteco expense
--     (kitchen_txns, source_kind 'tripeco', source_id the ride's trp_ id);
--     posted_txn_id only points at it.
--   * Money is integer paise; a ride's amounts are whole rupees. Quantities
--     are ×1000 integers (millilitres, grams, Wh); distances are km, REAL.
--   * Ids are stored with their prefix (veh_, ful_, trp_, pho_ and 32 hex).

CREATE TABLE IF NOT EXISTS tripeco_vehicles (
  id                  TEXT PRIMARY KEY CHECK (id GLOB 'veh_*'),
  owner_subject       TEXT NOT NULL,
  name                TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 60),
  plate               TEXT CHECK (plate IS NULL OR length(plate) BETWEEN 1 AND 20),
  fuel                TEXT NOT NULL CHECK (fuel IN ('petrol', 'diesel', 'cng', 'electric')),
  odometer_km         REAL NOT NULL DEFAULT 0 CHECK (odometer_km >= 0),
  estimate_mileage    REAL NOT NULL CHECK (estimate_mileage > 0 AND estimate_mileage <= 100),
  estimate_price_minor INTEGER NOT NULL CHECK (estimate_price_minor >= 0),
  wear_minor_per_km   INTEGER NOT NULL DEFAULT 0 CHECK (wear_minor_per_km BETWEEN 0 AND 10000),
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL,
  archived_at         TEXT
);

CREATE INDEX IF NOT EXISTS tripeco_vehicles_owner_idx
  ON tripeco_vehicles (owner_subject, created_at);

CREATE TABLE IF NOT EXISTS tripeco_fuel_logs (
  id              TEXT PRIMARY KEY CHECK (id GLOB 'ful_*'),
  vehicle_id      TEXT NOT NULL REFERENCES tripeco_vehicles(id),
  owner_subject   TEXT NOT NULL,
  amount_minor    INTEGER NOT NULL CHECK (amount_minor >= 0),
  quantity_milli  INTEGER NOT NULL CHECK (quantity_milli > 0),
  odometer_km     REAL NOT NULL CHECK (odometer_km >= 0),
  full            INTEGER NOT NULL CHECK (full IN (0, 1)),
  paid_by         TEXT NOT NULL DEFAULT 'me' CHECK (paid_by IN ('me', 'rider')),
  logged_at       TEXT NOT NULL,
  created_at      TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS tripeco_fuel_logs_vehicle_idx
  ON tripeco_fuel_logs (vehicle_id, logged_at);

CREATE TABLE IF NOT EXISTS tripeco_rides (
  id                 TEXT PRIMARY KEY CHECK (id GLOB 'trp_*'),
  vehicle_id         TEXT NOT NULL REFERENCES tripeco_vehicles(id),
  owner_subject      TEXT NOT NULL,
  state              TEXT NOT NULL DEFAULT 'open' CHECK (state IN ('open', 'done', 'posted')),
  mode               TEXT NOT NULL CHECK (mode IN ('odo', 'trip')),
  start_km           REAL CHECK (start_km IS NULL OR start_km >= 0),
  end_km             REAL CHECK (end_km IS NULL OR end_km >= 0),
  trip_km            REAL CHECK (trip_km IS NULL OR trip_km >= 0),
  car_average        REAL CHECK (car_average IS NULL OR car_average > 0),
  km                 REAL CHECK (km IS NULL OR km >= 0),
  mileage            REAL NOT NULL CHECK (mileage > 0),
  mileage_source     TEXT NOT NULL CHECK (mileage_source IN ('learned', 'estimate', 'car')),
  price_minor        INTEGER NOT NULL CHECK (price_minor >= 0),
  wear_on            INTEGER NOT NULL DEFAULT 0 CHECK (wear_on IN (0, 1)),
  wear_minor_per_km  INTEGER NOT NULL DEFAULT 0 CHECK (wear_minor_per_km >= 0),
  title              TEXT CHECK (title IS NULL OR length(title) BETWEEN 1 AND 80),
  org_id             TEXT,
  fuel_minor         INTEGER NOT NULL DEFAULT 0 CHECK (fuel_minor >= 0),
  wear_minor         INTEGER NOT NULL DEFAULT 0 CHECK (wear_minor >= 0),
  extras_minor       INTEGER NOT NULL DEFAULT 0 CHECK (extras_minor >= 0),
  total_minor        INTEGER NOT NULL DEFAULT 0 CHECK (total_minor >= 0),
  version            INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  posted_txn_id      TEXT,
  posted_org_id      TEXT,
  posted_version     INTEGER,
  posted_at          TEXT,
  started_at         TEXT NOT NULL,
  ended_at           TEXT,
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL,
  -- A posted ride says where it posted.
  CHECK ((state = 'posted') = (posted_txn_id IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS tripeco_rides_owner_idx
  ON tripeco_rides (owner_subject, started_at DESC);
CREATE INDEX IF NOT EXISTS tripeco_rides_posted_org_idx
  ON tripeco_rides (posted_org_id, posted_at DESC) WHERE posted_org_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS tripeco_ride_riders (
  ride_id      TEXT NOT NULL REFERENCES tripeco_rides(id),
  position     INTEGER NOT NULL CHECK (position >= 0),
  subject_id   TEXT NOT NULL,
  on_ride      INTEGER NOT NULL CHECK (on_ride IN (0, 1)),
  km           REAL NOT NULL CHECK (km >= 0),
  share_minor  INTEGER NOT NULL DEFAULT 0 CHECK (share_minor >= 0),
  PRIMARY KEY (ride_id, subject_id)
);

CREATE TABLE IF NOT EXISTS tripeco_ride_extras (
  ride_id       TEXT NOT NULL REFERENCES tripeco_rides(id),
  position      INTEGER NOT NULL CHECK (position >= 0),
  kind          TEXT NOT NULL CHECK (kind IN ('toll', 'parking')),
  amount_minor  INTEGER NOT NULL CHECK (amount_minor >= 0),
  PRIMARY KEY (ride_id, position)
);

CREATE TABLE IF NOT EXISTS tripeco_photos (
  id          TEXT PRIMARY KEY CHECK (id GLOB 'pho_*'),
  ride_id     TEXT NOT NULL REFERENCES tripeco_rides(id),
  role        TEXT NOT NULL CHECK (role IN ('start', 'end')),
  media_type  TEXT NOT NULL CHECK (media_type IN ('image/jpeg', 'image/webp')),
  data        TEXT NOT NULL,
  bytes       INTEGER NOT NULL CHECK (bytes BETWEEN 1 AND 409600),
  created_at  TEXT NOT NULL,
  -- One photo per role: a retake replaces it.
  UNIQUE (ride_id, role)
);

-- table tripeco_vehicles: A Tripeco owner's vehicle (veh_ ids). Archived, never deleted.
-- column tripeco_vehicles.owner_subject: The owner (usr_…); every read is scoped by it.
-- column tripeco_vehicles.fuel: petrol | diesel | cng | electric — the unit follows (litre, kg, kWh).
-- column tripeco_vehicles.odometer_km: The highest odometer reading seen (fill-ups and rides).
-- column tripeco_vehicles.estimate_mileage: The km per unit typed at Add vehicle, used until full tanks teach the real one.
-- column tripeco_vehicles.estimate_price_minor: The paise per unit typed at Add vehicle, used until the first fill-up.
-- column tripeco_vehicles.wear_minor_per_km: Wear & tear in paise per km; 0 is off.
-- column tripeco_vehicles.archived_at: Set when removed; its rides and fuel log stay.
-- table tripeco_fuel_logs: One fill-up or charge (ful_ ids): the owner's own, never shown to anyone else.
-- column tripeco_fuel_logs.quantity_milli: Litres, kilograms or kWh ×1000.
-- column tripeco_fuel_logs.full: 1 for a full tank (or a charge to 100%): it closes a mileage segment.
-- column tripeco_fuel_logs.paid_by: me | rider — a tag for the month's You/Riders bar, not a payment.
-- table tripeco_rides: One drive (trp_ ids): its readings, the mileage and price it used, its cost and where it posted.
-- column tripeco_rides.state: open (no distance yet) | done (distance known, not posted) | posted (a Spliteco expense).
-- column tripeco_rides.mode: odo (start and end odometer) | trip (Trip A reset at the start, read at the end).
-- column tripeco_rides.car_average: The car's own average read from the end photo (Trip reset), km per unit.
-- column tripeco_rides.km: The distance, one decimal, once known.
-- column tripeco_rides.mileage_source: learned | estimate | car — which figure the ride used.
-- column tripeco_rides.price_minor: Paise per unit the ride used.
-- column tripeco_rides.org_id: The Spliteco group chosen for the ride (membership_organizations.id, a bare UUID).
-- column tripeco_rides.version: Bumped by every change after posting; a repost's idempotency key carries it.
-- column tripeco_rides.posted_txn_id: The Spliteco expense (kitchen_txns.id) the ride posted as.
-- column tripeco_rides.posted_version: The version that posted; a later version needs a repost.
-- table tripeco_ride_riders: Who rode: in or left out, how far, and their share in whole rupees (as paise).
-- table tripeco_ride_extras: A ride's tolls and parking, split equally among the riders.
-- table tripeco_photos: A ride's start and end odometer photos (pho_ ids), base64, at most 400 KB, kept as proof.
