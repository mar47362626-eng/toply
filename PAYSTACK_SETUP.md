# Paystack wallet deposits

The dashboard's **Add money** action starts a Paystack-hosted checkout. This first version supports NGN deposits only. The Paystack account must have the relevant payment channels enabled; bank transfer availability depends on Paystack's approval and account settings.

## Local test setup

1. In your Paystack dashboard, use **Test Mode** and copy the test secret key. Never use a public key here, and never paste a secret key into browser code, chat, or a committed file.
2. Put the test secret in the ignored `.env` file as `PAYSTACK_SECRET_KEY=sk_test_...`. `.env.example` is a template; it is safe to copy its variable names, but keep your real key only in `.env`.
3. Start the site from this folder with `node --env-file=.env server.js`, then sign in and click **Add money**.
4. Use Paystack's test payment details. Do not make a real payment while testing.

The server sends the amount to Paystack in kobo and uses the signed-in account's email. The wallet is credited only after the server verifies the transaction reference, success status, exact amount, and NGN currency. Repeated callbacks or webhooks do not credit the same deposit twice.

## Deploying

- On Render, create a **Web Service** from the GitHub repository, use `node server.js` as the start command, and add these environment variables in the service's **Environment** settings:
  - `NODE_ENV` = `production`
  - `HOST` = `0.0.0.0`
  - `APP_BASE_URL` = your Render service's full HTTPS URL, such as `https://toply-example.onrender.com` (replace this with the URL Render assigns)
  - `PAYSTACK_CURRENCY` = `NGN`
  - `PAYSTACK_LIVE_ENABLED` = `false`
- Do not set `PORT`; Render supplies it automatically. Do not create or upload a `.env` file on GitHub.
- Leave `PAYSTACK_SECRET_KEY` unset to keep Paystack deposits disabled. Never use a live key until you are ready to accept real payments and have completed the production requirements below.
- Set `APP_BASE_URL` to the public website origin, for example `https://example.com`.
- Configure the Paystack webhook URL as `https://example.com/api/paystack/webhook`.
- Deploy behind HTTPS. In production, set `PAYSTACK_LIVE_ENABLED=true` only after replacing the test secret with the correct live secret and completing Paystack's account and business approvals.
- Never commit `.env`, send the secret key to the browser, or expose the JSON data files publicly.
- A local `127.0.0.1` website cannot receive Paystack webhooks. The browser return can verify completed payments, while asynchronous bank transfers need the public webhook endpoint to update later.

This is an initial NGN deposit-and-balance prototype, not a worldwide multi-currency wallet. Paystack account support varies by country and currency. It also does not yet deduct wallet funds for airtime, data, or gift-card orders, or support withdrawals. The current JSON-file storage is for local development only; use a transactional database and complete security, accounting, and compliance reviews before holding customer funds in production.
