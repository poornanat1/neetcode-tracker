import { createHash, createHmac, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const derive = promisify(scrypt);
const sessionName = 'practice_session';
const sessionDays = 30;
const digest = token => createHash('sha256').update(token).digest('hex');
const sessionToken = request => request.headers.cookie?.match(/(?:^|;\s*)practice_session=([a-f0-9]{64})(?:;|$)/)?.[1];

export const authSchema = `
  CREATE TABLE IF NOT EXISTS accounts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email_hash text UNIQUE NOT NULL,
    password_salt text NOT NULL,
    password_hash text NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash text PRIMARY KEY,
    account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    expires_at timestamptz NOT NULL
  );
`;

export function createAuth(pool, { emailKey, secureCookies }) {
  const attempts = new Map();
  let windowStart = 0;
  let total = 0;
  const cookie = (value, age) =>
    `${sessionName}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${age}${secureCookies ? '; Secure' : ''}`;

  async function account(request) {
    const token = sessionToken(request);
    if (!token) return null;
    const { rows: [session] } = await pool.query(
      'SELECT account_id FROM sessions WHERE token_hash = $1 AND expires_at > now()', [digest(token)]
    );
    return session?.account_id ?? null;
  }

  async function handle(path, body, request, response, json) {
    const token = sessionToken(request);
    if (path === '/api/auth/sign-out') {
      if (token) await pool.query('DELETE FROM sessions WHERE token_hash = $1', [digest(token)]);
      response.setHeader('Set-Cookie', cookie('', 0));
      return json(200, { ok: true });
    }

    const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
    const password = body?.password;
    const signup = path === '/api/auth/sign-up';
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
        typeof password !== 'string' || password.length < (signup ? 12 : 1) || password.length > 128) {
      return json(400, { error: signup ? 'Enter an email and a password of 12–128 characters.' : 'Enter a valid email and password.' });
    }

    const emailHash = createHmac('sha256', emailKey).update(email).digest('hex');
    if (Date.now() - windowStart >= 60_000) {
      attempts.clear();
      windowStart = Date.now();
      total = 0;
    }
    const count = (attempts.get(emailHash) || 0) + 1;
    if (total >= 120 || count > 8) return json(429, { error: 'Too many attempts. Try again in a minute.' });
    total++;
    attempts.set(emailHash, count);

    let user;
    if (signup) {
      const salt = randomBytes(16).toString('hex');
      const hash = (await derive(password, salt, 64)).toString('hex');
      ({ rows: [user] } = await pool.query(
        'INSERT INTO accounts (email_hash, password_salt, password_hash) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING RETURNING id',
        [emailHash, salt, hash]
      ));
      if (!user) return json(409, { error: 'Could not create this account. If you already registered, sign in.' });
    } else {
      ({ rows: [user] } = await pool.query(
        'SELECT id, password_salt, password_hash FROM accounts WHERE email_hash = $1', [emailHash]
      ));
      const actual = await derive(password, user?.password_salt ?? emailHash, 64);
      const expected = Buffer.from(user?.password_hash ?? '0'.repeat(128), 'hex');
      if (!timingSafeEqual(actual, expected) || !user) return json(401, { error: 'Email or password is incorrect.' });
    }

    await pool.query('DELETE FROM sessions WHERE expires_at <= now() OR token_hash = $1', [token ? digest(token) : null]);
    const session = randomBytes(32).toString('hex');
    await pool.query("INSERT INTO sessions VALUES ($1, $2, now() + interval '30 days')", [digest(session), user.id]);
    response.setHeader('Set-Cookie', cookie(session, sessionDays * 86_400));
    return json(signup ? 201 : 200, { ok: true });
  }

  return { account, handle };
}
