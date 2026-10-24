# Toply

Toply is a Node.js web app for airtime, data, gift-card previews, accounts, and a Paystack NGN wallet-deposit prototype.

## Run locally

Use Node.js 20.6 or newer. Add your Paystack test key to a local `.env` file using `.env.example` as a template, then run:

```sh
node --env-file=.env server.js
```

Open `http://localhost:3000`. See [PAYSTACK_SETUP.md](./PAYSTACK_SETUP.md) for payment setup.

## Data and hosting

Account, session, order, and wallet data is stored in local JSON files. These files and `.env` are excluded from Git because they can contain private data. This storage is for local development only; a hosted deployment needs persistent database storage. Do not use this prototype to hold real customer funds.

GitHub Pages cannot run this app's Node.js API. Hosting it publicly requires a Node.js web-service host.