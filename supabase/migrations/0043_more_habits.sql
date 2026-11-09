-- More habits on Kept's list (owner, 2026-10-03; tasks/plan.md decision 76): seven more that a photo or
-- a screenshot can check, so a staked challenge has seventeen to choose from, and free trackers get
-- the same seventeen as quick picks. Each one's check is in SPEC-challenges.md's habit table,
-- src/lib/check-in.ts (camera, screenshot or either) and the AI's rules
-- (supabase/functions/ai-check/rules.ts). Still left out on purpose (SPEC-challenges.md): quitting
-- habits, sleep on time, waking up early and Tidy up.

insert into public.habits (id, name, check_summary, position) values
  ('write', 'Write 500 words', 'A photo or screenshot of today''s writing, with its word count.', 4),
  ('code', 'Write code', 'A photo of your code on screen, or a commit dated today.', 5),
  ('chess', 'Play chess', 'Today''s finished game or puzzle, or a photo of your board mid-game.', 6),
  ('steps', '10,000 steps', 'Your phone''s step count for today: 10,000 or more.', 9),
  ('bike', 'Ride a bike', 'A photo with your bike outdoors, or your cycling app''s ride screen.', 10),
  ('greens', 'Eat your greens', 'A photo of your meal, with vegetables on the plate.', 13),
  ('draw', 'Draw or paint', 'A photo of today''s drawing or painting, in progress.', 17);

-- The grid in groups: mind (1-6), body (7-11), food (12-13), calm (14-15), making (16-17).
update public.habits h set position = v.position
from (values ('read', 1), ('language', 2), ('study', 3), ('workout', 7), ('walk-run', 8), ('stretch', 11),
             ('cook', 12), ('journal', 14), ('meditate', 15), ('instrument', 16)) as v(id, position)
where h.id = v.id;
