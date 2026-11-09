-- The habit list, revised (owner, 2026-10-03; tasks/plan.md decision 78): Write 500 words and Write code
-- come off (0043 added them), and Finish a LeetCode problem takes Write code's place: one accepted
-- submission a day, which a screenshot shows plainly. Sixteen habits.
--
-- A habit a challenge already uses can't be deleted (challenges.habit_id references it), so either stays
-- if one was started in the meantime; the app's list follows the table. Its check in
-- supabase/functions/ai-check/rules.ts, src/lib/check-in.ts and the icon go with this migration.

delete from public.habits h
where h.id in ('write', 'code')
  and not exists (select 1 from public.challenges c where c.habit_id = h.id);

insert into public.habits (id, name, check_summary, position) values
  ('leetcode', 'Finish a LeetCode problem', 'A screenshot or photo of today''s accepted LeetCode submission.', 4);
