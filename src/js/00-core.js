/* ==========================================================================
   00-core.js — the EV namespace.
   Utilities, DOM helpers, the app bus, time formatting, toast/confirm, and the
   settings object every other module leans on. Nothing here touches the
   network or IndexedDB; 01-store.js owns persistence.
   ========================================================================== */
(function (EV) {
  'use strict';

  EV.VERSION = '1.0.0';
  EV.BUILD = '__BUILD_STAMP__';

  /* ---- ids ---------------------------------------------------------------
     Sortable by creation: base36 ms timestamp + 5 random chars. Two records
     made in the same millisecond on the same device still differ. */
  var _seq = 0;
  EV.uid = function (prefix) {
    _seq = (_seq + 1) % 1296;
    var t = Date.now().toString(36);
    var r = Math.floor(Math.random() * 1679616).toString(36);
    while (r.length < 4) r = '0' + r;
    var s = _seq.toString(36);
    while (s.length < 2) s = '0' + s;
    return (prefix ? prefix + '_' : '') + t + r + s;
  };

  /* ---- numbers ----------------------------------------------------------- */
  EV.has = function (v) {
    return v !== undefined && v !== null && v !== '' &&
      !(typeof v === 'number' && isNaN(v));
  };
  EV.num = function (v) {
    if (!EV.has(v)) return undefined;
    var n = typeof v === 'number' ? v : parseFloat(String(v).replace(',', '.'));
    return isNaN(n) ? undefined : n;
  };
  EV.r = function (v, d) {
    if (!EV.has(v) || !isFinite(v)) return v;
    var p = Math.pow(10, d == null ? 1 : d);
    return Math.round(v * p) / p;
  };
  EV.clamp = function (v, lo, hi) { return Math.min(hi, Math.max(lo, v)); };
  EV.fmt = function (v, d) {
    if (!EV.has(v) || !isFinite(v)) return '—';
    var n = EV.r(v, d == null ? 1 : d);
    return String(n);
  };
  EV.pct = function (n, total, d) {
    if (!total) return 0;
    return EV.r((n / total) * 100, d == null ? 0 : d);
  };

  /* ---- strings ----------------------------------------------------------- */
  var ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  EV.esc = function (s) {
    if (s == null) return '';
    return String(s).replace(/[&<>"']/g, function (c) { return ESC[c]; });
  };
  EV.slug = function (s) {
    return String(s || '').toLowerCase()
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);
  };
  EV.norm = function (s) {
    return String(s == null ? '' : s).toLowerCase()
      .replace(/[àáâä]/g, 'a').replace(/[èéêë]/g, 'e').replace(/[ìíîï]/g, 'i')
      .replace(/[òóôö]/g, 'o').replace(/[ùúûü]/g, 'u')
      .replace(/[^a-z0-9%+/.\s-]/g, ' ').replace(/\s+/g, ' ').trim();
  };
  EV.titleCase = function (s) {
    return String(s || '').replace(/\w\S*/g, function (w) {
      return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
    });
  };
  /* FNV-1a — used for the passcode hash and content fingerprints. */
  EV.fnv = function (str) {
    var h = 0x811c9dc5;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
    return ('0000000' + h.toString(16)).slice(-8);
  };

  /* ---- fuzzy search ------------------------------------------------------
     Shared by the formulary, calculator and reference modules so a typo at
     3 a.m. behaves the same everywhere. */
  EV.trigrams = function (s) {
    var t = Object.create(null), x = '  ' + s + ' ', i;
    for (i = 0; i < x.length - 2; i++) t[x.substr(i, 3)] = 1;
    return t;
  };
  EV.dice = function (a, b) {
    var n = 0, na = 0, nb = 0, k;
    for (k in a) { na++; if (b[k]) n++; }
    for (k in b) nb++;
    return na + nb ? (2 * n) / (na + nb) : 0;
  };
  /* Score a query against a haystack string. 0 = no match. */
  EV.matchScore = function (q, hay) {
    if (!q) return 0;
    var h = EV.norm(hay);
    if (!h) return 0;
    if (h === q) return 100;
    if (h.indexOf(q) === 0) return 80;
    var w = h.split(' '), i;
    for (i = 0; i < w.length; i++) if (w[i].indexOf(q) === 0) return 70;
    if (h.indexOf(q) !== -1) return 55;
    if (q.length < 4) return 0;
    var d = EV.dice(EV.trigrams(q), EV.trigrams(h));
    return d > 0.42 ? Math.round(d * 50) : 0;
  };

  /* ---- time --------------------------------------------------------------
     Everything is epoch ms. Display is always local — a field team never
     reasons in UTC, and the Excel recap must match the paper log. */
  EV.now = function () { return Date.now(); };
  function p2(n) { return (n < 10 ? '0' : '') + n; }

  EV.iso = function (ms) {
    var d = new Date(ms == null ? Date.now() : ms);
    var off = -d.getTimezoneOffset();
    var sign = off >= 0 ? '+' : '-';
    var a = Math.abs(off);
    return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()) +
      'T' + p2(d.getHours()) + ':' + p2(d.getMinutes()) + ':' + p2(d.getSeconds()) +
      sign + p2(Math.floor(a / 60)) + ':' + p2(a % 60);
  };
  EV.hhmm = function (ms) {
    if (!EV.has(ms)) return '—';
    var d = new Date(ms);
    return p2(d.getHours()) + ':' + p2(d.getMinutes());
  };
  EV.hhmmss = function (ms) {
    if (!EV.has(ms)) return '—';
    var d = new Date(ms);
    return p2(d.getHours()) + ':' + p2(d.getMinutes()) + ':' + p2(d.getSeconds());
  };
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  EV.dmy = function (ms) {
    if (!EV.has(ms)) return '—';
    var d = new Date(ms);
    return d.getDate() + ' ' + MON[d.getMonth()] + ' ' + d.getFullYear();
  };
  EV.dmyhm = function (ms) {
    if (!EV.has(ms)) return '—';
    return EV.dmy(ms) + ' ' + EV.hhmm(ms);
  };
  /* Elapsed, written the way a code leader says it out loud. */
  EV.dur = function (ms) {
    if (!EV.has(ms) || ms < 0) return '—';
    var s = Math.floor(ms / 1000);
    var h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
    if (h) return h + 'h ' + p2(m) + 'm';
    if (m) return m + 'm ' + p2(ss) + 's';
    return ss + 's';
  };
  EV.durShort = function (ms) {
    if (!EV.has(ms) || ms < 0) return '—';
    var m = Math.round(ms / 60000);
    if (m < 60) return m + 'm';
    return Math.floor(m / 60) + 'h' + (m % 60 ? ' ' + (m % 60) + 'm' : '');
  };
  EV.mmss = function (ms) {
    var neg = ms < 0;
    var s = Math.floor(Math.abs(ms) / 1000);
    return (neg ? '-' : '') + p2(Math.floor(s / 60)) + ':' + p2(s % 60);
  };
  /* Minutes between two stamps, undefined when either is missing. */
  EV.mins = function (a, b) {
    if (!EV.has(a) || !EV.has(b)) return undefined;
    return (b - a) / 60000;
  };
  /* Parse a 'YYYY-MM-DD' or datetime-local value to local epoch ms. */
  EV.parseLocal = function (s) {
    if (!s) return undefined;
    var m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(String(s));
    if (!m) return undefined;
    return new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0)).getTime();
  };
  /* The value a <input type="datetime-local"> wants. */
  EV.localInput = function (ms) {
    if (!EV.has(ms)) return '';
    var d = new Date(ms);
    return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()) +
      'T' + p2(d.getHours()) + ':' + p2(d.getMinutes());
  };
  EV.dateInput = function (ms) {
    if (!EV.has(ms)) return '';
    var d = new Date(ms);
    return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate());
  };

  /* ---- statistics (shared with analytics) -------------------------------- */
  EV.median = function (arr) { return EV.quantile(arr, 0.5); };
  EV.quantile = function (arr, q) {
    var a = (arr || []).filter(function (v) { return EV.has(v) && isFinite(v); })
      .slice().sort(function (x, y) { return x - y; });
    if (!a.length) return undefined;
    if (a.length === 1) return a[0];
    var pos = (a.length - 1) * q;
    var lo = Math.floor(pos), hi = Math.ceil(pos);
    if (lo === hi) return a[lo];
    return a[lo] + (a[hi] - a[lo]) * (pos - lo);
  };
  EV.sum = function (arr) {
    var s = 0;
    for (var i = 0; i < (arr || []).length; i++) s += (+arr[i] || 0);
    return s;
  };

  /* ---- DOM --------------------------------------------------------------- */
  EV.el = function (tag, attrs, children) {
    var e = document.createElement(tag), k;
    if (attrs) for (k in attrs) {
      if (k === 'class') e.className = attrs[k];
      else if (k === 'html') e.innerHTML = attrs[k];
      else if (k === 'text') e.textContent = attrs[k];
      else if (k === 'style' && typeof attrs[k] === 'object') Object.assign(e.style, attrs[k]);
      else if (k === 'on') {
        for (var ev in attrs[k]) e.addEventListener(ev, attrs[k][ev]);
      } else if (k === 'data') {
        for (var d in attrs[k]) e.setAttribute('data-' + d, attrs[k][d]);
      } else if (attrs[k] !== undefined && attrs[k] !== null && attrs[k] !== false) {
        e.setAttribute(k, attrs[k] === true ? '' : attrs[k]);
      }
    }
    if (children != null) {
      var list = Array.isArray(children) ? children : [children];
      for (var i = 0; i < list.length; i++) {
        var c = list[i];
        if (c == null || c === false) continue;
        e.appendChild(typeof c === 'string' || typeof c === 'number'
          ? document.createTextNode(String(c)) : c);
      }
    }
    return e;
  };
  EV.h = function (html) {
    var t = document.createElement('template');
    t.innerHTML = String(html).trim();
    return t.content;
  };
  EV.qs = function (sel, root) { return (root || document).querySelector(sel); };
  EV.qsa = function (sel, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(sel));
  };
  EV.clear = function (node) { while (node && node.firstChild) node.removeChild(node.firstChild); };
  EV.show = function (node, on) { if (node) node.hidden = !on; };

  /* ---- bus ---------------------------------------------------------------
     Deliberately tiny. A handler that throws must not stop the others —
     a broken analytics panel should never take the patient list down. */
  var BUS = Object.create(null);
  EV.on = function (name, fn) {
    (BUS[name] = BUS[name] || []).push(fn);
    return function () { EV.off(name, fn); };
  };
  EV.off = function (name, fn) {
    var a = BUS[name];
    if (!a) return;
    var i = a.indexOf(fn);
    if (i !== -1) a.splice(i, 1);
  };
  EV.emit = function (name, payload) {
    var a = (BUS[name] || []).slice();
    for (var i = 0; i < a.length; i++) {
      try { a[i](payload); } catch (e) { EV.logError('bus:' + name, e); }
    }
  };

  /* ---- error journal -----------------------------------------------------
     Field devices are borrowed and offline; there is no console to read
     afterwards. Keep the last 50 errors so Settings can show them. */
  EV.errors = [];
  EV.logError = function (where, err) {
    EV.errors.unshift({
      t: Date.now(), where: where,
      msg: (err && err.message) || String(err),
      stack: (err && err.stack) || ''
    });
    if (EV.errors.length > 50) EV.errors.length = 50;
  };

  /* ---- toast ------------------------------------------------------------- */
  var toastHost = null, toastTimer = null;
  EV.toast = function (msg, kind, ms) {
    if (!toastHost) {
      toastHost = EV.el('div', { class: 'toast-host', role: 'status', 'aria-live': 'polite' });
      document.body.appendChild(toastHost);
    }
    EV.clear(toastHost);
    toastHost.appendChild(EV.el('div', { class: 'toast ' + (kind || ''), text: msg }));
    toastHost.classList.add('on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastHost.classList.remove('on'); }, ms || 2600);
  };

  /* ---- confirm / prompt --------------------------------------------------
     Never window.confirm: it blocks the sync loop and looks alien on a tablet. */
  EV.confirm = function (msg, opts) {
    opts = opts || {};
    return new Promise(function (resolve) {
      var scrim = EV.el('div', { class: 'scrim on' });
      function close(v) {
        document.removeEventListener('keydown', key);
        if (scrim.parentNode) scrim.parentNode.removeChild(scrim);
        resolve(v);
      }
      function key(e) {
        if (e.key === 'Escape') close(false);
        if (e.key === 'Enter') close(true);
      }
      var box = EV.el('div', { class: 'dialog' }, [
        EV.el('div', { class: 'dialog-b', text: msg }),
        EV.el('div', { class: 'dialog-f' }, [
          EV.el('button', {
            class: 'btn', type: 'button', text: opts.cancel || 'Cancel',
            on: { click: function () { close(false); } }
          }),
          EV.el('button', {
            class: 'btn ' + (opts.danger ? 'bad' : 'pri'), type: 'button',
            text: opts.ok || 'OK', on: { click: function () { close(true); } }
          })
        ])
      ]);
      scrim.appendChild(box);
      scrim.addEventListener('click', function (e) { if (e.target === scrim) close(false); });
      document.addEventListener('keydown', key);
      document.body.appendChild(scrim);
      var b = EV.qs('.btn.pri, .btn.bad', box);
      if (b) b.focus();
    });
  };

  /* ---- device identity ---------------------------------------------------
     Stable per browser profile. Used as the sync shard key and the LWW
     tie-break, so it must never change under a device's feet. */
  var _dev = null;
  EV.deviceId = function () {
    if (_dev) return _dev;
    try {
      _dev = localStorage.getItem('ev.device');
      if (!_dev) {
        _dev = 'd' + Date.now().toString(36) + Math.floor(Math.random() * 46656).toString(36);
        localStorage.setItem('ev.device', _dev);
      }
    } catch (e) {
      _dev = 'd' + Math.floor(Math.random() * 1e9).toString(36);
    }
    return _dev;
  };

  /* ---- settings ----------------------------------------------------------
     Device-local, never synced: which post this tablet is, its theme, the
     endpoints. Clinical data lives in the store. */
  var DEFAULTS = {
    eventId: '',
    postId: '',
    deviceLabel: '',
    theme: 'light',
    sync: { enabled: true, endpoint: '/api/sync', intervalMs: 15000 },
    drive: {
      enabled: false, endpoint: '/api/drive', folderName: '',
      autoUpload: true, uploadOn: 'close', eventFolderId: '', patientsFolderId: ''
    },
    ui: { density: 'comfortable', fontScale: 1, soundOn: true },
    passcodeHash: null,
    onboarded: false,
    /* Which post this device is bound to, and who is on it. Device-local by
       design: the binding is a property of the tablet, not of the event. */
    bind: null,
    chatSeen: {},
    chatOpen: []
  };
  function deepMerge(base, over) {
    var out = {}, k;
    for (k in base) {
      if (base[k] && typeof base[k] === 'object' && !Array.isArray(base[k])) {
        out[k] = deepMerge(base[k], (over && over[k]) || {});
      } else {
        out[k] = over && over[k] !== undefined ? over[k] : base[k];
      }
    }
    if (over) for (k in over) if (!(k in out)) out[k] = over[k];
    return out;
  }
  EV.settings = deepMerge(DEFAULTS, (function () {
    try { return JSON.parse(localStorage.getItem('ev.settings') || '{}'); }
    catch (e) { return {}; }
  })());

  EV.save = function () {
    try { localStorage.setItem('ev.settings', JSON.stringify(EV.settings)); }
    catch (e) { EV.logError('settings.save', e); }
    EV.emit('settings', EV.settings);
  };

  /* The passcode that unlocks configuration. Shipped locked to the brief's
     89370; stored as a hash so the digits are not sitting in localStorage. */
  EV.PASS_SALT = 'ev-mini-ambulatory-v1';
  EV.hashPass = function (code) { return EV.fnv(EV.PASS_SALT + String(code || '')); };
  if (!EV.settings.passcodeHash) {
    EV.settings.passcodeHash = EV.hashPass('89370');
    EV.save();
  }

  /* ---- theme -------------------------------------------------------------
     Light only, deliberately. A medical tent is lit by daylight or a
     floodlight; a dark UI on a glossy tablet in either is unreadable, and a
     device that silently flips theme at dusk is worse than one that does not
     offer the choice. Text size and density remain adjustable. */
  EV.applyTheme = function () {
    var root = document.documentElement;
    root.setAttribute('data-theme', 'light');
    root.style.setProperty('--font-scale', EV.settings.ui.fontScale || 1);
    root.setAttribute('data-density', EV.settings.ui.density || 'comfortable');
  };

  /* ---- misc -------------------------------------------------------------- */
  EV.debounce = function (fn, ms) {
    var t;
    return function () {
      var self = this, a = arguments;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(self, a); }, ms || 180);
    };
  };
  EV.throttle = function (fn, ms) {
    var last = 0, t;
    return function () {
      var self = this, a = arguments, now = Date.now();
      var wait = ms - (now - last);
      if (wait <= 0) { last = now; fn.apply(self, a); }
      else { clearTimeout(t); t = setTimeout(function () { last = Date.now(); fn.apply(self, a); }, wait); }
    };
  };
  EV.clone = function (o) { return o == null ? o : JSON.parse(JSON.stringify(o)); };
  EV.groupBy = function (arr, key) {
    var out = Object.create(null);
    for (var i = 0; i < (arr || []).length; i++) {
      var k = typeof key === 'function' ? key(arr[i]) : arr[i][key];
      if (k == null) k = '';
      (out[k] = out[k] || []).push(arr[i]);
    }
    return out;
  };
  EV.sortBy = function (arr, key, dir) {
    var d = dir === 'desc' ? -1 : 1;
    return (arr || []).slice().sort(function (a, b) {
      var x = typeof key === 'function' ? key(a) : a[key];
      var y = typeof key === 'function' ? key(b) : b[key];
      if (x == null && y == null) return 0;
      if (x == null) return 1;
      if (y == null) return -1;
      return x < y ? -d : x > y ? d : 0;
    });
  };
  EV.uniq = function (arr) {
    var seen = Object.create(null), out = [];
    for (var i = 0; i < (arr || []).length; i++) {
      var k = String(arr[i]);
      if (!seen[k]) { seen[k] = 1; out.push(arr[i]); }
    }
    return out;
  };

  /* base64 <-> bytes, used by the PDF/XLSX writers and the Drive upload. */
  EV.bytesToB64 = function (bytes) {
    var CH = 0x8000, out = [];
    for (var i = 0; i < bytes.length; i += CH) {
      out.push(String.fromCharCode.apply(null, bytes.subarray(i, Math.min(i + CH, bytes.length))));
    }
    return btoa(out.join(''));
  };
  EV.b64ToBytes = function (b64) {
    var bin = atob(String(b64).replace(/\s+/g, ''));
    var out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  };
  EV.utf8 = function (str) {
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(str);
    var s = unescape(encodeURIComponent(str)), out = new Uint8Array(s.length);
    for (var i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  };

  /* Handing a file to the user.

     On Netlify (or any ordinary origin) an anchor with `download` works. In
     the claude.ai artifact sandbox it is inert — the click does nothing and
     the user is left thinking the button is broken — so the viewer grants the
     save explicitly through the `downloads` capability. Resolve it once at
     load; it stays null everywhere else and the anchor path takes over. */
  EV.saver = null;
  EV.saverReady = false;
  if (window.claude && typeof window.claude.use === 'function') {
    try {
      window.claude.use('downloads').then(function (d) {
        EV.saver = d || null;
        EV.saverReady = true;
        EV.emit('saver', EV.saver);
      }, function () { EV.saverReady = true; });
    } catch (e) { EV.saverReady = true; }
  } else {
    EV.saverReady = true;
  }

  /* Returns how the file was offered: 'capability' (the viewer is being asked
     — do not announce success yet), 'download', or 'tab'. */
  EV.download = function (blob, filename) {
    if (EV.saver && typeof EV.saver.save === 'function') {
      EV.saver.save({ filename: filename, data: blob }).then(function () {
        EV.toast('Saved ' + filename, 'ok');
      }, function (err) {
        var code = (err && err.code) || '';
        if (code === 'declined' || code === 'rate_limited') return;
        EV.logError('download', err);
        EV.toast('Could not save the file here — use Print, or open the app on Netlify', 'warn', 6000);
      });
      return 'capability';
    }
    var url = URL.createObjectURL(blob);
    try {
      var a = EV.el('a', { href: url, download: filename, style: { display: 'none' } });
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 30000);
      return 'download';
    } catch (e) {
      window.open(url, '_blank');
      return 'tab';
    }
  };

  EV.isTouch = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
  EV.online = function () { return navigator.onLine !== false; };

})(window.EV = window.EV || {});
