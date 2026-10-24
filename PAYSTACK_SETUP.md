# Paystack wallet deposits

The dashboard's **Add money** action starts a Paystack-hosted checkout. This first version supports NGN deposits only. The Paystack account must have the relevant payment channels enabled; bank transfer availability depends on Paystack's approval and account settings.

## Local test setup

1. In your Paystack dashboard, use **Test Mode** and copy the test secret key. Never use a public key here, and never paste a secret key into browser code, chat, or a committed file.
2. Put the test secret in the ignored `.env` file as `PAYSTACK_SECRET_KEY=sk_test_...`. `.env.example` is a template; it is safe to copy its variable names, but keep your real key only in `.env`.
3. Start the site from this folder with `node --env-file=.env server.js`, then sign in and click **Add money**.
4. Use Paystack's test payment details. Do not make a real payment while testing.

The server sends the amount to Paystack in kobo and uses the signed-in account's email. The wallet is credited only after the server verifies the transaction reference, success status, exact amount, and NGN currency. Repeated callbacks or webhooks do not credit the same deposit twice.

## Deploying

- In Supabase, create the four private Toply tables using the SQL schema below. Enable Row Level Security and do not add public access policies.
- Set the web service's build command to `npm install` and start command to `npm start`.
- Add these environment variables in the web service's **Environment** settings:
  - `NODE_ENV` = `production`
  - `HOST` = `0.0.0.0`
  - `APP_BASE_URL` = `https://toply.onrender.com` (use your actual Render service URL)
  - `SUPABASE_URL` = your Supabase Project URL, such as `https://your-project-id.supabase.co`
  - `SUPABASE_SERVICE_ROLE_KEY` = your Supabase server-only service-role key
  - `PAYSTACK_CURRENCY` = `NGN`
  - `PAYSTACK_LIVE_ENABLED` = `false`
- Do not set `PORT`; Render supplies it automatically. Do not create or upload a `.env` file on GitHub.
- Get the Project URL and service-role key from your Supabase project's API settings. Add them directly in Render; never paste the service-role key into browser code, GitHub, or chat. The server checks that all four tables exist at startup.
- Keep `PAYSTACK_SECRET_KEY` unset and `PAYSTACK_LIVE_ENABLED=false` while setting up and checking the database. Do not enable live payments yet.
- The existing JSON files and accounts are not imported into PostgreSQL. Users will need to register again after the database-backed deployment.
- Once the database-backed deployment is verified and all production requirements are met, add your Paystack live secret directly in Render's environment settings and explicitly enable live payments. Never paste the secret into source code, GitHub, or chat.
- Configure the Paystack webhook URL as `https://toply.onrender.com/api/paystack/webhook` (replace the domain if your Render URL differs).
- Never commit `.env`, send the secret key to the browser, or expose the JSON data files publicly.
- A local `127.0.0.1` website cannot receive Paystack webhooks. The browser return can verify completed payments, while asynchronous bank transfers need the public webhook endpoint to update later.
- For optional Nigeria airtime/data sandbox tests, follow the VTpass setup below. Do not enable its live endpoint or use live VTpass credentials with this integration.

This is an NGN wallet prototype, not a worldwide multi-currency wallet. The optional live VTpass flow supports only Nigerian airtime and data and deducts the exact NGN provider plan/airtime amount. Gift cards and other countries remain previews. Paystack account support varies by country and currency. Do not enable live purchases until Supabase, VTpass live access, Paystack live funding, reconciliation, support, and required compliance checks have all been verified.

### VTpass Nigeria sandbox (airtime/data tests only)

1. Create a sandbox account at [sandbox.vtpass.com/register](https://sandbox.vtpass.com/register).
2. In the sandbox account's **API Keys** settings, generate the API key, public key, and secret key. VTpass documents public-key headers for GET requests and secret-key headers for POST requests.
3. Add these variables directly in Render's Environment settings:
   - `VTPASS_ENV` = `sandbox`
   - `VTPASS_API_KEY` = sandbox API key
   - `VTPASS_PUBLIC_KEY` = sandbox public key
   - `VTPASS_SECRET_KEY` = sandbox secret key
4. Redeploy and check the airtime/data pages. For Nigeria, when sandbox credentials are configured, data plans load from VTpass and order submissions use its sandbox API. VTpass says its sandbox wallet has default test funds and is debited during sandbox transactions.
5. These calls do **not** debit the customer's Toply wallet and do not deliver real airtime/data. They are provider integration tests only. Non-Nigerian destinations and gift cards remain saved previews.

### Preparing real VTpass wallet purchases

Live purchases are disabled by default. VTpass must approve/provision a live account first; sandbox credentials cannot make real top-ups. Resolve the Supabase connectivity failure from the Render logs and run the SQL below before switching modes. Never place any secret keys in the browser or GitHub.

1. Ask VTpass for live API provisioning and confirm that live airtime and data services are enabled on your account.
2. In Supabase SQL Editor, run the three wallet/order RPC functions below. These serialize wallet debits, prevent the same order reference being debited twice, reject insufficient balances, create idempotent refunds, and ensure only one server request submits an order to VTpass.
3. Configure Render with the **live** VTpass keys from your approved live account and set:
   - `VTPASS_ENV` = `live`
   - `VTPASS_LIVE_ENABLED` = `true`
   - `PAYSTACK_LIVE_ENABLED` = `true` only after Paystack has approved your live account and you have verified live funding
4. Redeploy and make a small test using an account funded with a small NGN balance. A pending order keeps its debit until VTpass confirms delivery or failure. Use **Check status** on the order to requery; do not submit the same purchase again while pending.
5. If Render still shows `Supabase table toply_users is not ready: TypeError: fetch failed`, stop here. Check that `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in Render belong to the same Supabase project and that its project is reachable. Never paste either secret into chat.

Do not use the service with customer money until you have confirmed provider settlement, tested failure/refund handling, set up support and reconciliation, and checked local legal/payment requirements. The code cannot activate a VTpass account or prove that the live credentials work.

Official VTpass references: [sandbox/live integration](https://www.vtpass.com/documentation/integrating-api/), [API key authentication](https://www.vtpass.com/documentation/authentication/), [airtime API](https://www.vtpass.com/documentation/airtime-vtu-api/), [data API](https://www.vtpass.com/documentation/data-subscription-api/), [variation codes](https://www.vtpass.com/documentation/variation-codes/), and [transaction requery](https://www.vtpass.com/documentation/re-query-services/).

### Supabase SQL schema

Run this in the Supabase SQL Editor before deploying:

```sql
create table if not exists public.toply_users (
  id text primary key,
  name text not null,
  email text not null unique,
  password_hash text not null,
  created_at text not null
);

create table if not exists public.toply_sessions (
  token_hash text primary key,
  user_id text not null references public.toply_users(id) on delete cascade,
  expires_at bigint not null
);
create index if not exists toply_sessions_expiry_idx
  on public.toply_sessions(expires_at);

create table if not exists public.toply_orders (
  id text primary key,
  user_id text not null references public.toply_users(id),
  order_type text not null,
  created_at text not null,
  data jsonb not null
);
create index if not exists toply_orders_user_created_idx
  on public.toply_orders(user_id, created_at desc);

create table if not exists public.toply_wallet_transactions (
  id text primary key,
  user_id text not null references public.toply_users(id),
  reference text not null unique,
  type text not null,
  amount_minor bigint not null,
  currency text not null,
  status text not null,
  created_at text not null,
  paystack_transaction_id text,
  confirmed_at text
);
create index if not exists toply_wallet_user_created_idx
  on public.toply_wallet_transactions(user_id, created_at desc);

alter table public.toply_users enable row level security;
alter table public.toply_sessions enable row level security;
alter table public.toply_orders enable row level security;
alter table public.toply_wallet_transactions enable row level security;

revoke all on public.toply_users from anon, authenticated;
revoke all on public.toply_sessions from anon, authenticated;
revoke all on public.toply_orders from anon, authenticated;
revoke all on public.toply_wallet_transactions from anon, authenticated;
```

After the schema above, run these wallet functions in the same Supabase SQL Editor:

```sql
create or replace function public.toply_debit_wallet(
  p_user_id text,
  p_reference text,
  p_amount_minor bigint,
  p_currency text
) returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_existing public.toply_wallet_transactions%rowtype;
  v_balance bigint;
begin
  if p_amount_minor <= 0 or p_currency <> 'NGN' then
    raise exception 'INVALID_PURCHASE_AMOUNT';
  end if;

  perform 1 from public.toply_users where id = p_user_id for update;
  if not found then
    raise exception 'USER_NOT_FOUND';
  end if;

  select * into v_existing
    from public.toply_wallet_transactions where reference = p_reference;
  if found then
    if v_existing.user_id <> p_user_id or v_existing.type <> 'purchase'
       or v_existing.amount_minor <> p_amount_minor or v_existing.currency <> p_currency
       or v_existing.status <> 'success' then
      raise exception 'PURCHASE_REFERENCE_CONFLICT';
    end if;
    select coalesce(sum(case when type = 'purchase' then -amount_minor else amount_minor end), 0)::bigint
      into v_balance from public.toply_wallet_transactions
      where user_id = p_user_id and currency = p_currency and status = 'success';
    return v_balance;
  end if;

  select coalesce(sum(case when type = 'purchase' then -amount_minor else amount_minor end), 0)::bigint
    into v_balance from public.toply_wallet_transactions
    where user_id = p_user_id and currency = p_currency and status = 'success';
  if v_balance < p_amount_minor then
    raise exception 'INSUFFICIENT_BALANCE';
  end if;

  insert into public.toply_wallet_transactions
    (id, user_id, reference, type, amount_minor, currency, status, created_at)
  values
    (gen_random_uuid()::text, p_user_id, p_reference, 'purchase', p_amount_minor,
     p_currency, 'success', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));

  return v_balance - p_amount_minor;
end;
$$;

create or replace function public.toply_refund_wallet(
  p_user_id text,
  p_purchase_reference text,
  p_refund_reference text,
  p_amount_minor bigint,
  p_currency text
) returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_purchase public.toply_wallet_transactions%rowtype;
  v_existing public.toply_wallet_transactions%rowtype;
  v_balance bigint;
begin
  perform 1 from public.toply_users where id = p_user_id for update;
  if not found then
    raise exception 'USER_NOT_FOUND';
  end if;

  select * into v_purchase from public.toply_wallet_transactions
    where reference = p_purchase_reference and user_id = p_user_id;
  if not found or v_purchase.type <> 'purchase' or v_purchase.status <> 'success'
     or v_purchase.amount_minor <> p_amount_minor or v_purchase.currency <> p_currency then
    raise exception 'PURCHASE_NOT_REFUNDABLE';
  end if;

  select * into v_existing from public.toply_wallet_transactions
    where reference = p_refund_reference;
  if found then
    if v_existing.user_id <> p_user_id or v_existing.type <> 'refund'
       or v_existing.amount_minor <> p_amount_minor or v_existing.currency <> p_currency
       or v_existing.status <> 'success' then
      raise exception 'REFUND_REFERENCE_CONFLICT';
    end if;
  else
    insert into public.toply_wallet_transactions
      (id, user_id, reference, type, amount_minor, currency, status, created_at)
    values
      (gen_random_uuid()::text, p_user_id, p_refund_reference, 'refund',
       p_amount_minor, p_currency, 'success', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
  end if;

  select coalesce(sum(case when type = 'purchase' then -amount_minor else amount_minor end), 0)::bigint
    into v_balance from public.toply_wallet_transactions
    where user_id = p_user_id and currency = p_currency and status = 'success';
  return v_balance;
end;
$$;

create or replace function public.toply_claim_vtpass_order(
  p_user_id text,
  p_order_id text
) returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_claimed boolean;
begin
  update public.toply_orders
    set data = jsonb_set(
      jsonb_set(data, '{providerAttempted}', 'true'::jsonb, true),
      '{providerAttemptedAt}', to_jsonb(to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')), true
    )
    where id = p_order_id
      and user_id = p_user_id
      and data->>'status' = 'pending'
      and coalesce(data->>'providerAttempted', 'false') <> 'true'
    returning true into v_claimed;
  return coalesce(v_claimed, false);
end;
$$;

revoke all on function public.toply_debit_wallet(text, text, bigint, text) from public;
revoke all on function public.toply_refund_wallet(text, text, text, bigint, text) from public;
revoke all on function public.toply_claim_vtpass_order(text, text) from public;
grant execute on function public.toply_debit_wallet(text, text, bigint, text) to service_role;
grant execute on function public.toply_refund_wallet(text, text, text, bigint, text) to service_role;
grant execute on function public.toply_claim_vtpass_order(text, text) to service_role;
```
