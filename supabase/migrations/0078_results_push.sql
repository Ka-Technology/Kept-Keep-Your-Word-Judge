-- The results push (T177; SPEC-notifications.md): when a challenge ends, finished or not, `notify` tells the
-- challenger and each pledger, with a link to the results ({ challenge_result }). A cancel on Day 1 says nothing:
-- whoever cancelled already knows. Sent after the ending commits, like every push (call_notify(), 0028).
-- Proven by supabase/tests/results_push_rls.sql.

create function public.challenges_results_push() returns trigger
  language plpgsql security definer set search_path = ''
  as $$
begin
  perform public.call_notify(jsonb_build_object('challenge_result', new.id));
  return null;
end $$;
create trigger challenges_results_push after update of outcome on public.challenges
  for each row when (new.outcome in ('finished', 'not_finished') and old.outcome is null)
  execute function public.challenges_results_push();

revoke execute on function public.challenges_results_push() from public, anon, authenticated;
