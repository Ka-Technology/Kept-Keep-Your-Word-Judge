-- Push notifications, part 2 (T59, SPEC-notifications.md section 2): the challenger hears when a
-- check-in needs a new photo or wasn't approved. Proven by supabase/tests/notifications_rls.sql.

-- "Your check-ins", per phone.
alter table public.push_tokens add column check_ins boolean not null default true;
grant update (check_ins) on public.push_tokens to authenticated;

-- Now also: a friend's "Doesn't look right" (#4), the AI's retake (#8), and a rejection (#9, #13).
create or replace function public.check_ins_notify() returns trigger
  language plpgsql security definer set search_path = ''
  as $$
  begin
    if new.status = 'pending' and (tg_op = 'INSERT' or old.status = 'flagged') then
      perform public.call_notify(jsonb_build_object('check_in', new.id, 'new_photo', tg_op = 'UPDATE'));
    elsif tg_op = 'UPDATE' and ((old.status, new.status) in (('pending', 'flagged'), ('ai_checking', 'retake'))
                                or (old.status in ('ai_checking', 'retake') and new.status = 'rejected')) then
      perform public.call_notify(jsonb_build_object('check_in_result', new.id));
    end if;
    return null;
  end
  $$;
