-- Signed with your full name, drawn or adopted (T203, plan.md decision 171): a challenge's promise names the
-- challenger by their first and last name, and they sign it with a finger or by adopting their name in script.
-- Kept keeps the signature, the name, the time and the exact text they signed, readable only by them: friends
-- read challenge rows (0012), so none of it is stored there.
--
-- The app sends it with the challenge, as `signature` ({kind, strokes, contract_text}). A trigger moves it into
-- challenge_signatures in the same insert and clears it, so a challenge and its signature are written together
-- or not at all; the foreign key waits for the end of the transaction, since the challenge row doesn't exist yet
-- when its signature is written. The name comes from the profile, never from the app, and a signature without
-- one is refused. A challenge sent without a signature (older builds, the owner, server jobs) is still taken;
-- consented_at (0046) records when it was agreed to either way.
--
-- strokes is an SVG path in a 300 × 100 box (signaturePath() in src/lib/signature.ts), checked here so it holds
-- only M and L commands with numbers.
-- Proven by supabase/tests/signatures_rls.sql.

create table public.challenge_signatures (
  challenge_id  uuid primary key references public.challenges on delete cascade deferrable initially deferred,
  user_id       uuid not null references auth.users on delete cascade,
  kind          text not null check (kind in ('drawn', 'adopted')),
  signed_name   text not null check (char_length(signed_name) between 3 and 101),
  strokes       text check (
                  char_length(strokes) <= 20000
                  and strokes ~ '^(M[0-9]+(\.[0-9])? [0-9]+(\.[0-9])?(L[0-9]+(\.[0-9])? [0-9]+(\.[0-9])?)+)+$'
                ),
  contract_text text not null check (char_length(contract_text) between 1 and 10000),
  signed_at     timestamptz not null default now(),
  constraint challenge_signatures_strokes_when_drawn check ((kind = 'drawn') = (strokes is not null))
);

alter table public.challenge_signatures enable row level security;
revoke all on public.challenge_signatures from anon, authenticated;
grant select on public.challenge_signatures to authenticated;

-- Only the signer reads it; it's written only by the trigger below, and never changed.
create policy "own signatures read" on public.challenge_signatures
  for select to authenticated using (user_id = (select auth.uid()));

alter table public.challenges
  add column signature jsonb,
  -- It only passes through: the trigger has always cleared it by the time the row is checked.
  add constraint challenges_signature_moved check (signature is null);
grant insert (signature) on public.challenges to authenticated;

-- Definer, to write a table the signer can only read.
create function public.challenges_signature() returns trigger
  language plpgsql security definer set search_path = ''
  as $$
declare
  signer text;
begin
  if new.signature is null then
    return new;
  end if;
  select p.first_name || ' ' || p.last_name into signer from public.profiles p where p.id = new.user_id;
  if signer is null then
    raise exception 'name_required' using errcode = '23514';
  end if;
  insert into public.challenge_signatures (challenge_id, user_id, kind, signed_name, strokes, contract_text)
  values (new.id, new.user_id, new.signature ->> 'kind', signer, new.signature ->> 'strokes', new.signature ->> 'contract_text');
  new.signature := null;
  return new;
end $$;

create trigger challenges_signature before insert on public.challenges
  for each row execute function public.challenges_signature();

revoke execute on function public.challenges_signature() from public, anon, authenticated;
