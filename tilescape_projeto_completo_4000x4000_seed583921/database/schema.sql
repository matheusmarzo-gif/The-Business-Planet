CREATE TABLE IF NOT EXISTS world_state (
  id SMALLINT PRIMARY KEY CHECK (id = 1),
  world_time TIMESTAMPTZ NOT NULL,
  last_real_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS player_wallets (
  user_id TEXT PRIMARY KEY,
  balance NUMERIC(14, 2) NOT NULL CHECK (balance >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

ALTER TABLE player_wallets
  ALTER COLUMN balance TYPE NUMERIC(14, 2) USING balance::numeric(14, 2);

CREATE TABLE IF NOT EXISTS city_assemblies (
  id UUID PRIMARY KEY,
  name VARCHAR(80) NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 80),
  center_x INTEGER NOT NULL CHECK (center_x BETWEEN 151 AND 3848),
  center_y INTEGER NOT NULL CHECK (center_y BETWEEN 151 AND 3848),
  minimum_wage NUMERIC(12, 2) NOT NULL DEFAULT 1 CHECK (minimum_wage BETWEEN 1 AND 100000),
  population INTEGER NOT NULL DEFAULT 0 CHECK (population >= 0),
  wellbeing INTEGER NOT NULL DEFAULT 0 CHECK (wellbeing BETWEEN 0 AND 100),
  economy INTEGER NOT NULL DEFAULT 0 CHECK (economy >= 0),
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

ALTER TABLE city_assemblies
  ADD COLUMN IF NOT EXISTS minimum_wage NUMERIC(12, 2) NOT NULL DEFAULT 1
  CHECK (minimum_wage BETWEEN 1 AND 100000);

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
  building_number INTEGER,
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
  ADD COLUMN IF NOT EXISTS building_number INTEGER;

WITH numbered_buildings AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY created_by, building_type
           ORDER BY started_at, id
         )::integer AS building_number
  FROM residential_buildings
)
UPDATE residential_buildings building
SET building_number = numbered_buildings.building_number
FROM numbered_buildings
WHERE building.id = numbered_buildings.id
  AND building.building_number IS NULL;

ALTER TABLE residential_buildings
  ALTER COLUMN building_number SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS residential_buildings_owner_type_number_idx
  ON residential_buildings (created_by, building_type, building_number);

CREATE TABLE IF NOT EXISTS player_building_counters (
  user_id TEXT NOT NULL,
  building_type TEXT NOT NULL,
  last_number INTEGER NOT NULL CHECK (last_number > 0),
  PRIMARY KEY (user_id, building_type)
);

INSERT INTO player_building_counters (user_id, building_type, last_number)
SELECT created_by, building_type, MAX(building_number)
FROM residential_buildings
GROUP BY created_by, building_type
ON CONFLICT (user_id, building_type) DO NOTHING;

CREATE TABLE IF NOT EXISTS player_warehouse_claims (
  user_id TEXT PRIMARY KEY,
  claimed_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

INSERT INTO player_warehouse_claims (user_id)
SELECT DISTINCT created_by
FROM residential_buildings
WHERE building_type = 'warehouse'
ON CONFLICT (user_id) DO NOTHING;

ALTER TABLE residential_buildings
  ADD COLUMN IF NOT EXISTS wage NUMERIC(12, 2) NOT NULL DEFAULT 10 CHECK (wage BETWEEN 0 AND 100000);
UPDATE residential_buildings AS building
SET wage = city.minimum_wage
FROM city_assemblies AS city
WHERE building.city_id = city.id
  AND building.wage < city.minimum_wage;
ALTER TABLE residential_buildings
  ADD COLUMN IF NOT EXISTS work_hours_per_day SMALLINT NOT NULL DEFAULT 8
  CHECK (work_hours_per_day BETWEEN 1 AND 24);

ALTER TABLE residential_buildings
  ADD COLUMN IF NOT EXISTS rent NUMERIC(12, 2) NOT NULL DEFAULT 10 CHECK (rent BETWEEN 0.01 AND 100000);
ALTER TABLE residential_buildings
  DROP CONSTRAINT IF EXISTS residential_buildings_wage_check,
  DROP CONSTRAINT IF EXISTS residential_buildings_rent_check,
  ALTER COLUMN wage TYPE NUMERIC(12, 2) USING wage::numeric(12, 2),
  ALTER COLUMN rent TYPE NUMERIC(12, 2) USING rent::numeric(12, 2),
  ADD CONSTRAINT residential_buildings_wage_check CHECK (wage BETWEEN 0 AND 100000),
  ADD CONSTRAINT residential_buildings_rent_check CHECK (rent BETWEEN 0.01 AND 100000);
ALTER TABLE residential_buildings
  ADD COLUMN IF NOT EXISTS occupants INTEGER NOT NULL DEFAULT 0 CHECK (occupants >= 0);
ALTER TABLE world_state
  ADD COLUMN IF NOT EXISTS last_immigration_day DATE;
ALTER TABLE world_state
  ADD COLUMN IF NOT EXISTS last_job_allocation_day DATE;
ALTER TABLE world_state
  ADD COLUMN IF NOT EXISTS last_payroll_day DATE;
ALTER TABLE world_state
  ADD COLUMN IF NOT EXISTS last_warehouse_trade_slot TEXT;
ALTER TABLE world_state
  ADD COLUMN IF NOT EXISTS last_spoilage_day DATE;
ALTER TABLE world_state
  ADD COLUMN IF NOT EXISTS last_full_world_sync_day DATE;
ALTER TABLE world_state
  ADD COLUMN IF NOT EXISTS time_scale DOUBLE PRECISION NOT NULL DEFAULT 15 CHECK (time_scale > 0);

ALTER TABLE residential_buildings
  ADD COLUMN IF NOT EXISTS desired_workers INTEGER NOT NULL DEFAULT 0 CHECK (desired_workers >= 0);

ALTER TABLE residential_buildings
  ADD COLUMN IF NOT EXISTS work_points_done DOUBLE PRECISION NOT NULL DEFAULT 0 CHECK (work_points_done >= 0);

ALTER TABLE residential_buildings
  ADD COLUMN IF NOT EXISTS price NUMERIC(12, 2) NOT NULL DEFAULT 10 CHECK (price BETWEEN 0.01 AND 100000);
ALTER TABLE residential_buildings
  DROP CONSTRAINT IF EXISTS residential_buildings_price_check,
  ALTER COLUMN price TYPE NUMERIC(12, 2) USING price::numeric(12, 2);
ALTER TABLE residential_buildings
  ADD CONSTRAINT residential_buildings_price_check CHECK (price BETWEEN 0.01 AND 100000);
ALTER TABLE residential_buildings
  ADD COLUMN IF NOT EXISTS stock INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0);
ALTER TABLE residential_buildings
  ADD COLUMN IF NOT EXISTS warehouse_id UUID REFERENCES residential_buildings (id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS building_warehouse_links (
  building_id UUID NOT NULL REFERENCES residential_buildings (id) ON DELETE CASCADE,
  warehouse_id UUID NOT NULL REFERENCES residential_buildings (id) ON DELETE CASCADE,
  PRIMARY KEY (building_id, warehouse_id),
  CHECK (building_id <> warehouse_id)
);

CREATE INDEX IF NOT EXISTS building_warehouse_links_warehouse_idx
  ON building_warehouse_links (warehouse_id, building_id);

INSERT INTO building_warehouse_links (building_id, warehouse_id)
SELECT id, warehouse_id
FROM residential_buildings
WHERE warehouse_id IS NOT NULL
ON CONFLICT DO NOTHING;
ALTER TABLE residential_buildings
  ADD COLUMN IF NOT EXISTS crop_phase TEXT CHECK (crop_phase IN ('growing', 'harvesting')),
  ADD COLUMN IF NOT EXISTS crop_planted_day DATE,
  ADD COLUMN IF NOT EXISTS crop_ratio_sum DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS crop_days INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS crop_yield INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS crop_harvested INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS farm_auto_planting_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS farm_auto_planting_months SMALLINT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS farm_planting_workers INTEGER NOT NULL DEFAULT 0 CHECK (farm_planting_workers >= 0),
  ADD COLUMN IF NOT EXISTS farm_harvest_workers INTEGER NOT NULL DEFAULT 0 CHECK (farm_harvest_workers >= 0);

ALTER TABLE residential_buildings
  DROP CONSTRAINT IF EXISTS residential_buildings_farm_auto_planting_months_check,
  ADD CONSTRAINT residential_buildings_farm_auto_planting_months_check
    CHECK (farm_auto_planting_months <@ ARRAY[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]::SMALLINT[]);

ALTER TABLE residential_buildings
  ADD COLUMN IF NOT EXISTS tool_stock INTEGER NOT NULL DEFAULT 0 CHECK (tool_stock >= 0),
  ADD COLUMN IF NOT EXISTS efficiency_penalty INTEGER NOT NULL DEFAULT 0 CHECK (efficiency_penalty BETWEEN 0 AND 90),
  ADD COLUMN IF NOT EXISTS production_progress DOUBLE PRECISION NOT NULL DEFAULT 0 CHECK (production_progress >= 0),
  ADD COLUMN IF NOT EXISTS wood_stock INTEGER NOT NULL DEFAULT 0 CHECK (wood_stock >= 0),
  ADD COLUMN IF NOT EXISTS iron_stock INTEGER NOT NULL DEFAULT 0 CHECK (iron_stock >= 0),
  ADD COLUMN IF NOT EXISTS charcoal_stock INTEGER NOT NULL DEFAULT 0 CHECK (charcoal_stock >= 0),
  ADD COLUMN IF NOT EXISTS sugarcane_stock INTEGER NOT NULL DEFAULT 0 CHECK (sugarcane_stock >= 0),
  ADD COLUMN IF NOT EXISTS selected_input_product_id TEXT;

CREATE TABLE IF NOT EXISTS building_input_stock (
  building_id UUID NOT NULL REFERENCES residential_buildings (id) ON DELETE CASCADE,
  product_id TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  PRIMARY KEY (building_id, product_id)
);

-- O caixa dos jogadores pode ficar negativo (folha de pagamento).
ALTER TABLE player_wallets DROP CONSTRAINT IF EXISTS player_wallets_balance_check;

ALTER TABLE residential_buildings
  DROP CONSTRAINT IF EXISTS residential_buildings_building_type_check,
  ADD CONSTRAINT residential_buildings_building_type_check
    CHECK (building_type IN ('house_poor1', 'house_poor2', 'house_poor3', 'farm_rice', 'farm_potato', 'farm_wheat', 'farm_barley', 'farm_corn', 'farm_cattle', 'farm_dairy', 'farm_cane', 'farm_spices', 'farm_vegetables', 'farm_fruit', 'farm_cocoa', 'shop_rice', 'shop_potato', 'shop_corn', 'shop_barley', 'shop_wheat', 'shop_butcher', 'shop_milk', 'shop_sugar', 'shop_vegetables', 'shop_salt', 'shop_spices', 'shop_bread', 'shop_cheese', 'shop_chocolate', 'shop_fruit', 'warehouse', 'silo', 'fishery', 'shop_fish', 'salt_gatherer', 'lumber_mill', 'quarry', 'iron_mine', 'toolmaker', 'sugar_mill', 'charcoal_works', 'flour_mill', 'bread_factory', 'cheese_factory', 'chocolate_factory'));

CREATE TABLE IF NOT EXISTS warehouse_product_settings (
  building_id UUID NOT NULL REFERENCES residential_buildings (id) ON DELETE CASCADE,
  product_id TEXT NOT NULL,
  minimum_stock INTEGER NOT NULL DEFAULT 0 CHECK (minimum_stock BETWEEN 0 AND 1000000),
  maximum_stock INTEGER CHECK (maximum_stock BETWEEN 0 AND 1000000),
  price NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (price BETWEEN 0 AND 1000000),
  mode TEXT NOT NULL DEFAULT 'sell' CHECK (mode IN ('sell', 'buy')),
  PRIMARY KEY (building_id, product_id)
);

ALTER TABLE warehouse_product_settings
  ALTER COLUMN price TYPE NUMERIC(12, 2) USING price::numeric(12, 2);

DO $$
DECLARE
  has_minimum_stock BOOLEAN;
  has_maximum_stock BOOLEAN;
  has_legacy_desired_stock BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'warehouse_product_settings'
      AND column_name = 'minimum_stock'
  ) INTO has_minimum_stock;
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'warehouse_product_settings'
      AND column_name = 'maximum_stock'
  ) INTO has_maximum_stock;
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'warehouse_product_settings'
      AND column_name = 'desired_stock'
  ) INTO has_legacy_desired_stock;

  IF NOT has_minimum_stock THEN
    ALTER TABLE warehouse_product_settings
      ADD COLUMN minimum_stock INTEGER NOT NULL DEFAULT 0
      CHECK (minimum_stock BETWEEN 0 AND 1000000);
    IF has_legacy_desired_stock THEN
      EXECUTE 'UPDATE warehouse_product_settings SET minimum_stock = desired_stock';
    END IF;
  END IF;

  IF NOT has_maximum_stock THEN
    ALTER TABLE warehouse_product_settings
      ADD COLUMN maximum_stock INTEGER
      CHECK (maximum_stock BETWEEN 0 AND 1000000);
    IF has_legacy_desired_stock THEN
      EXECUTE 'UPDATE warehouse_product_settings SET maximum_stock = NULLIF(desired_stock, 0)';
    END IF;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'warehouse_product_settings'::regclass
      AND conname = 'warehouse_product_settings_stock_range_check'
  ) THEN
    ALTER TABLE warehouse_product_settings
      ADD CONSTRAINT warehouse_product_settings_stock_range_check
      CHECK (maximum_stock IS NULL OR minimum_stock <= maximum_stock);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS job_assignments (
  workplace_id UUID NOT NULL REFERENCES residential_buildings (id) ON DELETE CASCADE,
  residence_id UUID NOT NULL REFERENCES residential_buildings (id) ON DELETE CASCADE,
  count INTEGER NOT NULL CHECK (count > 0),
  PRIMARY KEY (workplace_id, residence_id)
);

CREATE INDEX IF NOT EXISTS job_assignments_residence_id_idx ON job_assignments (residence_id);

CREATE TABLE IF NOT EXISTS warehouse_stock (
  building_id UUID NOT NULL REFERENCES residential_buildings (id) ON DELETE CASCADE,
  product_id TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  PRIMARY KEY (building_id, product_id)
);

CREATE TABLE IF NOT EXISTS warehouse_demand (
  building_id UUID NOT NULL REFERENCES residential_buildings (id) ON DELETE CASCADE,
  day DATE NOT NULL,
  demand DOUBLE PRECISION NOT NULL DEFAULT 0 CHECK (demand >= 0),
  PRIMARY KEY (building_id, day)
);

CREATE TABLE IF NOT EXISTS production_history (
  building_id UUID NOT NULL REFERENCES residential_buildings (id) ON DELETE CASCADE,
  day DATE NOT NULL,
  work_points DOUBLE PRECISION NOT NULL DEFAULT 0 CHECK (work_points >= 0),
  produced DOUBLE PRECISION NOT NULL DEFAULT 0 CHECK (produced >= 0),
  transported DOUBLE PRECISION NOT NULL DEFAULT 0 CHECK (transported >= 0),
  efficiency DOUBLE PRECISION NOT NULL DEFAULT 100 CHECK (efficiency >= 0),
  PRIMARY KEY (building_id, day)
);

CREATE TABLE IF NOT EXISTS commerce_history (
  building_id UUID NOT NULL REFERENCES residential_buildings (id) ON DELETE CASCADE,
  day DATE NOT NULL,
  employee_expense NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (employee_expense >= 0),
  product_expense NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (product_expense >= 0),
  units_sold INTEGER NOT NULL DEFAULT 0 CHECK (units_sold >= 0),
  sale_price NUMERIC(12, 2) NOT NULL CHECK (sale_price >= 0.01),
  PRIMARY KEY (building_id, day)
);

ALTER TABLE commerce_history
  DROP CONSTRAINT IF EXISTS commerce_history_sale_price_check,
  ALTER COLUMN employee_expense TYPE NUMERIC(14, 2) USING employee_expense::numeric(14, 2),
  ALTER COLUMN product_expense TYPE NUMERIC(14, 2) USING product_expense::numeric(14, 2),
  ALTER COLUMN sale_price TYPE NUMERIC(12, 2) USING sale_price::numeric(12, 2),
  ADD CONSTRAINT commerce_history_sale_price_check CHECK (sale_price >= 0.01);

CREATE TABLE IF NOT EXISTS warehouse_payroll_history (
  building_id UUID NOT NULL REFERENCES residential_buildings (id) ON DELETE CASCADE,
  day DATE NOT NULL,
  employee_expense NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (employee_expense >= 0),
  PRIMARY KEY (building_id, day)
);

ALTER TABLE warehouse_payroll_history
  ALTER COLUMN employee_expense TYPE NUMERIC(14, 2) USING employee_expense::numeric(14, 2);

CREATE TABLE IF NOT EXISTS building_payroll_history (
  building_id UUID NOT NULL REFERENCES residential_buildings (id) ON DELETE CASCADE,
  day DATE NOT NULL,
  employee_expense NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (employee_expense >= 0),
  PRIMARY KEY (building_id, day)
);

INSERT INTO building_payroll_history (building_id, day, employee_expense)
SELECT building_id, day, employee_expense FROM commerce_history
UNION ALL
SELECT building_id, day, employee_expense FROM warehouse_payroll_history
ON CONFLICT (building_id, day) DO NOTHING;

CREATE TABLE IF NOT EXISTS residence_rent_history (
  building_id UUID NOT NULL REFERENCES residential_buildings (id) ON DELETE CASCADE,
  day DATE NOT NULL,
  occupants INTEGER NOT NULL CHECK (occupants >= 0),
  rent_per_person NUMERIC(12, 2) NOT NULL CHECK (rent_per_person >= 0.01),
  rent_revenue NUMERIC(14, 2) NOT NULL CHECK (rent_revenue >= 0),
  PRIMARY KEY (building_id, day)
);

CREATE TABLE IF NOT EXISTS warehouse_trade_history (
  id BIGSERIAL PRIMARY KEY,
  day DATE NOT NULL,
  buyer_id UUID NOT NULL REFERENCES residential_buildings (id) ON DELETE CASCADE,
  seller_id UUID NOT NULL REFERENCES residential_buildings (id) ON DELETE CASCADE,
  product_id TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_price NUMERIC(12, 2) NOT NULL CHECK (unit_price >= 0)
);

ALTER TABLE warehouse_trade_history
  ALTER COLUMN unit_price TYPE NUMERIC(12, 2) USING unit_price::numeric(12, 2);

CREATE INDEX IF NOT EXISTS warehouse_trade_history_buyer_day_idx
  ON warehouse_trade_history (buyer_id, day DESC);
CREATE INDEX IF NOT EXISTS warehouse_trade_history_seller_day_idx
  ON warehouse_trade_history (seller_id, day DESC);

CREATE TABLE IF NOT EXISTS warehouse_transport_log (
  id BIGSERIAL PRIMARY KEY,
  warehouse_id UUID NOT NULL REFERENCES residential_buildings (id) ON DELETE CASCADE,
  day DATE NOT NULL,
  linked_id UUID NOT NULL,
  linked_type TEXT NOT NULL,
  product_id TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('in', 'out')),
  wanted INTEGER NOT NULL CHECK (wanted >= 0),
  moved INTEGER NOT NULL CHECK (moved >= 0),
  reason TEXT,
  error_detail TEXT
);

ALTER TABLE warehouse_transport_log
  ADD COLUMN IF NOT EXISTS error_detail TEXT;

CREATE INDEX IF NOT EXISTS warehouse_transport_log_idx ON warehouse_transport_log (warehouse_id, day DESC);

CREATE TABLE IF NOT EXISTS residence_consumption (
  building_id UUID NOT NULL REFERENCES residential_buildings (id) ON DELETE CASCADE,
  product_id TEXT NOT NULL,
  day DATE NOT NULL,
  quantity DOUBLE PRECISION NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  spent NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (spent >= 0),
  occupants INTEGER NOT NULL DEFAULT 0 CHECK (occupants >= 0),
  PRIMARY KEY (building_id, product_id, day)
);

ALTER TABLE residence_consumption
  ALTER COLUMN spent TYPE NUMERIC(14, 2) USING spent::numeric(14, 2);

CREATE INDEX IF NOT EXISTS residential_buildings_city_id_idx
  ON residential_buildings (city_id);
CREATE INDEX IF NOT EXISTS residential_buildings_owner_warehouse_idx
  ON residential_buildings (created_by, building_type, status, tile_x, tile_y);
CREATE INDEX IF NOT EXISTS residential_warehouse_position_idx
  ON residential_buildings (building_type, status, tile_x, tile_y);

CREATE TABLE IF NOT EXISTS road_tiles (
  tile_x INTEGER NOT NULL CHECK (tile_x BETWEEN 0 AND 3999),
  tile_y INTEGER NOT NULL CHECK (tile_y BETWEEN 0 AND 3999),
  city_id UUID NOT NULL REFERENCES city_assemblies (id) ON DELETE CASCADE,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tile_x, tile_y)
);

CREATE INDEX IF NOT EXISTS road_tiles_city_id_idx ON road_tiles (city_id);
