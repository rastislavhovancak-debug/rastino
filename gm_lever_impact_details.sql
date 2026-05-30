-- GM Lever Impact Details table
-- Stores per-developer breakdown for each lever/month
-- Run this in Supabase SQL editor

CREATE TABLE gm_lever_impact_details (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lever_id uuid NOT NULL REFERENCES gm_levers(id) ON DELETE CASCADE,
  developer_id integer NOT NULL REFERENCES developers(id) ON DELETE CASCADE,
  year integer NOT NULL DEFAULT 2026,
  month integer NOT NULL CHECK (month BETWEEN 1 AND 12),
  calc_amount numeric(12,2),        -- auto-calculated value (null for manual levers)
  manual_amount numeric(12,2),      -- manual override (null = use calc_amount)
  is_manual boolean NOT NULL DEFAULT false,
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(lever_id, developer_id, year, month)
);

-- Indexes
CREATE INDEX ON gm_lever_impact_details(lever_id, year, month);
CREATE INDEX ON gm_lever_impact_details(developer_id);

-- RLS
ALTER TABLE gm_lever_impact_details ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_all_details" ON gm_lever_impact_details FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Also update gm_lever_impacts to store aggregated totals
-- (already exists, no change needed to structure)

-- Helper: get effective amount for a detail row
-- = manual_amount if is_manual=true, else calc_amount
-- This is handled in application code, not DB
