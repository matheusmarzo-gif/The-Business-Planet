CREATE TABLE IF NOT EXISTS world_state (
  id SMALLINT PRIMARY KEY CHECK (id = 1),
  world_time TIMESTAMPTZ NOT NULL,
  last_real_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS city_assemblies (
  id UUID PRIMARY KEY,
  name VARCHAR(80) NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 80),
  center_x INTEGER NOT NULL CHECK (center_x BETWEEN 151 AND 3848),
  center_y INTEGER NOT NULL CHECK (center_y BETWEEN 151 AND 3848),
  population INTEGER NOT NULL DEFAULT 0 CHECK (population >= 0),
  wellbeing INTEGER NOT NULL DEFAULT 0 CHECK (wellbeing BETWEEN 0 AND 100),
  economy INTEGER NOT NULL DEFAULT 0 CHECK (economy >= 0),
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
