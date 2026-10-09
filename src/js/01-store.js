/* ==========================================================================
   01-store.js — offline-first persistence and sync.

   A medical post works with no signal at all: every write lands in IndexedDB
   first and is immediately readable. The outbox then drains to /api/sync when
   there is a network. Conflicts resolve last-write-wins on updatedAt with the
   deviceId as a deterministic tie-break, so two posts editing the same patient
   converge on the same answer regardless of who syncs first.
   ========================================================================== */
(function (EV) {
  'use strict';

  var DB_NAME = 'event-emr';
  var DB_VER = 1;
  var STORE = 'docs';
  var OUTBOX = 'outbox';
  var META = 'meta';

  var db = null;
  /* Hot cache: the whole working set is small (a big event is a few thousand
     records) and the dashboard re-renders constantly, so reads must be
     synchronous. IndexedDB is the durable mirror, not the read path. */
  var cache = Object.create(null);   // type -> { id -> doc }
  var outbox = Object.create(null);  // '<type>:<id>' -> doc
  var ready = null;

  var store = EV.store = {
    syncState: {
      online: EV.online(), lastPull: 0, lastPush: 0,
      pending: 0, error: null, lastError: null, failures: 0, busy: false, devices: 0
    }
  };

  function key(type, id) { return type + ':' + id; }
  function bucket(type) { return cache[type] || (cache[type] = Object.create(null)); }

  /* ---- IndexedDB ---------------------------------------------------------- */
  function idb() {
    return new Promise(function (resolve, reject) {
      var req = indexedDB.open(DB_NAME, DB_VER);
      req.onupgradeneeded = function (e) {
        var d = e.target.result;
        if (!d.objectStoreNames.contains(STORE)) {
          var s = d.createObjectStore(STORE, { keyPath: '_k' });
          s.createIndex('type', '_t', { unique: false });
        }
        if (!d.objectStoreNames.contains(OUTBOX)) d.createObjectStore(OUTBOX, { keyPath: '_k' });
        if (!d.objectStoreNames.contains(META)) d.createObjectStore(META);
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
      req.onblocked = function () { reject(new Error('IndexedDB blocked by another tab')); };
    });
  }

  function tx(names, mode) {
    var t = db.transaction(names, mode);
    return {
      t: t,
      s: function (n) { return t.objectStore(n); },
      done: new Promise(function (res, rej) {
        t.oncomplete = function () { res(); };
        t.onerror = function () { rej(t.error); };
        t.onabort = function () { rej(t.error || new Error('aborted')); };
      })
    };
  }

  function getAll(objStore) {
    return new Promise(function (res, rej) {
      var out = [];
      var req = objStore.openCursor();
      req.onsuccess = function (e) {
        var c = e.target.result;
        if (!c) return res(out);
        out.push(c.value);
        c.continue();
      };
      req.onerror = function () { rej(req.error); };
    });
  }

  store.open = function () {
    if (ready) return ready;
    ready = idb().then(function (d) {
      db = d;
      var t = tx([STORE, OUTBOX], 'readonly');
      return Promise.all([getAll(t.s(STORE)), getAll(t.s(OUTBOX))]);
    }).then(function (res) {
      var docs = res[0], pend = res[1], i;
      for (i = 0; i < docs.length; i++) {
        var doc = docs[i];
        /* Heals records stored before the fill existed, so a bad row cannot
           keep crashing the board on every launch. */
        bucket(doc._t)[doc.id] = (EV.model && EV.model.fillDefaults)
          ? EV.model.fillDefaults(doc) : doc;
      }
      for (i = 0; i < pend.length; i++) outbox[pend[i]._k] = pend[i].doc;
      store.syncState.pending = Object.keys(outbox).length;
      EV.emit('store-ready');
      return store;
    }).catch(function (e) {
      /* Private browsing, a full disk, or a locked DB. Degrade to memory
         rather than refusing to open a patient record in the field. */
      EV.logError('store.open', e);
      db = null;
      EV.toast('Storage unavailable — this session will not survive a reload', 'bad', 6000);
      return store;
    });
    return ready;
  };

  function persist(doc) {
    if (!db) return Promise.resolve();
    try {
      var t = tx([STORE], 'readwrite');
      var rec = EV.clone(doc);
      rec._k = key(doc._t, doc.id);
      t.s(STORE).put(rec);
      return t.done.catch(function (e) { EV.logError('store.persist', e); });
    } catch (e) {
      EV.logError('store.persist', e);
      return Promise.resolve();
    }
  }
  function persistOutbox(k, doc) {
    if (!db) return Promise.resolve();
    try {
      var t = tx([OUTBOX], 'readwrite');
      if (doc) t.s(OUTBOX).put({ _k: k, doc: EV.clone(doc) });
      else t.s(OUTBOX).delete(k);
      return t.done.catch(function (e) { EV.logError('store.outbox', e); });
    } catch (e) { return Promise.resolve(); }
  }

  /* ---- reads (synchronous, from cache) ------------------------------------ */
  store.get = function (type, id) {
    var d = bucket(type)[id];
    return d && !d._deleted ? d : undefined;
  };
  store.all = function (type, filter) {
    var b = bucket(type), out = [], id;
    for (id in b) {
      var d = b[id];
      if (d._deleted) continue;
      if (!filter) { out.push(d); continue; }
      if (typeof filter === 'function') { if (filter(d)) out.push(d); continue; }
      var ok = true;
      for (var f in filter) if (d[f] !== filter[f]) { ok = false; break; }
      if (ok) out.push(d);
    }
    return out;
  };
  store.count = function (type, filter) { return store.all(type, filter).length; };

  /* ---- writes ------------------------------------------------------------- */
  store.put = function (doc) {
    if (!doc || !doc._t) throw new Error('store.put needs a doc with _t');
    if (!doc.id) doc.id = EV.uid(doc._t.slice(0, 2));
    var prev = bucket(doc._t)[doc.id];
    doc.rev = ((prev && prev.rev) || 0) + 1;
    doc.updatedAt = EV.now();
    doc.deviceId = EV.deviceId();
    if (!doc.createdAt) doc.createdAt = (prev && prev.createdAt) || doc.updatedAt;
    bucket(doc._t)[doc.id] = doc;

    var k = key(doc._t, doc.id);
    outbox[k] = doc;
    store.syncState.pending = Object.keys(outbox).length;

    EV.emit('change', { type: doc._t, id: doc.id, doc: doc });
    EV.emit('change:' + doc._t, doc);
    nudgeSync();
    return Promise.all([persist(doc), persistOutbox(k, doc)]).then(function () { return doc; });
  };

  /* The interval is the ceiling on how stale a reader can be, not how long a
     writer waits: a local edit goes up almost immediately, so a patient booked
     in at one post shows at the others in about a second. Debounced, so typing
     a name is one request rather than one per keystroke. */
  var nudgeTimer = null;
  function nudgeSync() {
    if (nudgeTimer) return;
    if (!EV.settings.sync.enabled || !EV.settings.eventId) return;
    nudgeTimer = setTimeout(function () {
      nudgeTimer = null;
      store.sync();
    }, 350);
  }

  /* Soft delete. A tombstone still syncs, otherwise a record deleted on one
     post reappears the next time another post pushes its copy. */
  store.del = function (type, id) {
    var d = bucket(type)[id];
    if (!d) return Promise.resolve();
    var t = EV.clone(d);
    t._deleted = true;
    return store.put(t);
  };

  /* Merge records that came from the server. No outbox entry — these are
     already durable upstream. */
  store.bulk = function (docs) {
    var changed = [], i;
    for (i = 0; i < (docs || []).length; i++) {
      var inc = docs[i];
      if (!inc || !inc._t || !inc.id) continue;
      if (EV.model && EV.model.fillDefaults) inc = EV.model.fillDefaults(inc);
      var cur = bucket(inc._t)[inc.id];
      if (cur && !newer(inc, cur)) continue;
      bucket(inc._t)[inc.id] = inc;
      changed.push(inc);
      persist(inc);
      /* A record that came back from the server supersedes our queued copy
         only if it is genuinely newer — otherwise keep pushing ours. */
      var k = key(inc._t, inc.id);
      if (outbox[k] && !newer(outbox[k], inc)) {
        delete outbox[k];
        persistOutbox(k, null);
      }
    }
    store.syncState.pending = Object.keys(outbox).length;
    if (changed.length) {
      for (i = 0; i < changed.length; i++) {
        EV.emit('change', { type: changed[i]._t, id: changed[i].id, doc: changed[i], remote: true });
      }
      EV.emit('bulk', changed);
    }
    return changed.length;
  };

  /* Deterministic LWW: later updatedAt wins; on an exact tie the higher
     deviceId wins so every device reaches the same answer. */
  function newer(a, b) {
    if (!b) return true;
    if (a.updatedAt !== b.updatedAt) return a.updatedAt > b.updatedAt;
    return String(a.deviceId || '') > String(b.deviceId || '');
  }
  store.newer = newer;

  /* ---- meta --------------------------------------------------------------- */
  function metaGet(k) {
    if (!db) return Promise.resolve(null);
    return new Promise(function (res) {
      try {
        var r = tx([META], 'readonly').s(META).get(k);
        r.onsuccess = function () { res(r.result == null ? null : r.result); };
        r.onerror = function () { res(null); };
      } catch (e) { res(null); }
    });
  }
  function metaSet(k, v) {
    if (!db) return Promise.resolve();
    try {
      var t = tx([META], 'readwrite');
      t.s(META).put(v, k);
      return t.done.catch(function () {});
    } catch (e) { return Promise.resolve(); }
  }

  /* ---- sync --------------------------------------------------------------- */
  var autoTimer = null;
  var backoff = 0;

  store.sync = function (opts) {
    opts = opts || {};
    var s = store.syncState;
    if (s.busy) return Promise.resolve(s);
    var cfg = EV.settings.sync;
    var eventId = EV.settings.eventId;
    if (!cfg.enabled || !eventId) return Promise.resolve(s);
    if (!EV.online()) {
      s.online = false;
      EV.emit('sync', s);
      return Promise.resolve(s);
    }

    s.busy = true;
    s.error = null;
    EV.emit('sync', s);

    var changes = [];
    for (var k in outbox) changes.push(outbox[k]);
    /* Oldest first so a truncated push still makes forward progress. */
    changes.sort(function (a, b) { return a.updatedAt - b.updatedAt; });
    var batch = changes.slice(0, 500);
    var sent = {};
    for (var i = 0; i < batch.length; i++) sent[key(batch[i]._t, batch[i].id)] = batch[i].updatedAt;

    return metaGet('since:' + eventId).then(function (since) {
      return fetchJson(cfg.endpoint, {
        eventId: eventId,
        deviceId: EV.deviceId(),
        since: opts.full ? 0 : (since || 0),
        changes: batch
      });
    }).then(function (res) {
      if (!res || res.ok === false) throw new Error((res && res.error) || 'sync rejected');

      /* Clear only what we actually sent, and only if it has not been edited
         again since — otherwise a fast typist loses a keystroke. */
      for (var kk in sent) {
        var pend = outbox[kk];
        if (pend && pend.updatedAt === sent[kk]) {
          delete outbox[kk];
          persistOutbox(kk, null);
        }
      }
      store.bulk(res.changes || []);
      s.devices = res.devices || 0;
      s.lastPush = EV.now();
      s.lastPull = EV.now();
      s.online = true;
      s.lastError = null;
      s.failures = 0;
      s.pending = Object.keys(outbox).length;
      backoff = 0;

      /* truncated => the server had more than it would return in one go.
         Keep the cursor where the server says, and come straight back. */
      var next = res.truncated ? res.nextSince : res.now;
      return metaSet('since:' + eventId, next).then(function () {
        if (res.truncated) return store.sync(opts);
      });
    }).catch(function (e) {
      s.error = e.message || String(e);
      /* Sticky: `error` is cleared at the start of every attempt, so a pill
         bound to it flashes green between retries and tells a field team
         their records are syncing when they are not. */
      s.lastError = s.error;
      s.failures++;
      s.online = EV.online();
      /* Capped lower than it looks: at a 4s base this tops out around half a
         minute, so a post that drops off the network rejoins quickly instead of
         sitting out a four-minute backoff. */
      backoff = Math.min(backoff ? backoff * 2 : 1, 8);
      EV.logError('store.sync', e);
    }).then(function () {
      s.busy = false;
      s.pending = Object.keys(outbox).length;
      EV.emit('sync', s);
      return s;
    });
  };

  function fetchJson(url, body) {
    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, 20000);
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl ? ctrl.signal : undefined
    }).then(function (r) {
      clearTimeout(timer);
      return r.text().then(function (txt) {
        var j = null;
        try { j = JSON.parse(txt); } catch (e) { /* non-JSON error page */ }
        if (!r.ok) {
          /* A 404 here almost always means the site is being served without
             the Netlify functions - say that rather than "HTTP 404", which
             reads like a bug in the app. */
          if (r.status === 404) throw new Error('Sync endpoint not found — the Netlify function is not deployed');
          throw new Error((j && j.error) || ('HTTP ' + r.status));
        }
        return j;
      });
    }, function (e) {
      clearTimeout(timer);
      throw e;
    });
  }
  store.fetchJson = fetchJson;

  store.startAutoSync = function (ms) {
    store.stopAutoSync();
    var base = ms || (EV.settings.sync.intervalMs || 15000);
    function run() {
      store.sync().then(function () {
        autoTimer = setTimeout(run, base * (backoff || 1));
      });
    }
    autoTimer = setTimeout(run, 1200);
  };
  store.stopAutoSync = function () {
    if (autoTimer) clearTimeout(autoTimer);
    autoTimer = null;
  };

  window.addEventListener('online', function () {
    store.syncState.online = true;
    EV.emit('sync', store.syncState);
    store.sync();
  });
  window.addEventListener('offline', function () {
    store.syncState.online = false;
    EV.emit('sync', store.syncState);
  });
  /* A field tablet gets locked and pocketed constantly — sync the moment it
     comes back rather than waiting out the interval. */
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) store.sync();
  });

  /* ---- export / import (the offline escape hatch) ------------------------- */
  store.exportAll = function () {
    var out = { _app: 'event-emr', _v: EV.VERSION, at: EV.now(), docs: [] };
    for (var t in cache) for (var id in cache[t]) out.docs.push(cache[t][id]);
    return out;
  };
  store.importAll = function (json) {
    if (!json || json._app !== 'event-emr') throw new Error('Not an Event EMR backup');
    var docs = json.docs || [];
    /* Imported records must keep their own updatedAt so LWW still means
       something; re-queue them so they reach the other posts. */
    var n = 0;
    for (var i = 0; i < docs.length; i++) {
      var d = docs[i];
      if (!d || !d._t || !d.id) continue;
      var cur = bucket(d._t)[d.id];
      if (cur && !newer(d, cur)) continue;
      bucket(d._t)[d.id] = d;
      persist(d);
      var k = key(d._t, d.id);
      outbox[k] = d;
      persistOutbox(k, d);
      n++;
    }
    store.syncState.pending = Object.keys(outbox).length;
    EV.emit('bulk', docs);
    return n;
  };

  /* Wipe everything on this device. Used by Settings after an event closes;
     the Drive copy and the other posts are the durable record. */
  store.wipe = function () {
    cache = Object.create(null);
    outbox = Object.create(null);
    store.syncState.pending = 0;
    if (!db) return Promise.resolve();
    var t = tx([STORE, OUTBOX, META], 'readwrite');
    t.s(STORE).clear(); t.s(OUTBOX).clear(); t.s(META).clear();
    return t.done.then(function () { EV.emit('bulk', []); });
  };

  store.stats = function () {
    var out = {};
    for (var t in cache) {
      var n = 0;
      for (var id in cache[t]) if (!cache[t][id]._deleted) n++;
      out[t] = n;
    }
    return out;
  };

})(window.EV = window.EV || {});
