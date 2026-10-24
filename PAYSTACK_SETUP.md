# Paystack wallet deposits

The dashboard's **Add money** action starts a Paystack-hosted checkout. This first version supports NGN deposits only. The Paystack account must have the relevant payment channels enabled; bank transfer availability depends on Paystack's approval and account settings.

## Local test setup

1. In your Paystack dashboard, use **Test Mode** and copy the test secret key. Never use a public key here, and never paste a secret key into browser code, chat, or a committed file.
2. Put the test secret in the ignored `.env` file as `PAYSTACK_SECRET_KEY=sk_test_...`. `.env.example` is a template; it is safe to copy its variable names, but keep your real key only in `.env`.
3. Start the site from this folder with `node --env-file=.env server.js`, then sign in and click **Add money**.
4. Use Paystack's test payment details. Do not make a real payment while testing.

The server sends the amount to Paystack in kobo and uses the signed-in account's email. The wallet is credited only after the server verifies the transaction reference, success status, exact amount, and NGN currency. Repeated callbacks or webhooks do not credit the same deposit twice.

## Deploying

- On Render, create a persistent PostgreSQL database in the same region as the web service. In the web service's **Environment** settings, set `DATABASE_URL` to the database's **internal** connection URL. The app creates its tables at startup and refuses to start in production if this value is missing.
- Set the web service's build command to `npm install` and start command to `npm start`.
- Add these environment variables in the web service's **Environment** settings:
  - `NODE_ENV` = `production`
  - `HOST` = `0.0.0.0`
  - `APP_BASE_URL` = `https://toply.onrender.com` (use your actual Render service URL)
  - `PAYSTACK_CURRENCY` = `NGN`
  - `PAYSTACK_LIVE_ENABLED` = `false`
- Do not set `PORT`; Render supplies it automatically. Do not create or upload a `.env` file on GitHub.
- Keep `PAYSTACK_SECRET_KEY` unset and `PAYSTACK_LIVE_ENABLED=false` while setting up and checking the database. Do not enable live payments yet.
- The existing JSON files and accounts are not imported into PostgreSQL. Users will need to register again after the database-backed deployment.
- Once the database-backed deployment is verified and all production requirements are met, add your Paystack live secret directly in Render's environment settings and explicitly enable live payments. Never paste the secret into source code, GitHub, or chat.
- Configure the Paystack webhook URL as `https://toply.onrender.com/api/paystack/webhook` (replace the domain if your Render URL differs).
- Never commit `.env`, send the secret key to the browser, or expose the JSON data files publicly.
- A local `127.0.0.1` website cannot receive Paystack webhooks. The browser return can verify completed payments, while asynchronous bank transfers need the public webhook endpoint to update later.

This is an initial NGN deposit-and-balance prototype, not a worldwide multi-currency wallet. Paystack account support varies by country and currency. It also does not yet deduct wallet funds for airtime, data, or gift-card orders, or support withdrawals. Persistent storage alone does not make this prototype suitable for real customer funds; complete security, accounting, and compliance reviews first.
