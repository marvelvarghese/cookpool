-- 340_kitchen_foods: one shared list of foods, and what links a pantry's items to it.
--
-- Context: kitchen
-- Epic: cookpool-recipes (RC-4, design §2, §3.4, §6) — what people buy and
--       what recipes call for meet in one list of foods. An item named
--       "Onions", "pyaz" or "kanda" is the food `onion`; a recipe line asks
--       for `onion`; the match (design §3.3) counts the one against the other.
--
-- Design rules:
--   * Additive and idempotent: CREATE … IF NOT EXISTS, one nullable column on
--     kitchen_items with no default (items added before read as NULL: not
--     linked), and the seed rows with INSERT OR IGNORE. SQLite has no ADD
--     COLUMN IF NOT EXISTS, so the runner's applied ledger keeps the column
--     add from running twice (as 240, 260, 290 and 300 do).
--   * A food is keyed by a short ASCII key (`onion`, `toor_dal`) and has one
--     dimension — mass, volume or count — and, for the things people count
--     ("2 onions", "3 eggs"), each_g: one piece in whole grams, so a count
--     meets a weight. Its category is one of the pantry's own (veg, fruit,
--     dairy, grains, protein, spices, other), so Bought can fill it in.
--   * kitchen_food_names maps every spelling and language to one food: a name
--     belongs to exactly one food (its key is the primary key). Names are
--     stored as SQLite folds them, lower(trim(name)) — ASCII letters fold, as
--     the pantry search and the measures fold them — and an item's name is
--     looked up by the same expression: the name itself, else the name without
--     a plural "es" or "s" when those agree on one food (kitchen-worker's
--     matchFood, packages/db kitchen/foods.ts). Nothing that does not match is
--     guessed: the item stays unlinked (risks RC-B).
--   * kitchen_items.food_key is written when an item is added (the lookup
--     above, in the add's own batch) and by an answer below. An item that
--     links to nothing reads as NULL.
--   * kitchen_food_answers is "asked once" (design §2): the answer a pantry
--     gave for a name ("Is Kanda onion?" — yes: onion; no: NULL), kept per
--     pantry the way kitchen_measures keys it (owner_kind + owner_id: a
--     person's own pantry by their usr_…, a group's by its UUID) and name_key
--     (lower(trim(name))). An answer wins over the names table for that
--     pantry's items of that name, a NULL answer included.
--   * kitchen_always_have is each person's short list of foods they always
--     have (design §3.4): lines for them count as there. New people start
--     with salt and water — read as the default while kitchen_always_have_lists
--     has no row for them; the first time they save their list it gets one,
--     so a list they emptied stays empty.
--   * The seed is 70 everyday foods (design: about 60) with their common names in English, Hindi
--     and the regional words people use. RC-7 (migration 360) brings the list
--     to about 300 the same way: one row per food, then one row per name.
--   * owner_id and user_id are opaque references (membership_organizations.id,
--     or a public usr_… id) with no cross-context FK; answered_by is a usr_….

CREATE TABLE IF NOT EXISTS kitchen_foods (
  key        TEXT PRIMARY KEY CHECK (length(key) BETWEEN 1 AND 40 AND key NOT GLOB '*[^a-z0-9_]*'),
  name       TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 60),
  dimension  TEXT NOT NULL CHECK (dimension IN ('mass', 'volume', 'count')),
  each_g     INTEGER CHECK (each_g IS NULL OR each_g BETWEEN 1 AND 100000),
  category   TEXT NOT NULL CHECK (length(category) BETWEEN 1 AND 60)
);

CREATE TABLE IF NOT EXISTS kitchen_food_names (
  name_key  TEXT PRIMARY KEY CHECK (length(name_key) BETWEEN 1 AND 120 AND name_key = lower(trim(name_key))),
  food_key  TEXT NOT NULL REFERENCES kitchen_foods(key)
);

-- A food's names (the food list's search shows the name that matched).
CREATE INDEX IF NOT EXISTS kitchen_food_names_food_idx
  ON kitchen_food_names (food_key);

ALTER TABLE kitchen_items ADD COLUMN food_key TEXT REFERENCES kitchen_foods(key);

CREATE TABLE IF NOT EXISTS kitchen_food_answers (
  owner_kind   TEXT NOT NULL CHECK (owner_kind IN ('user', 'group')),
  owner_id     TEXT NOT NULL,
  name_key     TEXT NOT NULL CHECK (length(name_key) BETWEEN 1 AND 120 AND name_key = lower(trim(name_key))),
  food_key     TEXT REFERENCES kitchen_foods(key),
  answered_by  TEXT NOT NULL,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  -- One answer per name in a pantry.
  PRIMARY KEY (owner_kind, owner_id, name_key)
);

CREATE TABLE IF NOT EXISTS kitchen_always_have (
  user_id     TEXT NOT NULL,
  food_key    TEXT NOT NULL REFERENCES kitchen_foods(key),
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (user_id, food_key)
);

CREATE TABLE IF NOT EXISTS kitchen_always_have_lists (
  user_id     TEXT PRIMARY KEY,
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- The seed: (key, name, dimension, each_g, category), one food a line.
INSERT OR IGNORE INTO kitchen_foods (key, name, dimension, each_g, category) VALUES
  ('onion', 'Onion', 'mass', 150, 'veg'),
  ('tomato', 'Tomato', 'mass', 100, 'veg'),
  ('potato', 'Potato', 'mass', 150, 'veg'),
  ('garlic', 'Garlic', 'mass', 5, 'veg'),
  ('ginger', 'Ginger', 'mass', 10, 'veg'),
  ('green_chilli', 'Green chilli', 'mass', 5, 'veg'),
  ('coriander_leaves', 'Coriander leaves', 'mass', NULL, 'veg'),
  ('curry_leaves', 'Curry leaves', 'mass', NULL, 'veg'),
  ('mint', 'Mint', 'mass', NULL, 'veg'),
  ('spinach', 'Spinach', 'mass', NULL, 'veg'),
  ('cauliflower', 'Cauliflower', 'mass', 600, 'veg'),
  ('cabbage', 'Cabbage', 'mass', 800, 'veg'),
  ('carrot', 'Carrot', 'mass', 70, 'veg'),
  ('green_peas', 'Green peas', 'mass', NULL, 'veg'),
  ('capsicum', 'Capsicum', 'mass', 150, 'veg'),
  ('brinjal', 'Brinjal', 'mass', 250, 'veg'),
  ('okra', 'Okra', 'mass', 10, 'veg'),
  ('cucumber', 'Cucumber', 'mass', 200, 'veg'),
  ('mushroom', 'Mushroom', 'mass', 15, 'veg'),
  ('green_beans', 'Green beans', 'mass', NULL, 'veg'),
  ('lemon', 'Lemon', 'mass', 50, 'fruit'),
  ('banana', 'Banana', 'mass', 120, 'fruit'),
  ('apple', 'Apple', 'mass', 180, 'fruit'),
  ('coconut', 'Coconut', 'mass', 400, 'fruit'),
  ('rice', 'Rice', 'mass', NULL, 'grains'),
  ('atta', 'Wheat flour (atta)', 'mass', NULL, 'grains'),
  ('maida', 'Maida', 'mass', NULL, 'grains'),
  ('besan', 'Besan', 'mass', NULL, 'grains'),
  ('rava', 'Rava (sooji)', 'mass', NULL, 'grains'),
  ('poha', 'Poha', 'mass', NULL, 'grains'),
  ('bread', 'Bread', 'count', 25, 'grains'),
  ('pasta', 'Pasta', 'mass', NULL, 'grains'),
  ('oats', 'Oats', 'mass', NULL, 'grains'),
  ('noodles', 'Noodles', 'mass', NULL, 'grains'),
  ('toor_dal', 'Toor dal', 'mass', NULL, 'grains'),
  ('moong_dal', 'Moong dal', 'mass', NULL, 'grains'),
  ('masoor_dal', 'Masoor dal', 'mass', NULL, 'grains'),
  ('chana_dal', 'Chana dal', 'mass', NULL, 'grains'),
  ('urad_dal', 'Urad dal', 'mass', NULL, 'grains'),
  ('chickpeas', 'Chickpeas (chole)', 'mass', NULL, 'grains'),
  ('rajma', 'Rajma', 'mass', NULL, 'grains'),
  ('egg', 'Egg', 'count', 50, 'protein'),
  ('chicken', 'Chicken', 'mass', NULL, 'protein'),
  ('mutton', 'Mutton', 'mass', NULL, 'protein'),
  ('fish', 'Fish', 'mass', NULL, 'protein'),
  ('paneer', 'Paneer', 'mass', NULL, 'dairy'),
  ('milk', 'Milk', 'volume', NULL, 'dairy'),
  ('curd', 'Curd (yogurt)', 'mass', NULL, 'dairy'),
  ('butter', 'Butter', 'mass', NULL, 'dairy'),
  ('ghee', 'Ghee', 'volume', NULL, 'dairy'),
  ('cream', 'Cream', 'volume', NULL, 'dairy'),
  ('cheese', 'Cheese', 'mass', NULL, 'dairy'),
  ('oil', 'Cooking oil', 'volume', NULL, 'other'),
  ('salt', 'Salt', 'mass', NULL, 'spices'),
  ('sugar', 'Sugar', 'mass', NULL, 'other'),
  ('jaggery', 'Jaggery', 'mass', NULL, 'other'),
  ('water', 'Water', 'volume', NULL, 'other'),
  ('tea', 'Tea', 'mass', NULL, 'other'),
  ('tamarind', 'Tamarind', 'mass', NULL, 'other'),
  ('turmeric', 'Turmeric', 'mass', NULL, 'spices'),
  ('red_chilli_powder', 'Red chilli powder', 'mass', NULL, 'spices'),
  ('coriander_powder', 'Coriander powder', 'mass', NULL, 'spices'),
  ('cumin', 'Cumin (jeera)', 'mass', NULL, 'spices'),
  ('mustard_seeds', 'Mustard seeds', 'mass', NULL, 'spices'),
  ('garam_masala', 'Garam masala', 'mass', NULL, 'spices'),
  ('ginger_garlic_paste', 'Ginger-garlic paste', 'mass', NULL, 'spices'),
  ('black_pepper', 'Black pepper', 'mass', NULL, 'spices'),
  ('cardamom', 'Cardamom', 'mass', NULL, 'spices'),
  ('hing', 'Asafoetida (hing)', 'mass', NULL, 'spices'),
  ('bay_leaf', 'Bay leaf', 'mass', NULL, 'spices');

-- Every name a food goes by: (name, food), one food's names a line.
INSERT OR IGNORE INTO kitchen_food_names (name_key, food_key) VALUES
  ('onion', 'onion'), ('onions', 'onion'), ('red onion', 'onion'), ('red onions', 'onion'), ('pyaz', 'onion'), ('pyaaz', 'onion'), ('piyaz', 'onion'), ('kanda', 'onion'), ('kaanda', 'onion'), ('vengayam', 'onion'), ('ulli', 'onion'), ('eerulli', 'onion'),
  ('tomato', 'tomato'), ('tomatoes', 'tomato'), ('tamatar', 'tomato'), ('thakkali', 'tomato'),
  ('potato', 'potato'), ('potatoes', 'potato'), ('aloo', 'potato'), ('alu', 'potato'), ('batata', 'potato'), ('urulai', 'potato'),
  ('garlic', 'garlic'), ('garlic clove', 'garlic'), ('garlic cloves', 'garlic'), ('lahsun', 'garlic'), ('lehsun', 'garlic'), ('lasun', 'garlic'), ('poondu', 'garlic'),
  ('ginger', 'ginger'), ('adrak', 'ginger'), ('adrakh', 'ginger'), ('inji', 'ginger'), ('allam', 'ginger'),
  ('green chilli', 'green_chilli'), ('green chillies', 'green_chilli'), ('green chili', 'green_chilli'), ('green chilies', 'green_chilli'), ('chilli', 'green_chilli'), ('chili', 'green_chilli'), ('hari mirch', 'green_chilli'), ('mirchi', 'green_chilli'), ('pachai milagai', 'green_chilli'),
  ('coriander', 'coriander_leaves'), ('coriander leaves', 'coriander_leaves'), ('fresh coriander', 'coriander_leaves'), ('cilantro', 'coriander_leaves'), ('dhaniya', 'coriander_leaves'), ('dhania', 'coriander_leaves'), ('hara dhaniya', 'coriander_leaves'), ('kothamalli', 'coriander_leaves'), ('kothimbir', 'coriander_leaves'),
  ('curry leaves', 'curry_leaves'), ('curry leaf', 'curry_leaves'), ('kadi patta', 'curry_leaves'), ('kadhi patta', 'curry_leaves'), ('kadipatta', 'curry_leaves'), ('karuveppilai', 'curry_leaves'),
  ('mint', 'mint'), ('mint leaves', 'mint'), ('pudina', 'mint'),
  ('spinach', 'spinach'), ('palak', 'spinach'),
  ('cauliflower', 'cauliflower'), ('gobi', 'cauliflower'), ('gobhi', 'cauliflower'), ('phool gobi', 'cauliflower'),
  ('cabbage', 'cabbage'), ('patta gobi', 'cabbage'), ('band gobi', 'cabbage'), ('bandh gobhi', 'cabbage'),
  ('carrot', 'carrot'), ('carrots', 'carrot'), ('gajar', 'carrot'),
  ('peas', 'green_peas'), ('green peas', 'green_peas'), ('matar', 'green_peas'), ('mattar', 'green_peas'), ('mutter', 'green_peas'),
  ('capsicum', 'capsicum'), ('bell pepper', 'capsicum'), ('green capsicum', 'capsicum'), ('shimla mirch', 'capsicum'),
  ('brinjal', 'brinjal'), ('eggplant', 'brinjal'), ('aubergine', 'brinjal'), ('baingan', 'brinjal'), ('vankaya', 'brinjal'), ('kathirikai', 'brinjal'),
  ('okra', 'okra'), ('lady finger', 'okra'), ('ladyfinger', 'okra'), ('ladies finger', 'okra'), ('bhindi', 'okra'), ('vendakkai', 'okra'),
  ('cucumber', 'cucumber'), ('kheera', 'cucumber'), ('khira', 'cucumber'), ('kakdi', 'cucumber'),
  ('mushroom', 'mushroom'), ('mushrooms', 'mushroom'), ('khumbi', 'mushroom'),
  ('beans', 'green_beans'), ('green beans', 'green_beans'), ('french beans', 'green_beans'),
  ('lemon', 'lemon'), ('lemons', 'lemon'), ('lime', 'lemon'), ('nimbu', 'lemon'), ('limbu', 'lemon'), ('elumichai', 'lemon'),
  ('banana', 'banana'), ('kela', 'banana'),
  ('apple', 'apple'), ('seb', 'apple'),
  ('coconut', 'coconut'), ('grated coconut', 'coconut'), ('nariyal', 'coconut'), ('thengai', 'coconut'), ('kobbari', 'coconut'),
  ('rice', 'rice'), ('chawal', 'rice'), ('chaval', 'rice'), ('basmati', 'rice'), ('basmati rice', 'rice'), ('sona masoori', 'rice'), ('arisi', 'rice'),
  ('atta', 'atta'), ('aata', 'atta'), ('wheat flour', 'atta'), ('whole wheat flour', 'atta'), ('gehun atta', 'atta'), ('chapati flour', 'atta'),
  ('maida', 'maida'), ('all purpose flour', 'maida'), ('plain flour', 'maida'), ('refined flour', 'maida'),
  ('besan', 'besan'), ('gram flour', 'besan'), ('chickpea flour', 'besan'), ('kadalai maavu', 'besan'),
  ('rava', 'rava'), ('rawa', 'rava'), ('sooji', 'rava'), ('suji', 'rava'), ('semolina', 'rava'), ('bombay rava', 'rava'),
  ('poha', 'poha'), ('pohe', 'poha'), ('flattened rice', 'poha'), ('aval', 'poha'), ('avalakki', 'poha'),
  ('bread', 'bread'), ('bread slice', 'bread'), ('bread slices', 'bread'), ('white bread', 'bread'), ('brown bread', 'bread'), ('double roti', 'bread'),
  ('pasta', 'pasta'), ('macaroni', 'pasta'), ('penne', 'pasta'), ('spaghetti', 'pasta'),
  ('oats', 'oats'), ('rolled oats', 'oats'),
  ('noodles', 'noodles'), ('maggi', 'noodles'), ('hakka noodles', 'noodles'),
  ('toor dal', 'toor_dal'), ('toor daal', 'toor_dal'), ('tur dal', 'toor_dal'), ('tuvar dal', 'toor_dal'), ('arhar dal', 'toor_dal'), ('toor', 'toor_dal'), ('dal', 'toor_dal'), ('daal', 'toor_dal'), ('dhal', 'toor_dal'),
  ('moong dal', 'moong_dal'), ('moong daal', 'moong_dal'), ('mung dal', 'moong_dal'), ('moong', 'moong_dal'), ('yellow moong dal', 'moong_dal'), ('green gram', 'moong_dal'),
  ('masoor dal', 'masoor_dal'), ('masoor daal', 'masoor_dal'), ('masoor', 'masoor_dal'), ('red lentils', 'masoor_dal'), ('lentils', 'masoor_dal'),
  ('chana dal', 'chana_dal'), ('chana daal', 'chana_dal'), ('bengal gram', 'chana_dal'),
  ('urad dal', 'urad_dal'), ('urad daal', 'urad_dal'), ('urad', 'urad_dal'), ('black gram', 'urad_dal'), ('ulundu', 'urad_dal'),
  ('chickpeas', 'chickpeas'), ('chickpea', 'chickpeas'), ('chole', 'chickpeas'), ('chhole', 'chickpeas'), ('kabuli chana', 'chickpeas'), ('chana', 'chickpeas'), ('garbanzo', 'chickpeas'),
  ('rajma', 'rajma'), ('kidney beans', 'rajma'), ('red kidney beans', 'rajma'),
  ('egg', 'egg'), ('eggs', 'egg'), ('anda', 'egg'), ('ande', 'egg'), ('muttai', 'egg'),
  ('chicken', 'chicken'), ('murgh', 'chicken'), ('chicken breast', 'chicken'), ('chicken curry cut', 'chicken'), ('kozhi', 'chicken'),
  ('mutton', 'mutton'), ('goat meat', 'mutton'), ('gosht', 'mutton'),
  ('fish', 'fish'), ('machli', 'fish'), ('machhi', 'fish'), ('meen', 'fish'),
  ('paneer', 'paneer'), ('cottage cheese', 'paneer'),
  ('milk', 'milk'), ('doodh', 'milk'), ('dudh', 'milk'), ('paal', 'milk'),
  ('curd', 'curd'), ('curds', 'curd'), ('yogurt', 'curd'), ('yoghurt', 'curd'), ('dahi', 'curd'), ('thayir', 'curd'), ('mosaru', 'curd'),
  ('butter', 'butter'), ('makhan', 'butter'), ('makkhan', 'butter'), ('white butter', 'butter'),
  ('ghee', 'ghee'), ('desi ghee', 'ghee'), ('clarified butter', 'ghee'), ('neyyi', 'ghee'), ('nei', 'ghee'),
  ('cream', 'cream'), ('fresh cream', 'cream'), ('malai', 'cream'),
  ('cheese', 'cheese'), ('cheese slices', 'cheese'), ('processed cheese', 'cheese'),
  ('oil', 'oil'), ('cooking oil', 'oil'), ('sunflower oil', 'oil'), ('vegetable oil', 'oil'), ('refined oil', 'oil'), ('groundnut oil', 'oil'), ('mustard oil', 'oil'), ('tel', 'oil'), ('ennai', 'oil'),
  ('salt', 'salt'), ('namak', 'salt'), ('uppu', 'salt'), ('table salt', 'salt'),
  ('sugar', 'sugar'), ('cheeni', 'sugar'), ('chini', 'sugar'), ('shakkar', 'sugar'),
  ('jaggery', 'jaggery'), ('gur', 'jaggery'), ('gud', 'jaggery'), ('vellam', 'jaggery'), ('bellam', 'jaggery'),
  ('water', 'water'), ('pani', 'water'), ('paani', 'water'), ('neer', 'water'),
  ('tea', 'tea'), ('chai', 'tea'), ('chai patti', 'tea'), ('tea leaves', 'tea'), ('tea powder', 'tea'),
  ('tamarind', 'tamarind'), ('imli', 'tamarind'), ('puli', 'tamarind'),
  ('turmeric', 'turmeric'), ('turmeric powder', 'turmeric'), ('haldi', 'turmeric'), ('haldi powder', 'turmeric'), ('manjal', 'turmeric'),
  ('red chilli powder', 'red_chilli_powder'), ('chilli powder', 'red_chilli_powder'), ('chili powder', 'red_chilli_powder'), ('red chili powder', 'red_chilli_powder'), ('lal mirch', 'red_chilli_powder'), ('lal mirch powder', 'red_chilli_powder'), ('mirchi powder', 'red_chilli_powder'), ('kashmiri chilli powder', 'red_chilli_powder'),
  ('coriander powder', 'coriander_powder'), ('dhaniya powder', 'coriander_powder'), ('dhania powder', 'coriander_powder'),
  ('cumin', 'cumin'), ('cumin seeds', 'cumin'), ('jeera', 'cumin'), ('zeera', 'cumin'), ('jeerakam', 'cumin'),
  ('mustard seeds', 'mustard_seeds'), ('mustard', 'mustard_seeds'), ('rai', 'mustard_seeds'), ('sarson', 'mustard_seeds'), ('kadugu', 'mustard_seeds'),
  ('garam masala', 'garam_masala'),
  ('ginger garlic paste', 'ginger_garlic_paste'), ('ginger-garlic paste', 'ginger_garlic_paste'), ('adrak lehsun paste', 'ginger_garlic_paste'),
  ('black pepper', 'black_pepper'), ('pepper', 'black_pepper'), ('kali mirch', 'black_pepper'), ('milagu', 'black_pepper'),
  ('cardamom', 'cardamom'), ('elaichi', 'cardamom'), ('elachi', 'cardamom'), ('green cardamom', 'cardamom'), ('elakkai', 'cardamom'),
  ('hing', 'hing'), ('asafoetida', 'hing'), ('perungayam', 'hing'),
  ('bay leaf', 'bay_leaf'), ('bay leaves', 'bay_leaf'), ('tej patta', 'bay_leaf'), ('tejpatta', 'bay_leaf');

-- table kitchen_foods: The shared food list (RC-4): what an item is and what a recipe line asks for, one dimension each.
-- column kitchen_foods.key: Short ASCII key (onion, toor_dal); what items, lines, answers and Always have point at.
-- column kitchen_foods.name: Its display name (Onion).
-- column kitchen_foods.dimension: mass | volume | count: what an amount of it measures.
-- column kitchen_foods.each_g: One piece in whole grams (an onion ≈ 150), so a count meets a weight; null when it is not counted.
-- column kitchen_foods.category: The pantry category it is filed under (veg, fruit, dairy, grains, protein, spices, other).
-- table kitchen_food_names: Every spelling and language a food goes by (onion, onions, pyaz, kanda → onion).
-- column kitchen_food_names.name_key: The name as lower(trim(name)); a name belongs to one food.
-- column kitchen_food_names.food_key: The food it names.
-- column kitchen_items.food_key: The food the item is (RC-4): linked when it is added and exactly one food matches its name, or by an answer; null when unlinked.
-- table kitchen_food_answers: "Asked once" (RC-4): which food a name is in one pantry, or none.
-- column kitchen_food_answers.owner_kind: user (a personal pantry) | group (a group pantry), as kitchen_measures.owner_kind.
-- column kitchen_food_answers.owner_id: The pantry: the person (usr_…) or the group (membership_organizations.id, no cross-context FK).
-- column kitchen_food_answers.name_key: The item name it answers for, lower(trim(name)).
-- column kitchen_food_answers.food_key: The food that name is in this pantry; null for "none of these".
-- column kitchen_food_answers.answered_by: Who answered last (usr_…).
-- table kitchen_always_have: Foods a person always has (RC-4, design §3.4): recipe lines for them count as there.
-- column kitchen_always_have.user_id: The person (usr_…).
-- column kitchen_always_have.food_key: A food on their list.
-- table kitchen_always_have_lists: The people who have saved their Always have list; anyone else reads the default (salt and water).
-- column kitchen_always_have_lists.user_id: The person (usr_…).
-- column kitchen_always_have_lists.updated_at: When they last saved it.
