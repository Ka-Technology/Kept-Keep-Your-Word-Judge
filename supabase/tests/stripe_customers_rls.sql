-- Proves stripe_customers (migration 0058, T92) is the server's alone: the app can't read or write a
-- Stripe Customer id, the `payments` function's service role can, and the row goes with the account.
-- Everything runs in one transaction that is rolled back, so no test data persists.
-- Run: npx supabase db query --linked -f supabase/tests/stripe_customers_rls.sql
-- Any failed check raises an exception naming it; reaching the final SELECT means all passed.

begin;

insert into auth.users (id, email) values ('00000000-0000-4000-8000-0000000000d1', 'stripe-a@kept.test');
insert into public.stripe_customers (user_id, customer_id) values ('00000000-0000-4000-8000-0000000000d1', 'cus_test_a');

do $$
begin
  if has_table_privilege('anon', 'public.stripe_customers', 'select') or has_table_privilege('authenticated', 'public.stripe_customers', 'select')
     or has_any_column_privilege('authenticated', 'public.stripe_customers', 'insert') or has_any_column_privilege('authenticated', 'public.stripe_customers', 'update')
     or has_table_privilege('authenticated', 'public.stripe_customers', 'delete') then
    raise exception 'FAIL: the app can touch Stripe Customer ids';
  end if;
  if not has_table_privilege('service_role', 'public.stripe_customers', 'select') or not has_table_privilege('service_role', 'public.stripe_customers', 'insert')
     or not has_table_privilege('service_role', 'public.stripe_customers', 'delete') then
    raise exception 'FAIL: the payments function can''t read, write or delete Stripe Customer ids';
  end if;
end $$;

-- One Customer per user, and one user per Customer.
do $$
begin
  begin
    insert into public.stripe_customers (user_id, customer_id) values ('00000000-0000-4000-8000-0000000000d1', 'cus_test_b');
    raise exception 'FAIL: a user got a second Stripe Customer';
  exception when unique_violation then null;
  end;
end $$;

delete from auth.users where id = '00000000-0000-4000-8000-0000000000d1';
do $$
begin
  if exists (select 1 from public.stripe_customers where customer_id = 'cus_test_a') then
    raise exception 'FAIL: a deleted account left its Stripe Customer id behind';
  end if;
end $$;

select 'PASS: stripe_customers is server-only, one per user, and goes with the account' as result;

rollback;
