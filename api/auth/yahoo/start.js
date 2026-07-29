import crypto from 'node:crypto';
import { authorizeUrl } from '../../_lib/yahoo.js';
import { setStateCookie } from '../../_lib/session.js';

export default async function handler(req, res) {
  const state = crypto.randomBytes(16).toString('hex');
  setStateCookie(res, state);
  res.statusCode = 302;
  res.setHeader('Location', authorizeUrl(state));
  res.end();
}
