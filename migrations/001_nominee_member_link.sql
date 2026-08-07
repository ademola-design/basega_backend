-- ============================================================
-- Migration 001 — Link nominations to member accounts
--
-- Run ONCE against an existing basega_db. New installs get this
-- from database.sql already and should NOT run this file.
--
--   mysql -u <user> -p basega_db < migrations/001_nominee_member_link.sql
--
-- Why: nominations previously stored only a free-text nominee_name
-- like "Ada Okonkwo (Class of 1998 - Surgeon)". With no link to a
-- member row there was no way to show the honoree's profile photo.
-- ============================================================

USE basega_db;

ALTER TABLE nominations
  ADD COLUMN nominee_member_id INT NULL AFTER nominee_name;

ALTER TABLE nominations
  ADD CONSTRAINT fk_nominations_nominee
  FOREIGN KEY (nominee_member_id) REFERENCES members(id) ON DELETE CASCADE;

-- Speeds up "who is selected for this month" lookups.
CREATE INDEX idx_nominations_status_month ON nominations (status, month_year);

-- Existing rows keep nominee_member_id = NULL. They still render using
-- nominee_name, just without a photo. Only one nomination per month can
-- hold 'selected' from now on; if history already has several selected in
-- the same month, keep the newest and reset the rest:
UPDATE nominations n
  JOIN (
    SELECT month_year, MAX(id) AS keep_id
    FROM nominations
    WHERE status = 'selected'
    GROUP BY month_year
  ) latest
    ON n.month_year = latest.month_year
SET n.status = 'pending'
WHERE n.status = 'selected' AND n.id <> latest.keep_id;
