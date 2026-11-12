-- 540_spliteco_settle_up: settling up, reminders and UPI IDs in Spliteco.
--
-- Context: kitchen
-- Epic: cookpool-spliteco (SE-3) — payments by UPI, cash or bank, "not
--       received", a reminder at most once a day per pair, UPI IDs on the
--       profile, and simplify debts switched per group.
--
-- Design rules:
--   * Additive: three new tables, nothing altered, dropped or rewritten.
--   * Payments are no new table: a settlement is a kitchen_txns row with
--     kind 'settlement', its method and the bucket it pays (530). A payment
--     that pays both of a kitchen group's balances is one row per bucket,
--     written in one batch; "not received" reverses every row of it.
--   * ledger_reminders keeps one row per reminder sent. The 24-hour rule is
--     per pair (from, to), whichever group it was about; the index serves
--     the "last reminded" read and that check.
--   * spliteco_profiles holds what a person sets for themselves in Spliteco:
--     their UPI ID (shown only to people who share a group with them) and the
--     currency new groups start in. A person without a row has neither.
--   * spliteco_group_settings holds the per-group switches Spliteco owns, so
--     that turning one on never writes kitchen_group_settings, whose first
--     row pins the group's currency. A group without a row simplifies debts.

CREATE TABLE IF NOT EXISTS ledger_reminders (
  id            TEXT PRIMARY KEY CHECK (id GLOB 'rmd_*'),
  org_id        TEXT NOT NULL,
  from_subject  TEXT NOT NULL,
  to_subject    TEXT NOT NULL CHECK (to_subject <> from_subject),
  amount_minor  INTEGER NOT NULL CHECK (amount_minor > 0),
  currency      TEXT NOT NULL CHECK (length(currency) = 3),
  sent_at       TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS ledger_reminders_pair_idx
  ON ledger_reminders (from_subject, to_subject, sent_at DESC);

CREATE TABLE IF NOT EXISTS spliteco_profiles (
  subject_id        TEXT PRIMARY KEY,
  upi_vpa           TEXT CHECK (upi_vpa IS NULL OR (length(upi_vpa) BETWEEN 5 AND 100 AND upi_vpa LIKE '%_@_%')),
  default_currency  TEXT NOT NULL DEFAULT 'INR' CHECK (length(default_currency) = 3),
  updated_at        TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS spliteco_group_settings (
  org_id          TEXT PRIMARY KEY,
  simplify_debts  INTEGER NOT NULL DEFAULT 1 CHECK (simplify_debts IN (0, 1)),
  updated_by      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);

-- table ledger_reminders: One row per reminder sent ("a friendly nudge"); at most one per pair (from, to) per 24 hours.
-- column ledger_reminders.id: rmd_ plus 32 hex.
-- column ledger_reminders.org_id: The group the reminder was about (opaque reference to membership_organizations.id).
-- column ledger_reminders.from_subject: Who sent it (usr_…): the person owed.
-- column ledger_reminders.to_subject: Who it went to (usr_…): the person who owes.
-- column ledger_reminders.amount_minor: What the reminder said they owe, in the group's currency.
-- column ledger_reminders.sent_at: When it was sent, ISO-8601.
-- table spliteco_profiles: What a person sets for themselves in Spliteco. One row per person who set something.
-- column spliteco_profiles.upi_vpa: Their UPI ID (name@bank), the payee of a UPI payment to them; visible only to people who share a group with them.
-- column spliteco_profiles.default_currency: The currency new groups they make start in (ISO 4217).
-- table spliteco_group_settings: Spliteco's per-group switches. A group without a row uses the defaults.
-- column spliteco_group_settings.simplify_debts: 1 (the default): the settle plan is the fewest payments; 0: each pair settles what is between them.
-- column spliteco_group_settings.updated_by: Who last changed it (usr_…).
