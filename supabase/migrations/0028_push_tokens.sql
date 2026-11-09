-- Push notifications, part 1 (T34, SPEC-notifications.md): each phone's Expo push token, and the
-- "Check-ins to review" push to eligible friends. Proven by supabase/tests/notifications_rls.sql.

-- One row per phone. A token belongs to one account at a time: register_push_token() moves it when
-- another account signs in on the same phone. The switches are per phone (Settings → Notifications).
create table public.push_tokens (
  token      text primary key check (token ~ '^Expo(nent)?PushToken\[[^]]+\]$'),
  user_id    uuid not null references auth.users(id) on delete cascade,
  reviews    boolean not null default true,
  updated_at timestamptz not null default now()
);

create index push_tokens_user on public.push_tokens (user_id);

alter table public.push_tokens enable row level security;
revoke all on public.push_tokens from anon, authenticated;
grant select, delete on public.push_tokens to authenticated;
grant update (reviews) on public.push_tokens to authenticated;

create policy "Own push tokens: read" on public.push_tokens for select to authenticated
  using (user_id = (select auth.uid()));
create policy "Own push tokens: change the switches" on public.push_tokens for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "Own push tokens: delete (sign-out)" on public.push_tokens for delete to authenticated
  using (user_id = (select auth.uid()));

-- Stores this phone's token for the caller. If another account had it, the row starts over as the
-- caller's, with every switch back on. Registering again only touches updated_at.
create function public.register_push_token(token text) returns void
  language plpgsql security definer set search_path = ''
  as $$
  begin
    delete from public.push_tokens t where t.token = register_push_token.token and t.user_id <> (select auth.uid());
    insert into public.push_tokens (token, user_id) values (register_push_token.token, (select auth.uid()))
      on conflict on constraint push_tokens_pkey do update set updated_at = now();
  end
  $$;

revoke execute on function public.register_push_token(text) from public, anon;
grant execute on function public.register_push_token(text) to authenticated;

-- The phones to push about a check-in: its challenger's friends who may review it (accepted before
-- Day 1, like can_review()), with "Check-ins to review" on. Only the notify function calls it.
create function public.review_push_tokens(check_in uuid) returns table (token text)
  language sql stable security definer set search_path = ''
  as $$
    select t.token
    from public.check_ins ci
    join public.challenges c on c.id = ci.challenge_id
    join public.friendships f
      on f.status = 'accepted'
     and c.user_id in (f.requester_id, f.addressee_id)
     and f.accepted_at < (c.start_date::timestamp at time zone c.time_zone)
    join public.push_tokens t
      on t.user_id = case when f.requester_id = c.user_id then f.addressee_id else f.requester_id end
     and t.reviews
    where ci.id = check_in
  $$;

revoke execute on function public.review_push_tokens(uuid) from public, anon, authenticated;
grant execute on function public.review_push_tokens(uuid) to service_role;

-- Calls the notify Edge Function through pg_net, with the Vault's project URL and secret key (the
-- same secrets as the ai-check Cron, 0016). pg_net sends after the transaction commits, so a rolled
-- back change never pushes, and a failed push never touches the change.
create function public.call_notify(payload jsonb) returns void
  language sql security definer set search_path = ''
  as $$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/notify',
      body := payload,
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'apikey', (select decrypted_secret from vault.decrypted_secrets where name = 'secret_key')
      )
    );
  $$;

revoke execute on function public.call_notify(jsonb) from public, anon, authenticated;

-- A check-in starts waiting for friends: checked in (#1), or a new photo after a flag (#12), which
-- the push words differently (`new_photo`).
create function public.check_ins_notify() returns trigger
  language plpgsql security definer set search_path = ''
  as $$
  begin
    if new.status = 'pending' and (tg_op = 'INSERT' or old.status = 'flagged') then
      perform public.call_notify(jsonb_build_object('check_in', new.id, 'new_photo', tg_op = 'UPDATE'));
    end if;
    return null;
  end
  $$;

-- Runs as a trigger only (the privilege is checked when the trigger is created, not when it fires).
revoke execute on function public.check_ins_notify() from public, anon, authenticated;

create trigger check_ins_notify after insert or update of status on public.check_ins
  for each row execute function public.check_ins_notify();
