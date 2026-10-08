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
 *   GOOGLE_IMPERSONATE_USER      optional. A Workspace user's email. When set,
 *                                the signed JWT carries a `sub` claim and the
 *                                service account acts AS that user (domain-wide
 *                                delegation), so files are owned by them.
 *   DRIVE_ALLOWED_ORIGINS        optional, comma-separated extra origins.
 *
 *   --- the personal-account path (no Google Workspace needed) ---
 *   GOOGLE_OAUTH_CLIENT_ID       \
 *   GOOGLE_OAUTH_CLIENT_SECRET    >  set all three to upload as a human instead
 *   GOOGLE_OAUTH_REFRESH_TOKEN   /   of as the service account. Takes priority
 *                                over the service account when present.
 *
 * A service account owns no storage. Writing into a folder that lives in a
 * human's My Drive therefore fails with 403 storageQuotaExceeded, and sharing
 * that folder with the service account does not help — the new file would still
 * be owned by an account with zero quota. The only two ways out, both supported
 * here, are a Shared Drive (the drive owns the file) or GOOGLE_IMPERSONATE_USER
 * (the impersonated user owns it).
 *
 * BOTH of those require Google Workspace: Shared Drives do not exist on a
 * personal @gmail.com account, and domain-wide delegation needs an Admin
 * console. For a personal account the only way to write into My Drive is to act
 * as the human, which is what the GOOGLE_OAUTH_* refresh-token path does — the
 * file is owned by them and uses their 15 GB. See:
 *   https://developers.google.com/workspace/drive/api/guides/about-shareddrives
 *   https://developers.google.com/identity/protocols/oauth2/service-account
 *
 * Actions, all POST { action, ... }:
 *   ping   -> { ok, folder, folderId, account, sharedDrive, mode,
 *               impersonating, message }   mode: sharedDrive | impersonation |
 *               serviceAccount. ok is false when the configuration cannot
 *               actually upload, rather than green-lighting a first failure.
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
const EMAIL_RE = /^[^\s@<>,;"]+@[^\s@<>,;"]+\.[^\s@<>,;"]+$/;
const FILE_FIELDS = 'id,name,mimeType,size,modifiedTime,webViewLink,webContentLink,parents';

/* Google's own text here is "Service Accounts do not have storage quota.
   Leverage shared drives …, or use OAuth delegation … instead", which hands a
   medic two documentation links mid-event. Name both remedies in the terms of
   this site's own env vars instead. Kept short enough to survive niceError()'s
   400-character clamp once a prefix is added. */
const QUOTA_FIX =
  'a service account has no Drive storage, so it cannot own files in a My Drive ' +
  'folder — sharing the folder with it is not enough. Either (1) move the folder ' +
  'into a Shared Drive, add the service account as Content manager and set ' +
  'GDRIVE_SHARED_DRIVE_ID, or (2) set GOOGLE_IMPERSONATE_USER to a Workspace ' +
  'user with domain-wide delegation.';

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

/* The Workspace user to act as, or '' for none. A typo is thrown rather than
   ignored: silently falling back to the plain service account would leave the
   site in the exact broken state this variable was set to fix. */
function impersonateUser() {
  const raw = str(process.env.GOOGLE_IMPERSONATE_USER);
  if (!raw) return '';
  if (!EMAIL_RE.test(raw)) {
    throw bad('GOOGLE_IMPERSONATE_USER is not an email address');
  }
  return raw;
}

/* Module-scope cache: a warm container reuses one token for the whole hour, so
   a 200-record Drive push costs exactly one OAuth round trip. Keyed on the
   identity as well as the clock — an impersonated token is not interchangeable
   with a bare service-account one. */
let tokenCache = { token: '', exp: 0, account: '', subject: '' };

/* ---- the personal-account path ------------------------------------------
   A service account cannot own a file in My Drive, and neither of the Workspace
   remedies exists on a personal Google account. Acting as the human does: a
   one-time consent yields a refresh token, and every upload from then on is
   owned by them and billed to their own quota.

   Verified against
   https://developers.google.com/identity/protocols/oauth2/web-server#offline —
   POST grant_type=refresh_token with the client id, secret and refresh token to
   https://oauth2.googleapis.com/token. */
function oauthCreds() {
  const id = str(process.env.GOOGLE_OAUTH_CLIENT_ID);
  const secret = str(process.env.GOOGLE_OAUTH_CLIENT_SECRET);
  const refresh = str(process.env.GOOGLE_OAUTH_REFRESH_TOKEN);
  if (!id && !secret && !refresh) return null;
  if (!id || !secret || !refresh) {
    throw bad('The GOOGLE_OAUTH_* path needs all three of GOOGLE_OAUTH_CLIENT_ID, ' +
      'GOOGLE_OAUTH_CLIENT_SECRET and GOOGLE_OAUTH_REFRESH_TOKEN');
  }
  return { id: id, secret: secret, refresh: refresh };
}

let oauthCache = { token: '', exp: 0, id: '' };

async function oauthToken(force, oc) {
  const nowSec = Math.floor(Date.now() / 1000);
  if (!force && oauthCache.token && oauthCache.exp - 60 > nowSec && oauthCache.id === oc.id) {
    return oauthCache.token;
  }
  const form = new URLSearchParams();
  form.set('grant_type', 'refresh_token');
  form.set('client_id', oc.id);
  form.set('client_secret', oc.secret);
  form.set('refresh_token', oc.refresh);

  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString()
  });
  const txt = await r.text();
  let j = null;
  try { j = JSON.parse(txt); } catch (e) { /* non-JSON error page */ }

  if (!r.ok || !j || !j.access_token) {
    const detail = (j && (j.error_description || j.error)) || ('HTTP ' + r.status);
    if (/invalid_grant/i.test(String(detail))) {
      throw bad('The Google refresh token is no longer valid — it was revoked, expired ' +
        'while the OAuth app was in testing mode, or belongs to a different client. ' +
        'Generate a new one and update GOOGLE_OAUTH_REFRESH_TOKEN.');
    }
    throw bad('Google rejected the OAuth refresh: ' + detail);
  }
  oauthCache = {
    token: String(j.access_token),
    exp: nowSec + (Number(j.expires_in) || 3600),
    id: oc.id
  };
  return oauthCache.token;
}

/* Which identity is in play. Checked in one place so ping and every Drive call
   agree about it. */
function authMode() {
  let oc = null;
  try { oc = oauthCreds(); } catch (e) { return { kind: 'oauth-misconfigured', error: e }; }
  if (oc) return { kind: 'oauth', oauth: oc };
  if (impersonateUser()) return { kind: 'impersonation' };
  return { kind: 'serviceAccount' };
}

async function accessToken(force) {
  /* The human-owned path wins when it is configured: it is the only one that
     can write into a personal My Drive. */
  const oc = oauthCreds();
  if (oc) return oauthToken(force, oc);

  const nowSec = Math.floor(Date.now() / 1000);
  const c = creds();
  const sub = impersonateUser();
  if (!force && tokenCache.token && tokenCache.exp - 60 > nowSec &&
      tokenCache.account === c.email && tokenCache.subject === sub) {
    return tokenCache.token;
  }

  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claimSet = {
    iss: c.email, scope: SCOPE, aud: c.tokenUri, iat: nowSec, exp: nowSec + 3600
  };
  /* Domain-wide delegation. Verified against
     https://developers.google.com/identity/protocols/oauth2/service-account —
     "sub: The email address of the user for which the application is requesting
     delegated access". The scope above must be authorised for this service
     account's client id in the Admin console byte for byte; the token endpoint
     answers unauthorized_client when it is not, which is handled below. */
  if (sub) claimSet.sub = sub;
  const claims = b64url(JSON.stringify(claimSet));
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
    if (sub && /unauthorized_client/i.test(String((j && j.error) || '') + ' ' + String(detail))) {
      throw bad('Google will not let this service account act as ' + sub +
        ' — in the Admin console, add its client id under API controls > ' +
        'domain-wide delegation with the scope ' + SCOPE);
    }
    throw bad('Google rejected the service account: ' + detail);
  }
  tokenCache = {
    token: String(j.access_token),
    exp: nowSec + (Number(j.expires_in) || 3600),
    account: c.email,
    subject: sub
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
    const ge = j && j.error ? j.error : null;
    const msg = ge && ge.message ? String(ge.message) : ('HTTP ' + r.status);
    let reason = '';
    if (ge && Array.isArray(ge.errors) && ge.errors.length && ge.errors[0] && ge.errors[0].reason) {
      reason = String(ge.errors[0].reason);
    }
    const err = new Error(msg);
    err.status = r.status;
    err.drive = true;
    err.reason = reason;
    /* 403 storageQuotaExceeded is the service-account-owns-nothing wall, and it
       hits folder creation just as hard as upload — so translate it here, once,
       for every write. The message sniff is the fallback for error payloads
       that carry no errors[] array. Reason string verified against
       https://developers.google.com/workspace/drive/api/guides/handle-errors */
    if (reason === 'storageQuotaExceeded' || /storage quota/i.test(msg)) {
      err.quota = true;
      err.message = 'Google refused this write: ' + QUOTA_FIX;
    }
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

/* Search options that make a query see Shared Drive content too. These three
   are files.list parameters only — verified against
   https://developers.google.com/workspace/drive/api/reference/rest/v3/files/list
   ("corpora: user, domain, drive, allDrives"; "corpora='drive' … The driveId
   must be specified in the request"). files.create has no driveId or corpora
   parameter at all: a created file lands in a shared drive purely by having a
   parent there, with supportsAllDrives=true, which drive() always sends. */
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

/* A green light that fails on the first upload is worse than an honest red one,
   so ping answers the question that actually matters — can this configuration
   own a file? — rather than merely whether the folder is readable. The folder
   get runs under the impersonated identity when one is set, so what comes back
   describes the identity that will do the writing. */
async function actionPing() {
  const id = folderId();
  const impersonating = impersonateUser();
  await accessToken(false);
  const f = await drive('/files/' + encodeURIComponent(id), {
    query: { fields: 'id,name,mimeType,driveId,trashed,capabilities(canAddChildren)' }
  });
  if (f.mimeType && f.mimeType !== FOLDER_MIME) {
    throw bad('GDRIVE_FOLDER_ID points at a file, not a folder');
  }
  if (f.trashed) throw bad('The Drive folder is in the trash');

  /* File.driveId is "Only populated for items in shared drives", so its absence
     is the definitive test for "this folder is in somebody's My Drive". */
  const actualDrive = str(f.driveId);
  const configured = sharedDriveId();
  const caps = f.capabilities || {};

  let ok = true;
  let mode = 'serviceAccount';
  let message = '';
  const am = authMode();
  if (am.kind === 'oauth') {
    /* Acting as the human: the file is theirs and uses their quota, so a My
       Drive folder is perfectly fine and no shared drive is needed. */
    mode = 'oauth';
    message = 'Signed in as a Google user via a refresh token: new files are ' +
      'owned by that account and use their Drive quota. This is the path that ' +
      'works on a personal @gmail.com account.';
  } else if (actualDrive) {
    mode = 'sharedDrive';
    message = 'Shared drive: new files are owned by the drive, not by the ' +
      'service account, so no personal quota is involved.';
  } else if (impersonating) {
    mode = 'impersonation';
    message = 'Domain-wide delegation: acting as ' + impersonating +
      ', so new files are owned by that user and use their Drive quota.';
  } else {
    ok = false;
    message = 'Plain service account with a My Drive folder — uploads WILL ' +
      'fail with Google\'s storage-quota error: ' + QUOTA_FIX;
  }

  /* The shared-drive mismatch check below is about which corpus searches use.
     It is meaningless when acting as a user, who simply sees their own Drive. */
  const skipDriveChecks = (mode === 'oauth');

  /* corpora=drive scopes every search to one drive. Aimed at the wrong one, the
     find-or-create in actionFolder sees nothing and makes a fresh duplicate
     folder on every single run, quietly, forever. */
  if (!skipDriveChecks && configured && configured !== actualDrive) {
    ok = false;
    message = actualDrive
      ? 'GDRIVE_SHARED_DRIVE_ID is ' + configured + ' but this folder lives in ' +
        'drive ' + actualDrive + ', so searches look in the wrong drive and ' +
        'subfolders get duplicated. Set it to ' + actualDrive + ', or clear it.'
      : 'GDRIVE_SHARED_DRIVE_ID is set but this folder is not in a shared ' +
        'drive, so searches look in a drive that does not contain it and ' +
        'subfolders get duplicated. Clear it, or point GDRIVE_FOLDER_ID at a ' +
        'folder inside that shared drive.';
  } else if (!skipDriveChecks && caps.canAddChildren === false) {
    ok = false;
    message = 'The folder is readable but not writable by this account — share ' +
      'it as Editor on My Drive, or Content manager on a shared drive.';
  }

  const out = {
    ok: ok,
    folder: f.name || '',
    folderId: f.id || id,
    account: mode === 'oauth' ? 'oauth user' : tokenCache.account,
    sharedDrive: actualDrive || configured || null,
    mode: mode,
    impersonating: impersonating || null,
    message: message
  };
  /* The browser client renders `error` for a rejected ping, so a known-broken
     configuration must populate it as well as `message`. */
  if (!ok) out.error = message;
  return out;
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
      /* A quota refusal is a site misconfiguration, not a stale id — retrying
         as a create would re-send up to 12MB only to be refused again, and
         would bury the actionable message under the second failure. */
      if (e && e.quota) throw e;
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
