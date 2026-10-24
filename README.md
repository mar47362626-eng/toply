# Toply

Toply is a Node.js web app for airtime, data, gift-card previews, accounts, and a Paystack NGN wallet-deposit prototype.

## Run locally

Use Node.js 20.6 or newer. Add your Paystack test key to a local `.env` file using `.env.example` as a template, then run:

```sh
node --env-file=.env server.js
```

Open `http://localhost:3000`. See [PAYSTACK_SETUP.md](./PAYSTACK_SETUP.md) for payment setup.

## Data and hosting

Local development without `DATABASE_URL` stores account, session, order, and wallet data in JSON files. With `DATABASE_URL`, the app uses PostgreSQL for those records. Production startup requires `DATABASE_URL`; attach a persistent PostgreSQL database to the Render web service and set it to the database's **internal** connection URL.

Local JSON data is not automatically imported into PostgreSQL. Accounts and balances currently on the old Render deployment will not appear in the new database; users will need to register again. The wallet remains a prototype and is not ready to hold real customer funds.

GitHub Pages cannot run this app's Node.js API. Hosting it publicly requires a Node.js web-service host.