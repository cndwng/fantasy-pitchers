#!/usr/bin/env node
// One-time OAuth setup: run this locally to get a Yahoo refresh token.
//
// Steps:
//   1. Go to https://developer.yahoo.com/apps/ and create an app:
//        - App Type: Web Application
//        - Scope: Fantasy Sports (Read)
//        - Redirect URI: http://localhost:3000/callback
//   2. Run:
//        YAHOO_CLIENT_ID=your_id YAHOO_CLIENT_SECRET=your_secret node scripts/yahoo-auth.js
//   3. Copy the printed YAHOO_REFRESH_TOKEN into GitHub Settings → Secrets → Actions.
//      Also add YAHOO_CLIENT_ID and YAHOO_CLIENT_SECRET as secrets.

import http from 'http';
import { exec } from 'child_process';
import { promisify } from 'util';
import fetch from 'node-fetch';

const execAsync = promisify(exec);

const CLIENT_ID     = process.env.YAHOO_CLIENT_ID;
const CLIENT_SECRET = process.env.YAHOO_CLIENT_SECRET;
const PORT          = 3000;
const REDIRECT_URI  = `http://localhost:${PORT}/callback`;

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('Missing env vars. Usage:');
  console.error('  YAHOO_CLIENT_ID=... YAHOO_CLIENT_SECRET=... node scripts/yahoo-auth.js');
  process.exit(1);
}

const authUrl =
  'https://api.login.yahoo.com/oauth2/request_auth' +
  `?client_id=${encodeURIComponent(CLIENT_ID)}` +
  `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
  `&response_type=code&scope=fspt-r`;

let server;
const done = new Promise((resolve, reject) => {
  server = http.createServer(async (req, res) => {
    try {
      const url   = new URL(req.url, `http://localhost:${PORT}`);
      if(url.pathname !== '/callback') { res.writeHead(404); res.end(); return; }
      const code  = url.searchParams.get('code');
      const error = url.searchParams.get('error');
      if(error) { res.writeHead(400); res.end(error); reject(new Error(error)); return; }
      if(!code)  { res.writeHead(400); res.end('missing code'); reject(new Error('No code')); return; }

      const tokenRes = await fetch('https://api.login.yahoo.com/oauth2/get_token', {
        method:  'POST',
        headers: {
          'Content-Type':  'application/x-www-form-urlencoded',
          'Authorization': 'Basic ' + Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64'),
        },
        body: new URLSearchParams({
          grant_type:   'authorization_code',
          code,
          redirect_uri: REDIRECT_URI,
        }),
      });

      const tokens = await tokenRes.json();
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<html><body style="font-family:sans-serif;padding:2rem"><h2>Done — you can close this tab.</h2></body></html>');
      resolve(tokens);
    } catch(e) {
      reject(e);
    }
  });
});

server.listen(PORT, async () => {
  console.log('\nOpening Yahoo authorization page…');
  console.log('If the browser does not open, visit:\n  ' + authUrl + '\n');
  const open = process.platform === 'darwin' ? 'open'
             : process.platform === 'win32'  ? 'start'
             : 'xdg-open';
  try { await execAsync(`${open} "${authUrl}"`); } catch(_) { /* user opens manually */ }
});

try {
  const tokens = await done;
  server.close();

  if(tokens.error) {
    console.error('Yahoo error:', tokens.error_description || tokens.error);
    process.exit(1);
  }

  console.log('\nAuthorization successful!\n');
  console.log('Add these three secrets to your repo (Settings → Secrets → Actions):\n');
  console.log(`  YAHOO_CLIENT_ID      = ${CLIENT_ID}`);
  console.log(`  YAHOO_CLIENT_SECRET  = ${CLIENT_SECRET}`);
  console.log(`  YAHOO_REFRESH_TOKEN  = ${tokens.refresh_token}`);
  console.log('\nIf you have multiple Yahoo Fantasy Baseball leagues, also add:');
  console.log('  YAHOO_LEAGUE_ID = <the numeric league id from the Yahoo URL>');
  console.log('\nThe GitHub Action will auto-refresh the token on every run.\n');
} catch(e) {
  server.close();
  console.error('Failed:', e.message);
  process.exit(1);
}
