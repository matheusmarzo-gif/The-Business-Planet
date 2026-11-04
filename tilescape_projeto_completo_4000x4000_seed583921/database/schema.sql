CREATE TABLE IF NOT EXISTS world_state (
  id SMALLINT PRIMARY KEY CHECK (id = 1),
  world_time TIMESTAMPTZ NOT NULL,
  last_real_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS player_wallets (
  user_id TEXT PRIMARY KEY,
  balance BIGINT NOT NULL CHECK (balance >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
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

CREATE TABLE IF NOT EXISTS city_zones (
  id UUID PRIMARY KEY,
  city_id UUID NOT NULL REFERENCES city_assemblies (id) ON DELETE CASCADE,
  zone_type TEXT NOT NULL CHECK (zone_type IN ('urban', 'rural')),
  min_x INTEGER NOT NULL,
  min_y INTEGER NOT NULL,
  max_x INTEGER NOT NULL,
  max_y INTEGER NOT NULL,
  CHECK (min_x <= max_x),
  CHECK (min_y <= max_y),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX IF NOT EXISTS city_zones_city_id_idx ON city_zones (city_id);

CREATE TABLE IF NOT EXISTS residential_buildings (
  id UUID PRIMARY KEY,
  building_type TEXT NOT NULL,
  tile_x INTEGER NOT NULL CHECK (tile_x BETWEEN 0 AND 3999),
  tile_y INTEGER NOT NULL CHECK (tile_y BETWEEN 0 AND 3999),
  city_id UUID NOT NULL REFERENCES city_assemblies (id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('under_construction', 'completed')),
  created_by TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  completed_at TIMESTAMPTZ,
  CHECK (
    (status = 'under_construction' AND completed_at IS NULL) OR
    (status = 'completed' AND completed_at IS NOT NULL)
  )
);

ALTER TABLE residential_buildings
  ADD COLUMN IF NOT EXISTS wage INTEGER NOT NULL DEFAULT 10 CHECK (wage BETWEEN 0 AND 100000);
ALTER TABLE residential_buildings
  ADD COLUMN IF NOT EXISTS work_hours_per_day SMALLINT NOT NULL DEFAULT 8
  CHECK (work_hours_per_day BETWEEN 1 AND 24);

ALTER TABLE residential_buildings
  ADD COLUMN IF NOT EXISTS rent INTEGER NOT NULL DEFAULT 10 CHECK (rent BETWEEN 1 AND 100000);
ALTER TABLE residential_buildings
  ADD COLUMN IF NOT EXISTS occupants INTEGER NOT NULL DEFAULT 0 CHECK (occupants >= 0);
ALTER TABLE world_state
  ADD COLUMN IF NOT EXISTS last_immigration_day DATE;

ALTER TABLE residential_buildings
  DROP CONSTRAINT IF EXISTS residential_buildings_building_type_check,
  ADD CONSTRAINT residential_buildings_building_type_check
    CHECK (building_type IN ('house_poor1', 'house_poor2', 'farm_rice'));

CREATE INDEX IF NOT EXISTS residential_buildings_city_id_idx
  ON residential_buildings (city_id);

CREATE TABLE IF NOT EXISTS road_tiles (
  tile_x INTEGER NOT NULL CHECK (tile_x BETWEEN 0 AND 3999),
  tile_y INTEGER NOT NULL CHECK (tile_y BETWEEN 0 AND 3999),
  city_id UUID NOT NULL REFERENCES city_assemblies (id) ON DELETE CASCADE,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tile_x, tile_y)
);

CREATE INDEX IF NOT EXISTS road_tiles_city_id_idx ON road_tiles (city_id);
