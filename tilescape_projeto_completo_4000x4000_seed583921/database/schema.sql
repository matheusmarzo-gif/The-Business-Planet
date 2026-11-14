CREATE TABLE IF NOT EXISTS world_state (
  id SMALLINT PRIMARY KEY CHECK (id = 1),
  world_time TIMESTAMPTZ NOT NULL,
  last_real_at TIMESTAMPTZ NOT NULL,
  last_residence_relocation_day DATE
);

ALTER TABLE world_state
  ADD COLUMN IF NOT EXISTS last_residence_relocation_day DATE;
ALTER TABLE world_state
  ADD COLUMN IF NOT EXISTS last_population_change_day DATE;

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
  population_change_last_month INTEGER NOT NULL DEFAULT 0,
  wellbeing INTEGER NOT NULL DEFAULT 0 CHECK (wellbeing BETWEEN 0 AND 100),
  economy INTEGER NOT NULL DEFAULT 0 CHECK (economy >= 0),
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

ALTER TABLE city_assemblies
  ADD COLUMN IF NOT EXISTS minimum_wage NUMERIC(12, 2) NOT NULL DEFAULT 1
  CHECK (minimum_wage BETWEEN 1 AND 100000);
ALTER TABLE city_assemblies
  ADD COLUMN IF NOT EXISTS population_change_last_month INTEGER NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF to_regclass('public.all_buildings') IS NULL
     AND to_regclass('public.residential_buildings') IS NOT NULL THEN
    ALTER TABLE public.residential_buildings RENAME TO all_buildings;
  ELSIF to_regclass('public.all_buildings') IS NOT NULL
        AND to_regclass('public.residential_buildings') IS NOT NULL THEN
    RAISE EXCEPTION 'Both all_buildings and residential_buildings exist; refusing to leave building data split.';
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.residential_buildings_owner_type_number_idx') IS NOT NULL
     AND to_regclass('public.all_buildings_owner_type_number_idx') IS NULL THEN
    ALTER INDEX public.residential_buildings_owner_type_number_idx
      RENAME TO all_buildings_owner_type_number_idx;
  END IF;
  IF to_regclass('public.residential_buildings_city_id_idx') IS NOT NULL
     AND to_regclass('public.all_buildings_city_id_idx') IS NULL THEN
    ALTER INDEX public.residential_buildings_city_id_idx
      RENAME TO all_buildings_city_id_idx;
  END IF;
  IF to_regclass('public.residential_buildings_owner_warehouse_idx') IS NOT NULL
     AND to_regclass('public.all_buildings_owner_warehouse_idx') IS NULL THEN
    ALTER INDEX public.residential_buildings_owner_warehouse_idx
      RENAME TO all_buildings_owner_warehouse_idx;
  END IF;
  IF to_regclass('public.residential_warehouse_position_idx') IS NOT NULL
     AND to_regclass('public.all_buildings_warehouse_position_idx') IS NULL THEN
    ALTER INDEX public.residential_warehouse_position_idx
      RENAME TO all_buildings_warehouse_position_idx;
  END IF;
END $$;

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

CREATE TABLE IF NOT EXISTS all_buildings (
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

ALTER TABLE all_buildings
  ADD COLUMN IF NOT EXISTS building_number INTEGER;

WITH numbered_buildings AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY created_by, building_type
           ORDER BY started_at, id
         )::integer AS building_number
  FROM all_buildings
)
UPDATE all_buildings building
SET building_number = numbered_buildings.building_number
FROM numbered_buildings
WHERE building.id = numbered_buildings.id
  AND building.building_number IS NULL;

ALTER TABLE all_buildings
  ALTER COLUMN building_number SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS all_buildings_owner_type_number_idx
  ON all_buildings (created_by, building_type, building_number);

CREATE TABLE IF NOT EXISTS player_building_counters (
  user_id TEXT NOT NULL,
  building_type TEXT NOT NULL,
  last_number INTEGER NOT NULL CHECK (last_number > 0),
  PRIMARY KEY (user_id, building_type)
);

INSERT INTO player_building_counters (user_id, building_type, last_number)
SELECT created_by, building_type, MAX(building_number)
FROM all_buildings
GROUP BY created_by, building_type
ON CONFLICT (user_id, building_type) DO NOTHING;

CREATE TABLE IF NOT EXISTS player_warehouse_claims (
  user_id TEXT PRIMARY KEY,
  claimed_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

INSERT INTO player_warehouse_claims (user_id)
SELECT DISTINCT created_by
FROM all_buildings
WHERE building_type = 'warehouse'
ON CONFLICT (user_id) DO NOTHING;

ALTER TABLE all_buildings
  ADD COLUMN IF NOT EXISTS wage NUMERIC(12, 2) NOT NULL DEFAULT 10 CHECK (wage BETWEEN 0 AND 100000);
UPDATE all_buildings AS building
SET wage = city.minimum_wage
FROM city_assemblies AS city
WHERE building.city_id = city.id
  AND building.wage < city.minimum_wage;
ALTER TABLE all_buildings
  ADD COLUMN IF NOT EXISTS work_hours_per_day SMALLINT NOT NULL DEFAULT 8
  CHECK (work_hours_per_day BETWEEN 1 AND 24);

ALTER TABLE all_buildings
  ADD COLUMN IF NOT EXISTS rent NUMERIC(12, 2) NOT NULL DEFAULT 10 CHECK (rent BETWEEN 0.01 AND 100000);
ALTER TABLE all_buildings
  DROP CONSTRAINT IF EXISTS all_buildings_wage_check,
  DROP CONSTRAINT IF EXISTS residential_buildings_wage_check,
  DROP CONSTRAINT IF EXISTS all_buildings_rent_check,
  DROP CONSTRAINT IF EXISTS residential_buildings_rent_check,
  ALTER COLUMN wage TYPE NUMERIC(12, 2) USING wage::numeric(12, 2),
  ALTER COLUMN rent TYPE NUMERIC(12, 2) USING rent::numeric(12, 2),
  ADD CONSTRAINT all_buildings_wage_check CHECK (wage BETWEEN 0 AND 100000),
  ADD CONSTRAINT all_buildings_rent_check CHECK (rent BETWEEN 0.01 AND 100000);
ALTER TABLE all_buildings
  ADD COLUMN IF NOT EXISTS occupants INTEGER NOT NULL DEFAULT 0 CHECK (occupants >= 0);
ALTER TABLE all_buildings
  ADD COLUMN IF NOT EXISTS wellbeing DOUBLE PRECISION NOT NULL DEFAULT 0
  CHECK (wellbeing BETWEEN 0 AND 162);
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

ALTER TABLE all_buildings
  ADD COLUMN IF NOT EXISTS desired_workers INTEGER NOT NULL DEFAULT 0 CHECK (desired_workers >= 0);

ALTER TABLE all_buildings
  ADD COLUMN IF NOT EXISTS minimum_worker_technique SMALLINT NOT NULL DEFAULT 10
    CHECK (minimum_worker_technique BETWEEN 10 AND 40);

ALTER TABLE all_buildings
  ADD COLUMN IF NOT EXISTS work_points_done DOUBLE PRECISION NOT NULL DEFAULT 0 CHECK (work_points_done >= 0);

ALTER TABLE all_buildings
  ADD COLUMN IF NOT EXISTS price NUMERIC(12, 2) NOT NULL DEFAULT 10 CHECK (price BETWEEN 0.01 AND 100000);
ALTER TABLE all_buildings
  DROP CONSTRAINT IF EXISTS all_buildings_price_check,
  DROP CONSTRAINT IF EXISTS residential_buildings_price_check,
  ALTER COLUMN price TYPE NUMERIC(12, 2) USING price::numeric(12, 2);
ALTER TABLE all_buildings
  ADD CONSTRAINT all_buildings_price_check CHECK (price BETWEEN 0.01 AND 100000);
ALTER TABLE all_buildings
  ADD COLUMN IF NOT EXISTS stock INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0);
ALTER TABLE all_buildings
  ADD COLUMN IF NOT EXISTS stock_levels JSONB NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(stock_levels) = 'object');
ALTER TABLE all_buildings
  ADD COLUMN IF NOT EXISTS warehouse_id UUID REFERENCES all_buildings (id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS building_warehouse_links (
  building_id UUID NOT NULL REFERENCES all_buildings (id) ON DELETE CASCADE,
  warehouse_id UUID NOT NULL REFERENCES all_buildings (id) ON DELETE CASCADE,
  PRIMARY KEY (building_id, warehouse_id),
  CHECK (building_id <> warehouse_id)
);

CREATE INDEX IF NOT EXISTS building_warehouse_links_warehouse_idx
  ON building_warehouse_links (warehouse_id, building_id);

INSERT INTO building_warehouse_links (building_id, warehouse_id)
SELECT id, warehouse_id
FROM all_buildings
WHERE warehouse_id IS NOT NULL
ON CONFLICT DO NOTHING;
ALTER TABLE all_buildings
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

ALTER TABLE all_buildings
  DROP CONSTRAINT IF EXISTS all_buildings_farm_auto_planting_months_check,
  DROP CONSTRAINT IF EXISTS residential_buildings_farm_auto_planting_months_check,
  ADD CONSTRAINT all_buildings_farm_auto_planting_months_check
    CHECK (farm_auto_planting_months <@ ARRAY[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]::SMALLINT[]);

ALTER TABLE all_buildings
  ADD COLUMN IF NOT EXISTS tool_stock INTEGER NOT NULL DEFAULT 0 CHECK (tool_stock >= 0),
  ADD COLUMN IF NOT EXISTS efficiency_penalty INTEGER NOT NULL DEFAULT 0 CHECK (efficiency_penalty BETWEEN 0 AND 90),
  ADD COLUMN IF NOT EXISTS production_progress DOUBLE PRECISION NOT NULL DEFAULT 0 CHECK (production_progress >= 0),
  ADD COLUMN IF NOT EXISTS wood_stock INTEGER NOT NULL DEFAULT 0 CHECK (wood_stock >= 0),
  ADD COLUMN IF NOT EXISTS iron_stock INTEGER NOT NULL DEFAULT 0 CHECK (iron_stock >= 0),
  ADD COLUMN IF NOT EXISTS charcoal_stock INTEGER NOT NULL DEFAULT 0 CHECK (charcoal_stock >= 0),
  ADD COLUMN IF NOT EXISTS sugarcane_stock INTEGER NOT NULL DEFAULT 0 CHECK (sugarcane_stock >= 0),
  ADD COLUMN IF NOT EXISTS selected_input_product_id TEXT;

CREATE TABLE IF NOT EXISTS building_input_stock (
  building_id UUID NOT NULL REFERENCES all_buildings (id) ON DELETE CASCADE,
  product_id TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  PRIMARY KEY (building_id, product_id)
);

-- O caixa dos jogadores pode ficar negativo (folha de pagamento).
ALTER TABLE player_wallets DROP CONSTRAINT IF EXISTS player_wallets_balance_check;

ALTER TABLE all_buildings
  DROP CONSTRAINT IF EXISTS all_buildings_building_type_check,
  DROP CONSTRAINT IF EXISTS residential_buildings_building_type_check,
  ADD CONSTRAINT all_buildings_building_type_check
    CHECK (building_type IN (
      'house_poor1', 'house_poor2', 'house_poor3',
      'farm_rice', 'farm_potato', 'farm_wheat', 'farm_barley', 'farm_corn',
      'farm_cattle', 'farm_dairy', 'farm_cane', 'farm_spices', 'farm_vegetables',
      'farm_fruit', 'farm_cocoa', 'farm_sheep', 'farm_cotton',
      'shop_rice', 'shop_potato', 'shop_corn', 'shop_barley', 'shop_wheat',
      'shop_butcher', 'shop_milk', 'shop_sugar', 'shop_vegetables', 'shop_salt',
      'shop_spices', 'shop_bread', 'shop_cheese', 'shop_chocolate', 'shop_fruit',
      'shop_fish', 'shop_clothing', 'shop_furniture', 'shop_utilities', 'shop_glass',
      'warehouse', 'silo', 'fishery', 'salt_gatherer', 'lumber_mill', 'quarry',
      'iron_mine', 'toolmaker', 'sugar_mill', 'charcoal_works', 'flour_mill',
      'bread_factory', 'cheese_factory', 'chocolate_factory', 'steelworks',
      'thread_factory', 'textile_factory', 'furniture_factory', 'utilities_factory',
      'glass_factory', 'sand_pit'
    ));

CREATE TABLE IF NOT EXISTS building_footprint_catalog (
  building_type TEXT PRIMARY KEY,
  tile_count SMALLINT NOT NULL CHECK (tile_count > 0)
);

CREATE TABLE IF NOT EXISTS player_rank_metrics (
  user_id TEXT PRIMARY KEY,
  building_tiles INTEGER NOT NULL DEFAULT 0 CHECK (building_tiles >= 0)
);

CREATE OR REPLACE FUNCTION update_player_building_tiles()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  footprint_tiles INTEGER;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT tile_count INTO footprint_tiles
    FROM building_footprint_catalog
    WHERE building_type = NEW.building_type;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Missing footprint for building type %', NEW.building_type;
    END IF;
    INSERT INTO player_rank_metrics (user_id, building_tiles)
    VALUES (NEW.created_by, footprint_tiles)
    ON CONFLICT (user_id) DO UPDATE
    SET building_tiles = player_rank_metrics.building_tiles + EXCLUDED.building_tiles;
    RETURN NEW;
  END IF;

  SELECT tile_count INTO footprint_tiles
  FROM building_footprint_catalog
  WHERE building_type = OLD.building_type;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Missing footprint for building type %', OLD.building_type;
  END IF;
  UPDATE player_rank_metrics
  SET building_tiles = building_tiles - footprint_tiles
  WHERE user_id = OLD.created_by AND building_tiles >= footprint_tiles;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Building tile total is inconsistent for player %', OLD.created_by;
  END IF;
  RETURN OLD;
END;
$$;

CREATE TABLE IF NOT EXISTS player_investment_history (
  id BIGSERIAL PRIMARY KEY,
  user_id TEXT NOT NULL,
  day DATE NOT NULL,
  amount NUMERIC(14, 2) NOT NULL CHECK (amount >= 0),
  category TEXT NOT NULL CHECK (category IN ('construction', 'stock_upgrade'))
);

CREATE TABLE IF NOT EXISTS leaderboard_history_metadata (
  id SMALLINT PRIMARY KEY CHECK (id = 1),
  investment_tracking_from_day DATE NOT NULL
);

CREATE INDEX IF NOT EXISTS player_investment_history_day_idx
  ON player_investment_history (day, user_id);

CREATE TABLE IF NOT EXISTS warehouse_product_settings (
  building_id UUID NOT NULL REFERENCES all_buildings (id) ON DELETE CASCADE,
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
  workplace_id UUID NOT NULL REFERENCES all_buildings (id) ON DELETE CASCADE,
  residence_id UUID NOT NULL REFERENCES all_buildings (id) ON DELETE CASCADE,
  count INTEGER NOT NULL CHECK (count > 0),
  PRIMARY KEY (workplace_id, residence_id)
);

CREATE INDEX IF NOT EXISTS job_assignments_residence_id_idx ON job_assignments (residence_id);

CREATE TABLE IF NOT EXISTS warehouse_stock (
  building_id UUID NOT NULL REFERENCES all_buildings (id) ON DELETE CASCADE,
  product_id TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  PRIMARY KEY (building_id, product_id)
);

CREATE TABLE IF NOT EXISTS warehouse_demand (
  building_id UUID NOT NULL REFERENCES all_buildings (id) ON DELETE CASCADE,
  day DATE NOT NULL,
  demand DOUBLE PRECISION NOT NULL DEFAULT 0 CHECK (demand >= 0),
  PRIMARY KEY (building_id, day)
);

CREATE TABLE IF NOT EXISTS production_history (
  building_id UUID NOT NULL REFERENCES all_buildings (id) ON DELETE CASCADE,
  day DATE NOT NULL,
  work_points DOUBLE PRECISION NOT NULL DEFAULT 0 CHECK (work_points >= 0),
  produced DOUBLE PRECISION NOT NULL DEFAULT 0 CHECK (produced >= 0),
  transported DOUBLE PRECISION NOT NULL DEFAULT 0 CHECK (transported >= 0),
  efficiency DOUBLE PRECISION NOT NULL DEFAULT 100 CHECK (efficiency >= 0),
  PRIMARY KEY (building_id, day)
);

CREATE INDEX IF NOT EXISTS production_history_day_idx
  ON production_history (day, building_id);

CREATE TABLE IF NOT EXISTS production_input_history (
  building_id UUID NOT NULL REFERENCES all_buildings (id) ON DELETE CASCADE,
  product_id TEXT NOT NULL,
  day DATE NOT NULL,
  quantity DOUBLE PRECISION NOT NULL CHECK (quantity >= 0),
  PRIMARY KEY (building_id, product_id, day)
);

CREATE INDEX IF NOT EXISTS production_input_history_day_idx
  ON production_input_history (day, building_id);

CREATE TABLE IF NOT EXISTS product_cost_history (
  user_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  day DATE NOT NULL,
  unit_cost NUMERIC(14, 6) NOT NULL CHECK (unit_cost >= 0),
  source_quantity DOUBLE PRECISION NOT NULL DEFAULT 0 CHECK (source_quantity >= 0),
  PRIMARY KEY (user_id, product_id, day)
);

CREATE INDEX IF NOT EXISTS product_cost_history_user_day_idx
  ON product_cost_history (user_id, day DESC);

CREATE TABLE IF NOT EXISTS player_product_costs (
  user_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  unit_cost NUMERIC(14, 6) NOT NULL CHECK (unit_cost >= 0),
  updated_day DATE NOT NULL,
  PRIMARY KEY (user_id, product_id)
);

CREATE TABLE IF NOT EXISTS commerce_history (
  building_id UUID NOT NULL REFERENCES all_buildings (id) ON DELETE CASCADE,
  day DATE NOT NULL,
  employee_expense NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (employee_expense >= 0),
  product_expense NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (product_expense >= 0),
  units_sold INTEGER NOT NULL DEFAULT 0 CHECK (units_sold >= 0),
  units_lost INTEGER NOT NULL DEFAULT 0 CHECK (units_lost >= 0),
  average_unit_cost NUMERIC(14, 6) CHECK (average_unit_cost >= 0),
  sale_price NUMERIC(12, 2) NOT NULL CHECK (sale_price >= 0.01),
  diagnostics JSONB,
  PRIMARY KEY (building_id, day)
);

CREATE INDEX IF NOT EXISTS commerce_history_day_idx
  ON commerce_history (day, building_id);

ALTER TABLE commerce_history
  DROP CONSTRAINT IF EXISTS commerce_history_sale_price_check,
  ADD COLUMN IF NOT EXISTS units_lost INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS average_unit_cost NUMERIC(14, 6),
  ADD COLUMN IF NOT EXISTS diagnostics JSONB,
  ALTER COLUMN employee_expense TYPE NUMERIC(14, 2) USING employee_expense::numeric(14, 2),
  ALTER COLUMN product_expense TYPE NUMERIC(14, 2) USING product_expense::numeric(14, 2),
  ALTER COLUMN sale_price TYPE NUMERIC(12, 2) USING sale_price::numeric(12, 2),
  ADD CONSTRAINT commerce_history_sale_price_check CHECK (sale_price >= 0.01),
  DROP CONSTRAINT IF EXISTS commerce_history_units_lost_check,
  ADD CONSTRAINT commerce_history_units_lost_check CHECK (units_lost >= 0),
  DROP CONSTRAINT IF EXISTS commerce_history_average_unit_cost_check,
  ADD CONSTRAINT commerce_history_average_unit_cost_check CHECK (average_unit_cost >= 0);

CREATE TABLE IF NOT EXISTS warehouse_payroll_history (
  building_id UUID NOT NULL REFERENCES all_buildings (id) ON DELETE CASCADE,
  day DATE NOT NULL,
  employee_expense NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (employee_expense >= 0),
  PRIMARY KEY (building_id, day)
);

ALTER TABLE warehouse_payroll_history
  ALTER COLUMN employee_expense TYPE NUMERIC(14, 2) USING employee_expense::numeric(14, 2);

CREATE TABLE IF NOT EXISTS building_payroll_history (
  building_id UUID NOT NULL REFERENCES all_buildings (id) ON DELETE CASCADE,
  day DATE NOT NULL,
  employee_expense NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (employee_expense >= 0),
  PRIMARY KEY (building_id, day)
);

CREATE INDEX IF NOT EXISTS building_payroll_history_day_idx
  ON building_payroll_history (day, building_id);

INSERT INTO building_payroll_history (building_id, day, employee_expense)
SELECT building_id, day, employee_expense FROM commerce_history
UNION ALL
SELECT building_id, day, employee_expense FROM warehouse_payroll_history
ON CONFLICT (building_id, day) DO NOTHING;

CREATE TABLE IF NOT EXISTS residence_rent_history (
  building_id UUID NOT NULL REFERENCES all_buildings (id) ON DELETE CASCADE,
  day DATE NOT NULL,
  occupants INTEGER NOT NULL CHECK (occupants >= 0),
  rent_per_person NUMERIC(12, 2) NOT NULL CHECK (rent_per_person >= 0.01),
  rent_revenue NUMERIC(14, 2) NOT NULL CHECK (rent_revenue >= 0),
  PRIMARY KEY (building_id, day)
);

CREATE INDEX IF NOT EXISTS residence_rent_history_day_idx
  ON residence_rent_history (day, building_id);

CREATE TABLE IF NOT EXISTS warehouse_trade_history (
  id BIGSERIAL PRIMARY KEY,
  day DATE NOT NULL,
  buyer_id UUID NOT NULL REFERENCES all_buildings (id) ON DELETE CASCADE,
  seller_id UUID NOT NULL REFERENCES all_buildings (id) ON DELETE CASCADE,
  product_id TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_price NUMERIC(12, 2) NOT NULL CHECK (unit_price >= 0)
);

CREATE INDEX IF NOT EXISTS warehouse_trade_history_day_idx
  ON warehouse_trade_history (day);

ALTER TABLE warehouse_trade_history
  ALTER COLUMN unit_price TYPE NUMERIC(12, 2) USING unit_price::numeric(12, 2);

CREATE INDEX IF NOT EXISTS warehouse_trade_history_buyer_day_idx
  ON warehouse_trade_history (buyer_id, day DESC);
CREATE INDEX IF NOT EXISTS warehouse_trade_history_seller_day_idx
  ON warehouse_trade_history (seller_id, day DESC);

CREATE TABLE IF NOT EXISTS warehouse_transport_log (
  id BIGSERIAL PRIMARY KEY,
  warehouse_id UUID NOT NULL REFERENCES all_buildings (id) ON DELETE CASCADE,
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
  building_id UUID NOT NULL REFERENCES all_buildings (id) ON DELETE CASCADE,
  product_id TEXT NOT NULL,
  day DATE NOT NULL,
  quantity DOUBLE PRECISION NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  desired_quantity DOUBLE PRECISION CHECK (desired_quantity >= 0),
  spent NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (spent >= 0),
  occupants INTEGER NOT NULL DEFAULT 0 CHECK (occupants >= 0),
  consumers INTEGER DEFAULT 0 CHECK (consumers >= 0),
  PRIMARY KEY (building_id, product_id, day)
);

ALTER TABLE residence_consumption
  ADD COLUMN IF NOT EXISTS consumers INTEGER;
ALTER TABLE residence_consumption
  ADD COLUMN IF NOT EXISTS desired_quantity DOUBLE PRECISION;
ALTER TABLE residence_consumption
  ALTER COLUMN consumers SET DEFAULT 0;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.residence_consumption'::regclass
      AND conname = 'residence_consumption_consumers_check'
  ) THEN
    ALTER TABLE residence_consumption
      ADD CONSTRAINT residence_consumption_consumers_check CHECK (consumers >= 0);
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.residence_consumption'::regclass
      AND conname = 'residence_consumption_desired_quantity_check'
  ) THEN
    ALTER TABLE residence_consumption
      ADD CONSTRAINT residence_consumption_desired_quantity_check
      CHECK (desired_quantity >= 0);
  END IF;
END $$;
WITH expanded_diagnostics AS (
  SELECT
    CASE
      WHEN transaction_data.value ->> 'residenceId'
        ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      THEN (transaction_data.value ->> 'residenceId')::uuid
    END AS building_id,
    transaction_data.value ->> 'productId' AS product_id,
    shop_history.day,
    (transaction_data.value ->> 'expectedDemand')::double precision AS expected_demand,
    (transaction_data.value -> 'candidate' ->> 'resultShare')::double precision AS result_share,
    (transaction_data.value -> 'candidate' ->> 'associatedBenefit')::double precision
      AS associated_benefit
  FROM commerce_history shop_history
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE
      WHEN jsonb_typeof(shop_history.diagnostics) = 'array'
        THEN shop_history.diagnostics
      ELSE '[]'::jsonb
    END
  ) AS transaction_data(value)
  WHERE shop_history.day > (
    SELECT (world_time AT TIME ZONE 'UTC')::date - 30
    FROM world_state WHERE id = 1
  )
    AND jsonb_typeof(transaction_data.value -> 'expectedDemand') = 'number'
    AND jsonb_typeof(transaction_data.value -> 'candidate' -> 'resultShare') = 'number'
    AND jsonb_typeof(transaction_data.value -> 'candidate' -> 'associatedBenefit') = 'number'
    AND transaction_data.value ->> 'residenceId'
      ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
    AND transaction_data.value ->> 'productId' IS NOT NULL
), historical_desired_consumption AS (
  SELECT building_id, product_id, day,
         SUM(expected_demand * result_share * associated_benefit) AS desired_quantity
  FROM expanded_diagnostics
  GROUP BY building_id, product_id, day
)
UPDATE residence_consumption consumption
SET desired_quantity = historical.desired_quantity
FROM historical_desired_consumption historical
WHERE consumption.building_id = historical.building_id
  AND consumption.product_id = historical.product_id
  AND consumption.day = historical.day
  AND consumption.desired_quantity IS NULL;

ALTER TABLE residence_consumption
  ALTER COLUMN spent TYPE NUMERIC(14, 2) USING spent::numeric(14, 2);

CREATE INDEX IF NOT EXISTS residence_consumption_day_building_idx
  ON residence_consumption (day, building_id);

CREATE TABLE IF NOT EXISTS residence_relocation_log (
  id BIGSERIAL PRIMARY KEY,
  day DATE NOT NULL,
  source_residence_id UUID NOT NULL REFERENCES all_buildings (id) ON DELETE CASCADE,
  destination_residence_id UUID NOT NULL REFERENCES all_buildings (id) ON DELETE CASCADE,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  associated_source DOUBLE PRECISION NOT NULL CHECK (associated_source >= 0),
  associated_destination DOUBLE PRECISION NOT NULL CHECK (associated_destination >= 0)
);

CREATE INDEX IF NOT EXISTS residence_relocation_log_source_day_idx
  ON residence_relocation_log (source_residence_id, day DESC);
CREATE INDEX IF NOT EXISTS residence_relocation_log_destination_day_idx
  ON residence_relocation_log (destination_residence_id, day DESC);

CREATE INDEX IF NOT EXISTS all_buildings_city_id_idx
  ON all_buildings (city_id);
CREATE INDEX IF NOT EXISTS all_buildings_owner_warehouse_idx
  ON all_buildings (created_by, building_type, status, tile_x, tile_y);
CREATE INDEX IF NOT EXISTS all_buildings_warehouse_position_idx
  ON all_buildings (building_type, status, tile_x, tile_y);

CREATE TABLE IF NOT EXISTS road_tiles (
  tile_x INTEGER NOT NULL CHECK (tile_x BETWEEN 0 AND 3999),
  tile_y INTEGER NOT NULL CHECK (tile_y BETWEEN 0 AND 3999),
  city_id UUID NOT NULL REFERENCES city_assemblies (id) ON DELETE CASCADE,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tile_x, tile_y)
);

CREATE INDEX IF NOT EXISTS road_tiles_city_id_idx ON road_tiles (city_id);
