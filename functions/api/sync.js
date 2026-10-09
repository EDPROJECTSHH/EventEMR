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
  return utf8Len(JSON.stringify(obj));
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

/* ---------------------------------------------------------- the store (D1) --
   D1 stands in for Netlify Blobs, and it is the right one of Cloudflare's three
   on this account. R2 cannot create a bucket until a billing subscription is
   added. KV allows 1,000 writes a day on the free plan — a single event would
   spend that before lunch — and it is eventually consistent, so a handover the
   receiving post cannot see yet is worse than no sync at all. D1 is free, needs
   no subscription, and its reads go to the primary: a patient moved at 14:02 is
   visible at the other post at 14:02.

   The table is a plain key/value pair and the adapter is shaped exactly like
   the Netlify Blobs client, so every line built on top of it is untouched. */
const DB_BINDING = 'EVENT_EMR';

/* Set once per request. A Worker has no Node environment object; bindings and
   plain variables both arrive together on `env`. */
let ENV = {};

const ENC = new TextEncoder();
function utf8Len(s) { return ENC.encode(String(s == null ? '' : s)).length; }

/* Created on first use and remembered per isolate, so the DDL is not a round
   trip on every request. Cleared on failure so a cold start can retry. */
let schemaReady = null;

function db(env) {
  const d1 = env && env[DB_BINDING];
  if (!d1 || typeof d1.prepare !== 'function') {
    throw new Error(
      'The D1 binding "' + DB_BINDING + '" is missing. In the Cloudflare dashboard open ' +
      'Workers & Pages -> this project -> Settings -> Bindings, add a D1 database binding ' +
      'called ' + DB_BINDING + ' pointing at the eventemr database, then redeploy.'
    );
  }
  if (!schemaReady) {
    schemaReady = d1
      .prepare('CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL)')
      .run()
      .catch(function (e) { schemaReady = null; throw e; });
  }
  return {
    async get(key) {
      await schemaReady;
      const row = await d1.prepare('SELECT v FROM kv WHERE k = ?').bind(key).first();
      if (!row || !row.v) return null;
      try { return JSON.parse(row.v); } catch (e) { return null; }
    },
    async setJSON(key, value) {
      await schemaReady;
      await d1
        .prepare('INSERT INTO kv (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v')
        .bind(key, JSON.stringify(value))
        .run();
    },
    async list(opts) {
      await schemaReady;
      const prefix = (opts && opts.prefix) || '';
      /* LIKE needs an explicit ESCAPE: an unescaped _ matches any character, so
         a prefix carrying one would quietly match other events' keys too. */
      const like = prefix.replace(/([\\%_])/g, '\\$1') + '%';
      const res = await d1
        .prepare("SELECT k FROM kv WHERE k LIKE ? ESCAPE '\\' ORDER BY k")
        .bind(like)
        .all();
      const rows = (res && res.results) || [];
      return { blobs: rows.map(function (r) { return { key: r.k }; }) };
    }
  };
}

/* A GET reports whether the database is genuinely reachable, so an operator can
   tell a missing binding from a broken deploy without pushing patient data
   through it. The check is a real query, not just a binding test. */
async function health(env) {
  let detail = '';
  let ok = false;
  try {
    const store = db(env);
    await store.get('index/__health__.json');
    detail = 'database reachable';
    ok = true;
  } catch (e) {
    detail = (e && e.message) || String(e);
  }
  return {
    ok: ok,
    blobs: ok ? 'd1' : 'unavailable',
    store: DB_BINDING,
    platform: 'cloudflare-pages',
    detail: detail
  };
}

/* The event index — the one thing readable WITHOUT already knowing an event id.
   Everything else here is keyed by eventId, so a device that has never joined
   an event has nothing it can ask for: it cannot discover one, and the landing
   page fell through to creating a SECOND event instead of joining the first.
   Entries are the whole event record rather than a summary, so the client can
   merge them straight into its store and every existing screen keeps working. */
const IDX_PREFIX = 'index/';
function idxKey(eventId) { return IDX_PREFIX + eventId + '.json'; }

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
/* Every event id ever pushed, read out of the '<eventId>/meta/' namespace. This
   is the backfill path: events created before the index existed have no entry,
   and without this they would stay invisible forever. */
async function listEventIds(store) {
  let res;
  try {
    res = await store.list();
  } catch (e) {
    throw new Error('Could not list the events: ' + niceError(e));
  }
  const found = (res && res.blobs) || [];
  const ids = {};
  for (let i = 0; i < found.length; i++) {
    const key = (found[i] && found[i].key) || '';
    if (key.indexOf(IDX_PREFIX) === 0) continue;
    const slash = key.indexOf('/');
    if (slash <= 0) continue;
    const id = key.slice(0, slash);
    if (ID_RE.test(id)) ids[id] = true;
  }
  return Object.keys(ids);
}

/* Recover an event record from the device blobs that carry it, newest wins. */
async function recoverEvent(store, eventId) {
  const devices = await listDevices(store, eventId);
  let best = null;
  for (let i = 0; i < devices.length; i++) {
    const blob = await readJson(store, devKey(eventId, devices[i]));
    const recs = (blob && blob.records && typeof blob.records === 'object') ? blob.records : {};
    const d = recs['event:' + eventId];
    if (d && wins(best, d)) best = d;
  }
  return best;
}

async function listEvents(store) {
  const out = {};
  let res;
  try {
    res = await store.list({ prefix: IDX_PREFIX });
  } catch (e) {
    throw new Error('Could not list the events: ' + niceError(e));
  }
  const found = (res && res.blobs) || [];
  const reads = [];
  for (let i = 0; i < found.length; i++) {
    const key = (found[i] && found[i].key) || '';
    if (key.indexOf(IDX_PREFIX) === 0) reads.push(readJson(store, key));
  }
  const rows = await Promise.all(reads);
  for (let i = 0; i < rows.length; i++) {
    const ev = rows[i];
    if (ev && ev._t === 'event' && typeof ev.id === 'string') out[ev.id] = ev;
  }

  /* Backfill anything the index never saw, then write the entry so the walk
     over the device blobs happens once rather than on every landing page. */
  const ids = await listEventIds(store);
  for (let i = 0; i < ids.length; i++) {
    if (out[ids[i]]) continue;
    const ev = await recoverEvent(store, ids[i]);
    if (!ev || ev._t !== 'event' || typeof ev.id !== 'string') continue;
    out[ev.id] = ev;
    try { await store.setJSON(idxKey(ev.id), ev); } catch (e) { /* best effort */ }
  }
  return Object.keys(out).map(function (k) { return out[k]; });
}

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

  /* LWW against the stored entry, so a device replaying a stale copy cannot roll
     the index back. Never let a lagging index fail the push that carried it. */
  for (let i = 0; i < changes.length; i++) {
    const d = changes[i];
    if (!d || d._t !== 'event') continue;
    const eid = typeof d.id === 'string' ? d.id : '';
    if (!ID_RE.test(eid)) continue;
    try {
      const cur = await readJson(store, idxKey(eid));
      if (wins(cur, d)) await store.setJSON(idxKey(eid), d);
    } catch (e) { /* the push is what matters */ }
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

async function handleSync(body, event) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { status: 400, payload: { ok: false, error: 'Send a JSON object body' } };
  }

  /* Discovery. Deliberately the only action that needs no eventId — a device
     that has never joined an event has none to send. */
  if (body.action === 'events') {
    const store = db(ENV);
    const events = await listEvents(store);
    return { status: 200, payload: { ok: true, events: events } };
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

  const store = db(ENV);
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
  const extra = String(ENV.SYNC_ALLOWED_ORIGINS || '')
    .split(',').map(function (s) { return s.trim(); }).filter(Boolean);
  for (let i = 0; i < extra.length; i++) {
    if (extra[i] === origin) return origin;
  }
  const site = ENV.URL || ENV.DEPLOY_PRIME_URL || '';
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
  if (req.method === 'GET') {
    const h = await health(ENV);
    return {
      status: h.ok ? 200 : 503,
      headers: head,
      body: JSON.stringify(h)
    };
  }
  if (req.method !== 'POST') {
    return {
      status: 405,
      headers: Object.assign({ Allow: 'GET, POST, OPTIONS' }, head),
      body: JSON.stringify({ ok: false, error: 'POST a JSON body to this endpoint' })
    };
  }
  if (req.raw && utf8Len(req.raw) > MAX_BODY_BYTES) {
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
    const res = await handleSync(body, req.event);
    return { status: res.status, headers: head, body: JSON.stringify(res.payload) };
  } catch (e) {
    return {
      status: 500,
      headers: head,
      body: JSON.stringify({ ok: false, error: niceError(e) })
    };
  }
}

/* ------------------------------------------------------- Cloudflare Pages --
   Pages Functions are ESM and route by file path: this answers /api/sync
   because it sits at functions/api/sync.js, so none of netlify.toml's redirect
   rules are needed for it. */
export async function onRequest(context) {
  ENV = (context && context.env) || {};
  const request = context && context.request;
  const method = (request && request.method) || 'POST';

  let raw = '';
  try {
    if (request && typeof request.text === 'function' &&
        method !== 'GET' && method !== 'OPTIONS') {
      raw = await request.text();
    }
  } catch (e) { raw = ''; }

  const hdr = request && request.headers;
  const get = function (name) {
    return (hdr && typeof hdr.get === 'function' && hdr.get(name)) || '';
  };
  let host = get('x-forwarded-host') || get('host');
  if (!host && request && request.url) {
    try { host = new URL(request.url).host; } catch (e) { host = ''; }
  }

  const res = await route({ method: method, origin: get('origin'), host: host, raw: raw });
  return new Response(res.body, { status: res.status, headers: res.headers });
}

export { mergeLWW, wins, docKey, idxKey, changeProblem, niceError, allowOrigin };
