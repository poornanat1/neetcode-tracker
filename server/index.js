import { createServer } from 'node:http';
import { authSchema, createAuth } from './auth.js';
import { readFile } from 'node:fs/promises';
import pg from 'pg';

const { EMAIL_HASH_KEY, DATABASE_URL, PORT = 3000, HOST = '127.0.0.1' } = process.env;
if (!DATABASE_URL || !EMAIL_HASH_KEY || EMAIL_HASH_KEY.length < 32) {
  throw new Error('Set DATABASE_URL and an EMAIL_HASH_KEY of at least 32 characters.');
}

const pool = new pg.Pool({ connectionString: DATABASE_URL });
const auth = createAuth(pool, {
  emailKey: EMAIL_HASH_KEY,
  secureCookies: Boolean(process.env.RAILWAY_ENVIRONMENT_ID) || process.env.NODE_ENV === 'production',
});
const root = new URL('../', import.meta.url);
const files = new Map([
  ['/', ['index.html', 'text/html']],
  ['/src/app.js', ['src/app.js', 'text/javascript']],
  ['/src/state.js', ['src/state.js', 'text/javascript']],
  ['/src/styles.css', ['src/styles.css', 'text/css']],
  ['/src/schedule.json', ['src/schedule.json', 'application/json']],
]);
const catalog = JSON.parse(await readFile(new URL('src/schedule.json', root)));
const ids = new Set(catalog.problems.map(problem => problem.id));
const validDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;

await pool.query(`
  ${authSchema}
  CREATE TABLE IF NOT EXISTS account_attempts (
    account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    id uuid NOT NULL, problem text NOT NULL, outcome text NOT NULL,
    date text NOT NULL, minutes integer, note text NOT NULL,
    recorded bigint GENERATED ALWAYS AS IDENTITY,
    PRIMARY KEY (account_id, id)
  );
  CREATE TABLE IF NOT EXISTS account_planned_dates (
    account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    problem text NOT NULL, date text NOT NULL, PRIMARY KEY (account_id, problem)
  );
`);

async function readState(accountId) {
  const { rows: [state] } = await pool.query(`
    SELECT
      COALESCE((SELECT json_object_agg(problem, history) FROM (
        SELECT problem, json_agg(json_build_object('id', id, 'outcome', outcome,
          'date', date, 'minutes', minutes, 'note', note) ORDER BY recorded) AS history
        FROM account_attempts WHERE account_id = $1 GROUP BY problem
      ) grouped), '{}'::json) AS attempts,
      COALESCE((SELECT json_object_agg(problem, date) FROM account_planned_dates WHERE account_id = $1), '{}'::json) AS dates
  `, [accountId]);
  return state;
}

async function readBody(request) {
  const chunks = [];
  let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length > 100_000) throw Object.assign(new Error('Request too large'), { status: 413 });
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks));
  } catch {
    throw Object.assign(new Error('Invalid JSON'), { status: 400 });
  }
}

const isJson = request => /^application\/json(?:;|$)/i.test(request.headers['content-type'] || '');

createServer(async (request, response) => {
  const path = request.url.split('?')[0];
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Content-Security-Policy', "default-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  const json = (status, value) => {
    response.writeHead(status, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify(value));
  };

  try {
    if (request.method === 'GET' && path === '/health') {
      await pool.query('SELECT 1');
      return json(200, { ok: true });
    }
    if (request.method === 'GET' && files.has(path)) {
      const [file, type] = files.get(path);
      const bytes = await readFile(new URL(file, root));
      response.writeHead(200, { 'Content-Type': type + '; charset=utf-8' });
      return response.end(bytes);
    }
    if (request.method === 'POST' && ['/api/auth/sign-in', '/api/auth/sign-up', '/api/auth/sign-out'].includes(path)) {
      if (!isJson(request)) return json(415, { error: 'Expected JSON.' });
      return await auth.handle(path, await readBody(request), request, response, json);
    }
    const accountId = await auth.account(request);
    if (!accountId) return json(401, { error: 'Sign in to Loop Club.' });
    if (request.method === 'GET' && path === '/api/state') return json(200, await readState(accountId));
    if (request.method === 'POST' && ['/api/attempts', '/api/plan'].includes(path)) {
      if (!isJson(request)) {
        return json(415, { error: 'Expected JSON.' });
      }
      const body = await readBody(request);
      if (path === '/api/attempts') {
        const { id, problem, outcome, date, minutes, note } = body || {};
        if (typeof id !== 'string' || !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id) ||
            !ids.has(problem) || !['Done', 'Redo', 'Stuck'].includes(outcome) || !validDate(date) ||
            (minutes !== null && (!Number.isInteger(minutes) || minutes < 1 || minutes > 600)) ||
            typeof note !== 'string' || note.length > 2000) {
          return json(400, { error: 'Invalid attempt.' });
        }
        await pool.query(`
          INSERT INTO account_attempts (id, problem, outcome, date, minutes, note, account_id)
          VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (account_id, id) DO NOTHING
        `, [id, problem, outcome, date, minutes, note, accountId]);
      } else {
        const entries = body && typeof body === 'object' ? Object.entries(body) : [];
        if (!entries.length || entries.some(([id, date]) => !ids.has(id) || !validDate(date))) {
          return json(400, { error: 'Invalid schedule.' });
        }
        await pool.query(`
          INSERT INTO account_planned_dates (problem, date, account_id) SELECT key, value, $2 FROM json_each_text($1::json) ORDER BY key
          ON CONFLICT (account_id, problem) DO UPDATE SET date = EXCLUDED.date
        `, [JSON.stringify(body), accountId]);
      }
      return json(200, await readState(accountId));
    }
    return json(404, { error: 'Page not found.' });
  } catch (error) {
    if (!error.status) console.error(error);
    return json(error.status || 500, { error: error.status ? error.message : 'Could not reach your saved data.' });
  }
}).listen(Number(PORT), HOST, () => console.log(`Loop Club: http://${HOST}:${PORT}`));
