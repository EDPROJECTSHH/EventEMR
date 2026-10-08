'use strict';
/*
 * netlify/functions/sync.js — shared live state for a standby event.
 *
 * SPEC.md §3 wire format, §10 storage layout. CommonJS, Node 18+, zero npm
 * dependencies beyond '@netlify/blobs' (provided by the Netlify runtime).
 *
 * Environment variables
 *   SYNC_ALLOWED_ORIGINS   optional, comma-separated extra origins allowed to
 *                          call this function cross-origin. Same-origin always
 *                          works and needs no configuration.
 *   (no secrets of any kind are read by this function)
 *
 * Blob layout, in the strongly-consistent store named 'event-emr':
 *   <eventId>/meta/<deviceId>.json  { deviceId, lastWrite, n }
 *   <eventId>/dev/<deviceId>.json   { v, deviceId, records:{'<type>:<id>':doc},
 *                                     at:{'<type>:<id>':serverMs}, lastWrite, n }
 *
 * A device only ever writes its OWN two blobs, so twenty medical posts can push
 * at the same moment with no read-modify-write contention and no lost updates.
 * Reads fan out across every device blob and merge last-write-wins.
 *
 * Why the sibling `at` map: `since` has to be a cursor a puller can trust, and
 * `updatedAt` comes off twenty unsynchronised tablet clocks. `at` stamps each
 * record with the server clock at the moment it was accepted, so the delta
 * filter never loses a record written by a device whose clock runs slow. The
 * `records` map is exactly the shape SPEC.md §10 specifies; `at` sits beside it.
 */

const STORE_NAME = 'event-emr';
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_CHANGES = 500;
const MAX_DOC_BYTES = 256 * 1024;
const MAX_DELTA_BYTES = 4 * 1024 * 1024;
const MAX_BODY_BYTES = 24 * 1024 * 1024;
const MAX_TYPE_LEN = 48;
const MAX_ID_LEN = 128;

/* ---------------------------------------------------------------- helpers -- */

/* '<type>:<id>' — the canonical record key. Empty string means unusable. */
function docKey(d) {
  if (!d || typeof d !== 'object' || Array.isArray(d)) return '';
  const t = typeof d._t === 'string' ? d._t : '';
  const id = typeof d.id === 'string' || typeof d.id === 'number' ? String(d.id) : '';
  if (!t || !id) return '';
  return t + ':' + id;
}

/* LWW: should `b` replace `a`? updatedAt wins, deviceId breaks the tie, rev is
   the last resort so two writes from one device in the same millisecond still
   order deterministically. */
function wins(a, b) {
  if (!a) return true;
  if (!b) return false;
  const au = Number(a.updatedAt) || 0;
  const bu = Number(b.updatedAt) || 0;
  if (bu !== au) return bu > au;
  const ad = typeof a.deviceId === 'string' ? a.deviceId : '';
  const bd = typeof b.deviceId === 'string' ? b.deviceId : '';
  if (bd !== ad) return bd > ad;
  return (Number(b.rev) || 0) > (Number(a.rev) || 0);
}

/* Merge an array of docs, or a '<key>': doc map, into `into`. Pure apart from
   mutating (and returning) `into`; pass {} for a fresh merge. */
function mergeLWW(into, src) {
  const out = into || {};
  if (!src || typeof src !== 'object') return out;
  if (Array.isArray(src)) {
    for (let i = 0; i < src.length; i++) {
      const d = src[i];
      const k = docKey(d);
      if (!k) continue;
      if (wins(out[k], d)) out[k] = d;
    }
    return out;
  }
  const keys = Object.keys(src);
  for (let i = 0; i < keys.length; i++) {
    const d = src[keys[i]];
    if (!d || typeof d !== 'object' || Array.isArray(d)) continue;
    const k = docKey(d) || keys[i];
    if (wins(out[k], d)) out[k] = d;
  }
  return out;
}

/* Strip anything that could carry a secret or a stack path out to a caller. */
function niceError(e) {
  let m = e && e.message ? String(e.message) : String(e || 'Unknown error');
  m = m.replace(/-{5}BEGIN[\s\S]*?-{5}END[^-]*-{5}/g, '[key]');
  m = m.replace(/eyJ[A-Za-z0-9._-]{20,}/g, '[jwt]');
  m = m.replace(/ya29\.[A-Za-z0-9._-]+/g, '[token]');
  m = m.replace(/(?:access_token|private_key|assertion)["']?\s*[:=]\s*["']?[^"'\s,}]+/gi, '[redacted]');
  m = m.replace(/\/var\/task\/[^\s)]+/g, '[fn]');
  if (m.length > 400) m = m.slice(0, 400) + '…';
  return m;
}

function byteLen(obj) {
  return Buffer.byteLength(JSON.stringify(obj));
}

/* Reject a change the field app could not have meant to send, with a message a
   medic's console actually explains something. 400, never 500. */
function changeProblem(d, i) {
  const at = 'changes[' + i + ']';
  if (!d || typeof d !== 'object' || Array.isArray(d)) return at + ' is not a record object';
  if (typeof d._t !== 'string' || !d._t || d._t.length > MAX_TYPE_LEN) {
    return at + ' is missing a usable _t type tag';
  }
  const id = typeof d.id === 'string' || typeof d.id === 'number' ? String(d.id) : '';
  if (!id || id.length > MAX_ID_LEN) return at + ' is missing a usable id';
  if (!Number.isFinite(Number(d.updatedAt))) {
    return at + ' (' + docKey(d) + ') has no numeric updatedAt';
  }
  let n = 0;
  try {
    n = byteLen(d);
  } catch (e) {
    return at + ' (' + docKey(d) + ') is not serialisable JSON';
  }
  if (n > MAX_DOC_BYTES) {
    return at + ' (' + docKey(d) + ') is ' + Math.round(n / 1024) +
      'KB, over the ' + Math.round(MAX_DOC_BYTES / 1024) + 'KB per-record limit';
  }
  return '';
}

/* --------------------------------------------------------------- the store -- */

let cachedStore = null;
function blobs() {
  if (cachedStore) return cachedStore;
  let mod;
  try {
    mod = require('@netlify/blobs');
  } catch (e) {
    throw new Error('Netlify Blobs is unavailable in this runtime');
  }
  if (!mod || typeof mod.getStore !== 'function') {
    throw new Error('Netlify Blobs is unavailable in this runtime');
  }
  cachedStore = mod.getStore({ name: STORE_NAME, consistency: 'strong' });
  return cachedStore;
}

function metaKey(eventId, deviceId) { return eventId + '/meta/' + deviceId + '.json'; }
function devKey(eventId, deviceId) { return eventId + '/dev/' + deviceId + '.json'; }

async function readJson(store, key) {
  try {
    const v = await store.get(key, { type: 'json' });
    return v && typeof v === 'object' ? v : null;
  } catch (e) {
    /* A blob written half-way, or hand-edited, must not take the event down. */
    return null;
  }
}

/* Device ids out of the '<eventId>/meta/' listing. */
async function listDevices(store, eventId) {
  const prefix = eventId + '/meta/';
  let res;
  try {
    res = await store.list({ prefix: prefix });
  } catch (e) {
    throw new Error('Could not list the event devices: ' + niceError(e));
  }
  const out = [];
  const arr = res && Array.isArray(res.blobs) ? res.blobs : [];
  for (let i = 0; i < arr.length; i++) {
    const key = arr[i] && arr[i].key ? String(arr[i].key) : '';
    if (key.indexOf(prefix) !== 0) continue;
    const id = key.slice(prefix.length).replace(/\.json$/, '');
    if (ID_RE.test(id)) out.push(id);
  }
  return out;
}

/* ------------------------------------------------------------------ push --- */

/* Merge the caller's changes into the caller's own blob. Returns the server
   stamp written, which becomes that blob's lastWrite. */
async function push(store, eventId, deviceId, changes) {
  const dk = devKey(eventId, deviceId);
  const blob = (await readJson(store, dk)) || {};
  const records = blob.records && typeof blob.records === 'object' ? blob.records : {};
  const at = blob.at && typeof blob.at === 'object' ? blob.at : {};
  const prev = Number(blob.lastWrite) || 0;

  /* Stamps must be strictly increasing within a device so a truncated pull can
     resume on an exact cursor. One ms per record is plenty — the cap is 500. */
  let stamp = Date.now();
  if (stamp <= prev) stamp = prev + 1;

  let accepted = 0;
  for (let i = 0; i < changes.length; i++) {
    const d = changes[i];
    const k = docKey(d);
    if (!k) continue;
    if (!wins(records[k], d)) continue;
    records[k] = d;
    at[k] = stamp + accepted;
    accepted++;
  }

  const last = accepted ? stamp + accepted - 1 : prev;
  if (!accepted) return { lastWrite: prev, accepted: 0, n: Object.keys(records).length };

  const n = Object.keys(records).length;
  await store.setJSON(dk, {
    v: 1, deviceId: deviceId, records: records, at: at, lastWrite: last, n: n
  });
  /* Meta is written second and is the only thing pullers scan, so a device blob
     is always at least as fresh as the lastWrite other devices act on. */
  await store.setJSON(metaKey(eventId, deviceId), {
    deviceId: deviceId, lastWrite: last, n: n
  });
  return { lastWrite: last, accepted: accepted, n: n };
}

/* ------------------------------------------------------------------ pull --- */

async function pull(store, eventId, deviceId, since) {
  /* Stamped BEFORE the fan-out read, and handed back as the next cursor. A post
     that pushes while this read is in flight gets a stamp after t0, so it is
     picked up on the next pull instead of falling through the `> since` filter.
     Re-sending a record is free (the merge is idempotent); missing one is not. */
  const t0 = Date.now();
  const devices = await listDevices(store, eventId);

  /* Read every meta, then only the device blobs that moved since the cursor. */
  const metas = await Promise.all(devices.map(function (id) {
    return readJson(store, metaKey(eventId, id)).then(function (m) {
      return { id: id, lastWrite: Number(m && m.lastWrite) || 0 };
    });
  }));

  const wanted = [];
  for (let i = 0; i < metas.length; i++) {
    const m = metas[i];
    if (m.lastWrite <= since) continue;
    /* The caller already holds its own blob; echoing a 500-record push straight
       back costs real bandwidth on venue wifi. A full resync (since === 0) does
       want it, e.g. after the browser storage was cleared. */
    if (since > 0 && m.id === deviceId) continue;
    wanted.push(m.id);
  }

  const bodies = await Promise.all(wanted.map(function (id) {
    return readJson(store, devKey(eventId, id));
  }));

  /* Merge LWW across every device, carrying the newest server stamp per key. */
  const merged = {};
  const stamps = {};
  for (let i = 0; i < bodies.length; i++) {
    const b = bodies[i];
    if (!b) continue;
    const recs = b.records && typeof b.records === 'object' ? b.records : {};
    const at = b.at && typeof b.at === 'object' ? b.at : {};
    const keys = Object.keys(recs);
    for (let j = 0; j < keys.length; j++) {
      const raw = keys[j];
      const d = recs[raw];
      if (!d || typeof d !== 'object' || Array.isArray(d)) continue;
      const k = docKey(d) || raw;
      /* No `at` entry means a blob written by an older deploy — fall back to the
         record's own clock rather than dropping it. */
      const s = Number.isFinite(Number(at[raw])) ? Number(at[raw])
        : (Number(b.lastWrite) || Number(d.updatedAt) || 0);
      if (wins(merged[k], d)) {
        merged[k] = d;
        stamps[k] = s;
      }
    }
  }

  const keys = Object.keys(merged);
  const fresh = [];
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i];
    if ((stamps[k] || 0) > since) fresh.push(k);
  }
  fresh.sort(function (a, b) {
    const d = (stamps[a] || 0) - (stamps[b] || 0);
    return d !== 0 ? d : (a < b ? -1 : a > b ? 1 : 0);
  });

  /* Budget the delta, cutting on a whole-stamp boundary so nothing between two
     requests falls through the `> since` filter. Never silently drop. */
  const changes = [];
  let bytes = 0;
  let truncated = false;
  let nextSince = 0;
  let i = 0;
  while (i < fresh.length) {
    const s = stamps[fresh[i]] || 0;
    let j = i;
    const group = [];
    let groupBytes = 0;
    while (j < fresh.length && (stamps[fresh[j]] || 0) === s) {
      const d = merged[fresh[j]];
      group.push(d);
      try { groupBytes += byteLen(d) + 1; } catch (e) { groupBytes += MAX_DOC_BYTES; }
      j++;
    }
    if (changes.length && bytes + groupBytes > MAX_DELTA_BYTES) {
      truncated = true;
      break;
    }
    for (let g = 0; g < group.length; g++) changes.push(group[g]);
    bytes += groupBytes;
    nextSince = s;
    i = j;
    /* One oversized group is still sent whole — forward progress beats the cap. */
    if (bytes > MAX_DELTA_BYTES && i < fresh.length) {
      truncated = true;
      break;
    }
  }

  return {
    changes: changes,
    devices: devices.length,
    truncated: truncated,
    /* Resume exactly where the slice stopped; otherwise take the whole window. */
    nextSince: truncated ? nextSince : t0,
    now: t0
  };
}

/* ------------------------------------------------------------------ route -- */

async function handleSync(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { status: 400, payload: { ok: false, error: 'Send a JSON object body' } };
  }

  const eventId = typeof body.eventId === 'string' ? body.eventId : '';
  const deviceId = typeof body.deviceId === 'string' ? body.deviceId : '';
  if (!ID_RE.test(eventId)) {
    return {
      status: 400,
      payload: { ok: false, error: 'eventId must be 1-64 characters of A-Z a-z 0-9 _ or -' }
    };
  }
  if (!ID_RE.test(deviceId)) {
    return {
      status: 400,
      payload: { ok: false, error: 'deviceId must be 1-64 characters of A-Z a-z 0-9 _ or -' }
    };
  }

  let since = Number(body.since);
  if (!Number.isFinite(since) || since < 0) since = 0;

  let changes = body.changes;
  if (changes === undefined || changes === null) changes = [];
  if (!Array.isArray(changes)) {
    return { status: 400, payload: { ok: false, error: 'changes must be an array of records' } };
  }
  if (changes.length > MAX_CHANGES) {
    return {
      status: 400,
      payload: {
        ok: false,
        error: 'changes holds ' + changes.length + ' records, over the ' + MAX_CHANGES +
          ' per request limit — push in batches'
      }
    };
  }
  for (let i = 0; i < changes.length; i++) {
    const problem = changeProblem(changes[i], i);
    if (problem) return { status: 400, payload: { ok: false, error: problem } };
  }

  const store = blobs();
  let accepted = 0;
  if (changes.length) {
    const res = await push(store, eventId, deviceId, changes);
    accepted = res.accepted;
  }

  const got = await pull(store, eventId, deviceId, since);

  return {
    status: 200,
    payload: {
      ok: true,
      now: got.now,
      changes: got.changes,
      devices: got.devices,
      truncated: got.truncated,
      nextSince: got.nextSince,
      pushed: changes.length,
      accepted: accepted
    }
  };
}

/* ---------------------------------------------------------------- plumbing -- */

function allowOrigin(origin, host) {
  if (!origin) return '';
  let o;
  try { o = new URL(origin); } catch (e) { return ''; }
  if (host && o.host === host) return origin;
  const extra = String(process.env.SYNC_ALLOWED_ORIGINS || '')
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

/* One code path for both runtimes: {method, origin, host, raw} in, {status,
   headers, body} out. Always JSON, never an HTML error page. */
async function route(req) {
  const head = headersFor(req.origin, req.host);

  if (req.method === 'OPTIONS') {
    return { status: 204, headers: head, body: '' };
  }
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
      body: JSON.stringify({ ok: false, error: 'The request body is too large — push fewer records' })
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
    const res = await handleSync(body);
    return { status: res.status, headers: head, body: JSON.stringify(res.payload) };
  } catch (e) {
    return {
      status: 500,
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

/* Legacy (v1) handler — the shape zip-it-and-ship-it picks up for CommonJS. */
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
module.exports.mergeLWW = mergeLWW;
module.exports.wins = wins;
module.exports.docKey = docKey;
module.exports.changeProblem = changeProblem;
module.exports.niceError = niceError;
module.exports.allowOrigin = allowOrigin;
module.exports.LIMITS = {
  MAX_CHANGES: MAX_CHANGES,
  MAX_DOC_BYTES: MAX_DOC_BYTES,
  MAX_DELTA_BYTES: MAX_DELTA_BYTES,
  ID_RE: ID_RE
};
