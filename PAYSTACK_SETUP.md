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

This is an initial NGN deposit-and-balance prototype, not a worldwide multi-currency wallet. Paystack account support varies by country and currency. It also does not yet deduct wallet funds for airtime, data, or gift-card orders, or support withdrawals. Persistent storage alone does not make this prototype suitable for real customer funds; complete security, accounting, and compliance reviews first.

### VTpass Nigeria sandbox (airtime/data tests only)

1. Create a sandbox account at [sandbox.vtpass.com/register](https://sandbox.vtpass.com/register).
2. In the sandbox account's **API Keys** settings, generate the API key, public key, and secret key. VTpass documents public-key headers for GET requests and secret-key headers for POST requests.
3. Add these variables directly in Render's Environment settings:
   - `VTPASS_ENV` = `sandbox`
   - `VTPASS_API_KEY` = sandbox API key
   - `VTPASS_PUBLIC_KEY` = sandbox public key
   - `VTPASS_SECRET_KEY` = sandbox secret key
4. Redeploy and check the airtime/data pages. For Nigeria, when sandbox credentials are configured, data plans load from VTpass and order submissions use its sandbox API. VTpass says its sandbox wallet has default test funds and is debited during sandbox transactions.
5. These calls do **not** debit the customer's Toply wallet and do not deliver real airtime/data. They are provider integration tests only. Non-Nigerian destinations and gift cards remain saved previews. Do not use live VTpass credentials or live endpoints.

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
