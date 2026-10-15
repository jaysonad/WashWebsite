import 'dotenv/config';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import express from 'express';
import session from 'express-session';
import connectPgSimple from 'connect-pg-simple';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import pg from 'pg';
import Stripe from 'stripe';

const { Pool } = pg;
const scrypt = promisify(crypto.scrypt);
const app = express();
const rootDir = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(rootDir, 'public');
const privateDir = path.join(rootDir, 'private');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const isProduction = process.env.NODE_ENV === 'production';
const publicUrl = process.env.PUBLIC_URL || 'http://localhost:4242';
const PgSession = connectPgSimple(session);
const stripeSecret = process.env.STRIPE_SECRET_KEY || '';
const stripe = stripeSecret ? new Stripe(stripeSecret) : null;
const liveCheckoutAllowed = !stripeSecret.startsWith('sk_live_') || process.env.ALLOW_LIVE_CHECKOUT === 'true';
const checkoutConfigured = Boolean(stripe && process.env.STRIPE_WEBHOOK_SECRET && process.env.STRIPE_MONTHLY_PRICE_ID && liveCheckoutAllowed);

if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) {
  throw new Error('Set SESSION_SECRET to a random value of at least 32 characters.');
}
if (isProduction && !publicUrl.startsWith('https://')) throw new Error('PUBLIC_URL must use HTTPS in production.');

app.disable('x-powered-by');
app.set('trust proxy', isProduction ? 1 : false);
app.use(helmet({ contentSecurityPolicy: { directives: { defaultSrc: ["'self'"], styleSrc: ["'self'", 'https://fonts.googleapis.com'], fontSrc: ["'self'", 'https://fonts.gstatic.com'], imgSrc: ["'self'", 'data:'], scriptSrc: ["'self'"] } } }));

// Stripe requires the unparsed request body to verify its webhook signature.
app.post('/api/stripe/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  if (!stripe || !process.env.STRIPE_WEBHOOK_SECRET) return res.sendStatus(503);
  let event;
  try { event = stripe.webhooks.constructEvent(req.body, req.get('stripe-signature'), process.env.STRIPE_WEBHOOK_SECRET); }
  catch { return res.status(400).send('Invalid webhook signature'); }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const inserted = await client.query('INSERT INTO processed_stripe_events(event_id) VALUES($1) ON CONFLICT DO NOTHING RETURNING event_id', [event.id]);
    if (!inserted.rowCount) { await client.query('COMMIT'); return res.sendStatus(200); }
    let sub = event.data.object;
    if (event.type === 'checkout.session.completed' && sub.mode === 'subscription' && sub.subscription) {
      sub = await stripe.subscriptions.retrieve(sub.subscription);
    }
    if (event.type.startsWith('customer.subscription.') || event.type === 'checkout.session.completed') {
      if (sub.object === 'subscription') {
        const item = sub.items?.data?.[0];
        const customer = typeof sub.customer === 'string' ? sub.customer : sub.customer?.id;
        const customerEmail = typeof sub.customer === 'object' ? sub.customer.email : null;
        const email = customerEmail || sub.metadata?.email || null;
        await client.query(`INSERT INTO subscriptions(stripe_subscription_id,stripe_customer_id,email,status,price_id,current_period_end,updated_at)
          VALUES($1,$2,$3,$4,$5,to_timestamp($6),now()) ON CONFLICT(stripe_subscription_id) DO UPDATE SET
          stripe_customer_id=EXCLUDED.stripe_customer_id,email=COALESCE(EXCLUDED.email,subscriptions.email),status=EXCLUDED.status,
          price_id=EXCLUDED.price_id,current_period_end=EXCLUDED.current_period_end,updated_at=now()`,
          [sub.id, customer, email, sub.status, item?.price?.id || null, sub.current_period_end || null]);
      }
    }
    await client.query('COMMIT');
    res.sendStatus(200);
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Stripe webhook processing failed:', error.message);
    res.sendStatus(500);
  } finally { client.release(); }
});

app.use(express.json({ limit: '20kb' }));
app.use(session({
  store: new PgSession({ pool, createTableIfMissing: true }),
  name: 'freshwave.sid',
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, secure: isProduction, sameSite: 'strict', maxAge: 8 * 60 * 60 * 1000 }
}));

// Browser writes must originate from this site; cookies are also SameSite=Strict.
app.use('/api', (req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method) || req.path === '/stripe/webhook') return next();
  if (req.get('origin') !== publicUrl) return res.status(403).json({ error: 'Request origin is not allowed.' });
  next();
});
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 8, standardHeaders: 'draft-7', legacyHeaders: false });
function requireAdmin(req, res, next) {
  if (!req.session.adminId) return res.status(401).json({ error: 'Sign in required.' });
  next();
}

app.get('/admin', (req, res) => {
  if (!req.session.adminId) return res.redirect('/admin-login.html');
  res.set('Cache-Control', 'no-store').sendFile(path.join(privateDir, 'admin.html'));
});
app.get('/admin-login.html', (_req, res) => res.sendFile(path.join(publicDir, 'admin-login.html')));
app.post('/api/admin/login', loginLimiter, async (req, res, next) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    if (password.length > 1024) return res.status(400).json({ error: 'Invalid email or password.' });
    const { rows } = await pool.query('SELECT id,password_salt,password_hash FROM admins WHERE email=$1', [email]);
    const admin = rows[0];
    if (!admin) { await scrypt(password, 'freshwave-dummy-salt', 64); return res.status(401).json({ error: 'Invalid email or password.' }); }
    const actual = await scrypt(password, Buffer.from(admin.password_salt, 'hex'), 64);
    const expected = Buffer.from(admin.password_hash, 'hex');
    if (expected.length !== actual.length || !crypto.timingSafeEqual(actual, expected)) return res.status(401).json({ error: 'Invalid email or password.' });
    await new Promise((resolve, reject) => req.session.regenerate(error => error ? reject(error) : resolve()));
    req.session.adminId = admin.id;
    res.json({ ok: true });
  } catch (error) { next(error); }
});
app.post('/api/admin/logout', requireAdmin, (req, res, next) => req.session.destroy(error => error ? next(error) : res.sendStatus(204)));
app.get('/api/admin/subscriptions', requireAdmin, async (_req, res, next) => {
  try {
    const { rows } = await pool.query('SELECT stripe_subscription_id,email,status,price_id,current_period_end,updated_at FROM subscriptions ORDER BY updated_at DESC LIMIT 500');
    res.set('Cache-Control', 'no-store').json(rows);
  } catch (error) { next(error); }
});
const checkoutLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 12, standardHeaders: 'draft-7', legacyHeaders: false });
app.post('/api/checkout', checkoutLimiter, async (req, res, next) => {
  if (!checkoutConfigured) return res.status(503).json({ error: 'Monthly checkout is not configured for use yet.' });
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return res.status(400).json({ error: 'Enter a valid email address.' });
    const checkout = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price: process.env.STRIPE_MONTHLY_PRICE_ID, quantity: 1 }],
      customer_email: email,
      success_url: `${publicUrl}/success.html`,
      cancel_url: `${publicUrl}/#membership`,
      subscription_data: { metadata: { email } }
    });
    res.json({ url: checkout.url });
  } catch (error) { next(error); }
});
app.get('/api/status', (_req, res) => res.json({ checkoutEnabled: checkoutConfigured }));
app.use(express.static(publicDir, { index: 'index.html', dotfiles: 'deny', etag: true, maxAge: isProduction ? '1h' : 0 }));
app.use((error, _req, res, _next) => {
  console.error(error.message);
  res.status(500).json({ error: 'Something went wrong. Please try again.' });
});
const port = Number(process.env.PORT || 4242);
app.listen(port, () => console.log(`Freshwave running at ${publicUrl}`));




