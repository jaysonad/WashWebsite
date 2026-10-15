# Freshwave: local subscription and admin scaffold

This project is a static landing page plus a separate Node/Express backend and PostgreSQL database. The backend creates Stripe-hosted monthly Checkout Sessions; Stripe secret keys never go to browser code. Admin passwords are stored as scrypt hashes, and admin sessions are stored in PostgreSQL.

## Requirements

- Node.js 22 or newer
- Docker Desktop (for local PostgreSQL)
- A Stripe account in test mode for payment testing

## Run locally

1. Copy `.env.example` to `.env` and set a random `SESSION_SECRET` (at least 32 characters). Keep `.env` private; it is ignored by Git.
2. Start the database: `docker compose up -d db`
3. Install dependencies: `npm install`
4. Create tables: `npm run db:setup`
5. Set the admin login with `npm run admin:set-password`.
6. Start the site: `npm start`, then open http://localhost:4242. Admin login is at http://localhost:4242/admin.

## Stripe test checkout

In Stripe test mode, create a monthly recurring Product/Price. Put the `price_...` identifier in `STRIPE_MONTHLY_PRICE_ID` and a test secret key in `STRIPE_SECRET_KEY`. For local webhooks, install Stripe CLI and run `stripe listen --forward-to localhost:4242/api/stripe/webhook`; put its `whsec_...` signing secret in `STRIPE_WEBHOOK_SECRET`. Restart the server after changing `.env`. Use Stripe test card details from Stripe's documentation, never a real card during development.

Checkout is disabled until the secret key, signed webhook secret, and server-configured monthly Price ID are all present. Live keys also require `ALLOW_LIVE_CHECKOUT=true`, which is deliberately off by default. The checkout endpoint only accepts a server-configured Price ID. It does not accept an amount or Price ID from the browser. Subscription records are updated from signed Stripe webhooks, not from the checkout success redirect.

## Hosting plan

GitHub Pages can host the static frontend, but it cannot run this Express backend, securely hold Stripe secrets, or receive webhooks. When you are ready to launch, deploy the Node service and PostgreSQL database to a backend host, add HTTPS and production secrets there, then point the frontend to that backend or serve the frontend from the same app. Do not use this local development server as a public production service.

## Before accepting real subscriptions

Decide the actual pickup cadence, service area, plan contents and price; create and verify the corresponding live Stripe recurring Price; configure signed production webhooks; add customer consent, terms, privacy/refund details, and an operational process for failed payments and cancellations. The current admin page is a basic subscriber roster, not a full billing/customer portal. The landing page's subscription copy is still a concept, so do not enable live checkout until the service details are accurate.

## Maps

No Maps key is needed for the current page. If you later add an interactive browser map, use a separate browser key restricted to your production website referrers and only the Maps APIs that page needs. Never put a server-side Maps web-service key in browser code. A simple Google Maps directions link needs no API key.


