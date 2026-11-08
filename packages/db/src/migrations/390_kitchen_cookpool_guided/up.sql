-- 390_kitchen_cookpool_guided: Cookpool's 42 recipes, rewritten with guided steps and tools.
--
-- Context: kitchen
-- Epic: cookpool-guided (GC-4, design §1, §2, §6) — every recipe 360 seeds
--       under usr_cookpool now cooks with you: its steps are split into prep
--       (chopping, soaking, marinating, kneading and resting) and cook, and
--       each cook step says its flame, the lines that go in, a time range and
--       how that range grows with the size, whether it runs hands off, and the
--       checkpoint a home cook watches for ("golden brown", "the raw smell
--       goes", "oil shows at the edges", "mustard seeds splutter", "dal is soft
--       and mashable", "no pink inside"), with a one-line tip where it helps.
--       Pressure-cooker recipes count whistles, then a timed low flame where
--       the recipe needs one, then the pressure dropping as a hands-off step.
--       Rajma, chole, sabudana khichdi and veg fried rice carry long prep
--       (the overnight soaks, and rice cooled ahead).
--
-- Design rules:
--   * One block a recipe, three statements: an UPDATE of its tools, a DELETE
--     of its step rows, and one plain INSERT of its new steps. The steps are
--     replaced rather than updated in place because their number changes
--     (215 text steps become more, shorter guided ones). Nothing else changes:
--     lines, names, minutes, created_at and updated_at stay as 360 wrote them.
--   * Only Cookpool's own rows: every statement names one of 360's fixed
--     recipe ids (c00c0360-…). A person's recipes, and copies people saved of
--     Cookpool's before 390, keep the steps they have — a copy never follows
--     its source.
--   * Fixed step keys, c00c0390-<recipe>-<step> (both two digits, the step
--     counted from 1), so the time cooks record against a step (GC-2's
--     kitchen_dish_step_times, pooled by GC-7) hangs on a key that is the
--     same in every environment and in every copy saved from now on. The
--     random keys 370 gave the old steps go with them.
--   * Plain INSERT, never INSERT OR IGNORE: OR IGNORE skips a row that fails
--     a CHECK without a word (GC-2's note), so a bad step here fails the
--     migration instead of going missing. Both seconds are set in the same
--     row, and whistle steps leave them NULL.
--   * Re-runnable: the runner applies a migration statement by statement with
--     no transaction and re-applies it in full after a failure. Each block
--     deletes before it inserts, so running it again leaves the same rows.
--   * Line positions are 360's lines of that recipe; every line goes in at
--     some step, and a line split between two steps ("half the cumin", "the
--     rest of the ghee") is attached to both. Step text is plain imperative
--     words with no amounts or times in it: the attached lines carry the
--     amounts, scaled, and the step's own range carries the time.
--   * Times are at the recipe's own size. A time rule says how they grow with
--     the size (design §2): fixed for tempering, boiling a pot of water,
--     soaking, resting and the pressure dropping; partly for frying onions,
--     searing, reducing a gravy and cooking more vegetables in the same pan;
--     linear only for work done once a piece — chopping, and rolling or frying
--     rotis, puris, pakodas and omelettes one after another. Whistles never
--     scale.
--   * Heat is 0 off, 1 low, 2 medium, 3 high on every cook step; a step done
--     off the flame (mashing, mixing, garnishing, a drink) says 0.
--   * Long prep is a hands-off prep step whose shortest time is an hour or
--     more (GC-2's rule): the rajma and chole soaks (8–12 h), sabudana's soak
--     (5–8 h) and fried rice's cooled rice (1–3 h). Chicken curry's marinade
--     is 30–90 minutes, so it stays ordinary prep.
--   * Each statement stays far under D1's 100 KB statement limit.

-- 01 Kanda poha: 8 steps (3 prep, 5 cook).
UPDATE kitchen_recipes SET tools = '["Kadai with a lid", "Sieve"]' WHERE id = 'c00c0360-0000-4000-8000-000000000001';
DELETE FROM kitchen_recipe_steps WHERE recipe_id = 'c00c0360-0000-4000-8000-000000000001';
INSERT INTO kitchen_recipe_steps (recipe_id, position, step_key, phase, text, line_refs, heat, min_seconds, max_seconds, whistles, hands_off, time_rule, sense, checkpoint, tip) VALUES
  ('c00c0360-0000-4000-8000-000000000001', 0, 'c00c0390-01-01', 'prep', 'Chop the onion and the coriander, and slit the chillies.', '[1, 12, 2]', NULL, 240, 360, NULL, 0, 'linear', NULL, NULL, NULL),
  ('c00c0360-0000-4000-8000-000000000001', 1, 'c00c0390-01-02', 'prep', 'Rinse the poha in a sieve under running water, drain it and leave it to soften.', '[0]', NULL, 300, 480, NULL, 1, 'fixed', 'feel', 'a flake mashes easily between your fingers', 'Rinse it only for a few seconds; poha left in water turns to mush.'),
  ('c00c0360-0000-4000-8000-000000000001', 2, 'c00c0390-01-03', 'prep', 'Toss the soft poha with the turmeric, sugar and salt.', '[8, 9, 10]', NULL, NULL, NULL, NULL, 0, 'fixed', 'look', 'evenly yellow', NULL),
  ('c00c0360-0000-4000-8000-000000000001', 3, 'c00c0390-01-04', 'cook', 'Heat the oil and fry the peanuts until golden and crunchy, then lift them out.', '[4, 3]', 2, 120, 180, NULL, 0, 'partly', 'look', 'golden and crunchy', 'Keep them moving; peanuts go from golden to burnt fast.'),
  ('c00c0360-0000-4000-8000-000000000001', 4, 'c00c0390-01-05', 'cook', 'Add the mustard seeds. When they splutter, add the cumin, curry leaves and chillies.', '[5, 6, 7, 2]', 2, 30, 60, NULL, 0, 'fixed', 'sound', 'the mustard seeds splutter', NULL),
  ('c00c0360-0000-4000-8000-000000000001', 5, 'c00c0390-01-06', 'cook', 'Add the onion and cook until soft and pale gold.', '[1]', 2, 120, 240, NULL, 0, 'partly', 'look', 'soft and pale gold', NULL),
  ('c00c0360-0000-4000-8000-000000000001', 6, 'c00c0390-01-07', 'cook', 'Add the poha and the peanuts, mix gently, cover and steam on low.', '[0, 3]', 1, 120, 180, NULL, 0, 'fixed', 'feel', 'the poha is soft and hot right through', NULL),
  ('c00c0360-0000-4000-8000-000000000001', 7, 'c00c0390-01-08', 'cook', 'Turn off the heat, squeeze over the lemon and scatter the coriander. Taste and serve hot.', '[11, 12]', 0, NULL, NULL, NULL, 0, 'fixed', 'taste', 'a little tangy, with the salt just right', NULL);

-- 02 Rava upma: 7 steps (1 prep, 6 cook).
UPDATE kitchen_recipes SET tools = '["Kadai with a lid", "Plate"]' WHERE id = 'c00c0360-0000-4000-8000-000000000002';
DELETE FROM kitchen_recipe_steps WHERE recipe_id = 'c00c0360-0000-4000-8000-000000000002';
INSERT INTO kitchen_recipe_steps (recipe_id, position, step_key, phase, text, line_refs, heat, min_seconds, max_seconds, whistles, hands_off, time_rule, sense, checkpoint, tip) VALUES
  ('c00c0360-0000-4000-8000-000000000002', 0, 'c00c0390-02-01', 'prep', 'Chop the onion, chillies, ginger and coriander.', '[2, 3, 4, 12]', NULL, 300, 480, NULL, 0, 'linear', NULL, NULL, NULL),
  ('c00c0360-0000-4000-8000-000000000002', 1, 'c00c0390-02-02', 'cook', 'Dry-roast the rava on low, stirring, then tip it onto a plate.', '[0]', 1, 240, 360, NULL, 0, 'partly', 'smell', 'it smells toasty but is still pale', 'Roasted rava keeps the upma from turning lumpy.'),
  ('c00c0360-0000-4000-8000-000000000002', 2, 'c00c0390-02-03', 'cook', 'Heat the oil and add the mustard seeds. When they splutter, add the urad dal, chana dal and cashews.', '[5, 6, 7, 8, 9]', 2, 60, 120, NULL, 0, 'fixed', 'look', 'the dals and cashews turn golden', NULL),
  ('c00c0360-0000-4000-8000-000000000002', 3, 'c00c0390-02-04', 'cook', 'Add the curry leaves, chillies, ginger and onion, and cook until the onion is soft.', '[10, 3, 4, 2]', 2, 120, 240, NULL, 0, 'partly', 'look', 'the onion is soft and see-through', NULL),
  ('c00c0360-0000-4000-8000-000000000002', 4, 'c00c0390-02-05', 'cook', 'Pour in the water with the salt and bring it to a rolling boil.', '[1, 11]', 3, 180, 300, NULL, 0, 'partly', 'look', 'a rolling boil', NULL),
  ('c00c0360-0000-4000-8000-000000000002', 5, 'c00c0390-02-06', 'cook', 'Lower the heat and pour in the rava in a thin stream, stirring all the time.', '[0]', 1, 60, 120, NULL, 0, 'partly', 'look', 'a thick porridge with no lumps', 'Pour with one hand and stir with the other.'),
  ('c00c0360-0000-4000-8000-000000000002', 6, 'c00c0390-02-07', 'cook', 'Cover and cook on low until the water is absorbed, then fluff it up and add the coriander.', '[12]', 1, 120, 180, NULL, 0, 'fixed', 'look', 'the water is gone and the grains are fluffy', NULL);

-- 03 Egg bhurji: 6 steps (2 prep, 4 cook).
UPDATE kitchen_recipes SET tools = '["Frying pan", "Bowl and fork"]' WHERE id = 'c00c0360-0000-4000-8000-000000000003';
DELETE FROM kitchen_recipe_steps WHERE recipe_id = 'c00c0360-0000-4000-8000-000000000003';
INSERT INTO kitchen_recipe_steps (recipe_id, position, step_key, phase, text, line_refs, heat, min_seconds, max_seconds, whistles, hands_off, time_rule, sense, checkpoint, tip) VALUES
  ('c00c0360-0000-4000-8000-000000000003', 0, 'c00c0390-03-01', 'prep', 'Chop the onion, tomato, chilli and coriander.', '[1, 2, 3, 9]', NULL, 240, 360, NULL, 0, 'linear', NULL, NULL, NULL),
  ('c00c0360-0000-4000-8000-000000000003', 1, 'c00c0390-03-02', 'prep', 'Beat the eggs with a pinch of the salt.', '[0, 8]', NULL, NULL, NULL, NULL, 0, 'fixed', 'look', 'the yolks and whites are one colour', NULL),
  ('c00c0360-0000-4000-8000-000000000003', 2, 'c00c0390-03-03', 'cook', 'Melt the butter, add the onion and chilli and cook until soft.', '[4, 1, 3]', 2, 180, 240, NULL, 0, 'partly', 'look', 'the onion is soft and see-through', NULL),
  ('c00c0360-0000-4000-8000-000000000003', 3, 'c00c0390-03-04', 'cook', 'Add the tomato, turmeric and chilli powder and cook until the tomato breaks down.', '[2, 5, 6]', 2, 120, 180, NULL, 0, 'partly', 'look', 'the tomato is soft and mushy', NULL),
  ('c00c0360-0000-4000-8000-000000000003', 4, 'c00c0390-03-05', 'cook', 'Lower the heat, pour in the eggs and stir slowly until they set in soft curds.', '[0]', 1, 120, 180, NULL, 0, 'partly', 'look', 'just set in soft, moist curds', 'Take it off a little early; the eggs keep cooking in the hot pan.'),
  ('c00c0360-0000-4000-8000-000000000003', 5, 'c00c0390-03-06', 'cook', 'Turn off the heat, sprinkle over the garam masala and coriander, and check the salt.', '[7, 9, 8]', 0, NULL, NULL, NULL, 0, 'fixed', 'taste', 'the salt is right', 'Serve with pav or toast.');

-- 04 Masala omelette: 4 steps (2 prep, 2 cook).
UPDATE kitchen_recipes SET tools = '["Frying pan", "Flat spatula", "Bowl and fork"]' WHERE id = 'c00c0360-0000-4000-8000-000000000004';
DELETE FROM kitchen_recipe_steps WHERE recipe_id = 'c00c0360-0000-4000-8000-000000000004';
INSERT INTO kitchen_recipe_steps (recipe_id, position, step_key, phase, text, line_refs, heat, min_seconds, max_seconds, whistles, hands_off, time_rule, sense, checkpoint, tip) VALUES
  ('c00c0360-0000-4000-8000-000000000004', 0, 'c00c0390-04-01', 'prep', 'Finely chop the onion, tomato, chilli and coriander.', '[1, 2, 3, 4]', NULL, 240, 360, NULL, 0, 'linear', NULL, NULL, NULL),
  ('c00c0360-0000-4000-8000-000000000004', 1, 'c00c0390-04-02', 'prep', 'Whisk the eggs with the salt, pepper and chilli powder until frothy, then stir in the chopped vegetables.', '[0, 8, 6, 5, 1, 2, 3, 4]', NULL, NULL, NULL, NULL, 0, 'fixed', 'look', 'frothy on top', NULL),
  ('c00c0360-0000-4000-8000-000000000004', 2, 'c00c0390-04-03', 'cook', 'Heat a little of the oil, pour in a ladle of the eggs and swirl it thin. Cook until the edges set, then flip and cook the other side briefly.', '[7, 0]', 2, 120, 180, NULL, 0, 'fixed', 'look', 'the edges are set and the underside is golden', 'Lift an edge with the spatula to check before you flip.'),
  ('c00c0360-0000-4000-8000-000000000004', 3, 'c00c0390-04-04', 'cook', 'Cook the rest the same way, with a little oil each time.', '[7, 0]', 2, 120, 180, NULL, 0, 'linear', 'look', 'golden on both sides', 'Serve hot with toast.');

-- 05 Sabudana khichdi: 8 steps (2 prep, 6 cook); long prep 5–8 h.
UPDATE kitchen_recipes SET tools = '["Kadai with a lid", "Sieve", "Mortar and pestle"]' WHERE id = 'c00c0360-0000-4000-8000-000000000005';
DELETE FROM kitchen_recipe_steps WHERE recipe_id = 'c00c0360-0000-4000-8000-000000000005';
INSERT INTO kitchen_recipe_steps (recipe_id, position, step_key, phase, text, line_refs, heat, min_seconds, max_seconds, whistles, hands_off, time_rule, sense, checkpoint, tip) VALUES
  ('c00c0360-0000-4000-8000-000000000005', 0, 'c00c0390-05-01', 'prep', 'Rinse the sabudana two or three times, then soak it in the water until each pearl is soft.', '[0, 1]', NULL, 18000, 28800, NULL, 1, 'fixed', 'feel', 'a pearl squashes flat between your fingers', 'Use just enough water to cover it; more makes it mushy. Overnight is fine.'),
  ('c00c0360-0000-4000-8000-000000000005', 1, 'c00c0390-05-02', 'prep', 'Cut the potato into small cubes, and chop the chillies and coriander.', '[3, 4, 11]', NULL, 240, 360, NULL, 0, 'linear', NULL, NULL, NULL),
  ('c00c0360-0000-4000-8000-000000000005', 2, 'c00c0390-05-03', 'cook', 'Dry-roast the peanuts, rub off the skins and crush them coarsely.', '[2]', 2, 240, 360, NULL, 0, 'partly', 'smell', 'the skins crack and they smell nutty', NULL),
  ('c00c0360-0000-4000-8000-000000000005', 3, 'c00c0390-05-04', 'cook', 'Mix the crushed peanuts into the sabudana with the salt and sugar.', '[8, 9]', 0, NULL, NULL, NULL, 0, 'fixed', 'look', 'every pearl is coated', NULL),
  ('c00c0360-0000-4000-8000-000000000005', 4, 'c00c0390-05-05', 'cook', 'Heat the ghee and add the cumin. When it sizzles, add the chillies and curry leaves.', '[5, 6, 4, 7]', 2, 30, 60, NULL, 0, 'fixed', 'sound', 'the cumin sizzles and darkens', NULL),
  ('c00c0360-0000-4000-8000-000000000005', 5, 'c00c0390-05-06', 'cook', 'Add the potato, cover and cook on low until tender.', '[3]', 1, 360, 480, NULL, 0, 'partly', 'feel', 'a cube breaks under the spoon', NULL),
  ('c00c0360-0000-4000-8000-000000000005', 6, 'c00c0390-05-07', 'cook', 'Add the sabudana and toss gently on low until the pearls turn see-through.', '[0]', 1, 300, 420, NULL, 0, 'partly', 'look', 'most pearls are see-through', 'Stop while a few white centres remain; cooked longer, it turns sticky.'),
  ('c00c0360-0000-4000-8000-000000000005', 7, 'c00c0390-05-08', 'cook', 'Turn off the heat, squeeze over the lemon and add the coriander.', '[10, 11]', 0, NULL, NULL, NULL, 0, 'fixed', 'taste', 'tangy, with the salt just right', NULL);

-- 06 Aloo paratha: 10 steps (3 prep, 7 cook); 3 whistles.
UPDATE kitchen_recipes SET tools = '["Pressure cooker", "Tawa", "Rolling pin and board", "Potato masher"]' WHERE id = 'c00c0360-0000-4000-8000-000000000006';
DELETE FROM kitchen_recipe_steps WHERE recipe_id = 'c00c0360-0000-4000-8000-000000000006';
INSERT INTO kitchen_recipe_steps (recipe_id, position, step_key, phase, text, line_refs, heat, min_seconds, max_seconds, whistles, hands_off, time_rule, sense, checkpoint, tip) VALUES
  ('c00c0360-0000-4000-8000-000000000006', 0, 'c00c0390-06-01', 'prep', 'Knead the atta with the ajwain, a pinch of the salt and the water into a soft dough.', '[0, 2, 9, 1]', NULL, 300, 480, NULL, 0, 'partly', 'feel', 'soft and smooth, and it doesn''t stick', NULL),
  ('c00c0360-0000-4000-8000-000000000006', 1, 'c00c0390-06-02', 'prep', 'Cover the dough and let it rest.', '[]', NULL, 1200, 1800, NULL, 1, 'fixed', NULL, NULL, 'Rested dough stretches round the filling without tearing.'),
  ('c00c0360-0000-4000-8000-000000000006', 2, 'c00c0390-06-03', 'prep', 'Finely chop the chillies and coriander.', '[4, 5]', NULL, 180, 300, NULL, 0, 'linear', NULL, NULL, NULL),
  ('c00c0360-0000-4000-8000-000000000006', 3, 'c00c0390-06-04', 'cook', 'Pressure-cook the potatoes in water on high.', '[3]', 3, NULL, NULL, 3, 1, 'fixed', NULL, NULL, NULL),
  ('c00c0360-0000-4000-8000-000000000006', 4, 'c00c0390-06-05', 'cook', 'Turn off the heat and let the pressure drop on its own.', '[]', 0, 600, 900, NULL, 1, 'fixed', 'look', 'the pressure valve has dropped', 'Don''t lift the weight to hurry it; the food finishes cooking as it settles.'),
  ('c00c0360-0000-4000-8000-000000000006', 5, 'c00c0390-06-06', 'cook', 'Peel and mash the potatoes, and mix in the chillies, coriander, amchur, chilli powder, garam masala and salt.', '[3, 4, 5, 6, 7, 8, 9]', 0, 300, 480, NULL, 0, 'partly', 'feel', 'smooth, with no lumps', 'Lumps tear the paratha when you roll it.'),
  ('c00c0360-0000-4000-8000-000000000006', 6, 'c00c0390-06-07', 'cook', 'Divide the dough and the filling into equal balls. Flatten a ball of dough, set filling in the middle and pinch it closed.', '[]', 0, 480, 720, NULL, 0, 'linear', 'look', 'sealed, with no cracks', NULL),
  ('c00c0360-0000-4000-8000-000000000006', 7, 'c00c0390-06-08', 'cook', 'Heat the tawa. Dust a stuffed ball with flour and roll it gently into a round, so the filling stays inside.', '[]', 2, 60, 120, NULL, 0, 'fixed', 'look', 'an even round with no filling showing', NULL),
  ('c00c0360-0000-4000-8000-000000000006', 8, 'c00c0390-06-09', 'cook', 'Cook it on the hot tawa until spotted underneath, then flip, brush with ghee and cook both sides until golden.', '[10]', 2, 120, 180, NULL, 0, 'fixed', 'look', 'golden brown spots on both sides', NULL),
  ('c00c0360-0000-4000-8000-000000000006', 9, 'c00c0390-06-10', 'cook', 'Roll and cook the rest the same way, keeping the cooked ones warm in a cloth.', '[10]', 2, 900, 1500, NULL, 0, 'linear', 'look', 'every paratha is golden and crisp at the edges', 'Serve hot with curd, pickle or a little butter.');

-- 07 Plain paratha: 6 steps (2 prep, 4 cook).
UPDATE kitchen_recipes SET tools = '["Tawa", "Rolling pin and board", "Flat spatula"]' WHERE id = 'c00c0360-0000-4000-8000-000000000007';
DELETE FROM kitchen_recipe_steps WHERE recipe_id = 'c00c0360-0000-4000-8000-000000000007';
INSERT INTO kitchen_recipe_steps (recipe_id, position, step_key, phase, text, line_refs, heat, min_seconds, max_seconds, whistles, hands_off, time_rule, sense, checkpoint, tip) VALUES
  ('c00c0360-0000-4000-8000-000000000007', 0, 'c00c0390-07-01', 'prep', 'Knead the atta, salt, water and a little of the ghee into a soft dough.', '[0, 2, 1, 3]', NULL, 300, 480, NULL, 0, 'partly', 'feel', 'soft and smooth, and it doesn''t stick', NULL),
  ('c00c0360-0000-4000-8000-000000000007', 1, 'c00c0390-07-02', 'prep', 'Cover the dough and let it rest.', '[]', NULL, 900, 1800, NULL, 1, 'fixed', NULL, NULL, NULL),
  ('c00c0360-0000-4000-8000-000000000007', 2, 'c00c0390-07-03', 'cook', 'Heat the tawa. Divide the dough into balls, roll one into a disc, brush it with ghee and dust it with flour.', '[3]', 2, 60, 120, NULL, 0, 'fixed', NULL, NULL, NULL),
  ('c00c0360-0000-4000-8000-000000000007', 3, 'c00c0390-07-04', 'cook', 'Fold it in half and in half again into a triangle, then roll it out again.', '[]', 2, 60, 120, NULL, 0, 'fixed', 'look', 'an even triangle, thin all over', 'Dust with a little flour if it sticks to the pin.'),
  ('c00c0360-0000-4000-8000-000000000007', 4, 'c00c0390-07-05', 'cook', 'Cook it on the hot tawa until bubbles appear, then flip, brush with ghee and press with a spatula until both sides are golden.', '[3]', 2, 120, 180, NULL, 0, 'fixed', 'look', 'golden and flaky on both sides', NULL),
  ('c00c0360-0000-4000-8000-000000000007', 5, 'c00c0390-07-06', 'cook', 'Make the rest the same way, keeping them warm in a cloth.', '[3]', 2, 900, 1500, NULL, 0, 'linear', 'look', 'every paratha is golden and flaky', NULL);

-- 08 Chapati: 6 steps (2 prep, 4 cook).
UPDATE kitchen_recipes SET tools = '["Tawa", "Rolling pin and board", "Tongs", "Box lined with a cloth"]' WHERE id = 'c00c0360-0000-4000-8000-000000000008';
DELETE FROM kitchen_recipe_steps WHERE recipe_id = 'c00c0360-0000-4000-8000-000000000008';
INSERT INTO kitchen_recipe_steps (recipe_id, position, step_key, phase, text, line_refs, heat, min_seconds, max_seconds, whistles, hands_off, time_rule, sense, checkpoint, tip) VALUES
  ('c00c0360-0000-4000-8000-000000000008', 0, 'c00c0390-08-01', 'prep', 'Mix the atta and salt, then add the water a little at a time and knead into a soft, smooth dough. Rub in the oil.', '[0, 2, 1, 3]', NULL, 300, 480, NULL, 0, 'partly', 'feel', 'soft and smooth, and it doesn''t stick', NULL),
  ('c00c0360-0000-4000-8000-000000000008', 1, 'c00c0390-08-02', 'prep', 'Cover the dough and let it rest.', '[]', NULL, 1200, 1800, NULL, 1, 'fixed', NULL, NULL, 'Rested dough rolls thinner and puffs better.'),
  ('c00c0360-0000-4000-8000-000000000008', 2, 'c00c0390-08-03', 'cook', 'Heat the tawa. Divide the dough into balls, dust one with flour and roll it into a thin round.', '[]', 2, 60, 120, NULL, 0, 'fixed', 'look', 'thin and even all over', NULL),
  ('c00c0360-0000-4000-8000-000000000008', 3, 'c00c0390-08-04', 'cook', 'Cook it on the hot tawa until small bubbles form, then flip.', '[]', 2, 30, 45, NULL, 0, 'fixed', 'look', 'small bubbles form', NULL),
  ('c00c0360-0000-4000-8000-000000000008', 4, 'c00c0390-08-05', 'cook', 'When brown spots appear underneath, hold it over an open flame with tongs, or press it with a cloth on the tawa, until it puffs.', '[]', 3, 30, 60, NULL, 0, 'fixed', 'look', 'it puffs up like a ball', NULL),
  ('c00c0360-0000-4000-8000-000000000008', 5, 'c00c0390-08-06', 'cook', 'Brush it with ghee and stack it in the box, then roll and cook the rest the same way.', '[4]', 2, 900, 1500, NULL, 0, 'linear', 'look', 'every chapati is puffed and stacked', 'Keep the box closed so they stay soft.');

-- 09 Puri: 6 steps (3 prep, 3 cook).
UPDATE kitchen_recipes SET tools = '["Kadai for deep frying", "Rolling pin and board", "Slotted spoon"]' WHERE id = 'c00c0360-0000-4000-8000-000000000009';
DELETE FROM kitchen_recipe_steps WHERE recipe_id = 'c00c0360-0000-4000-8000-000000000009';
INSERT INTO kitchen_recipe_steps (recipe_id, position, step_key, phase, text, line_refs, heat, min_seconds, max_seconds, whistles, hands_off, time_rule, sense, checkpoint, tip) VALUES
  ('c00c0360-0000-4000-8000-000000000009', 0, 'c00c0390-09-01', 'prep', 'Mix the atta, rava, salt and the oil for the dough, then add the water little by little and knead into a stiff, smooth dough.', '[0, 1, 3, 4, 2]', NULL, 300, 480, NULL, 0, 'partly', 'feel', 'stiff and smooth', 'A stiff dough soaks up less oil.'),
  ('c00c0360-0000-4000-8000-000000000009', 1, 'c00c0390-09-02', 'prep', 'Cover the dough and let it rest.', '[]', NULL, 900, 1800, NULL, 1, 'fixed', NULL, NULL, NULL),
  ('c00c0360-0000-4000-8000-000000000009', 2, 'c00c0390-09-03', 'prep', 'Divide it into small balls and roll each into a small round, with a drop of oil instead of dry flour.', '[4]', NULL, 600, 900, NULL, 0, 'linear', NULL, NULL, 'Dry flour burns in the hot oil.'),
  ('c00c0360-0000-4000-8000-000000000009', 3, 'c00c0390-09-04', 'cook', 'Heat the oil for frying.', '[5]', 3, 240, 360, NULL, 0, 'fixed', 'look', 'a pinch of dough rises at once', NULL),
  ('c00c0360-0000-4000-8000-000000000009', 4, 'c00c0390-09-05', 'cook', 'Slide in one puri and press it gently with a slotted spoon so it puffs, then flip and fry until golden.', '[]', 3, 30, 45, NULL, 0, 'fixed', 'look', 'puffed and golden on both sides', NULL),
  ('c00c0360-0000-4000-8000-000000000009', 5, 'c00c0390-09-06', 'cook', 'Fry the rest one at a time, draining them on paper.', '[]', 3, 600, 900, NULL, 0, 'linear', 'look', 'every puri is puffed and golden', 'Serve hot with aloo sabzi, chole or shrikhand.');

-- 10 Dal tadka: 10 steps (2 prep, 8 cook); 3 whistles.
UPDATE kitchen_recipes SET tools = '["Pressure cooker", "Kadai", "Tadka pan", "Whisk"]' WHERE id = 'c00c0360-0000-4000-8000-000000000010';
DELETE FROM kitchen_recipe_steps WHERE recipe_id = 'c00c0360-0000-4000-8000-000000000010';
INSERT INTO kitchen_recipe_steps (recipe_id, position, step_key, phase, text, line_refs, heat, min_seconds, max_seconds, whistles, hands_off, time_rule, sense, checkpoint, tip) VALUES
  ('c00c0360-0000-4000-8000-000000000010', 0, 'c00c0390-10-01', 'prep', 'Rinse the dal two or three times, until the water runs almost clear.', '[0]', NULL, NULL, NULL, NULL, 0, 'fixed', NULL, NULL, NULL),
  ('c00c0360-0000-4000-8000-000000000010', 1, 'c00c0390-10-02', 'prep', 'Chop the onion, tomato and coriander, slit the chilli and slice the garlic.', '[3, 4, 13, 5, 8]', NULL, 300, 480, NULL, 0, 'linear', NULL, NULL, NULL),
  ('c00c0360-0000-4000-8000-000000000010', 2, 'c00c0390-10-03', 'cook', 'Pressure-cook the dal with the water, turmeric and a little of the salt on medium.', '[0, 1, 2, 12]', 2, NULL, NULL, 3, 1, 'fixed', NULL, NULL, 'Medium keeps the dal from frothing out of the vent.'),
  ('c00c0360-0000-4000-8000-000000000010', 3, 'c00c0390-10-04', 'cook', 'Turn off the heat and let the pressure drop on its own.', '[]', 0, 600, 900, NULL, 1, 'fixed', 'look', 'the pressure valve has dropped', 'Don''t lift the weight to hurry it; the food finishes cooking as it settles.'),
  ('c00c0360-0000-4000-8000-000000000010', 4, 'c00c0390-10-05', 'cook', 'Open the cooker and whisk the dal smooth.', '[]', 0, NULL, NULL, NULL, 0, 'fixed', 'feel', 'dal is soft and mashable', NULL),
  ('c00c0360-0000-4000-8000-000000000010', 5, 'c00c0390-10-06', 'cook', 'Heat some of the ghee and add half the cumin, then the onion and chilli, and cook until golden.', '[6, 7, 3, 5]', 2, 240, 360, NULL, 0, 'partly', 'look', 'golden', NULL),
  ('c00c0360-0000-4000-8000-000000000010', 6, 'c00c0390-10-07', 'cook', 'Add the tomato and cook until soft.', '[4]', 2, 180, 240, NULL, 0, 'partly', 'look', 'the tomato is soft and mushy', NULL),
  ('c00c0360-0000-4000-8000-000000000010', 7, 'c00c0390-10-08', 'cook', 'Stir in the dal, loosen it with hot water if needed, check the salt and simmer.', '[0, 12]', 1, 300, 420, NULL, 1, 'fixed', 'look', 'it bubbles gently and coats the spoon', NULL),
  ('c00c0360-0000-4000-8000-000000000010', 8, 'c00c0390-10-09', 'cook', 'For the tadka, heat the rest of the ghee and add the rest of the cumin, the garlic and the dried chillies. Fry until the garlic is golden.', '[6, 7, 8, 9]', 2, 60, 120, NULL, 0, 'fixed', 'look', 'the garlic is golden', 'Pull it off as soon as the garlic turns golden; it burns in seconds.'),
  ('c00c0360-0000-4000-8000-000000000010', 9, 'c00c0390-10-10', 'cook', 'Off the heat, add the hing and chilli powder, pour the tadka over the dal at once and scatter the coriander.', '[10, 11, 13]', 0, NULL, NULL, NULL, 0, 'fixed', 'sound', 'it sizzles as it hits the dal', 'Serve with rice or roti.');

-- 11 Dal fry: 10 steps (2 prep, 8 cook); 4 whistles.
UPDATE kitchen_recipes SET tools = '["Pressure cooker", "Kadai", "Whisk"]' WHERE id = 'c00c0360-0000-4000-8000-000000000011';
DELETE FROM kitchen_recipe_steps WHERE recipe_id = 'c00c0360-0000-4000-8000-000000000011';
INSERT INTO kitchen_recipe_steps (recipe_id, position, step_key, phase, text, line_refs, heat, min_seconds, max_seconds, whistles, hands_off, time_rule, sense, checkpoint, tip) VALUES
  ('c00c0360-0000-4000-8000-000000000011', 0, 'c00c0390-11-01', 'prep', 'Rinse the dal and soak it in fresh water.', '[0]', NULL, 1200, 1800, NULL, 1, 'fixed', NULL, NULL, 'Soaked toor dal cooks softer in fewer whistles.'),
  ('c00c0360-0000-4000-8000-000000000011', 1, 'c00c0390-11-02', 'prep', 'Finely chop the onion, tomatoes and coriander, and slit the chillies.', '[3, 4, 15, 6]', NULL, 360, 600, NULL, 0, 'linear', NULL, NULL, NULL),
  ('c00c0360-0000-4000-8000-000000000011', 2, 'c00c0390-11-03', 'cook', 'Drain the dal and pressure-cook it with the water and turmeric on medium.', '[0, 1, 2]', 2, NULL, NULL, 4, 1, 'fixed', NULL, NULL, NULL),
  ('c00c0360-0000-4000-8000-000000000011', 3, 'c00c0390-11-04', 'cook', 'Turn off the heat and let the pressure drop on its own.', '[]', 0, 600, 900, NULL, 1, 'fixed', 'look', 'the pressure valve has dropped', 'Don''t lift the weight to hurry it; the food finishes cooking as it settles.'),
  ('c00c0360-0000-4000-8000-000000000011', 4, 'c00c0390-11-05', 'cook', 'Open the cooker and whisk the dal smooth.', '[]', 0, NULL, NULL, NULL, 0, 'fixed', 'feel', 'dal is soft and mashable', NULL),
  ('c00c0360-0000-4000-8000-000000000011', 5, 'c00c0390-11-06', 'cook', 'Heat the oil and add the cumin. When it sizzles, add the onion and chillies and fry until golden brown.', '[7, 8, 3, 6]', 2, 300, 420, NULL, 0, 'partly', 'look', 'golden brown', NULL),
  ('c00c0360-0000-4000-8000-000000000011', 6, 'c00c0390-11-07', 'cook', 'Add the ginger-garlic paste and fry until the raw smell goes.', '[5]', 2, 60, 120, NULL, 0, 'fixed', 'smell', 'the raw smell goes', NULL),
  ('c00c0360-0000-4000-8000-000000000011', 7, 'c00c0390-11-08', 'cook', 'Add the tomatoes, chilli powder, coriander powder and salt, and cook until the oil separates.', '[4, 9, 10, 14]', 2, 360, 480, NULL, 0, 'partly', 'look', 'oil shows at the edges', NULL),
  ('c00c0360-0000-4000-8000-000000000011', 8, 'c00c0390-11-09', 'cook', 'Pour in the dal with a little hot water, bring it to a boil and simmer.', '[0]', 1, 300, 420, NULL, 1, 'fixed', 'look', 'it bubbles gently and thickens a little', NULL),
  ('c00c0360-0000-4000-8000-000000000011', 9, 'c00c0390-11-10', 'cook', 'Crush the kasuri methi between your palms over the pot, stir in the garam masala and butter, and scatter the coriander.', '[12, 11, 13, 15]', 0, NULL, NULL, NULL, 0, 'fixed', 'smell', 'the methi smells fragrant', 'Serve with jeera rice.');

-- 12 Rajma: 11 steps (2 prep, 9 cook); long prep 8–12 h; 3 whistles.
UPDATE kitchen_recipes SET tools = '["Pressure cooker", "Kadai", "Mixer jar"]' WHERE id = 'c00c0360-0000-4000-8000-000000000012';
DELETE FROM kitchen_recipe_steps WHERE recipe_id = 'c00c0360-0000-4000-8000-000000000012';
INSERT INTO kitchen_recipe_steps (recipe_id, position, step_key, phase, text, line_refs, heat, min_seconds, max_seconds, whistles, hands_off, time_rule, sense, checkpoint, tip) VALUES
  ('c00c0360-0000-4000-8000-000000000012', 0, 'c00c0390-12-01', 'prep', 'Rinse the rajma and soak it overnight in plenty of water.', '[0]', NULL, 28800, 43200, NULL, 1, 'fixed', 'look', 'the beans are plump and about twice the size', 'Soak it the night before; unsoaked rajma stays hard and is heavy to digest.'),
  ('c00c0360-0000-4000-8000-000000000012', 1, 'c00c0390-12-02', 'prep', 'Finely chop the onions, the chilli and the coriander, and puree the tomatoes.', '[2, 5, 14, 3]', NULL, 480, 720, NULL, 0, 'linear', NULL, NULL, NULL),
  ('c00c0360-0000-4000-8000-000000000012', 2, 'c00c0390-12-03', 'cook', 'Drain the rajma and pressure-cook it with the fresh water and a little of the salt on high.', '[0, 1, 13]', 3, NULL, NULL, 3, 1, 'fixed', NULL, NULL, 'Rajma froths; keep the cooker no more than half full.'),
  ('c00c0360-0000-4000-8000-000000000012', 3, 'c00c0390-12-04', 'cook', 'Turn the flame down to low and let it cook on.', '[]', 1, 900, 1200, NULL, 1, 'fixed', NULL, NULL, 'This slow finish makes the beans creamy inside.'),
  ('c00c0360-0000-4000-8000-000000000012', 4, 'c00c0390-12-05', 'cook', 'Turn off the heat and let the pressure drop on its own.', '[]', 0, 900, 1200, NULL, 1, 'fixed', 'look', 'the pressure valve has dropped', 'Don''t lift the weight to hurry it; the food finishes cooking as it settles.'),
  ('c00c0360-0000-4000-8000-000000000012', 5, 'c00c0390-12-06', 'cook', 'Heat the oil and add the cumin and bay leaf, then the onions, and fry until deep golden.', '[6, 7, 8, 2]', 2, 480, 600, NULL, 0, 'partly', 'look', 'deep golden brown', 'Patience here gives the gravy its colour.'),
  ('c00c0360-0000-4000-8000-000000000012', 6, 'c00c0390-12-07', 'cook', 'Add the ginger-garlic paste and chilli and fry until the raw smell goes.', '[4, 5]', 2, 60, 120, NULL, 0, 'fixed', 'smell', 'the raw smell goes', NULL),
  ('c00c0360-0000-4000-8000-000000000012', 7, 'c00c0390-12-08', 'cook', 'Add the tomatoes, turmeric, chilli powder and coriander powder, and cook until the masala is thick.', '[3, 9, 10, 11]', 2, 480, 600, NULL, 0, 'partly', 'look', 'oil shows at the edges', NULL),
  ('c00c0360-0000-4000-8000-000000000012', 8, 'c00c0390-12-09', 'cook', 'Open the cooker, check the beans, and add them with their cooking water to the masala.', '[0]', 2, NULL, NULL, NULL, 0, 'fixed', 'feel', 'a bean mashes easily between your fingers', 'Still firm? Close the cooker and give it another whistle or two.'),
  ('c00c0360-0000-4000-8000-000000000012', 9, 'c00c0390-12-10', 'cook', 'Mash a few beans against the pan to thicken it, and simmer.', '[]', 1, 900, 1200, NULL, 1, 'partly', 'look', 'thick and creamy', NULL),
  ('c00c0360-0000-4000-8000-000000000012', 10, 'c00c0390-12-11', 'cook', 'Stir in the garam masala and coriander, and check the salt.', '[12, 14, 13]', 0, NULL, NULL, NULL, 0, 'fixed', 'taste', 'the salt is right', 'Serve with steamed rice.');

-- 13 Chole: 13 steps (3 prep, 10 cook); long prep 8–12 h; 2 whistles.
UPDATE kitchen_recipes SET tools = '["Pressure cooker", "Kadai", "Muslin cloth"]' WHERE id = 'c00c0360-0000-4000-8000-000000000013';
DELETE FROM kitchen_recipe_steps WHERE recipe_id = 'c00c0360-0000-4000-8000-000000000013';
INSERT INTO kitchen_recipe_steps (recipe_id, position, step_key, phase, text, line_refs, heat, min_seconds, max_seconds, whistles, hands_off, time_rule, sense, checkpoint, tip) VALUES
  ('c00c0360-0000-4000-8000-000000000013', 0, 'c00c0390-13-01', 'prep', 'Rinse the chickpeas and soak them overnight in plenty of water.', '[0]', NULL, 28800, 43200, NULL, 1, 'fixed', 'look', 'plump and about twice the size', 'Soak them the night before; old chickpeas may need longer.'),
  ('c00c0360-0000-4000-8000-000000000013', 1, 'c00c0390-13-02', 'prep', 'Tie the tea leaves in a piece of muslin.', '[2]', NULL, NULL, NULL, NULL, 0, 'fixed', NULL, NULL, 'The tea gives chole its dark colour.'),
  ('c00c0360-0000-4000-8000-000000000013', 2, 'c00c0390-13-03', 'prep', 'Finely chop the onions, tomatoes and coriander, and slit the chillies.', '[3, 4, 14, 6]', NULL, 480, 720, NULL, 0, 'linear', NULL, NULL, NULL),
  ('c00c0360-0000-4000-8000-000000000013', 3, 'c00c0390-13-04', 'cook', 'Drain the chickpeas and pressure-cook them with the fresh water, a little of the salt and the tea bag on high.', '[0, 1, 13, 2]', 3, NULL, NULL, 2, 1, 'fixed', NULL, NULL, NULL),
  ('c00c0360-0000-4000-8000-000000000013', 4, 'c00c0390-13-05', 'cook', 'Turn the flame down to low and let it cook on.', '[]', 1, 1200, 1500, NULL, 1, 'fixed', NULL, NULL, NULL),
  ('c00c0360-0000-4000-8000-000000000013', 5, 'c00c0390-13-06', 'cook', 'Turn off the heat and let the pressure drop on its own.', '[]', 0, 900, 1200, NULL, 1, 'fixed', 'look', 'the pressure valve has dropped', 'Don''t lift the weight to hurry it; the food finishes cooking as it settles.'),
  ('c00c0360-0000-4000-8000-000000000013', 6, 'c00c0390-13-07', 'cook', 'Heat the oil and add the cumin, then the onions, and fry until browned.', '[7, 8, 3]', 2, 480, 600, NULL, 0, 'partly', 'look', 'deep golden brown', NULL),
  ('c00c0360-0000-4000-8000-000000000013', 7, 'c00c0390-13-08', 'cook', 'Add the ginger-garlic paste and chillies and fry until the raw smell goes.', '[5, 6]', 2, 60, 120, NULL, 0, 'fixed', 'smell', 'the raw smell goes', NULL),
  ('c00c0360-0000-4000-8000-000000000013', 8, 'c00c0390-13-09', 'cook', 'Add the tomatoes, turmeric and chilli powder and cook until the oil separates.', '[4, 9, 10]', 2, 480, 600, NULL, 0, 'partly', 'look', 'oil shows at the edges', NULL),
  ('c00c0360-0000-4000-8000-000000000013', 9, 'c00c0390-13-10', 'cook', 'Add the chole masala and amchur and fry for a moment.', '[11, 12]', 2, 30, 60, NULL, 0, 'fixed', 'smell', 'the masala smells toasty', NULL),
  ('c00c0360-0000-4000-8000-000000000013', 10, 'c00c0390-13-11', 'cook', 'Open the cooker, lift out the tea bag, and add the chickpeas with their water.', '[0]', 2, NULL, NULL, NULL, 0, 'fixed', 'feel', 'a chickpea mashes easily between your fingers', 'Still firm? Close the cooker and give them another whistle or two.'),
  ('c00c0360-0000-4000-8000-000000000013', 11, 'c00c0390-13-12', 'cook', 'Mash a few chickpeas against the pan and simmer until thick.', '[]', 1, 600, 900, NULL, 1, 'partly', 'look', 'the gravy is thick and dark', NULL),
  ('c00c0360-0000-4000-8000-000000000013', 12, 'c00c0390-13-13', 'cook', 'Check the salt and garnish with coriander.', '[13, 14]', 0, NULL, NULL, NULL, 0, 'fixed', 'taste', 'tangy, with the salt right', 'Serve with bhature, puri or rice.');

-- 14 Sambar: 9 steps (2 prep, 7 cook); 4 whistles.
UPDATE kitchen_recipes SET tools = '["Pressure cooker", "Deep pot", "Tadka pan"]' WHERE id = 'c00c0360-0000-4000-8000-000000000014';
DELETE FROM kitchen_recipe_steps WHERE recipe_id = 'c00c0360-0000-4000-8000-000000000014';
INSERT INTO kitchen_recipe_steps (recipe_id, position, step_key, phase, text, line_refs, heat, min_seconds, max_seconds, whistles, hands_off, time_rule, sense, checkpoint, tip) VALUES
  ('c00c0360-0000-4000-8000-000000000014', 0, 'c00c0390-14-01', 'prep', 'Soak the tamarind in a little warm water.', '[3]', NULL, 600, 900, NULL, 1, 'fixed', 'feel', 'soft enough to squeeze', NULL),
  ('c00c0360-0000-4000-8000-000000000014', 1, 'c00c0390-14-02', 'prep', 'Cut the drumstick into pieces, peel the small onions, cube the brinjal and chop the tomato and coriander.', '[4, 5, 6, 7, 17]', NULL, 600, 900, NULL, 0, 'linear', NULL, NULL, NULL),
  ('c00c0360-0000-4000-8000-000000000014', 2, 'c00c0390-14-03', 'cook', 'Rinse the dal and pressure-cook it with half the water and the turmeric on medium.', '[0, 1, 2]', 2, NULL, NULL, 4, 1, 'fixed', NULL, NULL, NULL),
  ('c00c0360-0000-4000-8000-000000000014', 3, 'c00c0390-14-04', 'cook', 'Turn off the heat, let the pressure drop on its own, then mash the dal.', '[]', 0, 600, 900, NULL, 1, 'fixed', 'look', 'the pressure valve has dropped', 'Don''t lift the weight to hurry it; the food finishes cooking as it settles.'),
  ('c00c0360-0000-4000-8000-000000000014', 4, 'c00c0390-14-05', 'cook', 'Boil the drumstick, onions, brinjal and tomato in the rest of the water with the salt.', '[4, 5, 6, 7, 1, 16]', 2, 480, 720, NULL, 1, 'partly', 'feel', 'a drumstick piece is just tender', NULL),
  ('c00c0360-0000-4000-8000-000000000014', 5, 'c00c0390-14-06', 'cook', 'Squeeze the tamarind into its water and strain it into the pot. Add the sambar powder and jaggery, and simmer.', '[3, 8, 9]', 2, 300, 420, NULL, 1, 'fixed', 'smell', 'the raw tamarind smell goes', NULL),
  ('c00c0360-0000-4000-8000-000000000014', 6, 'c00c0390-14-07', 'cook', 'Stir in the mashed dal and simmer.', '[0]', 1, 300, 420, NULL, 1, 'fixed', 'look', 'it is thick enough to coat a spoon', NULL),
  ('c00c0360-0000-4000-8000-000000000014', 7, 'c00c0390-14-08', 'cook', 'For the tadka, heat the oil and add the mustard seeds. When they splutter, add the fenugreek, dried chillies, curry leaves and hing.', '[10, 11, 12, 13, 14, 15]', 2, 30, 60, NULL, 0, 'fixed', 'sound', 'mustard seeds splutter', 'Fenugreek turns bitter if it goes past reddish brown.'),
  ('c00c0360-0000-4000-8000-000000000014', 8, 'c00c0390-14-09', 'cook', 'Pour the tadka over the sambar and add the coriander.', '[17]', 0, NULL, NULL, NULL, 0, 'fixed', 'sound', 'it sizzles as it hits the sambar', 'Serve with rice, idli or dosa.');

-- 15 Tomato rasam: 7 steps (3 prep, 4 cook).
UPDATE kitchen_recipes SET tools = '["Pot", "Mortar and pestle", "Tadka pan", "Strainer"]' WHERE id = 'c00c0360-0000-4000-8000-000000000015';
DELETE FROM kitchen_recipe_steps WHERE recipe_id = 'c00c0360-0000-4000-8000-000000000015';
INSERT INTO kitchen_recipe_steps (recipe_id, position, step_key, phase, text, line_refs, heat, min_seconds, max_seconds, whistles, hands_off, time_rule, sense, checkpoint, tip) VALUES
  ('c00c0360-0000-4000-8000-000000000015', 0, 'c00c0390-15-01', 'prep', 'Soak the tamarind in a little of the water, warmed, then squeeze it and strain out the pulp.', '[1, 2]', NULL, 600, 900, NULL, 1, 'fixed', 'feel', 'soft enough to squeeze', NULL),
  ('c00c0360-0000-4000-8000-000000000015', 1, 'c00c0390-15-02', 'prep', 'Chop the tomatoes and the coriander.', '[0, 14]', NULL, 180, 300, NULL, 0, 'linear', NULL, NULL, NULL),
  ('c00c0360-0000-4000-8000-000000000015', 2, 'c00c0390-15-03', 'prep', 'Crush the garlic, peppercorns and cumin coarsely in a mortar.', '[3, 4, 5]', NULL, 60, 120, NULL, 0, 'fixed', 'feel', 'coarsely crushed, not a paste', NULL),
  ('c00c0360-0000-4000-8000-000000000015', 3, 'c00c0390-15-04', 'cook', 'Simmer the tomatoes with the tamarind water, turmeric, salt and the crushed mix until the tomatoes are soft.', '[0, 1, 6, 13, 3, 4, 5]', 2, 360, 480, NULL, 1, 'partly', 'look', 'the tomatoes are soft and mushy', NULL),
  ('c00c0360-0000-4000-8000-000000000015', 4, 'c00c0390-15-05', 'cook', 'Add the rest of the water and the rasam powder and heat until it froths at the top, without letting it boil hard.', '[2, 7]', 2, 180, 300, NULL, 0, 'partly', 'look', 'a froth rises to the top', 'Boiling hard makes rasam bitter.'),
  ('c00c0360-0000-4000-8000-000000000015', 5, 'c00c0390-15-06', 'cook', 'Heat the ghee, add the mustard seeds, dried chilli, curry leaves and hing, and pour it over the rasam.', '[8, 9, 10, 11, 12]', 2, 30, 60, NULL, 0, 'fixed', 'sound', 'mustard seeds splutter', NULL),
  ('c00c0360-0000-4000-8000-000000000015', 6, 'c00c0390-15-07', 'cook', 'Add the coriander, cover and leave it to rest.', '[14]', 0, 300, 600, NULL, 1, 'fixed', 'smell', 'it smells of pepper and coriander', 'Serve with rice, or in a cup as a soup.');

-- 16 Kadhi: 6 steps (2 prep, 4 cook).
UPDATE kitchen_recipes SET tools = '["Heavy pot", "Whisk", "Tadka pan"]' WHERE id = 'c00c0360-0000-4000-8000-000000000016';
DELETE FROM kitchen_recipe_steps WHERE recipe_id = 'c00c0360-0000-4000-8000-000000000016';
INSERT INTO kitchen_recipe_steps (recipe_id, position, step_key, phase, text, line_refs, heat, min_seconds, max_seconds, whistles, hands_off, time_rule, sense, checkpoint, tip) VALUES
  ('c00c0360-0000-4000-8000-000000000016', 0, 'c00c0390-16-01', 'prep', 'Grate the ginger, slit the chilli and chop the coriander.', '[4, 5, 15]', NULL, 180, 300, NULL, 0, 'linear', NULL, NULL, NULL),
  ('c00c0360-0000-4000-8000-000000000016', 1, 'c00c0390-16-02', 'prep', 'Whisk the curd, besan, turmeric and salt until smooth, then whisk in the water.', '[0, 1, 3, 14, 2]', NULL, 120, 180, NULL, 0, 'fixed', 'look', 'smooth, with no lumps of besan', NULL),
  ('c00c0360-0000-4000-8000-000000000016', 2, 'c00c0390-16-03', 'cook', 'Pour it into a heavy pot with the ginger and chilli and bring it to a boil, stirring all the time.', '[4, 5]', 2, 360, 600, NULL, 0, 'partly', 'look', 'it boils without splitting', 'Keep stirring until it boils, or the curd splits.'),
  ('c00c0360-0000-4000-8000-000000000016', 3, 'c00c0390-16-04', 'cook', 'Lower the heat and simmer, stirring now and then, until it thickens and loses its raw taste.', '[]', 1, 1200, 1500, NULL, 1, 'partly', 'taste', 'no raw besan taste is left', NULL),
  ('c00c0360-0000-4000-8000-000000000016', 4, 'c00c0390-16-05', 'cook', 'For the tadka, heat the ghee and add the mustard, cumin and fenugreek seeds, then the dried chillies, curry leaves and hing.', '[6, 7, 8, 9, 10, 11, 12]', 2, 30, 60, NULL, 0, 'fixed', 'sound', 'mustard seeds splutter', NULL),
  ('c00c0360-0000-4000-8000-000000000016', 5, 'c00c0390-16-06', 'cook', 'Off the heat, add the chilli powder, pour the tadka over the kadhi and add the coriander.', '[13, 15]', 0, NULL, NULL, NULL, 0, 'fixed', 'look', 'the ghee turns red', 'Serve with rice.');

-- 17 Palak paneer: 10 steps (1 prep, 9 cook).
UPDATE kitchen_recipes SET tools = '["Pot", "Kadai", "Mixer jar"]' WHERE id = 'c00c0360-0000-4000-8000-000000000017';
DELETE FROM kitchen_recipe_steps WHERE recipe_id = 'c00c0360-0000-4000-8000-000000000017';
INSERT INTO kitchen_recipe_steps (recipe_id, position, step_key, phase, text, line_refs, heat, min_seconds, max_seconds, whistles, hands_off, time_rule, sense, checkpoint, tip) VALUES
  ('c00c0360-0000-4000-8000-000000000017', 0, 'c00c0390-17-01', 'prep', 'Wash the spinach well. Chop the onion, tomato and garlic, grate the ginger and cube the paneer.', '[1, 2, 3, 4, 5, 0]', NULL, 600, 900, NULL, 0, 'linear', NULL, NULL, NULL),
  ('c00c0360-0000-4000-8000-000000000017', 1, 'c00c0390-17-02', 'cook', 'Bring a pot of water to a boil.', '[]', 3, 300, 480, NULL, 0, 'fixed', 'look', 'a rolling boil', NULL),
  ('c00c0360-0000-4000-8000-000000000017', 2, 'c00c0390-17-03', 'cook', 'Blanch the spinach, then plunge it into cold water.', '[1]', 3, 60, 120, NULL, 0, 'fixed', 'look', 'bright green and just wilted', 'The cold water keeps it green.'),
  ('c00c0360-0000-4000-8000-000000000017', 3, 'c00c0390-17-04', 'cook', 'Drain the spinach and blend it with the chillies to a smooth puree.', '[6]', 0, 60, 120, NULL, 0, 'fixed', 'look', 'smooth and bright green', NULL),
  ('c00c0360-0000-4000-8000-000000000017', 4, 'c00c0390-17-05', 'cook', 'Heat the oil and add the cumin, then the onion, and fry until golden.', '[7, 8, 2]', 2, 300, 420, NULL, 0, 'partly', 'look', 'golden', NULL),
  ('c00c0360-0000-4000-8000-000000000017', 5, 'c00c0390-17-06', 'cook', 'Add the garlic and ginger and fry until the raw smell goes.', '[4, 5]', 2, 60, 120, NULL, 0, 'fixed', 'smell', 'the raw smell goes', NULL),
  ('c00c0360-0000-4000-8000-000000000017', 6, 'c00c0390-17-07', 'cook', 'Add the tomato and salt and cook until soft.', '[3, 12]', 2, 180, 300, NULL, 0, 'partly', 'look', 'the tomato is soft and mushy', NULL),
  ('c00c0360-0000-4000-8000-000000000017', 7, 'c00c0390-17-08', 'cook', 'Stir in the spinach puree with a splash of water and simmer.', '[1]', 1, 180, 240, NULL, 0, 'fixed', 'look', 'it bubbles gently', 'Cover it partly; the puree splutters.'),
  ('c00c0360-0000-4000-8000-000000000017', 8, 'c00c0390-17-09', 'cook', 'Add the paneer, garam masala and crushed kasuri methi and simmer a little more.', '[0, 9, 10]', 1, 120, 180, NULL, 0, 'fixed', 'feel', 'the paneer is hot right through', 'Paneer turns rubbery if it cooks too long.'),
  ('c00c0360-0000-4000-8000-000000000017', 9, 'c00c0390-17-10', 'cook', 'Turn off the heat, swirl in the cream and check the salt.', '[11, 12]', 0, NULL, NULL, NULL, 0, 'fixed', 'taste', 'the salt is right', 'Serve with roti or naan.');

-- 18 Paneer bhurji: 7 steps (2 prep, 5 cook).
UPDATE kitchen_recipes SET tools = '["Kadai"]' WHERE id = 'c00c0360-0000-4000-8000-000000000018';
DELETE FROM kitchen_recipe_steps WHERE recipe_id = 'c00c0360-0000-4000-8000-000000000018';
INSERT INTO kitchen_recipe_steps (recipe_id, position, step_key, phase, text, line_refs, heat, min_seconds, max_seconds, whistles, hands_off, time_rule, sense, checkpoint, tip) VALUES
  ('c00c0360-0000-4000-8000-000000000018', 0, 'c00c0390-18-01', 'prep', 'Finely chop the onion, tomato, capsicum, chilli and coriander.', '[1, 2, 3, 4, 11]', NULL, 360, 600, NULL, 0, 'linear', NULL, NULL, NULL),
  ('c00c0360-0000-4000-8000-000000000018', 1, 'c00c0390-18-02', 'prep', 'Crumble the paneer with your fingers.', '[0]', NULL, NULL, NULL, NULL, 0, 'fixed', 'feel', 'small, even crumbs', NULL),
  ('c00c0360-0000-4000-8000-000000000018', 2, 'c00c0390-18-03', 'cook', 'Heat the oil, add the onion and chilli and cook until soft.', '[6, 1, 4]', 2, 180, 240, NULL, 0, 'partly', 'look', 'soft and see-through', NULL),
  ('c00c0360-0000-4000-8000-000000000018', 3, 'c00c0390-18-04', 'cook', 'Add the ginger-garlic paste and fry until the raw smell goes.', '[5]', 2, 45, 90, NULL, 0, 'fixed', 'smell', 'the raw smell goes', NULL),
  ('c00c0360-0000-4000-8000-000000000018', 4, 'c00c0390-18-05', 'cook', 'Add the tomato, capsicum, turmeric, chilli powder and salt and cook until the tomato is soft.', '[2, 3, 7, 8, 10]', 2, 180, 300, NULL, 0, 'partly', 'look', 'the tomato is soft and mushy', NULL),
  ('c00c0360-0000-4000-8000-000000000018', 5, 'c00c0390-18-06', 'cook', 'Add the paneer and garam masala and toss for a short while.', '[0, 9]', 2, 90, 120, NULL, 0, 'fixed', 'feel', 'the paneer is hot right through', 'Cooked longer, paneer turns rubbery.'),
  ('c00c0360-0000-4000-8000-000000000018', 6, 'c00c0390-18-07', 'cook', 'Turn off the heat and finish with the coriander.', '[11]', 0, NULL, NULL, NULL, 0, 'fixed', 'taste', 'the salt is right', 'Serve with roti or toast.');

-- 19 Matar paneer: 7 steps (2 prep, 5 cook).
UPDATE kitchen_recipes SET tools = '["Kadai with a lid", "Mixer jar"]' WHERE id = 'c00c0360-0000-4000-8000-000000000019';
DELETE FROM kitchen_recipe_steps WHERE recipe_id = 'c00c0360-0000-4000-8000-000000000019';
INSERT INTO kitchen_recipe_steps (recipe_id, position, step_key, phase, text, line_refs, heat, min_seconds, max_seconds, whistles, hands_off, time_rule, sense, checkpoint, tip) VALUES
  ('c00c0360-0000-4000-8000-000000000019', 0, 'c00c0390-19-01', 'prep', 'Roughly chop the onions and tomatoes, cube the paneer and chop the coriander.', '[2, 3, 0, 14]', NULL, 360, 600, NULL, 0, 'linear', NULL, NULL, NULL),
  ('c00c0360-0000-4000-8000-000000000019', 1, 'c00c0390-19-02', 'prep', 'Blend the onions, tomatoes and cashews to a smooth paste.', '[2, 3, 4]', NULL, 60, 120, NULL, 0, 'fixed', 'look', 'smooth, with no bits of cashew', NULL),
  ('c00c0360-0000-4000-8000-000000000019', 2, 'c00c0390-19-03', 'cook', 'Heat the oil and add the cumin. When it sizzles, add the paste and the ginger-garlic paste and cook until thick.', '[6, 7, 5]', 2, 600, 720, NULL, 0, 'partly', 'look', 'oil shows at the edges', 'Cover it partly; the paste splutters.'),
  ('c00c0360-0000-4000-8000-000000000019', 3, 'c00c0390-19-04', 'cook', 'Add the turmeric, chilli powder, coriander powder and salt and cook a little.', '[8, 9, 10, 13]', 2, 45, 90, NULL, 0, 'fixed', 'smell', 'the raw smell of the spices goes', NULL),
  ('c00c0360-0000-4000-8000-000000000019', 4, 'c00c0390-19-05', 'cook', 'Add the peas and water, cover and simmer until the peas are tender.', '[1, 12]', 1, 300, 480, NULL, 1, 'partly', 'feel', 'a pea squashes easily', NULL),
  ('c00c0360-0000-4000-8000-000000000019', 5, 'c00c0390-19-06', 'cook', 'Add the paneer and garam masala and simmer a little more.', '[0, 11]', 1, 120, 180, NULL, 0, 'fixed', 'feel', 'the paneer is soft and hot right through', NULL),
  ('c00c0360-0000-4000-8000-000000000019', 6, 'c00c0390-19-07', 'cook', 'Turn off the heat, garnish with coriander and check the salt.', '[14, 13]', 0, NULL, NULL, NULL, 0, 'fixed', 'taste', 'the salt is right', 'Serve with roti or rice.');

-- 20 Aloo gobi: 6 steps (2 prep, 4 cook).
UPDATE kitchen_recipes SET tools = '["Kadai with a lid"]' WHERE id = 'c00c0360-0000-4000-8000-000000000020';
DELETE FROM kitchen_recipe_steps WHERE recipe_id = 'c00c0360-0000-4000-8000-000000000020';
INSERT INTO kitchen_recipe_steps (recipe_id, position, step_key, phase, text, line_refs, heat, min_seconds, max_seconds, whistles, hands_off, time_rule, sense, checkpoint, tip) VALUES
  ('c00c0360-0000-4000-8000-000000000020', 0, 'c00c0390-20-01', 'prep', 'Cut the cauliflower into florets and the potatoes into cubes, then rinse and drain them.', '[0, 1]', NULL, 480, 720, NULL, 0, 'linear', NULL, NULL, NULL),
  ('c00c0360-0000-4000-8000-000000000020', 1, 'c00c0390-20-02', 'prep', 'Chop the onion, tomato, chilli and coriander, and grate the ginger.', '[2, 3, 5, 14, 4]', NULL, 300, 480, NULL, 0, 'linear', NULL, NULL, NULL),
  ('c00c0360-0000-4000-8000-000000000020', 2, 'c00c0390-20-03', 'cook', 'Heat the oil and add the cumin, then the onion, ginger and chilli, and fry until soft.', '[6, 7, 2, 4, 5]', 2, 180, 300, NULL, 0, 'partly', 'look', 'soft and see-through', NULL),
  ('c00c0360-0000-4000-8000-000000000020', 3, 'c00c0390-20-04', 'cook', 'Add the potatoes, cover and cook on low.', '[1]', 1, 300, 420, NULL, 0, 'partly', 'look', 'the potato edges turn see-through', NULL),
  ('c00c0360-0000-4000-8000-000000000020', 4, 'c00c0390-20-05', 'cook', 'Add the cauliflower, tomato, turmeric, chilli powder, coriander powder and salt. Toss, cover and cook on low, stirring now and then.', '[0, 3, 8, 9, 10, 13]', 1, 720, 900, NULL, 1, 'partly', 'feel', 'a knife slides into both', 'Add no water; the vegetables steam in their own juices.'),
  ('c00c0360-0000-4000-8000-000000000020', 5, 'c00c0390-20-06', 'cook', 'Sprinkle over the garam masala, amchur and coriander and cook uncovered to dry it out.', '[11, 12, 14]', 2, 120, 180, NULL, 0, 'fixed', 'look', 'dry, with the edges lightly browned', NULL);

-- 21 Bhindi fry: 6 steps (2 prep, 4 cook).
UPDATE kitchen_recipes SET tools = '["Kadai", "Dry kitchen cloth"]' WHERE id = 'c00c0360-0000-4000-8000-000000000021';
DELETE FROM kitchen_recipe_steps WHERE recipe_id = 'c00c0360-0000-4000-8000-000000000021';
INSERT INTO kitchen_recipe_steps (recipe_id, position, step_key, phase, text, line_refs, heat, min_seconds, max_seconds, whistles, hands_off, time_rule, sense, checkpoint, tip) VALUES
  ('c00c0360-0000-4000-8000-000000000021', 0, 'c00c0390-21-01', 'prep', 'Wash the bhindi and dry it completely with a cloth, then cut it into short pieces.', '[0]', NULL, 480, 720, NULL, 0, 'linear', 'feel', 'completely dry to the touch', 'Wet bhindi turns slimy.'),
  ('c00c0360-0000-4000-8000-000000000021', 1, 'c00c0390-21-02', 'prep', 'Slice the onion.', '[1]', NULL, 60, 120, NULL, 0, 'linear', NULL, NULL, NULL),
  ('c00c0360-0000-4000-8000-000000000021', 2, 'c00c0390-21-03', 'cook', 'Heat the oil and add the cumin, then the onion, and fry until it turns see-through.', '[2, 3, 1]', 2, 120, 180, NULL, 0, 'partly', 'look', 'soft and see-through', NULL),
  ('c00c0360-0000-4000-8000-000000000021', 3, 'c00c0390-21-04', 'cook', 'Add the bhindi and fry uncovered, stirring gently, until it is no longer sticky.', '[0]', 2, 600, 720, NULL, 0, 'partly', 'look', 'no longer sticky', 'Don''t cover it, and add the salt only later, or it turns slimy.'),
  ('c00c0360-0000-4000-8000-000000000021', 4, 'c00c0390-21-05', 'cook', 'Add the turmeric, chilli powder, coriander powder and salt and cook until crisp at the edges.', '[4, 5, 6, 8]', 2, 180, 240, NULL, 0, 'partly', 'look', 'crisp at the edges', NULL),
  ('c00c0360-0000-4000-8000-000000000021', 5, 'c00c0390-21-06', 'cook', 'Sprinkle over the amchur, toss and turn off the heat.', '[7]', 0, NULL, NULL, NULL, 0, 'fixed', 'taste', 'tangy, with the salt right', 'Serve with roti, or with dal and rice.');

-- 22 Baingan bharta: 7 steps (1 prep, 6 cook).
UPDATE kitchen_recipes SET tools = '["Gas flame or grill", "Tongs", "Kadai"]' WHERE id = 'c00c0360-0000-4000-8000-000000000022';
DELETE FROM kitchen_recipe_steps WHERE recipe_id = 'c00c0360-0000-4000-8000-000000000022';
INSERT INTO kitchen_recipe_steps (recipe_id, position, step_key, phase, text, line_refs, heat, min_seconds, max_seconds, whistles, hands_off, time_rule, sense, checkpoint, tip) VALUES
  ('c00c0360-0000-4000-8000-000000000022', 0, 'c00c0390-22-01', 'prep', 'Chop the onion, tomatoes, garlic, chillies and coriander, and grate the ginger.', '[1, 2, 3, 5, 12, 4]', NULL, 360, 600, NULL, 0, 'linear', NULL, NULL, NULL),
  ('c00c0360-0000-4000-8000-000000000022', 1, 'c00c0390-22-02', 'cook', 'Rub the brinjal with a little of the oil and roast it over a gas flame, turning, until the skin is charred all over.', '[0, 6]', 2, 600, 900, NULL, 0, 'partly', 'look', 'charred all over and soft inside', 'Prick it a few times first so it doesn''t burst.'),
  ('c00c0360-0000-4000-8000-000000000022', 2, 'c00c0390-22-03', 'cook', 'Cool it in a covered bowl, then peel off the skin and mash the flesh.', '[0]', 0, 480, 720, NULL, 0, 'fixed', 'look', 'a smoky mash with no skin left', 'The covered bowl steams the skin loose.'),
  ('c00c0360-0000-4000-8000-000000000022', 3, 'c00c0390-22-04', 'cook', 'Heat the rest of the oil and add the cumin, then the onion, garlic, ginger and chillies, and fry until golden.', '[6, 7, 1, 3, 4, 5]', 2, 240, 360, NULL, 0, 'partly', 'look', 'golden', NULL),
  ('c00c0360-0000-4000-8000-000000000022', 4, 'c00c0390-22-05', 'cook', 'Add the tomatoes, turmeric, chilli powder and salt and cook until soft and pulpy.', '[2, 8, 9, 11]', 2, 300, 420, NULL, 0, 'partly', 'look', 'soft and pulpy', NULL),
  ('c00c0360-0000-4000-8000-000000000022', 5, 'c00c0390-22-06', 'cook', 'Add the mashed brinjal and cook, stirring, until it comes together.', '[0]', 2, 300, 420, NULL, 0, 'partly', 'look', 'thick, and leaving the sides of the pan', NULL),
  ('c00c0360-0000-4000-8000-000000000022', 6, 'c00c0390-22-07', 'cook', 'Stir in the garam masala and coriander and check the salt.', '[10, 12, 11]', 0, NULL, NULL, NULL, 0, 'fixed', 'taste', 'the salt is right', 'Serve with roti.');

-- 23 Chicken curry: 9 steps (2 prep, 7 cook).
UPDATE kitchen_recipes SET tools = '["Kadai with a lid", "Mixing bowl"]' WHERE id = 'c00c0360-0000-4000-8000-000000000023';
DELETE FROM kitchen_recipe_steps WHERE recipe_id = 'c00c0360-0000-4000-8000-000000000023';
INSERT INTO kitchen_recipe_steps (recipe_id, position, step_key, phase, text, line_refs, heat, min_seconds, max_seconds, whistles, hands_off, time_rule, sense, checkpoint, tip) VALUES
  ('c00c0360-0000-4000-8000-000000000023', 0, 'c00c0390-23-01', 'prep', 'Mix the chicken with the curd, turmeric, half the chilli powder, half the ginger-garlic paste and salt, and leave it to marinate.', '[0, 1, 10, 11, 4, 15]', NULL, 1800, 5400, NULL, 1, 'fixed', NULL, NULL, 'An hour or more, covered in the fridge, makes it more tender.'),
  ('c00c0360-0000-4000-8000-000000000023', 1, 'c00c0390-23-02', 'prep', 'Thinly slice the onions, chop the tomatoes and coriander, and slit the chillies.', '[2, 3, 16, 5]', NULL, 480, 720, NULL, 0, 'linear', NULL, NULL, NULL),
  ('c00c0360-0000-4000-8000-000000000023', 2, 'c00c0390-23-03', 'cook', 'Heat the oil and add the bay leaf, cinnamon and cloves.', '[6, 7, 8, 9]', 2, 30, 45, NULL, 0, 'fixed', 'smell', 'they sizzle and smell fragrant', NULL),
  ('c00c0360-0000-4000-8000-000000000023', 3, 'c00c0390-23-04', 'cook', 'Add the onions and fry until deep golden brown.', '[2]', 2, 600, 840, NULL, 0, 'partly', 'look', 'deep golden brown', 'Stir often near the end; they go from brown to burnt quickly.'),
  ('c00c0360-0000-4000-8000-000000000023', 4, 'c00c0390-23-05', 'cook', 'Add the rest of the ginger-garlic paste and the chillies and fry until the raw smell goes.', '[4, 5]', 2, 60, 120, NULL, 0, 'fixed', 'smell', 'the raw smell goes', NULL),
  ('c00c0360-0000-4000-8000-000000000023', 5, 'c00c0390-23-06', 'cook', 'Add the tomatoes, the rest of the chilli powder and the coriander powder, and cook until the oil separates.', '[3, 11, 12]', 2, 360, 480, NULL, 0, 'partly', 'look', 'oil shows at the edges', NULL),
  ('c00c0360-0000-4000-8000-000000000023', 6, 'c00c0390-23-07', 'cook', 'Add the chicken with its marinade and sear it on high, stirring.', '[0]', 3, 300, 420, NULL, 0, 'partly', 'look', 'no raw pink shows on the outside', NULL),
  ('c00c0360-0000-4000-8000-000000000023', 7, 'c00c0390-23-08', 'cook', 'Add the water, cover and simmer on low until the chicken is cooked through and tender.', '[14]', 1, 1200, 1500, NULL, 1, 'partly', 'look', 'no pink inside', 'Cut into the thickest piece to check.'),
  ('c00c0360-0000-4000-8000-000000000023', 8, 'c00c0390-23-09', 'cook', 'Stir in the garam masala and coriander, check the salt, and rest it covered off the heat.', '[13, 16, 15]', 0, 180, 300, NULL, 1, 'fixed', 'taste', 'the salt is right', 'Serve with rice or roti.');

-- 24 Egg curry: 9 steps (1 prep, 8 cook).
UPDATE kitchen_recipes SET tools = '["Saucepan", "Kadai with a lid"]' WHERE id = 'c00c0360-0000-4000-8000-000000000024';
DELETE FROM kitchen_recipe_steps WHERE recipe_id = 'c00c0360-0000-4000-8000-000000000024';
INSERT INTO kitchen_recipe_steps (recipe_id, position, step_key, phase, text, line_refs, heat, min_seconds, max_seconds, whistles, hands_off, time_rule, sense, checkpoint, tip) VALUES
  ('c00c0360-0000-4000-8000-000000000024', 0, 'c00c0390-24-01', 'prep', 'Finely chop the onions, tomatoes and coriander, and slit the chilli.', '[1, 2, 12, 4]', NULL, 360, 600, NULL, 0, 'linear', NULL, NULL, NULL),
  ('c00c0360-0000-4000-8000-000000000024', 1, 'c00c0390-24-02', 'cook', 'Hard-boil the eggs in a pan of water.', '[0]', 2, 720, 900, NULL, 1, 'fixed', NULL, NULL, 'Start them in cold water so they crack less, and time it from when you put them on.'),
  ('c00c0360-0000-4000-8000-000000000024', 2, 'c00c0390-24-03', 'cook', 'Cool the eggs in cold water, peel them and make a few shallow slits in each.', '[0]', 0, 180, 300, NULL, 0, 'linear', 'look', 'peeled clean, with no shell left', NULL),
  ('c00c0360-0000-4000-8000-000000000024', 3, 'c00c0390-24-04', 'cook', 'Heat a little of the oil with a pinch of turmeric and chilli powder and fry the eggs until lightly golden. Lift them out.', '[5, 6, 7, 0]', 2, 90, 150, NULL, 0, 'fixed', 'look', 'lightly golden and blistered', 'Cover the pan; eggs can pop in hot oil.'),
  ('c00c0360-0000-4000-8000-000000000024', 4, 'c00c0390-24-05', 'cook', 'In the rest of the oil, fry the onions until golden.', '[5, 1]', 2, 360, 480, NULL, 0, 'partly', 'look', 'golden', NULL),
  ('c00c0360-0000-4000-8000-000000000024', 5, 'c00c0390-24-06', 'cook', 'Add the ginger-garlic paste and chilli and fry until the raw smell goes.', '[3, 4]', 2, 60, 120, NULL, 0, 'fixed', 'smell', 'the raw smell goes', NULL),
  ('c00c0360-0000-4000-8000-000000000024', 6, 'c00c0390-24-07', 'cook', 'Add the tomatoes, the rest of the turmeric and chilli powder, the coriander powder and salt, and cook until the masala is thick.', '[2, 6, 7, 8, 11]', 2, 360, 480, NULL, 0, 'partly', 'look', 'oil shows at the edges', NULL),
  ('c00c0360-0000-4000-8000-000000000024', 7, 'c00c0390-24-08', 'cook', 'Add the water and bring it to a boil, then add the eggs and simmer.', '[10, 0]', 1, 300, 420, NULL, 1, 'fixed', 'look', 'the gravy coats the eggs', NULL),
  ('c00c0360-0000-4000-8000-000000000024', 8, 'c00c0390-24-09', 'cook', 'Finish with the garam masala and coriander, and check the salt.', '[9, 12, 11]', 0, NULL, NULL, NULL, 0, 'fixed', 'taste', 'the salt is right', 'Serve with rice or roti.');

-- 25 Fish curry: 9 steps (3 prep, 6 cook).
UPDATE kitchen_recipes SET tools = '["Wide clay pot or kadai", "Strainer"]' WHERE id = 'c00c0360-0000-4000-8000-000000000025';
DELETE FROM kitchen_recipe_steps WHERE recipe_id = 'c00c0360-0000-4000-8000-000000000025';
INSERT INTO kitchen_recipe_steps (recipe_id, position, step_key, phase, text, line_refs, heat, min_seconds, max_seconds, whistles, hands_off, time_rule, sense, checkpoint, tip) VALUES
  ('c00c0360-0000-4000-8000-000000000025', 0, 'c00c0390-25-01', 'prep', 'Rub the fish with half the turmeric and some salt and set it aside.', '[0, 13, 16]', NULL, 900, 1200, NULL, 1, 'fixed', NULL, NULL, NULL),
  ('c00c0360-0000-4000-8000-000000000025', 1, 'c00c0390-25-02', 'prep', 'Soak the tamarind in the warm water, then squeeze out the pulp and strain it.', '[2, 3]', NULL, 600, 900, NULL, 1, 'fixed', 'feel', 'soft enough to squeeze', NULL),
  ('c00c0360-0000-4000-8000-000000000025', 2, 'c00c0390-25-03', 'prep', 'Slice the onion, chop the tomato, ginger and garlic, and slit the chillies.', '[4, 5, 6, 7, 8]', NULL, 360, 600, NULL, 0, 'linear', NULL, NULL, NULL),
  ('c00c0360-0000-4000-8000-000000000025', 3, 'c00c0390-25-04', 'cook', 'Heat the coconut oil and add the mustard and fenugreek seeds, then the curry leaves.', '[9, 10, 11, 12]', 2, 30, 60, NULL, 0, 'fixed', 'sound', 'mustard seeds splutter', NULL),
  ('c00c0360-0000-4000-8000-000000000025', 4, 'c00c0390-25-05', 'cook', 'Add the onion, ginger, garlic and chillies and fry until soft.', '[4, 6, 7, 8]', 2, 240, 360, NULL, 0, 'partly', 'look', 'soft and light golden', NULL),
  ('c00c0360-0000-4000-8000-000000000025', 5, 'c00c0390-25-06', 'cook', 'Add the tomato and cook until mushy.', '[5]', 2, 180, 300, NULL, 0, 'partly', 'look', 'the tomato is soft and mushy', NULL),
  ('c00c0360-0000-4000-8000-000000000025', 6, 'c00c0390-25-07', 'cook', 'Lower the heat, add the chilli powder, coriander powder and the rest of the turmeric with a splash of water, and cook.', '[14, 15, 13]', 1, 90, 150, NULL, 0, 'fixed', 'smell', 'the raw smell goes', NULL),
  ('c00c0360-0000-4000-8000-000000000025', 7, 'c00c0390-25-08', 'cook', 'Add the tamarind water and bring it to a boil, then slide in the fish and simmer gently.', '[2, 3, 0]', 1, 300, 480, NULL, 1, 'partly', 'look', 'the fish is white and flakes at the edge', 'Swirl the pan rather than stirring so the fish stays whole.'),
  ('c00c0360-0000-4000-8000-000000000025', 8, 'c00c0390-25-09', 'cook', 'Pour in the coconut milk and heat it through without boiling.', '[1]', 1, 180, 240, NULL, 0, 'fixed', 'look', 'it steams but does not boil', 'Boiling splits the coconut milk.');

-- 26 Jeera rice: 6 steps (1 prep, 5 cook).
UPDATE kitchen_recipes SET tools = '["Heavy pot with a tight lid", "Sieve"]' WHERE id = 'c00c0360-0000-4000-8000-000000000026';
DELETE FROM kitchen_recipe_steps WHERE recipe_id = 'c00c0360-0000-4000-8000-000000000026';
INSERT INTO kitchen_recipe_steps (recipe_id, position, step_key, phase, text, line_refs, heat, min_seconds, max_seconds, whistles, hands_off, time_rule, sense, checkpoint, tip) VALUES
  ('c00c0360-0000-4000-8000-000000000026', 0, 'c00c0390-26-01', 'prep', 'Rinse the rice until the water runs clear, then soak it.', '[0]', NULL, 1200, 1800, NULL, 1, 'fixed', NULL, NULL, 'Soaked basmati cooks into long grains that don''t break.'),
  ('c00c0360-0000-4000-8000-000000000026', 1, 'c00c0390-26-02', 'cook', 'Drain the rice. Heat the ghee, add the cumin and bay leaf, and let the cumin sizzle.', '[2, 3, 4]', 2, 30, 60, NULL, 0, 'fixed', 'look', 'the cumin turns a shade darker', NULL),
  ('c00c0360-0000-4000-8000-000000000026', 2, 'c00c0390-26-03', 'cook', 'Add the rice and stir gently to coat it in ghee.', '[0]', 2, 60, 120, NULL, 0, 'fixed', 'look', 'the grains turn glossy', NULL),
  ('c00c0360-0000-4000-8000-000000000026', 3, 'c00c0390-26-04', 'cook', 'Add the water and salt and bring it to a boil.', '[1, 5]', 3, 180, 300, NULL, 0, 'partly', 'look', 'a rolling boil', NULL),
  ('c00c0360-0000-4000-8000-000000000026', 4, 'c00c0390-26-05', 'cook', 'Cover and cook on the lowest heat.', '[]', 1, 720, 840, NULL, 1, 'fixed', 'look', 'the water is gone and small holes show on top', 'Don''t lift the lid while it cooks.'),
  ('c00c0360-0000-4000-8000-000000000026', 5, 'c00c0390-26-06', 'cook', 'Turn off the heat and leave it covered, then fluff it with a fork.', '[]', 0, 300, 600, NULL, 1, 'fixed', 'look', 'the grains are separate', NULL);

-- 27 Veg pulao: 9 steps (2 prep, 7 cook).
UPDATE kitchen_recipes SET tools = '["Heavy pot with a tight lid", "Sieve"]' WHERE id = 'c00c0360-0000-4000-8000-000000000027';
DELETE FROM kitchen_recipe_steps WHERE recipe_id = 'c00c0360-0000-4000-8000-000000000027';
INSERT INTO kitchen_recipe_steps (recipe_id, position, step_key, phase, text, line_refs, heat, min_seconds, max_seconds, whistles, hands_off, time_rule, sense, checkpoint, tip) VALUES
  ('c00c0360-0000-4000-8000-000000000027', 0, 'c00c0390-27-01', 'prep', 'Rinse the rice and soak it.', '[0]', NULL, 1200, 1800, NULL, 1, 'fixed', NULL, NULL, NULL),
  ('c00c0360-0000-4000-8000-000000000027', 1, 'c00c0390-27-02', 'prep', 'Dice the carrot and potato, chop the beans and coriander, slice the onion and slit the chillies.', '[2, 5, 3, 16, 6, 7]', NULL, 600, 900, NULL, 0, 'linear', NULL, NULL, NULL),
  ('c00c0360-0000-4000-8000-000000000027', 2, 'c00c0390-27-03', 'cook', 'Heat the ghee and add the cumin and the whole spices.', '[9, 10, 11, 12, 13]', 2, 30, 60, NULL, 0, 'fixed', 'smell', 'they sizzle and smell fragrant', NULL),
  ('c00c0360-0000-4000-8000-000000000027', 3, 'c00c0390-27-04', 'cook', 'Add the onion and chillies and fry until light golden.', '[6, 7]', 2, 240, 360, NULL, 0, 'partly', 'look', 'light golden', NULL),
  ('c00c0360-0000-4000-8000-000000000027', 4, 'c00c0390-27-05', 'cook', 'Add the ginger-garlic paste, then the vegetables, and saute.', '[8, 2, 3, 4, 5]', 2, 180, 240, NULL, 0, 'partly', 'smell', 'the raw smell goes', NULL),
  ('c00c0360-0000-4000-8000-000000000027', 5, 'c00c0390-27-06', 'cook', 'Add the drained rice, garam masala and salt and stir gently.', '[0, 14, 15]', 2, 60, 120, NULL, 0, 'fixed', 'look', 'the grains turn glossy', NULL),
  ('c00c0360-0000-4000-8000-000000000027', 6, 'c00c0390-27-07', 'cook', 'Pour in the water and bring it to a boil.', '[1]', 3, 180, 300, NULL, 0, 'partly', 'look', 'a rolling boil', NULL),
  ('c00c0360-0000-4000-8000-000000000027', 7, 'c00c0390-27-08', 'cook', 'Cover and cook on low.', '[]', 1, 720, 900, NULL, 1, 'fixed', 'look', 'the water is gone and small holes show on top', 'In a pressure cooker, two whistles on medium do the same.'),
  ('c00c0360-0000-4000-8000-000000000027', 8, 'c00c0390-27-09', 'cook', 'Turn off the heat and rest it covered, then fluff it up and garnish with coriander.', '[16]', 0, 300, 600, NULL, 1, 'fixed', 'look', 'the grains are separate', 'Serve with raita.');

-- 28 Lemon rice: 9 steps (1 prep, 8 cook).
UPDATE kitchen_recipes SET tools = '["Pot with a lid", "Kadai", "Wide plate"]' WHERE id = 'c00c0360-0000-4000-8000-000000000028';
DELETE FROM kitchen_recipe_steps WHERE recipe_id = 'c00c0360-0000-4000-8000-000000000028';
INSERT INTO kitchen_recipe_steps (recipe_id, position, step_key, phase, text, line_refs, heat, min_seconds, max_seconds, whistles, hands_off, time_rule, sense, checkpoint, tip) VALUES
  ('c00c0360-0000-4000-8000-000000000028', 0, 'c00c0390-28-01', 'prep', 'Slit the green chillies and chop the coriander.', '[9, 14]', NULL, 120, 180, NULL, 0, 'linear', NULL, NULL, NULL),
  ('c00c0360-0000-4000-8000-000000000028', 1, 'c00c0390-28-02', 'cook', 'Rinse the rice and bring it to a boil in the water.', '[0, 1]', 3, 240, 360, NULL, 0, 'partly', 'look', 'a rolling boil', NULL),
  ('c00c0360-0000-4000-8000-000000000028', 2, 'c00c0390-28-03', 'cook', 'Cover and cook on low until done but separate.', '[]', 1, 720, 900, NULL, 1, 'fixed', 'look', 'the water is gone and the grains are separate', NULL),
  ('c00c0360-0000-4000-8000-000000000028', 3, 'c00c0390-28-04', 'cook', 'Spread the rice on a plate to cool.', '[]', 0, 600, 900, NULL, 1, 'fixed', NULL, NULL, 'Warm, not hot, rice takes the tempering without turning mushy.'),
  ('c00c0360-0000-4000-8000-000000000028', 4, 'c00c0390-28-05', 'cook', 'Heat the oil and fry the peanuts until crunchy.', '[4, 3]', 2, 120, 180, NULL, 0, 'partly', 'look', 'golden and crunchy', NULL),
  ('c00c0360-0000-4000-8000-000000000028', 5, 'c00c0390-28-06', 'cook', 'Add the mustard seeds, and when they splutter, the chana dal and urad dal. Fry until golden.', '[5, 6, 7]', 2, 60, 120, NULL, 0, 'fixed', 'look', 'the dals turn golden', NULL),
  ('c00c0360-0000-4000-8000-000000000028', 6, 'c00c0390-28-07', 'cook', 'Add the dried chillies, green chillies, curry leaves and hing, then the turmeric, and take the pan off the heat.', '[8, 9, 10, 12, 11]', 2, 30, 45, NULL, 0, 'fixed', 'sound', 'the curry leaves crackle', NULL),
  ('c00c0360-0000-4000-8000-000000000028', 7, 'c00c0390-28-08', 'cook', 'Add the rice and salt and mix gently so the grains stay whole.', '[0, 13]', 0, NULL, NULL, NULL, 0, 'fixed', 'look', 'every grain is yellow', NULL),
  ('c00c0360-0000-4000-8000-000000000028', 8, 'c00c0390-28-09', 'cook', 'Squeeze in the lemon, add the coriander and mix again.', '[2, 14]', 0, NULL, NULL, NULL, 0, 'fixed', 'taste', 'tangy, with the salt right', 'Serve warm or at room temperature.');

-- 29 Curd rice: 7 steps (1 prep, 6 cook); 4 whistles.
UPDATE kitchen_recipes SET tools = '["Pressure cooker", "Tadka pan", "Mixing bowl"]' WHERE id = 'c00c0360-0000-4000-8000-000000000029';
DELETE FROM kitchen_recipe_steps WHERE recipe_id = 'c00c0360-0000-4000-8000-000000000029';
INSERT INTO kitchen_recipe_steps (recipe_id, position, step_key, phase, text, line_refs, heat, min_seconds, max_seconds, whistles, hands_off, time_rule, sense, checkpoint, tip) VALUES
  ('c00c0360-0000-4000-8000-000000000029', 0, 'c00c0390-29-01', 'prep', 'Finely chop the ginger, chilli and coriander.', '[4, 5, 12]', NULL, 180, 300, NULL, 0, 'linear', NULL, NULL, NULL),
  ('c00c0360-0000-4000-8000-000000000029', 1, 'c00c0390-29-02', 'cook', 'Rinse the rice and pressure-cook it in the water on medium, until very soft.', '[0, 1]', 2, NULL, NULL, 4, 1, 'fixed', NULL, NULL, NULL),
  ('c00c0360-0000-4000-8000-000000000029', 2, 'c00c0390-29-03', 'cook', 'Turn off the heat and let the pressure drop on its own.', '[]', 0, 600, 900, NULL, 1, 'fixed', 'look', 'the pressure valve has dropped', 'Don''t lift the weight to hurry it; the food finishes cooking as it settles.'),
  ('c00c0360-0000-4000-8000-000000000029', 3, 'c00c0390-29-04', 'cook', 'Mash the rice lightly in a bowl and let it cool to room temperature.', '[]', 0, 900, 1500, NULL, 1, 'fixed', 'feel', 'cool to the touch', 'Curd stirred into hot rice turns sour.'),
  ('c00c0360-0000-4000-8000-000000000029', 4, 'c00c0390-29-05', 'cook', 'Mix in the curd, milk and salt until creamy.', '[2, 3, 11]', 0, NULL, NULL, NULL, 0, 'fixed', 'look', 'creamy and loose, not stiff', 'Add a little more milk if it''s thick.'),
  ('c00c0360-0000-4000-8000-000000000029', 5, 'c00c0390-29-06', 'cook', 'Heat the oil and add the mustard seeds. When they splutter, add the urad dal, ginger, chilli, curry leaves and hing, and fry until the dal is golden.', '[6, 7, 8, 4, 5, 9, 10]', 2, 45, 90, NULL, 0, 'fixed', 'look', 'the dal is golden', NULL),
  ('c00c0360-0000-4000-8000-000000000029', 6, 'c00c0390-29-07', 'cook', 'Pour the tempering over the rice, add the coriander and mix.', '[12]', 0, NULL, NULL, NULL, 0, 'fixed', 'taste', 'the salt is right', 'Serve cool, with pickle.');

-- 30 Moong dal khichdi: 7 steps (2 prep, 5 cook); 4 whistles.
UPDATE kitchen_recipes SET tools = '["Pressure cooker"]' WHERE id = 'c00c0360-0000-4000-8000-000000000030';
DELETE FROM kitchen_recipe_steps WHERE recipe_id = 'c00c0360-0000-4000-8000-000000000030';
INSERT INTO kitchen_recipe_steps (recipe_id, position, step_key, phase, text, line_refs, heat, min_seconds, max_seconds, whistles, hands_off, time_rule, sense, checkpoint, tip) VALUES
  ('c00c0360-0000-4000-8000-000000000030', 0, 'c00c0390-30-01', 'prep', 'Rinse the rice and dal together and soak them.', '[0, 1]', NULL, 900, 1200, NULL, 1, 'fixed', NULL, NULL, NULL),
  ('c00c0360-0000-4000-8000-000000000030', 1, 'c00c0390-30-02', 'prep', 'Grate the ginger and slit the chilli.', '[6, 7]', NULL, 120, 180, NULL, 0, 'linear', NULL, NULL, NULL),
  ('c00c0360-0000-4000-8000-000000000030', 2, 'c00c0390-30-03', 'cook', 'Heat the ghee in the pressure cooker and add the cumin. When it sizzles, add the hing, ginger and chilli.', '[3, 4, 5, 6, 7]', 2, 30, 60, NULL, 0, 'fixed', 'sound', 'the cumin sizzles', NULL),
  ('c00c0360-0000-4000-8000-000000000030', 3, 'c00c0390-30-04', 'cook', 'Add the drained rice and dal, the turmeric and salt, and stir.', '[0, 1, 8, 9]', 2, 60, 120, NULL, 0, 'fixed', 'look', 'the grains are coated in ghee', NULL),
  ('c00c0360-0000-4000-8000-000000000030', 4, 'c00c0390-30-05', 'cook', 'Add the water, close the cooker and pressure-cook on medium.', '[2]', 2, NULL, NULL, 4, 1, 'fixed', NULL, NULL, NULL),
  ('c00c0360-0000-4000-8000-000000000030', 5, 'c00c0390-30-06', 'cook', 'Turn off the heat and let the pressure drop on its own.', '[]', 0, 600, 900, NULL, 1, 'fixed', 'look', 'the pressure valve has dropped', 'Don''t lift the weight to hurry it; the food finishes cooking as it settles.'),
  ('c00c0360-0000-4000-8000-000000000030', 6, 'c00c0390-30-07', 'cook', 'Open the cooker, stir well and loosen it with hot water if needed.', '[]', 1, NULL, NULL, NULL, 0, 'fixed', 'feel', 'soft and like porridge', 'Serve with a spoon of ghee, curd and papad.');

-- 31 Veg fried rice: 6 steps (2 prep, 4 cook); long prep 1–3 h.
UPDATE kitchen_recipes SET tools = '["Wok or wide kadai", "Pot with a lid", "Tray"]' WHERE id = 'c00c0360-0000-4000-8000-000000000031';
DELETE FROM kitchen_recipe_steps WHERE recipe_id = 'c00c0360-0000-4000-8000-000000000031';
INSERT INTO kitchen_recipe_steps (recipe_id, position, step_key, phase, text, line_refs, heat, min_seconds, max_seconds, whistles, hands_off, time_rule, sense, checkpoint, tip) VALUES
  ('c00c0360-0000-4000-8000-000000000031', 0, 'c00c0390-31-01', 'prep', 'Cook the rice in the water until just done, then spread it out and cool it completely, ideally in the fridge.', '[0, 1]', NULL, 3600, 10800, NULL, 1, 'fixed', 'feel', 'cold, with the grains separate', 'Cold rice fries into separate grains; warm rice turns mushy. Last night''s rice is perfect.'),
  ('c00c0360-0000-4000-8000-000000000031', 1, 'c00c0390-31-02', 'prep', 'Finely chop the carrot, capsicum and beans, shred the cabbage, mince the garlic and chop the spring onions, keeping the greens apart.', '[2, 3, 5, 4, 7, 6]', NULL, 600, 900, NULL, 0, 'linear', NULL, NULL, NULL),
  ('c00c0360-0000-4000-8000-000000000031', 2, 'c00c0390-31-03', 'cook', 'Heat the oil in a wok until it smokes, add the garlic and the spring onion whites and stir-fry briefly.', '[8, 7, 6]', 3, 60, 120, NULL, 0, 'fixed', 'smell', 'the garlic smells fragrant', NULL),
  ('c00c0360-0000-4000-8000-000000000031', 3, 'c00c0390-31-04', 'cook', 'Add the carrot, beans, cabbage and capsicum and toss on high so they stay crunchy.', '[2, 5, 4, 3]', 3, 120, 180, NULL, 0, 'partly', 'look', 'bright and still crunchy', NULL),
  ('c00c0360-0000-4000-8000-000000000031', 4, 'c00c0390-31-05', 'cook', 'Add the rice, soy sauce, vinegar, pepper and salt and toss on high until hot and well mixed.', '[0, 9, 10, 11, 12]', 3, 180, 240, NULL, 0, 'partly', 'look', 'every grain is coated and steaming', NULL),
  ('c00c0360-0000-4000-8000-000000000031', 5, 'c00c0390-31-06', 'cook', 'Turn off the heat and scatter over the spring onion greens.', '[6]', 0, NULL, NULL, NULL, 0, 'fixed', 'taste', 'the salt and pepper are right', NULL);

-- 32 Masala chai: 5 steps (1 prep, 4 cook).
UPDATE kitchen_recipes SET tools = '["Saucepan", "Tea strainer", "Mortar and pestle"]' WHERE id = 'c00c0360-0000-4000-8000-000000000032';
DELETE FROM kitchen_recipe_steps WHERE recipe_id = 'c00c0360-0000-4000-8000-000000000032';
INSERT INTO kitchen_recipe_steps (recipe_id, position, step_key, phase, text, line_refs, heat, min_seconds, max_seconds, whistles, hands_off, time_rule, sense, checkpoint, tip) VALUES
  ('c00c0360-0000-4000-8000-000000000032', 0, 'c00c0390-32-01', 'prep', 'Crush the ginger and cardamom.', '[4, 5]', NULL, NULL, NULL, NULL, 0, 'fixed', NULL, NULL, NULL),
  ('c00c0360-0000-4000-8000-000000000032', 1, 'c00c0390-32-02', 'cook', 'Bring the water to a boil with the ginger and cardamom and let it bubble.', '[1, 4, 5]', 3, 120, 180, NULL, 0, 'partly', 'smell', 'it smells of ginger', NULL),
  ('c00c0360-0000-4000-8000-000000000032', 2, 'c00c0390-32-03', 'cook', 'Add the tea leaves and boil until the water is dark.', '[2]', 2, 45, 90, NULL, 0, 'fixed', 'look', 'the water turns dark', NULL),
  ('c00c0360-0000-4000-8000-000000000032', 3, 'c00c0390-32-04', 'cook', 'Add the milk and sugar and bring it to a boil.', '[0, 3]', 3, 120, 240, NULL, 0, 'partly', 'look', 'it rises up the pan', 'Stay with it; milk boils over fast.'),
  ('c00c0360-0000-4000-8000-000000000032', 4, 'c00c0390-32-05', 'cook', 'Lower the heat and simmer until the chai turns a deep tan, then strain it into cups.', '[]', 1, 90, 180, NULL, 0, 'fixed', 'look', 'a deep tan colour', NULL);

-- 33 Filter coffee: 5 steps (0 prep, 5 cook).
UPDATE kitchen_recipes SET tools = '["Coffee filter", "Saucepan", "Tumbler and dabara"]' WHERE id = 'c00c0360-0000-4000-8000-000000000033';
DELETE FROM kitchen_recipe_steps WHERE recipe_id = 'c00c0360-0000-4000-8000-000000000033';
INSERT INTO kitchen_recipe_steps (recipe_id, position, step_key, phase, text, line_refs, heat, min_seconds, max_seconds, whistles, hands_off, time_rule, sense, checkpoint, tip) VALUES
  ('c00c0360-0000-4000-8000-000000000033', 0, 'c00c0390-33-01', 'cook', 'Bring the water to a boil.', '[2]', 3, 120, 240, NULL, 0, 'partly', 'look', 'a rolling boil', NULL),
  ('c00c0360-0000-4000-8000-000000000033', 1, 'c00c0390-33-02', 'cook', 'Put the coffee powder in the upper cup of the filter, press it lightly and pour in the boiling water. Cover and let the decoction drip.', '[1, 2]', 0, 600, 900, NULL, 1, 'fixed', 'look', 'the upper cup is empty', 'Press the powder lightly; packed hard, the water won''t drip through.'),
  ('c00c0360-0000-4000-8000-000000000033', 2, 'c00c0390-33-03', 'cook', 'Bring the milk to a boil.', '[0]', 2, 240, 360, NULL, 0, 'partly', 'look', 'it froths up the pan', NULL),
  ('c00c0360-0000-4000-8000-000000000033', 3, 'c00c0390-33-04', 'cook', 'For each cup, mix a little decoction with sugar, then pour in the hot milk.', '[3]', 0, NULL, NULL, NULL, 0, 'fixed', 'taste', 'strong and sweet enough', 'Start with a little decoction and add more to taste.'),
  ('c00c0360-0000-4000-8000-000000000033', 4, 'c00c0390-33-05', 'cook', 'Pour it between the tumbler and the dabara a few times to froth it, and serve at once.', '[]', 0, NULL, NULL, NULL, 0, 'fixed', 'look', 'a thick froth on top', NULL);

-- 34 Sweet lassi: 3 steps (1 prep, 2 cook).
UPDATE kitchen_recipes SET tools = '["Blender or mathani", "Deep jug"]' WHERE id = 'c00c0360-0000-4000-8000-000000000034';
DELETE FROM kitchen_recipe_steps WHERE recipe_id = 'c00c0360-0000-4000-8000-000000000034';
INSERT INTO kitchen_recipe_steps (recipe_id, position, step_key, phase, text, line_refs, heat, min_seconds, max_seconds, whistles, hands_off, time_rule, sense, checkpoint, tip) VALUES
  ('c00c0360-0000-4000-8000-000000000034', 0, 'c00c0390-34-01', 'prep', 'Chill the curd and milk in the fridge.', '[0, 1]', NULL, 1800, 3600, NULL, 1, 'fixed', NULL, NULL, 'Skip this if they''re already cold.'),
  ('c00c0360-0000-4000-8000-000000000034', 1, 'c00c0390-34-02', 'cook', 'Put the curd, milk and sugar in a deep jug or blender, and whisk or blend until frothy.', '[0, 1, 2]', 0, 60, 90, NULL, 0, 'fixed', 'look', 'frothy, with the sugar dissolved', NULL),
  ('c00c0360-0000-4000-8000-000000000034', 2, 'c00c0390-34-03', 'cook', 'Add the cardamom, blend again briefly and pour into glasses over ice.', '[3]', 0, 30, 45, NULL, 0, 'fixed', 'taste', 'sweet enough for you', 'A spoon of malai on top makes it richer.');

-- 35 Nimbu pani: 3 steps (1 prep, 2 cook).
UPDATE kitchen_recipes SET tools = '["Jug", "Lemon squeezer"]' WHERE id = 'c00c0360-0000-4000-8000-000000000035';
DELETE FROM kitchen_recipe_steps WHERE recipe_id = 'c00c0360-0000-4000-8000-000000000035';
INSERT INTO kitchen_recipe_steps (recipe_id, position, step_key, phase, text, line_refs, heat, min_seconds, max_seconds, whistles, hands_off, time_rule, sense, checkpoint, tip) VALUES
  ('c00c0360-0000-4000-8000-000000000035', 0, 'c00c0390-35-01', 'prep', 'Chill the water in the fridge.', '[0]', NULL, 1800, 3600, NULL, 1, 'fixed', NULL, NULL, 'Skip this if it''s already cold.'),
  ('c00c0360-0000-4000-8000-000000000035', 1, 'c00c0390-35-02', 'cook', 'Squeeze the lemon into a jug and stir in the sugar, black salt and cumin until the sugar dissolves.', '[1, 2, 3, 4]', 0, 60, 120, NULL, 0, 'fixed', 'look', 'the sugar has dissolved', 'Roll the lemon on the counter first; it gives more juice.'),
  ('c00c0360-0000-4000-8000-000000000035', 2, 'c00c0390-35-03', 'cook', 'Add the cold water and the torn mint, stir well, and pour over ice.', '[0, 5]', 0, NULL, NULL, NULL, 0, 'fixed', 'taste', 'sweet, sour and salty in balance', 'Adjust the sugar or lemon before you pour.');

-- 36 Onion pakoda: 6 steps (2 prep, 4 cook).
UPDATE kitchen_recipes SET tools = '["Kadai for deep frying", "Slotted spoon", "Mixing bowl"]' WHERE id = 'c00c0360-0000-4000-8000-000000000036';
DELETE FROM kitchen_recipe_steps WHERE recipe_id = 'c00c0360-0000-4000-8000-000000000036';
INSERT INTO kitchen_recipe_steps (recipe_id, position, step_key, phase, text, line_refs, heat, min_seconds, max_seconds, whistles, hands_off, time_rule, sense, checkpoint, tip) VALUES
  ('c00c0360-0000-4000-8000-000000000036', 0, 'c00c0390-36-01', 'prep', 'Thinly slice the onions, and chop the chillies, curry leaves and coriander.', '[0, 3, 4, 5]', NULL, 480, 720, NULL, 0, 'linear', NULL, NULL, NULL),
  ('c00c0360-0000-4000-8000-000000000036', 1, 'c00c0390-36-02', 'prep', 'Rub the onions with the salt and leave them so they release water.', '[0, 9]', NULL, 600, 900, NULL, 1, 'fixed', 'feel', 'the onions are limp and wet', NULL),
  ('c00c0360-0000-4000-8000-000000000036', 2, 'c00c0390-36-03', 'cook', 'Add the chillies, curry leaves, coriander, ajwain, chilli powder and hing, then the besan and rice flour. Mix with your hands and only a sprinkle of water.', '[3, 4, 5, 6, 7, 8, 1, 2, 10]', 0, NULL, NULL, NULL, 0, 'fixed', 'feel', 'the onions are coated and the mix just holds', 'Too much water makes them soggy, not crisp.'),
  ('c00c0360-0000-4000-8000-000000000036', 3, 'c00c0390-36-04', 'cook', 'Heat the oil for deep frying.', '[11]', 3, 300, 480, NULL, 0, 'fixed', 'look', 'a drop of batter rises at once', NULL),
  ('c00c0360-0000-4000-8000-000000000036', 4, 'c00c0390-36-05', 'cook', 'Drop in small loose clusters and fry, turning, until golden brown and crisp.', '[]', 2, 240, 300, NULL, 0, 'fixed', 'look', 'golden brown and crisp', 'Don''t crowd the oil, or it cools and they turn greasy.'),
  ('c00c0360-0000-4000-8000-000000000036', 5, 'c00c0390-36-06', 'cook', 'Fry the rest in batches, draining each on paper.', '[]', 2, 480, 720, NULL, 0, 'linear', 'look', 'every batch is golden brown and crisp', 'Serve hot with chai and green chutney.');

-- 37 Pav bhaji: 10 steps (2 prep, 8 cook); 3 whistles.
UPDATE kitchen_recipes SET tools = '["Pressure cooker", "Wide pan or tawa", "Potato masher"]' WHERE id = 'c00c0360-0000-4000-8000-000000000037';
DELETE FROM kitchen_recipe_steps WHERE recipe_id = 'c00c0360-0000-4000-8000-000000000037';
INSERT INTO kitchen_recipe_steps (recipe_id, position, step_key, phase, text, line_refs, heat, min_seconds, max_seconds, whistles, hands_off, time_rule, sense, checkpoint, tip) VALUES
  ('c00c0360-0000-4000-8000-000000000037', 0, 'c00c0390-37-01', 'prep', 'Peel and quarter the potatoes and chop the cauliflower.', '[0, 1]', NULL, 300, 480, NULL, 0, 'linear', NULL, NULL, NULL),
  ('c00c0360-0000-4000-8000-000000000037', 1, 'c00c0390-37-02', 'prep', 'Finely chop the capsicum, onions, tomatoes and coriander, and cut the lemon into wedges.', '[3, 4, 5, 14, 13]', NULL, 600, 900, NULL, 0, 'linear', NULL, NULL, NULL),
  ('c00c0360-0000-4000-8000-000000000037', 2, 'c00c0390-37-03', 'cook', 'Pressure-cook the potatoes, cauliflower and peas with a little water on high.', '[0, 1, 2]', 3, NULL, NULL, 3, 1, 'fixed', NULL, NULL, NULL),
  ('c00c0360-0000-4000-8000-000000000037', 3, 'c00c0390-37-04', 'cook', 'Turn off the heat, let the pressure drop on its own, then mash the vegetables.', '[]', 0, 600, 900, NULL, 1, 'fixed', 'look', 'the pressure valve has dropped', 'Don''t lift the weight to hurry it; the food finishes cooking as it settles.'),
  ('c00c0360-0000-4000-8000-000000000037', 4, 'c00c0390-37-05', 'cook', 'Melt half the butter in a wide pan and cook most of the onions until soft, keeping some back to serve.', '[7, 4]', 2, 240, 360, NULL, 0, 'partly', 'look', 'soft and see-through', NULL),
  ('c00c0360-0000-4000-8000-000000000037', 5, 'c00c0390-37-06', 'cook', 'Add the ginger-garlic paste and capsicum and fry until the raw smell goes.', '[6, 3]', 2, 120, 180, NULL, 0, 'fixed', 'smell', 'the raw smell goes', NULL),
  ('c00c0360-0000-4000-8000-000000000037', 6, 'c00c0390-37-07', 'cook', 'Add the tomatoes and cook, mashing, until they break down completely.', '[5]', 2, 360, 480, NULL, 0, 'partly', 'look', 'no pieces of tomato are left', NULL),
  ('c00c0360-0000-4000-8000-000000000037', 7, 'c00c0390-37-08', 'cook', 'Add the turmeric, chilli powder, pav bhaji masala and salt, then the mashed vegetables and the water. Mash it all together and simmer.', '[8, 9, 10, 12, 0, 1, 2, 11]', 1, 600, 720, NULL, 1, 'partly', 'look', 'thick, with butter shining at the edges', NULL),
  ('c00c0360-0000-4000-8000-000000000037', 8, 'c00c0390-37-09', 'cook', 'Finish with a little butter, the coriander and a squeeze of lemon.', '[7, 14, 13]', 0, NULL, NULL, NULL, 0, 'fixed', 'taste', 'the salt and lemon are right', NULL),
  ('c00c0360-0000-4000-8000-000000000037', 9, 'c00c0390-37-10', 'cook', 'Slit the pav and toast them in the rest of the butter on a tawa.', '[15, 7]', 2, 180, 300, NULL, 0, 'linear', 'look', 'crisp and golden', 'Serve with the bhaji, the onion you kept back and lemon wedges.');

-- 38 Veg sandwich: 6 steps (2 prep, 4 cook).
UPDATE kitchen_recipes SET tools = '["Saucepan", "Tawa or sandwich maker", "Butter knife"]' WHERE id = 'c00c0360-0000-4000-8000-000000000038';
DELETE FROM kitchen_recipe_steps WHERE recipe_id = 'c00c0360-0000-4000-8000-000000000038';
INSERT INTO kitchen_recipe_steps (recipe_id, position, step_key, phase, text, line_refs, heat, min_seconds, max_seconds, whistles, hands_off, time_rule, sense, checkpoint, tip) VALUES
  ('c00c0360-0000-4000-8000-000000000038', 0, 'c00c0390-38-01', 'prep', 'Boil the potato until a knife slides in, then cool and peel it.', '[2]', NULL, 900, 1200, NULL, 1, 'fixed', 'feel', 'a knife slides in easily', 'A pressure cooker does it in two whistles.'),
  ('c00c0360-0000-4000-8000-000000000038', 1, 'c00c0390-38-02', 'prep', 'Slice the potato, cucumber, tomato and onion into thin rounds.', '[2, 3, 4, 5]', NULL, 300, 480, NULL, 0, 'linear', NULL, NULL, NULL),
  ('c00c0360-0000-4000-8000-000000000038', 2, 'c00c0390-38-03', 'cook', 'Butter the bread slices on one side.', '[0, 1]', 0, 60, 120, NULL, 0, 'linear', NULL, NULL, NULL),
  ('c00c0360-0000-4000-8000-000000000038', 3, 'c00c0390-38-04', 'cook', 'Layer half the slices with potato, cucumber, onion and tomato, sprinkling chaat masala, pepper and salt over each layer.', '[2, 3, 5, 4, 6, 7, 8]', 0, 120, 240, NULL, 0, 'linear', NULL, NULL, NULL),
  ('c00c0360-0000-4000-8000-000000000038', 4, 'c00c0390-38-05', 'cook', 'Close with the other slices, buttered side in, and press lightly.', '[]', 0, 30, 60, NULL, 0, 'linear', NULL, NULL, NULL),
  ('c00c0360-0000-4000-8000-000000000038', 5, 'c00c0390-38-06', 'cook', 'Toast them on a tawa or in a sandwich maker, if you like, then cut them in half.', '[]', 2, 180, 240, NULL, 0, 'linear', 'look', 'golden and crisp', NULL);

-- 39 Rava sheera: 6 steps (0 prep, 6 cook).
UPDATE kitchen_recipes SET tools = '["Heavy kadai", "Saucepan"]' WHERE id = 'c00c0360-0000-4000-8000-000000000039';
DELETE FROM kitchen_recipe_steps WHERE recipe_id = 'c00c0360-0000-4000-8000-000000000039';
INSERT INTO kitchen_recipe_steps (recipe_id, position, step_key, phase, text, line_refs, heat, min_seconds, max_seconds, whistles, hands_off, time_rule, sense, checkpoint, tip) VALUES
  ('c00c0360-0000-4000-8000-000000000039', 0, 'c00c0390-39-01', 'cook', 'Warm the milk and water with the sugar until the sugar dissolves, and keep it hot.', '[3, 4, 2]', 2, 180, 300, NULL, 0, 'partly', 'look', 'steaming, with the sugar dissolved', NULL),
  ('c00c0360-0000-4000-8000-000000000039', 1, 'c00c0390-39-02', 'cook', 'Heat the ghee and fry the cashews and raisins until golden, then lift them out.', '[1, 5, 6]', 2, 60, 120, NULL, 0, 'fixed', 'look', 'the cashews are golden and the raisins puff up', NULL),
  ('c00c0360-0000-4000-8000-000000000039', 2, 'c00c0390-39-03', 'cook', 'Add the rava to the ghee and roast it on low, stirring, until it smells nutty and turns light golden.', '[0]', 1, 360, 480, NULL, 0, 'partly', 'smell', 'it smells nutty and turns light golden', 'Roast it well; under-roasted rava tastes raw.'),
  ('c00c0360-0000-4000-8000-000000000039', 3, 'c00c0390-39-04', 'cook', 'Carefully pour in the hot milk, stirring hard, as it will splutter.', '[]', 1, 30, 60, NULL, 0, 'fixed', 'sound', 'the spluttering settles', NULL),
  ('c00c0360-0000-4000-8000-000000000039', 4, 'c00c0390-39-05', 'cook', 'Stir until the rava soaks up the liquid and leaves the sides of the pan.', '[]', 1, 120, 180, NULL, 0, 'partly', 'look', 'it leaves the sides of the pan', NULL),
  ('c00c0360-0000-4000-8000-000000000039', 5, 'c00c0390-39-06', 'cook', 'Stir in the cardamom, saffron and nuts and serve warm.', '[7, 8, 5, 6]', 0, NULL, NULL, NULL, 0, 'fixed', 'smell', 'it smells of cardamom', NULL);

-- 40 Rice kheer: 6 steps (2 prep, 4 cook).
UPDATE kitchen_recipes SET tools = '["Heavy-bottomed pan", "Long spoon"]' WHERE id = 'c00c0360-0000-4000-8000-000000000040';
DELETE FROM kitchen_recipe_steps WHERE recipe_id = 'c00c0360-0000-4000-8000-000000000040';
INSERT INTO kitchen_recipe_steps (recipe_id, position, step_key, phase, text, line_refs, heat, min_seconds, max_seconds, whistles, hands_off, time_rule, sense, checkpoint, tip) VALUES
  ('c00c0360-0000-4000-8000-000000000040', 0, 'c00c0390-40-01', 'prep', 'Rinse the rice and soak it.', '[1]', NULL, 1200, 1800, NULL, 1, 'fixed', NULL, NULL, NULL),
  ('c00c0360-0000-4000-8000-000000000040', 1, 'c00c0390-40-02', 'prep', 'Chop the cashews and slice the almonds.', '[4, 5]', NULL, 180, 300, NULL, 0, 'linear', NULL, NULL, NULL),
  ('c00c0360-0000-4000-8000-000000000040', 2, 'c00c0390-40-03', 'cook', 'Bring the milk to a boil in a heavy pan.', '[0]', 2, 480, 720, NULL, 0, 'partly', 'look', 'it froths up the pan', 'Rinse the pan with water first so the milk sticks less.'),
  ('c00c0360-0000-4000-8000-000000000040', 3, 'c00c0390-40-04', 'cook', 'Add the drained rice and simmer on low until the rice is soft and the milk thickens.', '[1]', 1, 1800, 2100, NULL, 1, 'partly', 'look', 'the rice is soft and the milk is creamy', 'Stir every few minutes, scraping the bottom, so it doesn''t catch.'),
  ('c00c0360-0000-4000-8000-000000000040', 4, 'c00c0390-40-05', 'cook', 'Add the sugar and simmer a little more.', '[2]', 1, 300, 420, NULL, 0, 'fixed', 'look', 'thick enough to coat a spoon', NULL),
  ('c00c0360-0000-4000-8000-000000000040', 5, 'c00c0390-40-06', 'cook', 'Stir in the cardamom, saffron and nuts.', '[3, 7, 4, 5, 6]', 0, NULL, NULL, NULL, 0, 'fixed', 'taste', 'sweet enough', 'Serve warm, or chill it; it thickens as it cools.');

-- 41 Besan ladoo: 6 steps (1 prep, 5 cook).
UPDATE kitchen_recipes SET tools = '["Heavy kadai", "Wide plate", "Airtight box"]' WHERE id = 'c00c0360-0000-4000-8000-000000000041';
DELETE FROM kitchen_recipe_steps WHERE recipe_id = 'c00c0360-0000-4000-8000-000000000041';
INSERT INTO kitchen_recipe_steps (recipe_id, position, step_key, phase, text, line_refs, heat, min_seconds, max_seconds, whistles, hands_off, time_rule, sense, checkpoint, tip) VALUES
  ('c00c0360-0000-4000-8000-000000000041', 0, 'c00c0390-41-01', 'prep', 'Chop the cashews.', '[4]', NULL, 120, 180, NULL, 0, 'linear', NULL, NULL, NULL),
  ('c00c0360-0000-4000-8000-000000000041', 1, 'c00c0390-41-02', 'cook', 'Melt the ghee in a heavy pan, add the besan and roast it on low, stirring all the time, until golden and nutty.', '[1, 0]', 1, 1200, 1500, NULL, 0, 'partly', 'smell', 'it smells nutty and turns golden', 'Go slowly; besan roasted fast stays raw inside.'),
  ('c00c0360-0000-4000-8000-000000000041', 2, 'c00c0390-41-03', 'cook', 'Take the pan off the heat and let it cool until just warm.', '[]', 0, 900, 1200, NULL, 1, 'fixed', 'feel', 'just warm to the touch', 'Sugar added while it''s hot melts, and the ladoos won''t hold.'),
  ('c00c0360-0000-4000-8000-000000000041', 3, 'c00c0390-41-04', 'cook', 'Mix in the powdered sugar, cardamom and cashews.', '[2, 3, 4]', 0, NULL, NULL, NULL, 0, 'fixed', 'feel', 'it holds together when pressed', NULL),
  ('c00c0360-0000-4000-8000-000000000041', 4, 'c00c0390-41-05', 'cook', 'Take a small handful and press it into a tight ball between your palms. Shape the rest the same way.', '[]', 0, 480, 720, NULL, 0, 'linear', 'feel', 'firm balls with no cracks', NULL),
  ('c00c0360-0000-4000-8000-000000000041', 5, 'c00c0390-41-06', 'cook', 'Cool them fully and keep them in an airtight box.', '[]', 0, 1200, 1800, NULL, 1, 'fixed', NULL, NULL, 'They keep for about two weeks.');

-- 42 Gajar halwa: 6 steps (2 prep, 4 cook).
UPDATE kitchen_recipes SET tools = '["Heavy kadai", "Grater"]' WHERE id = 'c00c0360-0000-4000-8000-000000000042';
DELETE FROM kitchen_recipe_steps WHERE recipe_id = 'c00c0360-0000-4000-8000-000000000042';
INSERT INTO kitchen_recipe_steps (recipe_id, position, step_key, phase, text, line_refs, heat, min_seconds, max_seconds, whistles, hands_off, time_rule, sense, checkpoint, tip) VALUES
  ('c00c0360-0000-4000-8000-000000000042', 0, 'c00c0390-42-01', 'prep', 'Wash, peel and grate the carrots.', '[0]', NULL, 600, 900, NULL, 0, 'linear', NULL, NULL, NULL),
  ('c00c0360-0000-4000-8000-000000000042', 1, 'c00c0390-42-02', 'prep', 'Chop the cashews and slice the almonds.', '[5, 6]', NULL, 180, 300, NULL, 0, 'linear', NULL, NULL, NULL),
  ('c00c0360-0000-4000-8000-000000000042', 2, 'c00c0390-42-03', 'cook', 'Heat the ghee in a heavy pan and saute the carrots.', '[3, 0]', 2, 300, 420, NULL, 0, 'partly', 'look', 'the carrots turn a shade darker', NULL),
  ('c00c0360-0000-4000-8000-000000000042', 3, 'c00c0390-42-04', 'cook', 'Add the milk and cook, stirring now and then, until it is almost absorbed.', '[1]', 2, 1800, 2100, NULL, 1, 'partly', 'look', 'the milk is almost gone', 'Stir every few minutes so it doesn''t catch.'),
  ('c00c0360-0000-4000-8000-000000000042', 4, 'c00c0390-42-05', 'cook', 'Add the sugar. It turns runny again; keep cooking and stirring until the halwa is thick.', '[2]', 2, 600, 720, NULL, 0, 'partly', 'look', 'it leaves the sides of the pan', NULL),
  ('c00c0360-0000-4000-8000-000000000042', 5, 'c00c0390-42-06', 'cook', 'Stir in the cardamom and nuts.', '[4, 5, 6, 7]', 0, NULL, NULL, NULL, 0, 'fixed', 'taste', 'sweet enough', 'Serve warm.');
