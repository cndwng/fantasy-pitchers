import { SignJWT, jwtVerify } from 'jose';

const COOKIE = 'fp_session';
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;

function secret() {
  const s = process.env.SESSION_SECRET;
  if (!s) throw new Error('SESSION_SECRET not set');
  return new TextEncoder().encode(s);
}

export async function signSession(userId) {
  return new SignJWT({ sub: userId })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(secret());
}

export function setSessionCookie(res, token) {
  const isProd = process.env.VERCEL === '1' || process.env.NODE_ENV === 'production';
  const parts = [
    `${COOKIE}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${SESSION_TTL_SECONDS}`
  ];
  if (isProd) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

export function clearSessionCookie(res) {
  const isProd = process.env.VERCEL === '1' || process.env.NODE_ENV === 'production';
  const parts = [`${COOKIE}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'];
  if (isProd) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

function readCookie(req, name) {
  const header = req.headers.cookie || '';
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}

export async function getUserId(req) {
  const token = readCookie(req, COOKIE);
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret());
    return payload.sub || null;
  } catch {
    return null;
  }
}

export async function requireUser(req, res) {
  const userId = await getUserId(req);
  if (!userId) {
    res.status(401).json({ error: 'unauthenticated' });
    return null;
  }
  return userId;
}

export function setStateCookie(res, value) {
  const isProd = process.env.VERCEL === '1' || process.env.NODE_ENV === 'production';
  const parts = [
    `fp_oauth_state=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=600'
  ];
  if (isProd) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

export function readStateCookie(req) {
  return readCookie(req, 'fp_oauth_state');
}

export function isAuthorizedCron(req) {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  if (req.headers['x-vercel-cron'] === '1') return true;
  const auth = req.headers.authorization || '';
  return auth === `Bearer ${expected}`;
}
