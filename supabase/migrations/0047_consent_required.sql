-- Consent is still required (fix to 0046, 2026-10-04). 0046's trigger set consented_at to now() on
-- every new challenge, which also filled it in when the app sent none, so a challenge without its
-- signed promise was accepted (challenges_rls.sql: "a challenge without consent was accepted"). The
-- app still has to send it, as when the column alone refused a null (0004); the database only sets
-- when it happened. Proven by challenges_rls.sql and hardening_rls.sql.

create or replace function public.challenges_consent_time() returns trigger
  language plpgsql set search_path = ''
  as $$
begin
  if new.consented_at is null then
    raise exception 'null value in column "consented_at" violates not-null constraint' using errcode = '23502';
  end if;
  new.consented_at := now();
  return new;
end $$;
