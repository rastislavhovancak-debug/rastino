-- GM Levers tables
-- Run this in Supabase SQL editor

CREATE TABLE gm_levers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  year integer NOT NULL DEFAULT 2026,
  category text NOT NULL,       -- e.g. 'COLA / Annual Rate Escalation'
  description text NOT NULL,    -- human-readable action description
  eu_in text NOT NULL DEFAULT 'EU', -- 'EU' or 'IN'
  calc_type text NOT NULL,      -- 'auto_cola' | 'auto_rate_adj' | 'auto_lm_hm' | 'manual'
  params jsonb NOT NULL DEFAULT '{}', -- formula params (see below)
  effective_from date,          -- when this lever takes effect
  effective_to date,            -- when it ends (null = ongoing)
  notes text,
  created_at timestamptz DEFAULT now()
);

-- params structure per calc_type:
-- auto_cola:     { "location": "Slovakia" | "India Pune" | "all_eu" | "all_in", "old_rate_map": {"regular": 36.05, "senior": 46.35, ...}, "new_rate_map": {"regular": 38.40, ...} }
-- auto_rate_adj: { "dev_id": 123, "old_rate": 49.37, "new_rate": 54.85 }
-- auto_lm_hm:    { "dev_old_id": 123, "dev_new_id": 456, "ctc_diff": 1516 }
-- manual:        {} (amounts entered directly per month)

CREATE TABLE gm_lever_impacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lever_id uuid NOT NULL REFERENCES gm_levers(id) ON DELETE CASCADE,
  year integer NOT NULL DEFAULT 2026,
  month integer NOT NULL CHECK (month BETWEEN 1 AND 12),
  amount numeric(12,2) NOT NULL DEFAULT 0,
  is_stored boolean NOT NULL DEFAULT true, -- true=locked past, false=preview
  created_at timestamptz DEFAULT now(),
  UNIQUE(lever_id, year, month)
);

-- Indexes
CREATE INDEX ON gm_lever_impacts(lever_id);
CREATE INDEX ON gm_lever_impacts(year, month);
CREATE INDEX ON gm_levers(year);

-- RLS (match your existing tables pattern)
ALTER TABLE gm_levers ENABLE ROW LEVEL SECURITY;
ALTER TABLE gm_lever_impacts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth_all_levers" ON gm_levers FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all_impacts" ON gm_lever_impacts FOR ALL TO authenticated USING (true) WITH CHECK (true);
