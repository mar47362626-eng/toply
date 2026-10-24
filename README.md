# Toply

Toply is a Node.js web app for airtime, data, gift-card previews, accounts, and a Paystack NGN wallet-deposit prototype.

## Run locally

Use Node.js 20.6 or newer. Add your Paystack test key to a local `.env` file using `.env.example` as a template, then run:

```sh
node --env-file=.env server.js
```

Open `http://localhost:3000`. See [PAYSTACK_SETUP.md](./PAYSTACK_SETUP.md) for payment setup.

## Data and hosting

Local development without Supabase credentials stores account, session, order, and wallet data in JSON files. To use Supabase, set `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`; the Node.js server uses these credentials to access the private tables. Production startup requires both values and verifies that the tables exist.

Create the `toply_users`, `toply_sessions`, `toply_orders`, and `toply_wallet_transactions` tables in Supabase before deploying. Enable Row Level Security and do not add public access policies: the service-role key is used only by the server and bypasses RLS. Never put it in browser code, GitHub, or chat.

Local JSON data is not automatically imported into Supabase. Accounts and balances currently on the old Render deployment will not appear in the new database; users will need to register again. The wallet remains a prototype and is not ready to hold real customer funds.

GitHub Pages cannot run this app's Node.js API. Hosting it publicly requires a Node.js web-service host.