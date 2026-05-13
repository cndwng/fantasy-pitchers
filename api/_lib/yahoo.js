import fetch from 'node-fetch';
import { db } from './db.js';

const TOKEN_URL = 'https://api.login.yahoo.com/oauth2/get_token';
const AUTHORIZE_URL = 'https://api.login.yahoo.com/oauth2/request_auth';
const REFRESH_BUFFER_MS = 60_000;

export function authorizeUrl(state) {
  const params = new URLSearchParams({
    client_id: process.env.YAHOO_CLIENT_ID,
    redirect_uri: process.env.YAHOO_REDIRECT_URI,
    response_type: 'code',
    scope: 'fspt-r',
    state
  });
  return `${AUTHORIZE_URL}?${params.toString()}`;
}

function basicAuthHeader() {
  const id = process.env.YAHOO_CLIENT_ID;
  const secret = process.env.YAHOO_CLIENT_SECRET;
  return 'Basic ' + Buffer.from(`${id}:${secret}`).toString('base64');
}

export async function exchangeCode(code) {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    redirect_uri: process.env.YAHOO_REDIRECT_URI,
    code
  });
  const r = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: basicAuthHeader(),
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body
  });
  if (!r.ok) throw new Error(`Yahoo token exchange failed: ${r.status} ${await r.text()}`);
  return r.json();
}

async function refreshAccessToken(refreshToken) {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    redirect_uri: process.env.YAHOO_REDIRECT_URI,
    refresh_token: refreshToken
  });
  const r = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: basicAuthHeader(),
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body
  });
  if (!r.ok) throw new Error(`Yahoo refresh failed: ${r.status} ${await r.text()}`);
  return r.json();
}

async function loadTokens(userId) {
  const { data, error } = await db()
    .from('yahoo_tokens')
    .select('access_token, refresh_token, expires_at')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function saveTokens(userId, tokens) {
  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();
  const row = {
    user_id: userId,
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    expires_at: expiresAt,
    updated_at: new Date().toISOString()
  };
  const { error } = await db().from('yahoo_tokens').upsert(row, { onConflict: 'user_id' });
  if (error) throw error;
  return row;
}

export async function storeInitialTokens(userId, tokens) {
  return saveTokens(userId, tokens);
}

async function getValidAccessToken(userId) {
  const t = await loadTokens(userId);
  if (!t) throw new Error('no_yahoo_tokens');
  if (new Date(t.expires_at).getTime() - Date.now() > REFRESH_BUFFER_MS) return t.access_token;
  const fresh = await refreshAccessToken(t.refresh_token);
  if (!fresh.refresh_token) fresh.refresh_token = t.refresh_token;
  await saveTokens(userId, fresh);
  return fresh.access_token;
}

export async function yahooFetch(userId, path) {
  const url = path.startsWith('http')
    ? path
    : `https://fantasysports.yahooapis.com/fantasy/v2${path}${path.includes('?') ? '&' : '?'}format=json`;
  let token = await getValidAccessToken(userId);
  let r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (r.status === 401) {
    const t = await loadTokens(userId);
    const fresh = await refreshAccessToken(t.refresh_token);
    if (!fresh.refresh_token) fresh.refresh_token = t.refresh_token;
    await saveTokens(userId, fresh);
    token = fresh.access_token;
    r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  }
  if (!r.ok) throw new Error(`Yahoo API ${r.status}: ${await r.text()}`);
  return r.json();
}

export async function fetchUserProfile(accessToken) {
  const r = await fetch('https://api.login.yahoo.com/openid/v1/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  if (!r.ok) throw new Error(`Yahoo userinfo ${r.status}: ${await r.text()}`);
  return r.json();
}
