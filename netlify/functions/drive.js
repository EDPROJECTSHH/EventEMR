'use strict';
/*
 * netlify/functions/drive.js — Google Drive via a service account.
 *
 * SPEC.md §10. CommonJS, Node 18+, zero npm dependencies: global fetch and
 * node:crypto only. No user OAuth — the field tablets never see a Google login.
 *
 * Environment variables
 *   GOOGLE_SERVICE_ACCOUNT_JSON  required. The whole downloaded key file, as
 *                                JSON text (a base64 blob of it also works).
 *                                Share the destination Drive folder with this
 *                                account's client_email, as Editor.
 *   GDRIVE_FOLDER_ID             required. Default parent folder id.
 *   GDRIVE_SHARED_DRIVE_ID       optional. Set when the folder lives on a Shared
 *                                Drive, so searches look in the right corpus.
 *   DRIVE_ALLOWED_ORIGINS        optional, comma-separated extra origins.
 *
 * Actions, all POST { action, ... }:
 *   ping   -> { ok, folder, folderId, account, sharedDrive }
 *   folder -> { ok, id, name, created }      find-or-create, idempotent
 *   upload -> { ok, id, name, webViewLink, modifiedTime, updated }
 *   list   -> { ok, files, nextPageToken, folderId }
 *
 * The private key and the access token are never logged, never returned, and are
 * scrubbed out of any error text on its way to the caller.
 */

const crypto = require('node:crypto');

const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
const SCOPE = 'https://www.googleapis.com/auth/drive';
const FOLDER_MIME = 'application/vnd.google-apps.folder';

const MAX_B64 = 12 * 1024 * 1024;
const MAX_BODY_BYTES = 20 * 1024 * 1024;
const MAX_NAME = 200;
const DRIVE_ID_RE = /^[A-Za-z0-9_-]{6,256}$/;
const FILE_FIELDS = 'id,name,mimeType,size,modifiedTime,webViewLink,webContentLink,parents';

/* ---------------------------------------------------------------- helpers -- */

/* base64url of a Buffer or a string — JWT segments and signature. */
function b64url(input) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(String(input), 'utf8');
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/* Drive filenames are not paths, but a name carrying '/' or a control byte ends
   up mangled in every client that later downloads it — and '..' in a name is
   exactly the shape SPEC.md §10 says to reject. Strip, never silently truncate
   the extension away. */
function sanitiseFilename(name) {
  let s = name === null || name === undefined ? '' : String(name);
  s = s.replace(/[\x00-\x1f\x7f]+/g, ' ');   // control characters
  s = s.replace(/[\\/]+/g, '-');                   // path separators
  s = s.replace(/[<>:"|?*]/g, '-');                // hostile once downloaded
  s = s.replace(/\s+/g, ' ').trim();
  s = s.replace(/^\.+/, '').trim();                // no leading dots, no '..'
  if (!s) s = 'untitled';
  if (s.length > MAX_NAME) {
    const dot = s.lastIndexOf('.');
    const ext = dot > 0 && s.length - dot <= 10 ? s.slice(dot) : '';
    s = s.slice(0, MAX_NAME - ext.length).trim() + ext;
  }
  return s;
}

/* Escape a value for a Drive v3 `q` string literal. */
function qLit(v) {
  return String(v === null || v === undefined ? '' : v)
    .replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function niceError(e) {
  let m = e && e.message ? String(e.message) : String(e || 'Unknown error');
  m = m.replace(/-{5}BEGIN[\s\S]*?-{5}END[^-]*-{5}/g, '[key]');
  m = m.replace(/eyJ[A-Za-z0-9._-]{20,}/g, '[jwt]');
  m = m.replace(/ya29\.[A-Za-z0-9._-]+/g, '[token]');
  m = m.replace(/1\/\/[A-Za-z0-9._-]{20,}/g, '[token]');
  m = m.replace(/(?:access_token|private_key|private_key_id|assertion|client_secret)["']?\s*[:=]\s*["']?[^"'\s,}]+/gi, '[redacted]');
  m = m.replace(/Bearer\s+[A-Za-z0-9._-]+/g, 'Bearer [token]');
  m = m.replace(/\/var\/task\/[^\s)]+/g, '[fn]');
  if (m.length > 400) m = m.slice(0, 400) + '…';
  return m;
}

function str(v) {
  return typeof v === 'string' ? v.trim() : (typeof v === 'number' ? String(v) : '');
}

function bad(msg) {
  const e = new Error(msg);
  e.client = true;
  return e;
}

/* ------------------------------------------------------------ credentials -- */

function creds() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw || !String(raw).trim()) {
    throw bad('GOOGLE_SERVICE_ACCOUNT_JSON is not set on this site');
  }
  let j = null;
  const text = String(raw).trim();
  try {
    j = JSON.parse(text);
  } catch (e) {
    /* Some dashboards mangle multi-line values, so a base64 wrapper is allowed. */
    try {
      j = JSON.parse(Buffer.from(text, 'base64').toString('utf8'));
    } catch (e2) {
      throw bad('GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON');
    }
  }
  if (!j || typeof j !== 'object' || !j.client_email || !j.private_key) {
    throw bad('The service account JSON is missing client_email or private_key');
  }
  return {
    email: String(j.client_email),
    /* Netlify stores the key with literal \n in most setups. */
    key: String(j.private_key).replace(/\\n/g, '\n'),
    tokenUri: j.token_uri ? String(j.token_uri) : 'https://oauth2.googleapis.com/token'
  };
}

function folderId() {
  const id = str(process.env.GDRIVE_FOLDER_ID);
  if (!id) throw bad('GDRIVE_FOLDER_ID is not set on this site');
  if (!DRIVE_ID_RE.test(id)) throw bad('GDRIVE_FOLDER_ID does not look like a Drive folder id');
  return id;
}

function sharedDriveId() {
  const id = str(process.env.GDRIVE_SHARED_DRIVE_ID);
  return id && DRIVE_ID_RE.test(id) ? id : '';
}

/* Module-scope cache: a warm container reuses one token for the whole hour, so
   a 200-record Drive push costs exactly one OAuth round trip. */
let tokenCache = { token: '', exp: 0, account: '' };

async function accessToken(force) {
  const nowSec = Math.floor(Date.now() / 1000);
  if (!force && tokenCache.token && tokenCache.exp - 60 > nowSec) return tokenCache.token;

  const c = creds();
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = b64url(JSON.stringify({
    iss: c.email, scope: SCOPE, aud: c.tokenUri, iat: nowSec, exp: nowSec + 3600
  }));
  const signing = header + '.' + claims;

  let sig;
  try {
    const signer = crypto.createSign('RSA-SHA256');
    signer.update(signing);
    sig = b64url(signer.sign(c.key));
  } catch (e) {
    throw bad('The service account private key could not be used to sign — re-paste the key file');
  }

  const form = new URLSearchParams();
  form.set('grant_type', 'urn:ietf:params:oauth:grant-type:jwt-bearer');
  form.set('assertion', signing + '.' + sig);

  const r = await fetch(c.tokenUri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString()
  });
  const txt = await r.text();
  let j = null;
  try { j = JSON.parse(txt); } catch (e) { /* non-JSON error page */ }

  if (!r.ok || !j || !j.access_token) {
    const detail = j && (j.error_description || j.error) ? (j.error_description || j.error)
      : ('HTTP ' + r.status);
    throw bad('Google rejected the service account: ' + detail);
  }
  tokenCache = {
    token: String(j.access_token),
    exp: nowSec + (Number(j.expires_in) || 3600),
    account: c.email
  };
  return tokenCache.token;
}

/* ------------------------------------------------------------ drive calls -- */

async function callOnce(url, opts, token) {
  const headers = Object.assign({}, opts.headers || {}, { Authorization: 'Bearer ' + token });
  const r = await fetch(url, {
    method: opts.method || 'GET',
    headers: headers,
    body: opts.body === undefined ? undefined : opts.body
  });
  const txt = await r.text();
  let j = null;
  try { j = JSON.parse(txt); } catch (e) { /* ignore */ }
  if (!r.ok) {
    const msg = j && j.error && j.error.message ? j.error.message : ('HTTP ' + r.status);
    const err = new Error(msg);
    err.status = r.status;
    err.drive = true;
    throw err;
  }
  return j || {};
}

/* Every Drive call carries supportsAllDrives, per SPEC.md §10. One retry on 401
   so an expired cached token self-heals instead of surfacing to a medic. */
async function drive(path, opts) {
  const o = opts || {};
  const qs = new URLSearchParams();
  qs.set('supportsAllDrives', 'true');
  const q = o.query || {};
  const keys = Object.keys(q);
  for (let i = 0; i < keys.length; i++) {
    const v = q[keys[i]];
    if (v === undefined || v === null || v === '') continue;
    qs.set(keys[i], String(v));
  }
  const base = path.indexOf('http') === 0 ? path : API + path;
  const url = base + (base.indexOf('?') >= 0 ? '&' : '?') + qs.toString();

  let token = await accessToken(false);
  try {
    return await callOnce(url, o, token);
  } catch (e) {
    if (e && e.status === 401) {
      token = await accessToken(true);
      return await callOnce(url, o, token);
    }
    throw e;
  }
}

/* Search options that make a query see Shared Drive content too. */
function searchScope() {
  const sd = sharedDriveId();
  const out = { includeItemsFromAllDrives: 'true' };
  if (sd) {
    out.driveId = sd;
    out.corpora = 'drive';
  }
  return out;
}

function parentOf(body) {
  const p = str(body && body.parentId);
  if (!p) return folderId();
  if (!DRIVE_ID_RE.test(p)) throw bad('parentId does not look like a Drive folder id');
  return p;
}

/* ---------------------------------------------------------------- actions -- */

async function actionPing() {
  const id = folderId();
  await accessToken(false);
  const f = await drive('/files/' + encodeURIComponent(id), {
    query: { fields: 'id,name,mimeType,driveId,trashed' }
  });
  if (f.mimeType && f.mimeType !== FOLDER_MIME) {
    throw bad('GDRIVE_FOLDER_ID points at a file, not a folder');
  }
  if (f.trashed) throw bad('The Drive folder is in the trash');
  return {
    ok: true,
    folder: f.name || '',
    folderId: f.id || id,
    account: tokenCache.account,
    sharedDrive: f.driveId || sharedDriveId() || null
  };
}

async function actionFolder(body) {
  const name = sanitiseFilename(str(body.name));
  if (!str(body.name)) throw bad('folder needs a name');
  const parent = parentOf(body);

  /* Query first, so two posts tapping "upload" at the same second do not end up
     with two folders of the same name. */
  const q = "name = '" + qLit(name) + "' and mimeType = '" + FOLDER_MIME +
    "' and trashed = false and '" + qLit(parent) + "' in parents";
  const found = await drive('/files', {
    query: Object.assign({
      q: q, fields: 'files(id,name)', pageSize: 10, orderBy: 'createdTime'
    }, searchScope())
  });
  const hits = found && Array.isArray(found.files) ? found.files : [];
  if (hits.length && hits[0] && hits[0].id) {
    return { ok: true, id: hits[0].id, name: hits[0].name || name, created: false };
  }

  const made = await drive('/files', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=UTF-8' },
    body: JSON.stringify({ name: name, mimeType: FOLDER_MIME, parents: [parent] }),
    query: { fields: 'id,name' }
  });
  if (!made || !made.id) throw new Error('Drive created no folder');
  return { ok: true, id: made.id, name: made.name || name, created: true };
}

/* multipart/related body: JSON metadata part, then the raw bytes. */
function multipart(meta, mimeType, bytes) {
  const boundary = 'evemr' + crypto.randomBytes(16).toString('hex');
  const head = Buffer.from(
    '--' + boundary + '\r\n' +
    'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
    JSON.stringify(meta) + '\r\n' +
    '--' + boundary + '\r\n' +
    'Content-Type: ' + mimeType + '\r\n\r\n', 'utf8');
  const tail = Buffer.from('\r\n--' + boundary + '--\r\n', 'utf8');
  return {
    boundary: boundary,
    body: Buffer.concat([head, bytes, tail])
  };
}

async function actionUpload(body) {
  const filename = sanitiseFilename(str(body.filename));
  if (!str(body.filename)) throw bad('upload needs a filename');

  const mimeType = str(body.mimeType) || 'application/octet-stream';
  if (!/^[\w.+-]+\/[\w.+-]+$/.test(mimeType)) throw bad('mimeType is not a media type');

  const b64 = typeof body.dataBase64 === 'string' ? body.dataBase64 : '';
  if (!b64) throw bad('upload needs dataBase64');
  if (b64.length > MAX_B64) {
    throw bad('The file is ' + Math.round(b64.length / 1048576) +
      'MB encoded, over the ' + Math.round(MAX_B64 / 1048576) + 'MB limit');
  }
  if (!/^[A-Za-z0-9+/=\s]+$/.test(b64)) throw bad('dataBase64 is not base64');

  let bytes;
  try {
    bytes = Buffer.from(b64.replace(/\s+/g, ''), 'base64');
  } catch (e) {
    throw bad('dataBase64 could not be decoded');
  }
  if (!bytes.length) throw bad('dataBase64 decoded to zero bytes');

  const fileId = str(body.fileId);
  if (fileId && !DRIVE_ID_RE.test(fileId)) throw bad('fileId does not look like a Drive file id');

  /* Update in place when we know the file, so an edited chart overwrites its own
     PDF and the link already pasted into the recap keeps resolving. `parents` is
     deliberately absent on update — Drive requires addParents/removeParents for
     a move, and a silent re-parent is not what a re-upload means. */
  if (fileId) {
    try {
      const up = multipart({ name: filename }, mimeType, bytes);
      const res = await drive(UPLOAD + '/' + encodeURIComponent(fileId), {
        method: 'PATCH',
        headers: { 'Content-Type': 'multipart/related; boundary=' + up.boundary },
        body: up.body,
        query: { uploadType: 'multipart', fields: FILE_FIELDS }
      });
      return {
        ok: true, id: res.id, name: res.name || filename,
        webViewLink: res.webViewLink || '', modifiedTime: res.modifiedTime || '',
        size: res.size || String(bytes.length), updated: true
      };
    } catch (e) {
      /* The file was deleted or emptied from the trash in Drive. Falling through
         to a create keeps the device usable instead of failing forever on a
         stale pdfDriveId; the caller stores the new id from this response. */
      if (!e || (e.status !== 404 && e.status !== 403)) throw e;
    }
  }

  const parent = parentOf(body);
  const up = multipart({ name: filename, parents: [parent] }, mimeType, bytes);
  const res = await drive(UPLOAD, {
    method: 'POST',
    headers: { 'Content-Type': 'multipart/related; boundary=' + up.boundary },
    body: up.body,
    query: { uploadType: 'multipart', fields: FILE_FIELDS }
  });
  if (!res || !res.id) throw new Error('Drive stored no file');
  return {
    ok: true, id: res.id, name: res.name || filename,
    webViewLink: res.webViewLink || '', modifiedTime: res.modifiedTime || '',
    size: res.size || String(bytes.length), updated: false
  };
}

async function actionList(body) {
  const parent = parentOf(body);
  let pageSize = Number(body.pageSize);
  if (!Number.isFinite(pageSize)) pageSize = 100;
  pageSize = Math.min(200, Math.max(1, Math.round(pageSize)));
  const token = str(body.pageToken);

  const q = "'" + qLit(parent) + "' in parents and trashed = false";
  const res = await drive('/files', {
    query: Object.assign({
      q: q,
      fields: 'nextPageToken,files(' + FILE_FIELDS + ')',
      pageSize: pageSize,
      pageToken: token,
      orderBy: 'folder,modifiedTime desc,name'
    }, searchScope())
  });
  return {
    ok: true,
    folderId: parent,
    files: res && Array.isArray(res.files) ? res.files : [],
    nextPageToken: res && res.nextPageToken ? res.nextPageToken : null
  };
}

const ACTIONS = {
  ping: actionPing,
  folder: actionFolder,
  upload: actionUpload,
  list: actionList
};

async function handleDrive(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw bad('Send a JSON object body');
  }
  const action = str(body.action);
  if (!action) throw bad('Send an action: ping, folder, upload or list');
  if (!Object.prototype.hasOwnProperty.call(ACTIONS, action)) {
    throw bad('Unknown action "' + action.slice(0, 32) + '" — use ping, folder, upload or list');
  }
  return await ACTIONS[action](body);
}

/* ---------------------------------------------------------------- plumbing -- */

function allowOrigin(origin, host) {
  if (!origin) return '';
  let o;
  try { o = new URL(origin); } catch (e) { return ''; }
  if (host && o.host === host) return origin;
  const extra = String(process.env.DRIVE_ALLOWED_ORIGINS || '')
    .split(',').map(function (s) { return s.trim(); }).filter(Boolean);
  for (let i = 0; i < extra.length; i++) {
    if (extra[i] === origin) return origin;
  }
  const site = process.env.URL || process.env.DEPLOY_PRIME_URL || '';
  if (site) {
    try { if (new URL(site).host === o.host) return origin; } catch (e) { /* ignore */ }
  }
  return '';
}

function headersFor(origin, host) {
  const h = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Vary': 'Origin'
  };
  const ok = allowOrigin(origin, host);
  if (ok) {
    h['Access-Control-Allow-Origin'] = ok;
    h['Access-Control-Allow-Methods'] = 'POST, OPTIONS';
    h['Access-Control-Allow-Headers'] = 'Content-Type';
    h['Access-Control-Max-Age'] = '86400';
  }
  return h;
}

function statusFor(e) {
  if (e && e.client) return 400;
  if (e && e.status === 401) return 502;   // our credentials, not the caller's
  if (e && e.status === 403) return 502;
  if (e && e.status === 404) return 404;
  if (e && e.status === 429) return 429;
  return 502;                               // anything else is Drive's fault
}

async function route(req) {
  const head = headersFor(req.origin, req.host);

  if (req.method === 'OPTIONS') return { status: 204, headers: head, body: '' };
  if (req.method !== 'POST') {
    return {
      status: 405,
      headers: Object.assign({ Allow: 'POST, OPTIONS' }, head),
      body: JSON.stringify({ ok: false, error: 'POST a JSON body to this endpoint' })
    };
  }
  if (req.raw && Buffer.byteLength(req.raw) > MAX_BODY_BYTES) {
    return {
      status: 413,
      headers: head,
      body: JSON.stringify({ ok: false, error: 'The request body is too large for one upload' })
    };
  }

  let body = null;
  try {
    body = JSON.parse(req.raw || '{}');
  } catch (e) {
    return {
      status: 400,
      headers: head,
      body: JSON.stringify({ ok: false, error: 'The request body is not valid JSON' })
    };
  }

  try {
    const payload = await handleDrive(body);
    return { status: 200, headers: head, body: JSON.stringify(payload) };
  } catch (e) {
    return {
      status: statusFor(e),
      headers: head,
      body: JSON.stringify({ ok: false, error: niceError(e) })
    };
  }
}

/* Netlify Functions v2 */
async function handlerV2(request) {
  let raw = '';
  try {
    if (request && typeof request.text === 'function' && request.method !== 'GET' &&
        request.method !== 'OPTIONS') {
      raw = await request.text();
    }
  } catch (e) { raw = ''; }
  const hdr = request && request.headers ? request.headers : null;
  const get = function (name) {
    if (hdr && typeof hdr.get === 'function') return hdr.get(name) || '';
    if (hdr && hdr[name]) return String(hdr[name]);
    return '';
  };
  let host = get('x-forwarded-host') || get('host');
  if (!host && request && request.url) {
    try { host = new URL(request.url).host; } catch (e) { host = ''; }
  }
  const res = await route({
    method: (request && request.method) || 'POST',
    origin: get('origin'),
    host: host,
    raw: raw
  });
  return new Response(res.body, { status: res.status, headers: res.headers });
}

/* Legacy (v1) handler */
async function handlerLegacy(event) {
  const h = (event && event.headers) || {};
  const get = function (name) { return h[name] || h[name.toLowerCase()] || ''; };
  let raw = (event && event.body) || '';
  if (event && event.isBase64Encoded && raw) {
    try { raw = Buffer.from(raw, 'base64').toString('utf8'); } catch (e) { raw = ''; }
  }
  const res = await route({
    method: (event && (event.httpMethod || event.method)) || 'POST',
    origin: get('origin'),
    host: get('x-forwarded-host') || get('host'),
    raw: raw
  });
  return { statusCode: res.status, headers: res.headers, body: res.body };
}

module.exports = handlerLegacy;
module.exports.handler = handlerLegacy;
module.exports.default = handlerV2;

/* Pure helpers, exported for unit testing. */
module.exports.sanitiseFilename = sanitiseFilename;
module.exports.b64url = b64url;
module.exports.niceError = niceError;
module.exports.qLit = qLit;
module.exports.multipart = multipart;
module.exports.allowOrigin = allowOrigin;
module.exports.statusFor = statusFor;
module.exports.LIMITS = { MAX_B64: MAX_B64, MAX_NAME: MAX_NAME, DRIVE_ID_RE: DRIVE_ID_RE };
