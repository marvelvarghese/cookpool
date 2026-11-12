-- 590_kitchen_no_starter_recipes: Cookpool's recipes are replaced by 13 Kerala recipes.
--
-- Context: kitchen
-- Epic: cookpool-revamp (RV-20) — the owner's decision: the 42 recipes
--       Cookpool provided (is_system = 1 under usr_cookpool, seeded by 360
--       and given guided steps by 390) are deleted, and 13 new Cookpool
--       recipes take their place: Kerala home and restaurant staples, each
--       for four, with lines on the food list and guided steps the way 390
--       writes them. They are visible to everyone and edited by no one, as
--       the old ones were; Explore, search and Cook now show only these and
--       recipes people wrote or saved.
--
-- Design rules:
--   * The old recipes are deleted the way the app deletes one (350,
--     deleteRecipe): soft, deleted_at and updated_at set to now; every read
--     leaves a deleted recipe out. No row is hard-deleted: lines, steps,
--     dishes, posts, activity and step times reference them, and the copies'
--     source_recipe_id walk (370's recipe root) needs the rows. Whatever
--     names one keeps working on its own words: a dish keeps its name, a
--     post its title (its recipe link reads as none), an activity row its
--     recipe_id (its name reads as none). A copy someone saved is their own
--     recipe and stays ("from Cookpool"): 350 never ties a copy to its source.
--   * Deletes first, then inserts. The delete names every live system recipe
--     except 590's own ids (c00c0590-…), so a rerun after the inserts deletes
--     nothing new; a rerun changes nothing at all (deleted_at keeps its first
--     time). No LIKE or GLOB (D1 limits a pattern to 50 bytes): substr.
--   * The new recipes have fixed ids c00c0590-0000-4000-8000-0000000000NN
--     (NN 01–13) and fixed step keys c00c0590-<recipe>-<step> (both two
--     digits, the step counted from 1), so cooks' step times pool on keys
--     that are the same in every environment. created_at steps back a minute
--     a recipe from 2026-11-13T00:59, so Explore's newest-first order is the
--     order below.
--   * Re-runnable without OR IGNORE on anything a CHECK guards (370's note:
--     OR IGNORE skips a row that fails a CHECK without a word): a recipe row
--     goes in with ON CONFLICT (id) DO NOTHING, which skips only the row
--     already there; each recipe's lines and steps are deleted and inserted
--     again with plain INSERT, as 390 does. Only the new names use INSERT OR
--     IGNORE, which keeps a name already on another food (a name belongs to
--     one food).
--   * Every recipe serves 4, has one main line with an amount, every line a
--     food on the list in one of the app's units on its rounding grid (or to
--     taste), and 3–20 guided steps: prep before cook; every cook step a
--     flame and a checkpoint or a time; hands-off steps timed or counted in
--     whistles; ranges at least 30 s, the longest at most three times the
--     shortest; no amount or time in a step's words (the lines carry the
--     amounts, the range the time); every line used by some step.
--   * No new food is needed: kudampuli is already a name of kokum, matta rice
--     and keema of rice and mutton. New names: kaima (jeerakasala) rice and
--     vadi matta for rice, thenga kothu and coconut slices for coconut,
--     Malabar tamarind for kokum; pantry items named exactly one of them,
--     still unlinked and never answered for, link to it.
--   * Kinds: curries and roasts dal_curry, the rice dishes rice, and the dry
--     fries (chilli chicken, kondattam, chilli pork, fish fry, beef fry) snack.
--   * Each statement stays far under D1's 100 KB statement limit.

UPDATE kitchen_recipes
SET deleted_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'),
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE (is_system = 1 OR owner_id = 'usr_cookpool')
  AND deleted_at IS NULL
  AND substr(id, 1, 8) <> 'c00c0590';

-- New names for foods already on the list: (name, food).
INSERT OR IGNORE INTO kitchen_food_names (name_key, food_key) VALUES
  ('kaima rice', 'rice'),
  ('kaima ari', 'rice'),
  ('jeerakasala', 'rice'),
  ('jeerakasala rice', 'rice'),
  ('vadi matta', 'rice'),
  ('vadi matta rice', 'rice'),
  ('kerala matta rice', 'rice'),
  ('red matta rice', 'rice'),
  ('kerala red rice', 'rice'),
  ('thenga kothu', 'coconut'),
  ('coconut slices', 'coconut'),
  ('coconut slivers', 'coconut'),
  ('coconut bits', 'coconut'),
  ('malabar tamarind', 'kokum'),
  ('fish tamarind', 'kokum'),
  ('pot tamarind', 'kokum');

-- Items already in pantries named exactly one of those words, still unlinked,
-- link the way an item added from now on does — unless their pantry answered
-- for that name (an answer wins, "none of these" included).
UPDATE kitchen_items SET food_key = (SELECT n.food_key FROM kitchen_food_names n WHERE n.name_key = lower(trim(kitchen_items.name)))
WHERE food_key IS NULL
  AND lower(trim(name)) IN ('kaima rice', 'kaima ari', 'jeerakasala', 'jeerakasala rice', 'vadi matta', 'vadi matta rice', 'kerala matta rice', 'red matta rice', 'kerala red rice', 'thenga kothu', 'coconut slices', 'coconut slivers', 'coconut bits', 'malabar tamarind', 'fish tamarind', 'pot tamarind')
  AND NOT EXISTS (
    SELECT 1 FROM kitchen_food_answers a
    WHERE a.owner_kind = kitchen_items.owner_kind
      AND a.owner_id = COALESCE(kitchen_items.owner_subject_id, kitchen_items.org_id)
      AND a.name_key = lower(trim(kitchen_items.name)));

-- The 13 recipes: (id, owner, name, serves × 2, minutes, visibility, link code, is_system, kind, tools, created, updated).
INSERT INTO kitchen_recipes (id, owner_id, name, serves_half, minutes, visibility, link_code, is_system, kind, tools, created_at, updated_at) VALUES
  ('c00c0590-0000-4000-8000-000000000001', 'usr_cookpool', 'Chicken curry (Kerala style)', 8, 60, 'groups', NULL, 1, 'dal_curry', '["Kadai with a lid", "Mortar and pestle"]', '2026-11-13T00:59:00.000Z', '2026-11-13T00:59:00.000Z'),
  ('c00c0590-0000-4000-8000-000000000002', 'usr_cookpool', 'Chilli chicken', 8, 45, 'groups', NULL, 1, 'snack', '["Kadai or wok", "Mixing bowl", "Slotted spoon"]', '2026-11-13T00:58:00.000Z', '2026-11-13T00:58:00.000Z'),
  ('c00c0590-0000-4000-8000-000000000003', 'usr_cookpool', 'Chicken kondattam', 8, 60, 'groups', NULL, 1, 'snack', '["Kadai", "Mixing bowl", "Slotted spoon"]', '2026-11-13T00:57:00.000Z', '2026-11-13T00:57:00.000Z'),
  ('c00c0590-0000-4000-8000-000000000004', 'usr_cookpool', 'Chettinad chicken curry', 8, 70, 'groups', NULL, 1, 'dal_curry', '["Heavy pan with a lid", "Mixer jar"]', '2026-11-13T00:56:00.000Z', '2026-11-13T00:56:00.000Z'),
  ('c00c0590-0000-4000-8000-000000000005', 'usr_cookpool', 'Chicken roast (Kerala)', 8, 60, 'groups', NULL, 1, 'dal_curry', '["Kadai with a lid", "Mortar and pestle"]', '2026-11-13T00:55:00.000Z', '2026-11-13T00:55:00.000Z'),
  ('c00c0590-0000-4000-8000-000000000006', 'usr_cookpool', 'Beef roast (Kerala ularthiyathu)', 8, 90, 'groups', NULL, 1, 'dal_curry', '["Pressure cooker", "Heavy kadai", "Mortar and pestle"]', '2026-11-13T00:54:00.000Z', '2026-11-13T00:54:00.000Z'),
  ('c00c0590-0000-4000-8000-000000000007', 'usr_cookpool', 'Ghee rice with kaima curry', 8, 75, 'groups', NULL, 1, 'rice', '["Heavy pan with a tight lid", "Kadai", "Sieve"]', '2026-11-13T00:53:00.000Z', '2026-11-13T00:53:00.000Z'),
  ('c00c0590-0000-4000-8000-000000000008', 'usr_cookpool', 'Vadi matta rice', 8, 50, 'groups', NULL, 1, 'rice', '["Large pot", "Colander"]', '2026-11-13T00:52:00.000Z', '2026-11-13T00:52:00.000Z'),
  ('c00c0590-0000-4000-8000-000000000009', 'usr_cookpool', 'Pork vindaloo', 8, 90, 'groups', NULL, 1, 'dal_curry', '["Heavy pan with a lid", "Mixer jar", "Mixing bowl"]', '2026-11-13T00:51:00.000Z', '2026-11-13T00:51:00.000Z'),
  ('c00c0590-0000-4000-8000-000000000010', 'usr_cookpool', 'Chilli pork', 8, 75, 'groups', NULL, 1, 'snack', '["Pressure cooker", "Kadai or wok"]', '2026-11-13T00:50:00.000Z', '2026-11-13T00:50:00.000Z'),
  ('c00c0590-0000-4000-8000-000000000011', 'usr_cookpool', 'Fish curry (Kerala, with kudampuli)', 8, 45, 'groups', NULL, 1, 'dal_curry', '["Clay pot (manchatti) or heavy pan", "Mortar and pestle"]', '2026-11-13T00:49:00.000Z', '2026-11-13T00:49:00.000Z'),
  ('c00c0590-0000-4000-8000-000000000012', 'usr_cookpool', 'Fish fry (Kerala masala)', 8, 45, 'groups', NULL, 1, 'snack', '["Flat pan (tawa)", "Mixing bowl"]', '2026-11-13T00:48:00.000Z', '2026-11-13T00:48:00.000Z'),
  ('c00c0590-0000-4000-8000-000000000013', 'usr_cookpool', 'Beef fry (Kerala)', 8, 80, 'groups', NULL, 1, 'snack', '["Pressure cooker", "Heavy kadai"]', '2026-11-13T00:47:00.000Z', '2026-11-13T00:47:00.000Z')
ON CONFLICT (id) DO NOTHING;

-- 01 Chicken curry (Kerala style): 16 lines, 9 steps (2 prep, 7 cook).
DELETE FROM kitchen_recipe_lines WHERE recipe_id = 'c00c0590-0000-4000-8000-000000000001';
INSERT INTO kitchen_recipe_lines (recipe_id, position, food_key, name, qty_milli, unit, to_taste, is_main) VALUES
  ('c00c0590-0000-4000-8000-000000000001', 0, 'chicken', 'Chicken, curry cut', 750000, 'g', 0, 1),
  ('c00c0590-0000-4000-8000-000000000001', 1, 'coconut_oil', 'Coconut oil', 45000, 'tbsp', 0, 0),
  ('c00c0590-0000-4000-8000-000000000001', 2, 'onion', 'Onions, thinly sliced', 2000, 'pcs', 0, 0),
  ('c00c0590-0000-4000-8000-000000000001', 3, 'ginger', 'Ginger, crushed', 15000, 'g', 0, 0),
  ('c00c0590-0000-4000-8000-000000000001', 4, 'garlic', 'Garlic cloves, crushed', 8000, 'pcs', 0, 0),
  ('c00c0590-0000-4000-8000-000000000001', 5, 'green_chilli', 'Green chillies, slit', 3000, 'pcs', 0, 0),
  ('c00c0590-0000-4000-8000-000000000001', 6, 'curry_leaves', 'Curry leaves, two sprigs', NULL, NULL, 1, 0),
  ('c00c0590-0000-4000-8000-000000000001', 7, 'tomato', 'Tomato, chopped', 1000, 'pcs', 0, 0),
  ('c00c0590-0000-4000-8000-000000000001', 8, 'turmeric', 'Turmeric', 2500, 'tsp', 0, 0),
  ('c00c0590-0000-4000-8000-000000000001', 9, 'red_chilli_powder', 'Kashmiri chilli powder', 15000, 'tbsp', 0, 0),
  ('c00c0590-0000-4000-8000-000000000001', 10, 'coriander_powder', 'Coriander powder', 22500, 'tbsp', 0, 0),
  ('c00c0590-0000-4000-8000-000000000001', 11, 'black_pepper', 'Black pepper powder', 5000, 'tsp', 0, 0),
  ('c00c0590-0000-4000-8000-000000000001', 12, 'garam_masala', 'Garam masala', 5000, 'tsp', 0, 0),
  ('c00c0590-0000-4000-8000-000000000001', 13, 'coconut_milk', 'Thin coconut milk', 360000, 'cup', 0, 0),
  ('c00c0590-0000-4000-8000-000000000001', 14, 'coconut_milk', 'Thick coconut milk', 120000, 'cup', 0, 0),
  ('c00c0590-0000-4000-8000-000000000001', 15, 'salt', 'Salt', NULL, NULL, 1, 0);
DELETE FROM kitchen_recipe_steps WHERE recipe_id = 'c00c0590-0000-4000-8000-000000000001';
INSERT INTO kitchen_recipe_steps (recipe_id, position, step_key, phase, text, line_refs, heat, min_seconds, max_seconds, whistles, hands_off, time_rule, sense, checkpoint, tip) VALUES
  ('c00c0590-0000-4000-8000-000000000001', 0, 'c00c0590-01-01', 'prep', 'Cut the chicken into curry pieces, wash it and drain it well.', '[0]', NULL, 300, 600, NULL, 0, 'linear', NULL, NULL, NULL),
  ('c00c0590-0000-4000-8000-000000000001', 1, 'c00c0590-01-02', 'prep', 'Thinly slice the onions, chop the tomato, crush the ginger and garlic together, and slit the chillies.', '[2,  7,  3,  4,  5]', NULL, 480, 720, NULL, 0, 'linear', NULL, NULL, NULL),
  ('c00c0590-0000-4000-8000-000000000001', 2, 'c00c0590-01-03', 'cook', 'Heat the coconut oil, add the onions with a pinch of the salt and fry until golden brown.', '[1,  2,  15]', 2, 600, 900, NULL, 0, 'partly', 'look', 'golden brown at the edges', 'The salt helps the onions soften and brown evenly.'),
  ('c00c0590-0000-4000-8000-000000000001', 3, 'c00c0590-01-04', 'cook', 'Add the ginger, garlic, chillies and curry leaves and fry until the raw smell goes.', '[3,  4,  5,  6]', 2, 60, 120, NULL, 0, 'fixed', 'smell', 'the raw smell goes', NULL),
  ('c00c0590-0000-4000-8000-000000000001', 4, 'c00c0590-01-05', 'cook', 'Lower the flame, add the turmeric, chilli powder and coriander powder and stir until fragrant.', '[8,  9,  10]', 1, 45, 90, NULL, 0, 'fixed', 'smell', 'the spices smell toasted, not burnt', 'Add a splash of water if they start to stick.'),
  ('c00c0590-0000-4000-8000-000000000001', 5, 'c00c0590-01-06', 'cook', 'Add the tomato and cook until soft and mushy.', '[7]', 2, 240, 360, NULL, 0, 'partly', 'look', 'the tomato breaks down', NULL),
  ('c00c0590-0000-4000-8000-000000000001', 6, 'c00c0590-01-07', 'cook', 'Add the chicken with the rest of the salt and stir on high until coated.', '[0,  15]', 3, 240, 360, NULL, 0, 'partly', 'look', 'no raw pink shows on the outside', NULL),
  ('c00c0590-0000-4000-8000-000000000001', 7, 'c00c0590-01-08', 'cook', 'Pour in the thin coconut milk, cover and simmer on low until the chicken is cooked.', '[13]', 1, 1200, 1800, NULL, 1, 'partly', 'look', 'no pink inside', 'Cut into the thickest piece to check.'),
  ('c00c0590-0000-4000-8000-000000000001', 8, 'c00c0590-01-09', 'cook', 'Stir in the pepper, garam masala and thick coconut milk and heat through without boiling.', '[11,  12,  14]', 1, 120, 180, NULL, 0, 'fixed', 'look', 'just steaming, not bubbling', 'Boiling after the thick milk goes in can split it.');

-- 02 Chilli chicken: 22 lines, 9 steps (3 prep, 6 cook).
DELETE FROM kitchen_recipe_lines WHERE recipe_id = 'c00c0590-0000-4000-8000-000000000002';
INSERT INTO kitchen_recipe_lines (recipe_id, position, food_key, name, qty_milli, unit, to_taste, is_main) VALUES
  ('c00c0590-0000-4000-8000-000000000002', 0, 'chicken', 'Boneless chicken, bite-size pieces', 500000, 'g', 0, 1),
  ('c00c0590-0000-4000-8000-000000000002', 1, 'egg', 'Egg', 1000, 'pcs', 0, 0),
  ('c00c0590-0000-4000-8000-000000000002', 2, 'cornflour', 'Cornflour, for the coating', 45000, 'tbsp', 0, 0),
  ('c00c0590-0000-4000-8000-000000000002', 3, 'maida', 'Maida', 30000, 'tbsp', 0, 0),
  ('c00c0590-0000-4000-8000-000000000002', 4, 'ginger_garlic_paste', 'Ginger-garlic paste', 15000, 'tbsp', 0, 0),
  ('c00c0590-0000-4000-8000-000000000002', 5, 'red_chilli_powder', 'Kashmiri chilli powder', 5000, 'tsp', 0, 0),
  ('c00c0590-0000-4000-8000-000000000002', 6, 'soy_sauce', 'Soy sauce', 30000, 'tbsp', 0, 0),
  ('c00c0590-0000-4000-8000-000000000002', 7, 'black_pepper', 'Black pepper powder', 2500, 'tsp', 0, 0),
  ('c00c0590-0000-4000-8000-000000000002', 8, 'salt', 'Salt', NULL, NULL, 1, 0),
  ('c00c0590-0000-4000-8000-000000000002', 9, 'oil', 'Oil, for deep frying', 360000, 'cup', 0, 0),
  ('c00c0590-0000-4000-8000-000000000002', 10, 'oil', 'Oil, for the sauce', 30000, 'tbsp', 0, 0),
  ('c00c0590-0000-4000-8000-000000000002', 11, 'garlic', 'Garlic cloves, finely chopped', 6000, 'pcs', 0, 0),
  ('c00c0590-0000-4000-8000-000000000002', 12, 'ginger', 'Ginger, finely chopped', 10000, 'g', 0, 0),
  ('c00c0590-0000-4000-8000-000000000002', 13, 'green_chilli', 'Green chillies, slit', 4000, 'pcs', 0, 0),
  ('c00c0590-0000-4000-8000-000000000002', 14, 'onion', 'Onion, cut in squares', 1000, 'pcs', 0, 0),
  ('c00c0590-0000-4000-8000-000000000002', 15, 'capsicum', 'Capsicum, cut in squares', 1000, 'pcs', 0, 0),
  ('c00c0590-0000-4000-8000-000000000002', 16, 'red_chilli_sauce', 'Red chilli sauce', 30000, 'tbsp', 0, 0),
  ('c00c0590-0000-4000-8000-000000000002', 17, 'tomato_ketchup', 'Tomato ketchup', 15000, 'tbsp', 0, 0),
  ('c00c0590-0000-4000-8000-000000000002', 18, 'vinegar', 'Vinegar', 5000, 'tsp', 0, 0),
  ('c00c0590-0000-4000-8000-000000000002', 19, 'cornflour', 'Cornflour, for the sauce', 5000, 'tsp', 0, 0),
  ('c00c0590-0000-4000-8000-000000000002', 20, 'water', 'Water', 120000, 'cup', 0, 0),
  ('c00c0590-0000-4000-8000-000000000002', 21, 'spring_onion', 'Spring onions, chopped', 2000, 'pcs', 0, 0);
DELETE FROM kitchen_recipe_steps WHERE recipe_id = 'c00c0590-0000-4000-8000-000000000002';
INSERT INTO kitchen_recipe_steps (recipe_id, position, step_key, phase, text, line_refs, heat, min_seconds, max_seconds, whistles, hands_off, time_rule, sense, checkpoint, tip) VALUES
  ('c00c0590-0000-4000-8000-000000000002', 0, 'c00c0590-02-01', 'prep', 'Mix the chicken with the egg, coating cornflour, maida, ginger-garlic paste, chilli powder, half the soy sauce, the pepper and salt, and leave it to marinate.', '[0,  1,  2,  3,  4,  5,  6,  7,  8]', NULL, 900, 1800, NULL, 1, 'fixed', NULL, NULL, 'The coating should cling thickly; add a spoon of water only if it is too stiff.'),
  ('c00c0590-0000-4000-8000-000000000002', 1, 'c00c0590-02-02', 'prep', 'Chop the garlic, ginger and spring onions, slit the chillies, and cut the onion and capsicum into squares.', '[11,  12,  21,  13,  14,  15]', NULL, 480, 720, NULL, 0, 'linear', NULL, NULL, NULL),
  ('c00c0590-0000-4000-8000-000000000002', 2, 'c00c0590-02-03', 'prep', 'Stir the cornflour for the sauce into the water.', '[19,  20]', NULL, 30, 60, NULL, 0, 'fixed', NULL, NULL, NULL),
  ('c00c0590-0000-4000-8000-000000000002', 3, 'c00c0590-02-04', 'cook', 'Heat the oil for frying and fry the chicken in batches until crisp and golden.', '[9,  0]', 2, 480, 720, NULL, 0, 'linear', 'look', 'crisp, golden and cooked through', 'Don''t crowd the oil; it stays hot and the coating stays crisp.'),
  ('c00c0590-0000-4000-8000-000000000002', 4, 'c00c0590-02-05', 'cook', 'Heat the oil for the sauce on high and fry the garlic, ginger and chillies.', '[10,  11,  12,  13]', 3, 30, 60, NULL, 0, 'fixed', 'smell', 'the garlic smells fragrant', NULL),
  ('c00c0590-0000-4000-8000-000000000002', 5, 'c00c0590-02-06', 'cook', 'Add the onion and capsicum and toss on high until just tender.', '[14,  15]', 3, 60, 120, NULL, 0, 'partly', 'look', 'still crunchy, edges just charred', NULL),
  ('c00c0590-0000-4000-8000-000000000002', 6, 'c00c0590-02-07', 'cook', 'Add the rest of the soy sauce, the chilli sauce, ketchup and vinegar and stir.', '[6,  16,  17,  18]', 3, 30, 60, NULL, 0, 'fixed', 'look', 'the sauce bubbles', NULL),
  ('c00c0590-0000-4000-8000-000000000002', 7, 'c00c0590-02-08', 'cook', 'Stir in the cornflour water and cook until the sauce turns glossy.', '[19,  20]', 2, 60, 120, NULL, 0, 'fixed', 'look', 'glossy and thick enough to coat a spoon', NULL),
  ('c00c0590-0000-4000-8000-000000000002', 8, 'c00c0590-02-09', 'cook', 'Toss in the fried chicken and the spring onions and turn off the heat.', '[0,  21]', 3, NULL, NULL, NULL, 0, 'fixed', 'look', 'every piece is coated', 'Serve straight away while the coating is crisp.');

-- 03 Chicken kondattam: 19 lines, 8 steps (2 prep, 6 cook).
DELETE FROM kitchen_recipe_lines WHERE recipe_id = 'c00c0590-0000-4000-8000-000000000003';
INSERT INTO kitchen_recipe_lines (recipe_id, position, food_key, name, qty_milli, unit, to_taste, is_main) VALUES
  ('c00c0590-0000-4000-8000-000000000003', 0, 'chicken', 'Boneless chicken, small pieces', 500000, 'g', 0, 1),
  ('c00c0590-0000-4000-8000-000000000003', 1, 'red_chilli_powder', 'Kashmiri chilli powder, for the marinade', 15000, 'tbsp', 0, 0),
  ('c00c0590-0000-4000-8000-000000000003', 2, 'turmeric', 'Turmeric', 2500, 'tsp', 0, 0),
  ('c00c0590-0000-4000-8000-000000000003', 3, 'ginger_garlic_paste', 'Ginger-garlic paste', 15000, 'tbsp', 0, 0),
  ('c00c0590-0000-4000-8000-000000000003', 4, 'lemon', 'Lemon, for its juice', 500, 'pcs', 0, 0),
  ('c00c0590-0000-4000-8000-000000000003', 5, 'rice_flour', 'Rice flour', 15000, 'tbsp', 0, 0),
  ('c00c0590-0000-4000-8000-000000000003', 6, 'salt', 'Salt', NULL, NULL, 1, 0),
  ('c00c0590-0000-4000-8000-000000000003', 7, 'coconut_oil', 'Coconut oil, for frying', 240000, 'cup', 0, 0),
  ('c00c0590-0000-4000-8000-000000000003', 8, 'dried_red_chilli', 'Dried red chillies, broken', 10000, 'pcs', 0, 0),
  ('c00c0590-0000-4000-8000-000000000003', 9, 'small_onion', 'Shallots, sliced', 100000, 'g', 0, 0),
  ('c00c0590-0000-4000-8000-000000000003', 10, 'garlic', 'Garlic cloves, sliced', 8000, 'pcs', 0, 0),
  ('c00c0590-0000-4000-8000-000000000003', 11, 'ginger', 'Ginger, cut in thin strips', 10000, 'g', 0, 0),
  ('c00c0590-0000-4000-8000-000000000003', 12, 'green_chilli', 'Green chillies, slit', 3000, 'pcs', 0, 0),
  ('c00c0590-0000-4000-8000-000000000003', 13, 'curry_leaves', 'Curry leaves, three sprigs', NULL, NULL, 1, 0),
  ('c00c0590-0000-4000-8000-000000000003', 14, 'red_chilli_powder', 'Kashmiri chilli powder, for the masala', 5000, 'tsp', 0, 0),
  ('c00c0590-0000-4000-8000-000000000003', 15, 'black_pepper', 'Black pepper powder', 5000, 'tsp', 0, 0),
  ('c00c0590-0000-4000-8000-000000000003', 16, 'tomato_ketchup', 'Tomato ketchup', 15000, 'tbsp', 0, 0),
  ('c00c0590-0000-4000-8000-000000000003', 17, 'sugar', 'Sugar', 5000, 'tsp', 0, 0),
  ('c00c0590-0000-4000-8000-000000000003', 18, 'vinegar', 'Vinegar', 5000, 'tsp', 0, 0);
DELETE FROM kitchen_recipe_steps WHERE recipe_id = 'c00c0590-0000-4000-8000-000000000003';
INSERT INTO kitchen_recipe_steps (recipe_id, position, step_key, phase, text, line_refs, heat, min_seconds, max_seconds, whistles, hands_off, time_rule, sense, checkpoint, tip) VALUES
  ('c00c0590-0000-4000-8000-000000000003', 0, 'c00c0590-03-01', 'prep', 'Mix the chicken with the chilli powder for the marinade, turmeric, ginger-garlic paste, lemon juice, rice flour and salt, and leave it to marinate.', '[0,  1,  2,  3,  4,  5,  6]', NULL, 1800, 3600, NULL, 1, 'fixed', NULL, NULL, NULL),
  ('c00c0590-0000-4000-8000-000000000003', 1, 'c00c0590-03-02', 'prep', 'Slice the shallots and garlic, cut the ginger in thin strips, slit the green chillies and break the dried ones.', '[9,  10,  11,  12,  8]', NULL, 480, 720, NULL, 0, 'linear', NULL, NULL, NULL),
  ('c00c0590-0000-4000-8000-000000000003', 2, 'c00c0590-03-03', 'cook', 'Heat the coconut oil and fry the chicken in batches until crisp and deep golden, then lift it out.', '[7,  0]', 2, 600, 900, NULL, 0, 'linear', 'look', 'crisp, deep golden and cooked through', NULL),
  ('c00c0590-0000-4000-8000-000000000003', 3, 'c00c0590-03-04', 'cook', 'Pour off all but a little of the oil and fry the dried chillies.', '[8]', 2, 30, 60, NULL, 0, 'fixed', 'look', 'a shade darker, not black', 'They burn fast; have the shallots ready.'),
  ('c00c0590-0000-4000-8000-000000000003', 4, 'c00c0590-03-05', 'cook', 'Add the shallots, garlic, ginger, green chillies and curry leaves and fry until the shallots are golden.', '[9,  10,  11,  12,  13]', 2, 300, 480, NULL, 0, 'partly', 'look', 'the shallots are golden brown', NULL),
  ('c00c0590-0000-4000-8000-000000000003', 5, 'c00c0590-03-06', 'cook', 'Lower the flame and stir in the chilli powder for the masala and the pepper.', '[14,  15]', 1, 30, 60, NULL, 0, 'fixed', 'smell', 'the raw smell of the chilli goes', NULL),
  ('c00c0590-0000-4000-8000-000000000003', 6, 'c00c0590-03-07', 'cook', 'Add the ketchup, sugar and vinegar and stir into a thick, sticky masala.', '[16,  17,  18]', 2, 60, 120, NULL, 0, 'fixed', 'look', 'thick and glossy', NULL),
  ('c00c0590-0000-4000-8000-000000000003', 7, 'c00c0590-03-08', 'cook', 'Toss in the fried chicken and keep tossing until every piece is coated and dry.', '[0]', 2, 120, 240, NULL, 0, 'partly', 'look', 'dry and coated, no sauce left in the pan', 'It is meant to be dry and crisp; serve it hot.');

-- 04 Chettinad chicken curry: 21 lines, 10 steps (2 prep, 8 cook).
DELETE FROM kitchen_recipe_lines WHERE recipe_id = 'c00c0590-0000-4000-8000-000000000004';
INSERT INTO kitchen_recipe_lines (recipe_id, position, food_key, name, qty_milli, unit, to_taste, is_main) VALUES
  ('c00c0590-0000-4000-8000-000000000004', 0, 'chicken', 'Chicken, curry cut', 750000, 'g', 0, 1),
  ('c00c0590-0000-4000-8000-000000000004', 1, 'curd', 'Curd', 120000, 'cup', 0, 0),
  ('c00c0590-0000-4000-8000-000000000004', 2, 'turmeric', 'Turmeric', 2500, 'tsp', 0, 0),
  ('c00c0590-0000-4000-8000-000000000004', 3, 'coriander_seeds', 'Coriander seeds', 30000, 'tbsp', 0, 0),
  ('c00c0590-0000-4000-8000-000000000004', 4, 'cumin', 'Cumin seeds', 5000, 'tsp', 0, 0),
  ('c00c0590-0000-4000-8000-000000000004', 5, 'fennel_seeds', 'Fennel seeds', 5000, 'tsp', 0, 0),
  ('c00c0590-0000-4000-8000-000000000004', 6, 'black_pepper', 'Black peppercorns', 15000, 'tbsp', 0, 0),
  ('c00c0590-0000-4000-8000-000000000004', 7, 'dried_red_chilli', 'Dried red chillies', 8000, 'pcs', 0, 0),
  ('c00c0590-0000-4000-8000-000000000004', 8, 'cinnamon', 'Cinnamon stick', 5000, 'g', 0, 0),
  ('c00c0590-0000-4000-8000-000000000004', 9, 'cloves', 'Cloves', 2500, 'tsp', 0, 0),
  ('c00c0590-0000-4000-8000-000000000004', 10, 'cardamom', 'Green cardamom', 2500, 'tsp', 0, 0),
  ('c00c0590-0000-4000-8000-000000000004', 11, 'star_anise', 'Star anise, one', NULL, NULL, 1, 0),
  ('c00c0590-0000-4000-8000-000000000004', 12, 'coconut', 'Grated coconut', 120000, 'cup', 0, 0),
  ('c00c0590-0000-4000-8000-000000000004', 13, 'sesame_oil', 'Gingelly (sesame) oil', 45000, 'tbsp', 0, 0),
  ('c00c0590-0000-4000-8000-000000000004', 14, 'small_onion', 'Shallots, sliced', 150000, 'g', 0, 0),
  ('c00c0590-0000-4000-8000-000000000004', 15, 'ginger_garlic_paste', 'Ginger-garlic paste', 15000, 'tbsp', 0, 0),
  ('c00c0590-0000-4000-8000-000000000004', 16, 'tomato', 'Tomatoes, chopped', 2000, 'pcs', 0, 0),
  ('c00c0590-0000-4000-8000-000000000004', 17, 'curry_leaves', 'Curry leaves, two sprigs', NULL, NULL, 1, 0),
  ('c00c0590-0000-4000-8000-000000000004', 18, 'salt', 'Salt', NULL, NULL, 1, 0),
  ('c00c0590-0000-4000-8000-000000000004', 19, 'water', 'Water', 240000, 'cup', 0, 0),
  ('c00c0590-0000-4000-8000-000000000004', 20, 'coriander_leaves', 'Coriander leaves, chopped', 30000, 'tbsp', 0, 0);
DELETE FROM kitchen_recipe_steps WHERE recipe_id = 'c00c0590-0000-4000-8000-000000000004';
INSERT INTO kitchen_recipe_steps (recipe_id, position, step_key, phase, text, line_refs, heat, min_seconds, max_seconds, whistles, hands_off, time_rule, sense, checkpoint, tip) VALUES
  ('c00c0590-0000-4000-8000-000000000004', 0, 'c00c0590-04-01', 'prep', 'Mix the chicken with the curd, turmeric and salt and leave it to marinate.', '[0,  1,  2,  18]', NULL, 1800, 3600, NULL, 1, 'fixed', NULL, NULL, 'Covered in the fridge, it can sit longer and turns more tender.'),
  ('c00c0590-0000-4000-8000-000000000004', 1, 'c00c0590-04-02', 'prep', 'Slice the shallots and chop the tomatoes and coriander leaves.', '[14,  16,  20]', NULL, 480, 720, NULL, 0, 'linear', NULL, NULL, NULL),
  ('c00c0590-0000-4000-8000-000000000004', 2, 'c00c0590-04-03', 'cook', 'Dry-roast the coriander seeds, cumin, fennel, peppercorns, dried chillies, cinnamon, cloves and cardamom on low.', '[3,  4,  5,  6,  7,  8,  9,  10]', 1, 180, 300, NULL, 0, 'fixed', 'smell', 'fragrant and a shade darker', 'Keep stirring; burnt spices turn the curry bitter.'),
  ('c00c0590-0000-4000-8000-000000000004', 3, 'c00c0590-04-04', 'cook', 'Add the coconut and roast until light golden, then cool and grind it all to a fine paste with a little of the water.', '[12,  19]', 1, 180, 300, NULL, 0, 'fixed', 'look', 'the coconut is light golden', NULL),
  ('c00c0590-0000-4000-8000-000000000004', 4, 'c00c0590-04-05', 'cook', 'Heat the oil, add the star anise and curry leaves, then the shallots, and fry until golden.', '[13,  11,  17,  14]', 2, 360, 540, NULL, 0, 'partly', 'look', 'golden brown', NULL),
  ('c00c0590-0000-4000-8000-000000000004', 5, 'c00c0590-04-06', 'cook', 'Add the ginger-garlic paste and fry until the raw smell goes.', '[15]', 2, 60, 120, NULL, 0, 'fixed', 'smell', 'the raw smell goes', NULL),
  ('c00c0590-0000-4000-8000-000000000004', 6, 'c00c0590-04-07', 'cook', 'Add the tomatoes and cook until soft and mushy.', '[16]', 2, 300, 420, NULL, 0, 'partly', 'look', 'the tomatoes melt into the shallots', NULL),
  ('c00c0590-0000-4000-8000-000000000004', 7, 'c00c0590-04-08', 'cook', 'Add the chicken and sear it on high, stirring.', '[0]', 3, 300, 420, NULL, 0, 'partly', 'look', 'no raw pink shows on the outside', NULL),
  ('c00c0590-0000-4000-8000-000000000004', 8, 'c00c0590-04-09', 'cook', 'Stir in the ground masala and the rest of the water, cover and simmer on low until the chicken is tender.', '[19]', 1, 1200, 1800, NULL, 1, 'partly', 'look', 'no pink inside, and oil floats on top', NULL),
  ('c00c0590-0000-4000-8000-000000000004', 9, 'c00c0590-04-10', 'cook', 'Scatter the coriander leaves and check the salt.', '[20,  18]', 0, NULL, NULL, NULL, 0, 'fixed', 'taste', 'the salt is right', 'Serve with rice, parotta or dosa.');

-- 05 Chicken roast (Kerala): 17 lines, 9 steps (2 prep, 7 cook).
DELETE FROM kitchen_recipe_lines WHERE recipe_id = 'c00c0590-0000-4000-8000-000000000005';
INSERT INTO kitchen_recipe_lines (recipe_id, position, food_key, name, qty_milli, unit, to_taste, is_main) VALUES
  ('c00c0590-0000-4000-8000-000000000005', 0, 'chicken', 'Chicken, curry cut', 750000, 'g', 0, 1),
  ('c00c0590-0000-4000-8000-000000000005', 1, 'red_chilli_powder', 'Kashmiri chilli powder', 15000, 'tbsp', 0, 0),
  ('c00c0590-0000-4000-8000-000000000005', 2, 'turmeric', 'Turmeric', 2500, 'tsp', 0, 0),
  ('c00c0590-0000-4000-8000-000000000005', 3, 'black_pepper', 'Black pepper powder', 5000, 'tsp', 0, 0),
  ('c00c0590-0000-4000-8000-000000000005', 4, 'lemon', 'Lemon, for its juice', 500, 'pcs', 0, 0),
  ('c00c0590-0000-4000-8000-000000000005', 5, 'salt', 'Salt', NULL, NULL, 1, 0),
  ('c00c0590-0000-4000-8000-000000000005', 6, 'coconut_oil', 'Coconut oil', 60000, 'tbsp', 0, 0),
  ('c00c0590-0000-4000-8000-000000000005', 7, 'onion', 'Onions, thinly sliced', 3000, 'pcs', 0, 0),
  ('c00c0590-0000-4000-8000-000000000005', 8, 'ginger', 'Ginger, crushed', 15000, 'g', 0, 0),
  ('c00c0590-0000-4000-8000-000000000005', 9, 'garlic', 'Garlic cloves, crushed', 10000, 'pcs', 0, 0),
  ('c00c0590-0000-4000-8000-000000000005', 10, 'green_chilli', 'Green chillies, slit', 3000, 'pcs', 0, 0),
  ('c00c0590-0000-4000-8000-000000000005', 11, 'curry_leaves', 'Curry leaves, two sprigs', NULL, NULL, 1, 0),
  ('c00c0590-0000-4000-8000-000000000005', 12, 'tomato', 'Tomato, chopped', 1000, 'pcs', 0, 0),
  ('c00c0590-0000-4000-8000-000000000005', 13, 'coriander_powder', 'Coriander powder', 15000, 'tbsp', 0, 0),
  ('c00c0590-0000-4000-8000-000000000005', 14, 'fennel_seeds', 'Fennel seeds, crushed', 2500, 'tsp', 0, 0),
  ('c00c0590-0000-4000-8000-000000000005', 15, 'garam_masala', 'Garam masala', 5000, 'tsp', 0, 0),
  ('c00c0590-0000-4000-8000-000000000005', 16, 'water', 'Water', 120000, 'cup', 0, 0);
DELETE FROM kitchen_recipe_steps WHERE recipe_id = 'c00c0590-0000-4000-8000-000000000005';
INSERT INTO kitchen_recipe_steps (recipe_id, position, step_key, phase, text, line_refs, heat, min_seconds, max_seconds, whistles, hands_off, time_rule, sense, checkpoint, tip) VALUES
  ('c00c0590-0000-4000-8000-000000000005', 0, 'c00c0590-05-01', 'prep', 'Rub the chicken with half the chilli powder, the turmeric, half the pepper, the lemon juice and salt, and leave it to marinate.', '[0,  1,  2,  3,  4,  5]', NULL, 1800, 3600, NULL, 1, 'fixed', NULL, NULL, NULL),
  ('c00c0590-0000-4000-8000-000000000005', 1, 'c00c0590-05-02', 'prep', 'Thinly slice the onions, crush the ginger and garlic, slit the chillies and chop the tomato.', '[7,  8,  9,  10,  12]', NULL, 480, 720, NULL, 0, 'linear', NULL, NULL, NULL),
  ('c00c0590-0000-4000-8000-000000000005', 2, 'c00c0590-05-03', 'cook', 'Heat the coconut oil and shallow-fry the chicken until lightly browned, then lift it out.', '[6,  0]', 2, 480, 720, NULL, 0, 'partly', 'look', 'lightly browned on both sides', NULL),
  ('c00c0590-0000-4000-8000-000000000005', 3, 'c00c0590-05-04', 'cook', 'In the same oil, fry the onions until deep brown.', '[7]', 2, 900, 1200, NULL, 0, 'partly', 'look', 'deep brown and jammy', 'This is where the roast gets its flavour; don''t rush it.'),
  ('c00c0590-0000-4000-8000-000000000005', 4, 'c00c0590-05-05', 'cook', 'Add the ginger, garlic, chillies and curry leaves and fry until the raw smell goes.', '[8,  9,  10,  11]', 2, 60, 120, NULL, 0, 'fixed', 'smell', 'the raw smell goes', NULL),
  ('c00c0590-0000-4000-8000-000000000005', 5, 'c00c0590-05-06', 'cook', 'Lower the flame, add the rest of the chilli powder, the coriander powder and fennel, and stir.', '[1,  13,  14]', 1, 45, 90, NULL, 0, 'fixed', 'smell', 'the spices smell toasted, not burnt', NULL),
  ('c00c0590-0000-4000-8000-000000000005', 6, 'c00c0590-05-07', 'cook', 'Add the tomato and cook until it melts.', '[12]', 2, 240, 360, NULL, 0, 'partly', 'look', 'the tomato breaks down', NULL),
  ('c00c0590-0000-4000-8000-000000000005', 7, 'c00c0590-05-08', 'cook', 'Add the chicken and the water, cover and cook on low until tender.', '[0,  16]', 1, 900, 1200, NULL, 1, 'partly', 'look', 'no pink inside', NULL),
  ('c00c0590-0000-4000-8000-000000000005', 8, 'c00c0590-05-09', 'cook', 'Uncover, add the garam masala and the rest of the pepper, and roast on medium until the masala clings.', '[15,  3]', 2, 300, 600, NULL, 0, 'partly', 'look', 'dark, dry and clinging to the chicken', 'Stir from the bottom so the masala doesn''t catch.');

-- 06 Beef roast (Kerala ularthiyathu): 16 lines, 9 steps (2 prep, 7 cook).
DELETE FROM kitchen_recipe_lines WHERE recipe_id = 'c00c0590-0000-4000-8000-000000000006';
INSERT INTO kitchen_recipe_lines (recipe_id, position, food_key, name, qty_milli, unit, to_taste, is_main) VALUES
  ('c00c0590-0000-4000-8000-000000000006', 0, 'beef', 'Beef, small cubes', 750000, 'g', 0, 1),
  ('c00c0590-0000-4000-8000-000000000006', 1, 'turmeric', 'Turmeric', 2500, 'tsp', 0, 0),
  ('c00c0590-0000-4000-8000-000000000006', 2, 'red_chilli_powder', 'Kashmiri chilli powder', 15000, 'tbsp', 0, 0),
  ('c00c0590-0000-4000-8000-000000000006', 3, 'coriander_powder', 'Coriander powder', 22500, 'tbsp', 0, 0),
  ('c00c0590-0000-4000-8000-000000000006', 4, 'black_pepper', 'Black pepper powder', 10000, 'tsp', 0, 0),
  ('c00c0590-0000-4000-8000-000000000006', 5, 'garam_masala', 'Garam masala', 5000, 'tsp', 0, 0),
  ('c00c0590-0000-4000-8000-000000000006', 6, 'ginger', 'Ginger, crushed', 20000, 'g', 0, 0),
  ('c00c0590-0000-4000-8000-000000000006', 7, 'garlic', 'Garlic cloves, crushed', 10000, 'pcs', 0, 0),
  ('c00c0590-0000-4000-8000-000000000006', 8, 'green_chilli', 'Green chillies, slit', 3000, 'pcs', 0, 0),
  ('c00c0590-0000-4000-8000-000000000006', 9, 'small_onion', 'Shallots, sliced', 150000, 'g', 0, 0),
  ('c00c0590-0000-4000-8000-000000000006', 10, 'coconut', 'Coconut, cut in thin slivers (thenga kothu)', 60000, 'g', 0, 0),
  ('c00c0590-0000-4000-8000-000000000006', 11, 'coconut_oil', 'Coconut oil', 60000, 'tbsp', 0, 0),
  ('c00c0590-0000-4000-8000-000000000006', 12, 'curry_leaves', 'Curry leaves, three sprigs', NULL, NULL, 1, 0),
  ('c00c0590-0000-4000-8000-000000000006', 13, 'fennel_seeds', 'Fennel seeds, crushed', 5000, 'tsp', 0, 0),
  ('c00c0590-0000-4000-8000-000000000006', 14, 'salt', 'Salt', NULL, NULL, 1, 0),
  ('c00c0590-0000-4000-8000-000000000006', 15, 'water', 'Water', 120000, 'cup', 0, 0);
DELETE FROM kitchen_recipe_steps WHERE recipe_id = 'c00c0590-0000-4000-8000-000000000006';
INSERT INTO kitchen_recipe_steps (recipe_id, position, step_key, phase, text, line_refs, heat, min_seconds, max_seconds, whistles, hands_off, time_rule, sense, checkpoint, tip) VALUES
  ('c00c0590-0000-4000-8000-000000000006', 0, 'c00c0590-06-01', 'prep', 'Wash and drain the beef, mix it with the turmeric, chilli powder, coriander powder, half the pepper, half the ginger and garlic, and salt, and leave it.', '[0,  1,  2,  3,  4,  6,  7,  14]', NULL, 1800, 3600, NULL, 1, 'fixed', NULL, NULL, NULL),
  ('c00c0590-0000-4000-8000-000000000006', 1, 'c00c0590-06-02', 'prep', 'Slice the shallots, slit the chillies, and cut the coconut into thin slivers.', '[9,  8,  10]', NULL, 600, 900, NULL, 0, 'linear', NULL, NULL, NULL),
  ('c00c0590-0000-4000-8000-000000000006', 2, 'c00c0590-06-03', 'cook', 'Pressure-cook the beef with the water on high.', '[0,  15]', 3, NULL, NULL, 5, 1, 'fixed', NULL, NULL, 'A tough cut may need one or two more.'),
  ('c00c0590-0000-4000-8000-000000000006', 3, 'c00c0590-06-04', 'cook', 'Turn the flame down to low and let it cook on.', '[]', 1, 600, 900, NULL, 1, 'fixed', NULL, NULL, NULL),
  ('c00c0590-0000-4000-8000-000000000006', 4, 'c00c0590-06-05', 'cook', 'Turn off the heat and let the pressure drop on its own.', '[]', 0, 600, 900, NULL, 1, 'fixed', 'look', 'the pressure valve has dropped', NULL),
  ('c00c0590-0000-4000-8000-000000000006', 5, 'c00c0590-06-06', 'cook', 'Heat the coconut oil and fry the coconut slivers until golden brown.', '[11,  10]', 2, 180, 300, NULL, 0, 'partly', 'look', 'golden brown', NULL),
  ('c00c0590-0000-4000-8000-000000000006', 6, 'c00c0590-06-07', 'cook', 'Add the shallots, the rest of the ginger and garlic, the chillies and curry leaves, and fry until golden.', '[9,  6,  7,  8,  12]', 2, 360, 540, NULL, 0, 'partly', 'look', 'the shallots are golden', NULL),
  ('c00c0590-0000-4000-8000-000000000006', 7, 'c00c0590-06-08', 'cook', 'Add the cooked beef with its stock and the fennel, and cook until the liquid is gone.', '[0,  13]', 2, 600, 900, NULL, 0, 'partly', 'look', 'no liquid left in the pan', NULL),
  ('c00c0590-0000-4000-8000-000000000006', 8, 'c00c0590-06-09', 'cook', 'Add the garam masala and the rest of the pepper and roast, stirring, until dark brown and dry.', '[5,  4]', 2, 900, 1500, NULL, 0, 'partly', 'look', 'dark brown, dry, the oil glistening', 'Scrape the bottom often; the long roast is what makes it ularthiyathu.');

-- 07 Ghee rice with kaima curry: 24 lines, 11 steps (2 prep, 9 cook).
DELETE FROM kitchen_recipe_lines WHERE recipe_id = 'c00c0590-0000-4000-8000-000000000007';
INSERT INTO kitchen_recipe_lines (recipe_id, position, food_key, name, qty_milli, unit, to_taste, is_main) VALUES
  ('c00c0590-0000-4000-8000-000000000007', 0, 'rice', 'Kaima (jeerakasala) rice', 480000, 'cup', 0, 1),
  ('c00c0590-0000-4000-8000-000000000007', 1, 'ghee', 'Ghee', 60000, 'tbsp', 0, 0),
  ('c00c0590-0000-4000-8000-000000000007', 2, 'onion', 'Onion, thinly sliced, for the rice', 1000, 'pcs', 0, 0),
  ('c00c0590-0000-4000-8000-000000000007', 3, 'cashews', 'Cashews', 30000, 'tbsp', 0, 0),
  ('c00c0590-0000-4000-8000-000000000007', 4, 'raisins', 'Raisins', 15000, 'tbsp', 0, 0),
  ('c00c0590-0000-4000-8000-000000000007', 5, 'cinnamon', 'Cinnamon stick', 5000, 'g', 0, 0),
  ('c00c0590-0000-4000-8000-000000000007', 6, 'cloves', 'Cloves', 2500, 'tsp', 0, 0),
  ('c00c0590-0000-4000-8000-000000000007', 7, 'cardamom', 'Green cardamom', 2500, 'tsp', 0, 0),
  ('c00c0590-0000-4000-8000-000000000007', 8, 'bay_leaf', 'Bay leaf, one', NULL, NULL, 1, 0),
  ('c00c0590-0000-4000-8000-000000000007', 9, 'water', 'Hot water, for the rice', 840000, 'cup', 0, 0),
  ('c00c0590-0000-4000-8000-000000000007', 10, 'salt', 'Salt', NULL, NULL, 1, 0),
  ('c00c0590-0000-4000-8000-000000000007', 11, 'mutton', 'Mutton keema', 500000, 'g', 0, 0),
  ('c00c0590-0000-4000-8000-000000000007', 12, 'onion', 'Onions, chopped, for the curry', 2000, 'pcs', 0, 0),
  ('c00c0590-0000-4000-8000-000000000007', 13, 'tomato', 'Tomatoes, chopped', 2000, 'pcs', 0, 0),
  ('c00c0590-0000-4000-8000-000000000007', 14, 'ginger_garlic_paste', 'Ginger-garlic paste', 15000, 'tbsp', 0, 0),
  ('c00c0590-0000-4000-8000-000000000007', 15, 'green_chilli', 'Green chillies, chopped', 3000, 'pcs', 0, 0),
  ('c00c0590-0000-4000-8000-000000000007', 16, 'turmeric', 'Turmeric', 2500, 'tsp', 0, 0),
  ('c00c0590-0000-4000-8000-000000000007', 17, 'red_chilli_powder', 'Kashmiri chilli powder', 15000, 'tbsp', 0, 0),
  ('c00c0590-0000-4000-8000-000000000007', 18, 'coriander_powder', 'Coriander powder', 15000, 'tbsp', 0, 0),
  ('c00c0590-0000-4000-8000-000000000007', 19, 'garam_masala', 'Garam masala', 5000, 'tsp', 0, 0),
  ('c00c0590-0000-4000-8000-000000000007', 20, 'oil', 'Oil', 30000, 'tbsp', 0, 0),
  ('c00c0590-0000-4000-8000-000000000007', 21, 'green_peas', 'Green peas', 120000, 'cup', 0, 0),
  ('c00c0590-0000-4000-8000-000000000007', 22, 'water', 'Water, for the curry', 240000, 'cup', 0, 0),
  ('c00c0590-0000-4000-8000-000000000007', 23, 'coriander_leaves', 'Coriander leaves, chopped', 30000, 'tbsp', 0, 0);
DELETE FROM kitchen_recipe_steps WHERE recipe_id = 'c00c0590-0000-4000-8000-000000000007';
INSERT INTO kitchen_recipe_steps (recipe_id, position, step_key, phase, text, line_refs, heat, min_seconds, max_seconds, whistles, hands_off, time_rule, sense, checkpoint, tip) VALUES
  ('c00c0590-0000-4000-8000-000000000007', 0, 'c00c0590-07-01', 'prep', 'Wash the rice gently and leave it to soak, then drain it well.', '[0]', NULL, 1200, 1800, NULL, 1, 'fixed', NULL, NULL, 'Kaima rice is delicate; rub it gently so the grains stay whole.'),
  ('c00c0590-0000-4000-8000-000000000007', 1, 'c00c0590-07-02', 'prep', 'Thinly slice the onion for the rice, and chop the onions, tomatoes, chillies and coriander leaves for the curry.', '[2,  12,  13,  15,  23]', NULL, 480, 720, NULL, 0, 'linear', NULL, NULL, NULL),
  ('c00c0590-0000-4000-8000-000000000007', 2, 'c00c0590-07-03', 'cook', 'Heat the oil, fry the onions for the curry until golden, then the ginger-garlic paste and chillies until the raw smell goes.', '[20,  12,  14,  15]', 2, 480, 720, NULL, 0, 'partly', 'look', 'the onions are golden and the raw smell is gone', NULL),
  ('c00c0590-0000-4000-8000-000000000007', 3, 'c00c0590-07-04', 'cook', 'Lower the flame, add the turmeric, chilli powder and coriander powder, then the tomatoes, and cook until soft.', '[16,  17,  18,  13]', 2, 300, 420, NULL, 0, 'partly', 'look', 'oil shows at the edges', NULL),
  ('c00c0590-0000-4000-8000-000000000007', 4, 'c00c0590-07-05', 'cook', 'Add the keema and cook on high, breaking it up, until it is no longer pink.', '[11]', 3, 300, 480, NULL, 0, 'partly', 'look', 'no pink left and no lumps', NULL),
  ('c00c0590-0000-4000-8000-000000000007', 5, 'c00c0590-07-06', 'cook', 'Add the peas, the water for the curry and salt, cover and simmer until the keema is tender and the curry thick.', '[21,  22,  10]', 1, 900, 1500, NULL, 1, 'partly', 'look', 'thick, with oil on top', NULL),
  ('c00c0590-0000-4000-8000-000000000007', 6, 'c00c0590-07-07', 'cook', 'Stir in the garam masala and coriander leaves, check the salt and keep the curry aside.', '[19,  23]', 0, NULL, NULL, NULL, 0, 'fixed', 'taste', 'the salt is right', NULL),
  ('c00c0590-0000-4000-8000-000000000007', 7, 'c00c0590-07-08', 'cook', 'For the rice, heat the ghee and fry the sliced onion until golden, then the cashews and raisins, and lift them out.', '[1,  2,  3,  4]', 2, 360, 540, NULL, 0, 'partly', 'look', 'onions crisp and golden, raisins puffed', NULL),
  ('c00c0590-0000-4000-8000-000000000007', 8, 'c00c0590-07-09', 'cook', 'Add the cinnamon, cloves, cardamom and bay leaf to the ghee, then the drained rice, and fry it gently.', '[5,  6,  7,  8,  0]', 1, 120, 180, NULL, 0, 'fixed', 'look', 'the grains turn glossy', 'Stir lightly with a flat spoon so the grains don''t break.'),
  ('c00c0590-0000-4000-8000-000000000007', 9, 'c00c0590-07-10', 'cook', 'Pour in the hot water and salt, bring it to a boil, then cover and cook on the lowest flame.', '[9,  10]', 1, 720, 900, NULL, 1, 'partly', 'look', 'the water is absorbed and the grains are tender', 'Don''t stir once it is covered.'),
  ('c00c0590-0000-4000-8000-000000000007', 10, 'c00c0590-07-11', 'cook', 'Let it rest covered off the heat, then fluff it and top with the fried onion, cashews and raisins.', '[2,  3,  4]', 0, 300, 600, NULL, 1, 'fixed', NULL, NULL, 'Serve with the kaima curry.');

-- 08 Vadi matta rice: 3 lines, 5 steps (1 prep, 4 cook).
DELETE FROM kitchen_recipe_lines WHERE recipe_id = 'c00c0590-0000-4000-8000-000000000008';
INSERT INTO kitchen_recipe_lines (recipe_id, position, food_key, name, qty_milli, unit, to_taste, is_main) VALUES
  ('c00c0590-0000-4000-8000-000000000008', 0, 'rice', 'Kerala matta rice', 480000, 'cup', 0, 1),
  ('c00c0590-0000-4000-8000-000000000008', 1, 'water', 'Water, for boiling', 1920000, 'cup', 0, 0),
  ('c00c0590-0000-4000-8000-000000000008', 2, 'salt', 'Salt', NULL, NULL, 1, 0);
DELETE FROM kitchen_recipe_steps WHERE recipe_id = 'c00c0590-0000-4000-8000-000000000008';
INSERT INTO kitchen_recipe_steps (recipe_id, position, step_key, phase, text, line_refs, heat, min_seconds, max_seconds, whistles, hands_off, time_rule, sense, checkpoint, tip) VALUES
  ('c00c0590-0000-4000-8000-000000000008', 0, 'c00c0590-08-01', 'prep', 'Wash the rice in several changes of water until it runs clearer, then leave it to soak.', '[0]', NULL, 1800, 3600, NULL, 1, 'fixed', NULL, NULL, 'Soaking shortens the boil and cooks the grains evenly.'),
  ('c00c0590-0000-4000-8000-000000000008', 1, 'c00c0590-08-02', 'cook', 'Bring the water to a rolling boil in a large pot.', '[1]', 3, 480, 720, NULL, 0, 'fixed', 'look', 'a rolling boil', NULL),
  ('c00c0590-0000-4000-8000-000000000008', 2, 'c00c0590-08-03', 'cook', 'Drain the rice and add it to the boiling water with the salt.', '[0,  2]', 3, NULL, NULL, NULL, 0, 'fixed', 'look', 'the water comes back to the boil', NULL),
  ('c00c0590-0000-4000-8000-000000000008', 3, 'c00c0590-08-04', 'cook', 'Boil it uncovered on medium, stirring now and then, until the grains are soft but still whole.', '[]', 2, 1800, 2400, NULL, 1, 'partly', 'feel', 'a grain presses soft between your fingers', 'Matta rice keeps a little bite; it should not turn mushy.'),
  ('c00c0590-0000-4000-8000-000000000008', 4, 'c00c0590-08-05', 'cook', 'Drain it in a colander and let it stand to steam dry.', '[]', 0, 180, 300, NULL, 1, 'fixed', 'look', 'no more water drips and the grains are separate', 'Keep the drained kanji water to drink warm with a pinch of salt.');

-- 09 Pork vindaloo: 16 lines, 8 steps (4 prep, 4 cook).
DELETE FROM kitchen_recipe_lines WHERE recipe_id = 'c00c0590-0000-4000-8000-000000000009';
INSERT INTO kitchen_recipe_lines (recipe_id, position, food_key, name, qty_milli, unit, to_taste, is_main) VALUES
  ('c00c0590-0000-4000-8000-000000000009', 0, 'pork', 'Pork with some fat, cubed', 750000, 'g', 0, 1),
  ('c00c0590-0000-4000-8000-000000000009', 1, 'dried_red_chilli', 'Dried Kashmiri chillies', 12000, 'pcs', 0, 0),
  ('c00c0590-0000-4000-8000-000000000009', 2, 'vinegar', 'Vinegar', 75000, 'tbsp', 0, 0),
  ('c00c0590-0000-4000-8000-000000000009', 3, 'cumin', 'Cumin seeds', 5000, 'tsp', 0, 0),
  ('c00c0590-0000-4000-8000-000000000009', 4, 'black_pepper', 'Black peppercorns', 5000, 'tsp', 0, 0),
  ('c00c0590-0000-4000-8000-000000000009', 5, 'cloves', 'Cloves', 2500, 'tsp', 0, 0),
  ('c00c0590-0000-4000-8000-000000000009', 6, 'cinnamon', 'Cinnamon stick', 5000, 'g', 0, 0),
  ('c00c0590-0000-4000-8000-000000000009', 7, 'turmeric', 'Turmeric', 2500, 'tsp', 0, 0),
  ('c00c0590-0000-4000-8000-000000000009', 8, 'garlic', 'Garlic cloves', 12000, 'pcs', 0, 0),
  ('c00c0590-0000-4000-8000-000000000009', 9, 'ginger', 'Ginger', 20000, 'g', 0, 0),
  ('c00c0590-0000-4000-8000-000000000009', 10, 'salt', 'Salt', NULL, NULL, 1, 0),
  ('c00c0590-0000-4000-8000-000000000009', 11, 'oil', 'Oil', 45000, 'tbsp', 0, 0),
  ('c00c0590-0000-4000-8000-000000000009', 12, 'onion', 'Onions, finely chopped', 2000, 'pcs', 0, 0),
  ('c00c0590-0000-4000-8000-000000000009', 13, 'green_chilli', 'Green chillies, slit', 2000, 'pcs', 0, 0),
  ('c00c0590-0000-4000-8000-000000000009', 14, 'water', 'Hot water', 240000, 'cup', 0, 0),
  ('c00c0590-0000-4000-8000-000000000009', 15, 'sugar', 'Sugar or jaggery', 5000, 'tsp', 0, 0);
DELETE FROM kitchen_recipe_steps WHERE recipe_id = 'c00c0590-0000-4000-8000-000000000009';
INSERT INTO kitchen_recipe_steps (recipe_id, position, step_key, phase, text, line_refs, heat, min_seconds, max_seconds, whistles, hands_off, time_rule, sense, checkpoint, tip) VALUES
  ('c00c0590-0000-4000-8000-000000000009', 0, 'c00c0590-09-01', 'prep', 'Soak the dried chillies in half the vinegar.', '[1,  2]', NULL, 900, 1800, NULL, 1, 'fixed', NULL, NULL, NULL),
  ('c00c0590-0000-4000-8000-000000000009', 1, 'c00c0590-09-02', 'prep', 'Grind the soaked chillies and their vinegar with the cumin, peppercorns, cloves, cinnamon, turmeric, garlic and ginger to a smooth paste.', '[1,  2,  3,  4,  5,  6,  7,  8,  9]', NULL, 300, 600, NULL, 0, 'fixed', NULL, NULL, NULL),
  ('c00c0590-0000-4000-8000-000000000009', 2, 'c00c0590-09-03', 'prep', 'Rub the pork with the paste and salt, cover it and leave it in the fridge.', '[0,  10]', NULL, 7200, 21600, NULL, 1, 'fixed', NULL, NULL, 'Overnight is best; the vinegar tenderises the pork.'),
  ('c00c0590-0000-4000-8000-000000000009', 3, 'c00c0590-09-04', 'prep', 'Finely chop the onions and slit the chillies.', '[12,  13]', NULL, 300, 480, NULL, 0, 'linear', NULL, NULL, NULL),
  ('c00c0590-0000-4000-8000-000000000009', 4, 'c00c0590-09-05', 'cook', 'Heat the oil and fry the onions until golden brown.', '[11,  12]', 2, 600, 840, NULL, 0, 'partly', 'look', 'golden brown', NULL),
  ('c00c0590-0000-4000-8000-000000000009', 5, 'c00c0590-09-06', 'cook', 'Add the pork with all its marinade and the green chillies, and fry on high, stirring.', '[0,  13]', 3, 420, 600, NULL, 0, 'partly', 'look', 'the pork is sealed and the paste darkens', NULL),
  ('c00c0590-0000-4000-8000-000000000009', 6, 'c00c0590-09-07', 'cook', 'Add the hot water and the rest of the vinegar, cover and simmer on low until the pork is tender.', '[14,  2]', 1, 2700, 3600, NULL, 1, 'partly', 'feel', 'a piece breaks easily with a spoon', 'Stir now and then, and add a splash of water if it catches.'),
  ('c00c0590-0000-4000-8000-000000000009', 7, 'c00c0590-09-08', 'cook', 'Stir in the sugar and check the salt and the sourness.', '[15,  10]', 1, 120, 180, NULL, 0, 'fixed', 'taste', 'sharp, hot and just a little sweet', 'Like most curries, it tastes even better the next day.');

-- 10 Chilli pork: 17 lines, 9 steps (1 prep, 8 cook).
DELETE FROM kitchen_recipe_lines WHERE recipe_id = 'c00c0590-0000-4000-8000-000000000010';
INSERT INTO kitchen_recipe_lines (recipe_id, position, food_key, name, qty_milli, unit, to_taste, is_main) VALUES
  ('c00c0590-0000-4000-8000-000000000010', 0, 'pork', 'Boneless pork, bite-size pieces', 500000, 'g', 0, 1),
  ('c00c0590-0000-4000-8000-000000000010', 1, 'turmeric', 'Turmeric', 2500, 'tsp', 0, 0),
  ('c00c0590-0000-4000-8000-000000000010', 2, 'black_pepper', 'Black pepper powder', 5000, 'tsp', 0, 0),
  ('c00c0590-0000-4000-8000-000000000010', 3, 'salt', 'Salt', NULL, NULL, 1, 0),
  ('c00c0590-0000-4000-8000-000000000010', 4, 'water', 'Water, for cooking the pork', 240000, 'cup', 0, 0),
  ('c00c0590-0000-4000-8000-000000000010', 5, 'cornflour', 'Cornflour', 30000, 'tbsp', 0, 0),
  ('c00c0590-0000-4000-8000-000000000010', 6, 'soy_sauce', 'Soy sauce', 30000, 'tbsp', 0, 0),
  ('c00c0590-0000-4000-8000-000000000010', 7, 'oil', 'Oil', 45000, 'tbsp', 0, 0),
  ('c00c0590-0000-4000-8000-000000000010', 8, 'garlic', 'Garlic cloves, chopped', 8000, 'pcs', 0, 0),
  ('c00c0590-0000-4000-8000-000000000010', 9, 'ginger', 'Ginger, chopped', 15000, 'g', 0, 0),
  ('c00c0590-0000-4000-8000-000000000010', 10, 'green_chilli', 'Green chillies, slit', 4000, 'pcs', 0, 0),
  ('c00c0590-0000-4000-8000-000000000010', 11, 'onion', 'Onion, cut in squares', 1000, 'pcs', 0, 0),
  ('c00c0590-0000-4000-8000-000000000010', 12, 'capsicum', 'Capsicum, cut in squares', 1000, 'pcs', 0, 0),
  ('c00c0590-0000-4000-8000-000000000010', 13, 'red_chilli_sauce', 'Red chilli sauce', 30000, 'tbsp', 0, 0),
  ('c00c0590-0000-4000-8000-000000000010', 14, 'vinegar', 'Vinegar', 5000, 'tsp', 0, 0),
  ('c00c0590-0000-4000-8000-000000000010', 15, 'chilli_flakes', 'Chilli flakes', 5000, 'tsp', 0, 0),
  ('c00c0590-0000-4000-8000-000000000010', 16, 'spring_onion', 'Spring onions, chopped', 2000, 'pcs', 0, 0);
DELETE FROM kitchen_recipe_steps WHERE recipe_id = 'c00c0590-0000-4000-8000-000000000010';
INSERT INTO kitchen_recipe_steps (recipe_id, position, step_key, phase, text, line_refs, heat, min_seconds, max_seconds, whistles, hands_off, time_rule, sense, checkpoint, tip) VALUES
  ('c00c0590-0000-4000-8000-000000000010', 0, 'c00c0590-10-01', 'prep', 'Chop the garlic, ginger and spring onions, slit the chillies, and cut the onion and capsicum into squares.', '[8,  9,  16,  10,  11,  12]', NULL, 480, 720, NULL, 0, 'linear', NULL, NULL, NULL),
  ('c00c0590-0000-4000-8000-000000000010', 1, 'c00c0590-10-02', 'cook', 'Pressure-cook the pork with the turmeric, half the pepper, salt and the water on high.', '[0,  1,  2,  3,  4]', 3, NULL, NULL, 3, 1, 'fixed', NULL, NULL, NULL),
  ('c00c0590-0000-4000-8000-000000000010', 2, 'c00c0590-10-03', 'cook', 'Turn off the heat and let the pressure drop on its own.', '[]', 0, 600, 900, NULL, 1, 'fixed', 'look', 'the pressure valve has dropped', NULL),
  ('c00c0590-0000-4000-8000-000000000010', 3, 'c00c0590-10-04', 'cook', 'Drain the pork, keeping the stock, and toss it with the cornflour and half the soy sauce.', '[0,  5,  6]', 0, NULL, NULL, NULL, 0, 'fixed', 'look', 'every piece is lightly coated', NULL),
  ('c00c0590-0000-4000-8000-000000000010', 4, 'c00c0590-10-05', 'cook', 'Heat the oil and fry the pork until the edges are crisp and brown.', '[7,  0]', 2, 360, 540, NULL, 0, 'partly', 'look', 'crisp, brown edges', NULL),
  ('c00c0590-0000-4000-8000-000000000010', 5, 'c00c0590-10-06', 'cook', 'Push it aside and fry the garlic, ginger and chillies on high.', '[8,  9,  10]', 3, 30, 60, NULL, 0, 'fixed', 'smell', 'the garlic smells fragrant', NULL),
  ('c00c0590-0000-4000-8000-000000000010', 6, 'c00c0590-10-07', 'cook', 'Add the onion and capsicum and toss until just tender.', '[11,  12]', 3, 60, 120, NULL, 0, 'partly', 'look', 'still crunchy', NULL),
  ('c00c0590-0000-4000-8000-000000000010', 7, 'c00c0590-10-08', 'cook', 'Add the chilli sauce, the rest of the soy sauce, the vinegar, chilli flakes, the rest of the pepper and a splash of the stock, and toss.', '[13,  6,  14,  15,  2,  4]', 3, 60, 120, NULL, 0, 'fixed', 'look', 'the sauce is glossy and clings to the pork', NULL),
  ('c00c0590-0000-4000-8000-000000000010', 8, 'c00c0590-10-09', 'cook', 'Toss in the spring onions, check the salt and turn off the heat.', '[16,  3]', 0, NULL, NULL, NULL, 0, 'fixed', 'taste', 'the salt is right', NULL);

-- 11 Fish curry (Kerala, with kudampuli): 15 lines, 7 steps (2 prep, 5 cook).
DELETE FROM kitchen_recipe_lines WHERE recipe_id = 'c00c0590-0000-4000-8000-000000000011';
INSERT INTO kitchen_recipe_lines (recipe_id, position, food_key, name, qty_milli, unit, to_taste, is_main) VALUES
  ('c00c0590-0000-4000-8000-000000000011', 0, 'fish', 'Fish steaks (seer, sardine or mackerel)', 500000, 'g', 0, 1),
  ('c00c0590-0000-4000-8000-000000000011', 1, 'kokum', 'Kudampuli (Malabar tamarind)', 15000, 'g', 0, 0),
  ('c00c0590-0000-4000-8000-000000000011', 2, 'water', 'Warm water, for the kudampuli', 120000, 'cup', 0, 0),
  ('c00c0590-0000-4000-8000-000000000011', 3, 'coconut_oil', 'Coconut oil', 45000, 'tbsp', 0, 0),
  ('c00c0590-0000-4000-8000-000000000011', 4, 'mustard_seeds', 'Mustard seeds', 2500, 'tsp', 0, 0),
  ('c00c0590-0000-4000-8000-000000000011', 5, 'fenugreek_seeds', 'Fenugreek seeds', 2500, 'tsp', 0, 0),
  ('c00c0590-0000-4000-8000-000000000011', 6, 'small_onion', 'Shallots, sliced', 100000, 'g', 0, 0),
  ('c00c0590-0000-4000-8000-000000000011', 7, 'ginger', 'Ginger, crushed', 15000, 'g', 0, 0),
  ('c00c0590-0000-4000-8000-000000000011', 8, 'garlic', 'Garlic cloves, crushed', 10000, 'pcs', 0, 0),
  ('c00c0590-0000-4000-8000-000000000011', 9, 'green_chilli', 'Green chillies, slit', 2000, 'pcs', 0, 0),
  ('c00c0590-0000-4000-8000-000000000011', 10, 'curry_leaves', 'Curry leaves, two sprigs', NULL, NULL, 1, 0),
  ('c00c0590-0000-4000-8000-000000000011', 11, 'red_chilli_powder', 'Kashmiri chilli powder', 30000, 'tbsp', 0, 0),
  ('c00c0590-0000-4000-8000-000000000011', 12, 'turmeric', 'Turmeric', 2500, 'tsp', 0, 0),
  ('c00c0590-0000-4000-8000-000000000011', 13, 'water', 'Water', 360000, 'cup', 0, 0),
  ('c00c0590-0000-4000-8000-000000000011', 14, 'salt', 'Salt', NULL, NULL, 1, 0);
DELETE FROM kitchen_recipe_steps WHERE recipe_id = 'c00c0590-0000-4000-8000-000000000011';
INSERT INTO kitchen_recipe_steps (recipe_id, position, step_key, phase, text, line_refs, heat, min_seconds, max_seconds, whistles, hands_off, time_rule, sense, checkpoint, tip) VALUES
  ('c00c0590-0000-4000-8000-000000000011', 0, 'c00c0590-11-01', 'prep', 'Rinse the kudampuli and soak it in the warm water.', '[1,  2]', NULL, 900, 1800, NULL, 1, 'fixed', NULL, NULL, 'Kudampuli gives the curry its sourness; rinse off any grit first.'),
  ('c00c0590-0000-4000-8000-000000000011', 1, 'c00c0590-11-02', 'prep', 'Clean the fish and cut it into pieces; slice the shallots, crush the ginger and garlic, and slit the chillies.', '[0,  6,  7,  8,  9]', NULL, 600, 900, NULL, 0, 'linear', NULL, NULL, NULL),
  ('c00c0590-0000-4000-8000-000000000011', 2, 'c00c0590-11-03', 'cook', 'Heat the coconut oil in the clay pot and add the mustard and fenugreek seeds.', '[3,  4,  5]', 2, 30, 60, NULL, 0, 'fixed', 'sound', 'the mustard seeds splutter', NULL),
  ('c00c0590-0000-4000-8000-000000000011', 3, 'c00c0590-11-04', 'cook', 'Add the shallots, ginger, garlic, chillies and curry leaves and fry until soft.', '[6,  7,  8,  9,  10]', 2, 240, 360, NULL, 0, 'partly', 'look', 'the shallots are soft and light golden', NULL),
  ('c00c0590-0000-4000-8000-000000000011', 4, 'c00c0590-11-05', 'cook', 'Lower the flame, add the chilli powder and turmeric with a splash of the water, and stir into a paste.', '[11,  12,  13]', 1, 60, 120, NULL, 0, 'fixed', 'look', 'deep red, with oil separating', 'Never let the chilli burn; it turns the curry bitter.'),
  ('c00c0590-0000-4000-8000-000000000011', 5, 'c00c0590-11-06', 'cook', 'Add the rest of the water, the kudampuli with its water, and salt, and bring it to a boil.', '[13,  1,  2,  14]', 2, 180, 300, NULL, 0, 'fixed', 'look', 'it bubbles all over', NULL),
  ('c00c0590-0000-4000-8000-000000000011', 6, 'c00c0590-11-07', 'cook', 'Slide in the fish and simmer, swirling the pot rather than stirring, until the fish is cooked and the gravy thick.', '[0]', 1, 600, 900, NULL, 1, 'partly', 'look', 'the fish is opaque and the gravy thick', 'It tastes best the next day, once the fish soaks up the gravy.');

-- 12 Fish fry (Kerala masala): 11 lines, 6 steps (3 prep, 3 cook).
DELETE FROM kitchen_recipe_lines WHERE recipe_id = 'c00c0590-0000-4000-8000-000000000012';
INSERT INTO kitchen_recipe_lines (recipe_id, position, food_key, name, qty_milli, unit, to_taste, is_main) VALUES
  ('c00c0590-0000-4000-8000-000000000012', 0, 'fish', 'Fish steaks (seer, pomfret or mackerel)', 500000, 'g', 0, 1),
  ('c00c0590-0000-4000-8000-000000000012', 1, 'red_chilli_powder', 'Kashmiri chilli powder', 22500, 'tbsp', 0, 0),
  ('c00c0590-0000-4000-8000-000000000012', 2, 'turmeric', 'Turmeric', 2500, 'tsp', 0, 0),
  ('c00c0590-0000-4000-8000-000000000012', 3, 'black_pepper', 'Black pepper powder', 5000, 'tsp', 0, 0),
  ('c00c0590-0000-4000-8000-000000000012', 4, 'ginger_garlic_paste', 'Ginger-garlic paste', 15000, 'tbsp', 0, 0),
  ('c00c0590-0000-4000-8000-000000000012', 5, 'lemon', 'Lemon, for its juice', 500, 'pcs', 0, 0),
  ('c00c0590-0000-4000-8000-000000000012', 6, 'rice_flour', 'Rice flour', 15000, 'tbsp', 0, 0),
  ('c00c0590-0000-4000-8000-000000000012', 7, 'salt', 'Salt', NULL, NULL, 1, 0),
  ('c00c0590-0000-4000-8000-000000000012', 8, 'water', 'Water, for the paste', 30000, 'tbsp', 0, 0),
  ('c00c0590-0000-4000-8000-000000000012', 9, 'coconut_oil', 'Coconut oil, for shallow frying', 120000, 'cup', 0, 0),
  ('c00c0590-0000-4000-8000-000000000012', 10, 'curry_leaves', 'Curry leaves, two sprigs', NULL, NULL, 1, 0);
DELETE FROM kitchen_recipe_steps WHERE recipe_id = 'c00c0590-0000-4000-8000-000000000012';
INSERT INTO kitchen_recipe_steps (recipe_id, position, step_key, phase, text, line_refs, heat, min_seconds, max_seconds, whistles, hands_off, time_rule, sense, checkpoint, tip) VALUES
  ('c00c0590-0000-4000-8000-000000000012', 0, 'c00c0590-12-01', 'prep', 'Clean the fish, cut it into steaks, score each lightly and pat it dry.', '[0]', NULL, 600, 900, NULL, 0, 'linear', NULL, NULL, NULL),
  ('c00c0590-0000-4000-8000-000000000012', 1, 'c00c0590-12-02', 'prep', 'Mix the chilli powder, turmeric, pepper, ginger-garlic paste, lemon juice, rice flour, salt and the water into a thick paste.', '[1,  2,  3,  4,  5,  6,  7,  8]', NULL, 120, 240, NULL, 0, 'fixed', NULL, NULL, NULL),
  ('c00c0590-0000-4000-8000-000000000012', 2, 'c00c0590-12-03', 'prep', 'Coat the fish all over with the paste and leave it to marinate.', '[0]', NULL, 1800, 3600, NULL, 1, 'fixed', NULL, NULL, 'Covered in the fridge, it can sit longer.'),
  ('c00c0590-0000-4000-8000-000000000012', 3, 'c00c0590-12-04', 'cook', 'Heat the coconut oil in the flat pan and lay in the fish with the curry leaves.', '[9,  10]', 2, 30, 60, NULL, 0, 'fixed', 'sound', 'the fish sizzles as it goes in', NULL),
  ('c00c0590-0000-4000-8000-000000000012', 4, 'c00c0590-12-05', 'cook', 'Fry until the underside is crisp and dark red, then turn it gently.', '[]', 2, 240, 360, NULL, 0, 'linear', 'look', 'crisp and dark red underneath', 'Turn it only once, or the coating comes off.'),
  ('c00c0590-0000-4000-8000-000000000012', 5, 'c00c0590-12-06', 'cook', 'Fry the other side until crisp and the fish is cooked through.', '[]', 2, 180, 300, NULL, 0, 'linear', 'look', 'the fish flakes at the centre', 'Serve with the crisp curry leaves on top.');

-- 13 Beef fry (Kerala): 13 lines, 8 steps (2 prep, 6 cook).
DELETE FROM kitchen_recipe_lines WHERE recipe_id = 'c00c0590-0000-4000-8000-000000000013';
INSERT INTO kitchen_recipe_lines (recipe_id, position, food_key, name, qty_milli, unit, to_taste, is_main) VALUES
  ('c00c0590-0000-4000-8000-000000000013', 0, 'beef', 'Beef, thin small strips', 500000, 'g', 0, 1),
  ('c00c0590-0000-4000-8000-000000000013', 1, 'turmeric', 'Turmeric', 2500, 'tsp', 0, 0),
  ('c00c0590-0000-4000-8000-000000000013', 2, 'red_chilli_powder', 'Kashmiri chilli powder', 15000, 'tbsp', 0, 0),
  ('c00c0590-0000-4000-8000-000000000013', 3, 'meat_masala', 'Meat masala', 15000, 'tbsp', 0, 0),
  ('c00c0590-0000-4000-8000-000000000013', 4, 'ginger_garlic_paste', 'Ginger-garlic paste', 15000, 'tbsp', 0, 0),
  ('c00c0590-0000-4000-8000-000000000013', 5, 'salt', 'Salt', NULL, NULL, 1, 0),
  ('c00c0590-0000-4000-8000-000000000013', 6, 'water', 'Water', 120000, 'cup', 0, 0),
  ('c00c0590-0000-4000-8000-000000000013', 7, 'coconut_oil', 'Coconut oil', 60000, 'tbsp', 0, 0),
  ('c00c0590-0000-4000-8000-000000000013', 8, 'onion', 'Onions, thinly sliced', 2000, 'pcs', 0, 0),
  ('c00c0590-0000-4000-8000-000000000013', 9, 'green_chilli', 'Green chillies, slit', 3000, 'pcs', 0, 0),
  ('c00c0590-0000-4000-8000-000000000013', 10, 'curry_leaves', 'Curry leaves, three sprigs', NULL, NULL, 1, 0),
  ('c00c0590-0000-4000-8000-000000000013', 11, 'black_pepper', 'Black pepper, coarsely crushed', 10000, 'tsp', 0, 0),
  ('c00c0590-0000-4000-8000-000000000013', 12, 'fennel_seeds', 'Fennel seeds, crushed', 5000, 'tsp', 0, 0);
DELETE FROM kitchen_recipe_steps WHERE recipe_id = 'c00c0590-0000-4000-8000-000000000013';
INSERT INTO kitchen_recipe_steps (recipe_id, position, step_key, phase, text, line_refs, heat, min_seconds, max_seconds, whistles, hands_off, time_rule, sense, checkpoint, tip) VALUES
  ('c00c0590-0000-4000-8000-000000000013', 0, 'c00c0590-13-01', 'prep', 'Mix the beef with the turmeric, chilli powder, half the meat masala, the ginger-garlic paste and salt, and leave it.', '[0,  1,  2,  3,  4,  5]', NULL, 900, 1800, NULL, 1, 'fixed', NULL, NULL, NULL),
  ('c00c0590-0000-4000-8000-000000000013', 1, 'c00c0590-13-02', 'prep', 'Thinly slice the onions, slit the chillies, and crush the pepper and fennel.', '[8,  9,  11,  12]', NULL, 300, 600, NULL, 0, 'linear', NULL, NULL, NULL),
  ('c00c0590-0000-4000-8000-000000000013', 2, 'c00c0590-13-03', 'cook', 'Pressure-cook the beef with the water on high.', '[0,  6]', 3, NULL, NULL, 4, 1, 'fixed', NULL, NULL, 'A tough cut may need one or two more.'),
  ('c00c0590-0000-4000-8000-000000000013', 3, 'c00c0590-13-04', 'cook', 'Turn the flame down to low and let it cook on.', '[]', 1, 600, 900, NULL, 1, 'fixed', NULL, NULL, NULL),
  ('c00c0590-0000-4000-8000-000000000013', 4, 'c00c0590-13-05', 'cook', 'Turn off the heat and let the pressure drop on its own.', '[]', 0, 600, 900, NULL, 1, 'fixed', 'look', 'the pressure valve has dropped', NULL),
  ('c00c0590-0000-4000-8000-000000000013', 5, 'c00c0590-13-06', 'cook', 'Heat the coconut oil and fry the onions, chillies and curry leaves until golden.', '[7,  8,  9,  10]', 2, 480, 720, NULL, 0, 'partly', 'look', 'the onions are golden', NULL),
  ('c00c0590-0000-4000-8000-000000000013', 6, 'c00c0590-13-07', 'cook', 'Add the beef, cook off any liquid, then fry on medium, stirring, until dark and crisp at the edges.', '[0]', 2, 900, 1500, NULL, 0, 'partly', 'look', 'dark brown with crisp edges', 'Spread it out and stir less often so it crisps.'),
  ('c00c0590-0000-4000-8000-000000000013', 7, 'c00c0590-13-08', 'cook', 'Add the rest of the meat masala, the pepper and fennel, and fry until fragrant.', '[3,  11,  12]', 2, 60, 120, NULL, 0, 'fixed', 'smell', 'the pepper smells toasty', 'Check the salt; serve with rice or parotta.');
