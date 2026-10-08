/* ==========================================================================
   10-ui.js — the shell: top bar, router, sheets, and the shared controls
   every screen is built out of.

   The inline module buttons live here too (EV.ui.fieldBtn). They are what the
   brief calls "small buttons within the input fields": a calculator beside
   weight, the reference beside the complaint, the formulary beside an order.
   They must never steal the caret — a nurse half-way through typing a name
   who taps one has to come back to the same cursor position.
   ========================================================================== */
(function (EV) {
  'use strict';

  var UI = EV.ui = {};

  /* ---- icons (inline, so nothing is fetched) ------------------------------ */
  var I = UI.icons = {
    board: '<path d="M3 4h18v6H3zM3 13h8v7H3zM14 13h7v7h-7z"/>',
    patients: '<path d="M16 19v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 19v-2a4 4 0 0 0-3-3.87"/>',
    chart: '<path d="M3 3v18h18"/><path d="M7 15l4-5 3 3 5-7"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6 1.65 1.65 0 0 0 10 3.09V3a2 2 0 0 1 4 0v.09A1.65 1.65 0 0 0 15 4.6a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9c.14.47.5.84 1 .98H21a2 2 0 0 1 0 4h-.09c-.5.14-.86.51-1 1z"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    close: '<path d="M18 6 6 18M6 6l12 12"/>',
    back: '<path d="m15 18-6-6 6-6"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
    sync: '<path d="M21 2v6h-6"/><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M3 22v-6h6"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/>',
    pdf: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M9 15h6M9 18h4"/>',
    xls: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="m9 13 6 6M15 13l-6 6"/>',
    print: '<path d="M6 9V2h12v7"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><path d="M6 14h12v8H6z"/>',
    drive: '<path d="M12 2v14M5 9l7-7 7 7"/><path d="M3 16v3a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-3"/>',
    heart: '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 1 0-7.8 7.8l1.1 1L12 21l7.7-7.6 1.1-1a5.5 5.5 0 0 0 0-7.8z"/>',
    amb: '<path d="M10 17h4V5H2v12h3"/><path d="M20 17h2v-3.3a4 4 0 0 0-.8-2.4L19 8h-5v9h2"/><circle cx="7.5" cy="17.5" r="2.5"/><circle cx="17.5" cy="17.5" r="2.5"/><path d="M6 10h4M8 8v4"/>',
    bed: '<path d="M2 4v16M2 8h18a2 2 0 0 1 2 2v10M2 17h20"/><circle cx="7" cy="12" r="2"/>',
    lock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    alert: '<path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/>',
    note: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M8 13h8M8 17h5"/>',
    pill: '<path d="M10.5 20.5 3.5 13.5a5 5 0 0 1 7-7l7 7a5 5 0 0 1-7 7z"/><path d="m8.5 8.5 7 7"/>',
    trash: '<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>',
    book: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>',
    down: '<path d="M12 5v14M19 12l-7 7-7-7"/>'
  };
  UI.icon = function (name, size) {
    return '<svg viewBox="0 0 24 24" width="' + (size || 18) + '" height="' + (size || 18) +
      '" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" ' +
      'stroke-linejoin="round" aria-hidden="true">' + (I[name] || '') + '</svg>';
  };

  /* ---- routing -----------------------------------------------------------
     Hash-based so the app survives a refresh on a flaky venue wifi and so a
     post can bookmark its own board. */
  var routes = Object.create(null);
  UI.route = function (name, fn) { routes[name] = fn; };
  UI.current = { name: 'board', arg: '' };

  UI.go = function (name, arg, replace) {
    var h = '#/' + name + (arg ? '/' + encodeURIComponent(arg) : '');
    if (location.hash === h) { UI.render(); return; }
    if (replace) location.replace(h); else location.hash = h;
  };
  function parseHash() {
    var m = /^#\/([a-z-]+)(?:\/(.*))?$/.exec(location.hash || '');
    return m ? { name: m[1], arg: m[2] ? decodeURIComponent(m[2]) : '' } : { name: 'board', arg: '' };
  }
  window.addEventListener('hashchange', function () { UI.render(); });

  /* ---- shell -------------------------------------------------------------- */
  var mainEl = null, navEl = null, statusEl = null;

  UI.mount = function (root) {
    var bar = EV.el('div', { class: 'topbar' });

    var brand = EV.el('div', { class: 'brandmark' });
    brand.appendChild(EV.h(
      '<span class="plate"><img src="' + (EV.LOGO || 'assets/siloam.png') +
      '" alt="Siloam Hospitals" width="104" height="42"></span>' +
      '<span class="title">' +
      '<span class="t1">Mini Emergency &amp; Critical Care</span>' +
      '<span class="t2">Event EMR</span>' +
      '</span>'
    ));
    bar.appendChild(brand);
    bar.appendChild(EV.el('div', { class: 'spacer' }));

    navEl = EV.el('nav', { class: 'nav', 'aria-label': 'Main' });
    bar.appendChild(navEl);

    statusEl = EV.el('div', { class: 'row tight' });
    bar.appendChild(statusEl);

    mainEl = EV.el('main', { class: 'main', id: 'main' });

    root.appendChild(bar);
    root.appendChild(mainEl);

    EV.on('change', UI.scheduleRender);
    EV.on('bulk', UI.scheduleRender);
    EV.on('sync', renderStatus);
    EV.on('settings', function () { EV.applyTheme(); UI.scheduleRender(); });
    EV.on('change:chat', function () { if (UI.renderChat) UI.renderChat(); });

    /* The board shows live elapsed times; a 10s beat is enough and costs
       nothing, but only while the tab is actually visible. */
    setInterval(function () {
      if (!document.hidden && (UI.current.name === 'board' || UI.current.name === 'patients')) UI.scheduleRender();
    }, 10000);

    UI.render();
  };

  var pending = null;
  UI.scheduleRender = function () {
    if (pending) return;
    pending = requestAnimationFrame(function () { pending = null; UI.render(); });
  };

  UI.render = function () {
    var r = parseHash();
    /* The landing page is the only route that works without a binding. */
    if (r.name !== 'landing' && UI.needsLanding && UI.needsLanding()) r = { name: 'landing', arg: '' };
    UI.current = r;
    var fn = routes[r.name] || routes.board;
    EV.clear(mainEl);
    var wrap = EV.el('div', { class: 'wrap' + (r.name === 'settings' || r.name === 'patient' ? '' : '') });
    mainEl.appendChild(wrap);
    try {
      fn(wrap, r.arg);
    } catch (e) {
      EV.logError('render:' + r.name, e);
      wrap.appendChild(EV.el('div', { class: 'empty' }, [
        EV.el('h3', { text: 'This screen failed to draw' }),
        EV.el('p', { text: e.message || String(e) }),
        EV.el('button', { class: 'btn', text: 'Back to the board', on: { click: function () { UI.go('board'); } } })
      ]));
    }
    renderNav();
    renderStatus();
  };

  function renderNav() {
    EV.clear(navEl);
    if (UI.needsLanding && UI.needsLanding()) return;
    var open = EV.model.openPatients().length;
    var items = [
      { k: 'board', l: 'Board', i: 'board', n: open || null },
      { k: 'patients', l: 'Patients', i: 'patients' },
      { k: 'analytics', l: 'Analytics', i: 'chart' },
      { k: 'settings', l: 'Settings', i: 'gear' }
    ];
    for (var i = 0; i < items.length; i++) (function (it) {
      var b = EV.el('button', {
        class: UI.current.name === it.k || (it.k === 'patients' && UI.current.name === 'patient') ? 'on' : '',
        type: 'button', title: it.l,
        on: { click: function () { UI.go(it.k); } }
      });
      b.innerHTML = UI.icon(it.i, 17) + '<span class="navlbl">' + it.l + '</span>' +
        (it.n ? '<span class="n">' + it.n + '</span>' : '');
      navEl.appendChild(b);
    })(items[i]);
  }

  function renderStatus() {
    if (!statusEl) return;
    EV.clear(statusEl);
    var s = EV.store.syncState;
    var broken = !!(s.error || s.lastError);
    var cls = 'pill syncpill' + (broken ? ' error' : !s.online ? ' offline' : ' ok') + (s.busy ? ' busy' : '');
    var label = broken
      ? (s.pending ? s.pending + ' not sent' : 'Sync failing')
      : !s.online ? (s.pending ? s.pending + ' offline' : 'Offline')
        : s.pending ? s.pending + ' queued'
          : s.lastPull ? 'Synced ' + EV.hhmm(s.lastPull) : 'Local only';
    var p = EV.el('button', {
      class: cls, type: 'button',
      title: (s.error || s.lastError || 'Tap to sync now') +
        (broken && s.failures > 1 ? '  (' + s.failures + ' failed attempts)' : ''),
      on: { click: function () { EV.store.sync({ full: false }).then(function () { EV.toast('Sync run'); }); } }
    });
    p.innerHTML = '<span class="dot"></span>' + EV.esc(label);
    statusEl.appendChild(p);
  }

  /* ---- sheets ------------------------------------------------------------ */
  var openSheets = [];
  UI.sheet = function (opts) {
    var scrim = EV.el('div', { class: 'scrim', style: { background: 'rgba(10,16,28,.42)' } });
    var sheet = EV.el('aside', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': opts.title || 'Panel' });

    var head = EV.el('div', { class: 'sh' });
    head.appendChild(EV.el('h2', { text: opts.title || '', class: 'grow trunc' }));
    if (opts.head) head.appendChild(opts.head);
    var x = EV.el('button', { class: 'iconbtn', type: 'button', 'aria-label': 'Close' });
    x.innerHTML = UI.icon('close');
    x.addEventListener('click', function () { api.close(); });
    head.appendChild(x);

    var body = EV.el('div', { class: 'sb' });
    var foot = opts.footer ? EV.el('div', { class: 'sf' }) : null;

    sheet.appendChild(head);
    sheet.appendChild(body);
    if (foot) sheet.appendChild(foot);

    function key(e) {
      if (e.key === 'Escape' && openSheets[openSheets.length - 1] === api) { e.stopPropagation(); api.close(); }
    }
    var api = {
      el: sheet, body: body, foot: foot,
      close: function (val) {
        document.removeEventListener('keydown', key, true);
        if (scrim.parentNode) scrim.parentNode.removeChild(scrim);
        if (sheet.parentNode) sheet.parentNode.removeChild(sheet);
        var i = openSheets.indexOf(api);
        if (i !== -1) openSheets.splice(i, 1);
        if (opts.onClose) opts.onClose(val);
      },
      setBody: function (node) { EV.clear(body); body.appendChild(node); },
      setFooter: function (nodes) {
        if (!foot) return;
        EV.clear(foot);
        for (var i = 0; i < nodes.length; i++) if (nodes[i]) foot.appendChild(nodes[i]);
      }
    };
    scrim.addEventListener('click', function (e) { if (e.target === scrim) api.close(); });
    document.addEventListener('keydown', key, true);
    document.body.appendChild(scrim);
    document.body.appendChild(sheet);
    openSheets.push(api);

    if (opts.body) api.setBody(opts.body);
    if (opts.footer && foot) api.setFooter(opts.footer);
    /* Focus the first real control, not the close button — the common case
       is "type here immediately". */
    setTimeout(function () {
      var f = EV.qs('input, select, textarea, button.btn', body);
      if (f && !EV.isTouch) f.focus();
    }, 30);
    return api;
  };

  /* ---- form controls ------------------------------------------------------
     Thin wrappers that keep every field in the app on the same grid, the same
     label treatment, and the same inline-button mechanism. */

  UI.field = function (o) {
    var f = EV.el('div', { class: 'f ' + (o.cls || '') });
    if (o.label) {
      var lab = EV.el('label', { for: o.id || null }, [o.label]);
      if (o.req) lab.appendChild(EV.el('span', { style: { color: 'var(--bad)' }, text: '*' }));
      f.appendChild(lab);
    }
    var ctrl;
    if (o.type === 'select') {
      ctrl = EV.el('select', { id: o.id || null, name: o.name || null });
      var opts = o.options || [];
      for (var i = 0; i < opts.length; i++) {
        var op = opts[i];
        var v = typeof op === 'object' ? op.v : op;
        var l = typeof op === 'object' ? op.l : op;
        ctrl.appendChild(EV.el('option', { value: v, selected: String(v) === String(o.value) ? true : null }, [l]));
      }
      if (o.placeholder !== undefined) {
        ctrl.insertBefore(EV.el('option', { value: '', selected: !EV.has(o.value) ? true : null }, [o.placeholder]), ctrl.firstChild);
      }
    } else if (o.type === 'textarea') {
      ctrl = EV.el('textarea', {
        id: o.id || null, rows: o.rows || 3, placeholder: o.placeholder || '',
        name: o.name || null
      });
      ctrl.value = o.value == null ? '' : o.value;
    } else {
      ctrl = EV.el('input', {
        id: o.id || null, type: o.type || 'text', placeholder: o.placeholder || '',
        name: o.name || null, inputmode: o.inputmode || null,
        step: o.step || null, min: o.min != null ? o.min : null, max: o.max != null ? o.max : null,
        autocomplete: o.autocomplete || 'off', maxlength: o.maxlength || null
      });
      ctrl.value = o.value == null ? '' : o.value;
      if (o.type === 'number') f.classList.add('n');
    }
    if (o.on) for (var ev in o.on) ctrl.addEventListener(ev, o.on[ev]);
    if (o.onInput) ctrl.addEventListener('input', function () { o.onInput(ctrl.value, ctrl); });
    if (o.onChange) ctrl.addEventListener('change', function () { o.onChange(ctrl.value, ctrl); });

    if (o.buttons && o.buttons.length) {
      var holder = EV.el('div', { class: 'with-btn' + (o.buttons.length > 1 ? ' two' : '') });
      holder.appendChild(ctrl);
      for (var b = 0; b < o.buttons.length; b++) {
        holder.appendChild(UI.fieldBtn(o.buttons[b], ctrl, b === 1));
      }
      f.appendChild(holder);
    } else {
      f.appendChild(ctrl);
    }

    if (o.hint) f.appendChild(EV.el('div', { class: 'hint', text: o.hint }));
    f.input = ctrl;
    f.value = function () { return ctrl.value; };
    f.setError = function (msg) {
      f.classList.toggle('bad', !!msg);
      var e = EV.qs('.err', f);
      if (e) e.parentNode.removeChild(e);
      if (msg) f.appendChild(EV.el('div', { class: 'err', text: msg }));
    };
    return f;
  };

  /* The inline module button. `mousedown` is cancelled so the field keeps the
     caret and the half-typed value; the handler receives the live value. */
  UI.fieldBtn = function (spec, ctrl, second) {
    var b = EV.el('button', {
      class: 'fx' + (second ? ' second' : '') + (spec.cls ? ' ' + spec.cls : ''),
      type: 'button', title: spec.title || '', 'aria-label': spec.title || spec.label
    }, [spec.label]);
    b.addEventListener('mousedown', function (e) { e.preventDefault(); });
    b.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      spec.onClick(ctrl ? ctrl.value : '', ctrl);
    });
    return b;
  };

  UI.segment = function (o) {
    var wrap = EV.el('div', { class: 'seg ' + (o.cls || '') + (o.block ? ' block' : '') });
    var cur = o.value;
    (o.options || []).forEach(function (op) {
      var v = typeof op === 'object' ? op.v : op;
      var l = typeof op === 'object' ? op.l : op;
      var b = EV.el('button', {
        type: 'button', class: String(v) === String(cur) ? 'on' : '',
        data: o.dataKey ? (function () { var d = {}; d[o.dataKey] = v; return d; })() : null,
        title: (typeof op === 'object' && op.hint) || null
      }, [l]);
      b.addEventListener('click', function () {
        cur = v;
        EV.qsa('button', wrap).forEach(function (x) { x.classList.remove('on'); });
        b.classList.add('on');
        if (o.onChange) o.onChange(v);
      });
      wrap.appendChild(b);
    });
    wrap.get = function () { return cur; };
    return wrap;
  };

  UI.stat = function (label, value, sub, cls) {
    var s = EV.el('div', { class: 'stat ' + (cls || '') });
    s.appendChild(EV.el('label', { text: label }));
    s.appendChild(EV.el('b', { text: value == null ? '—' : String(value) }));
    if (sub) s.appendChild(EV.el('small', { text: sub }));
    return s;
  };

  UI.sectionHead = function (title, action) {
    var h = EV.el('div', { class: 'sec-h' }, [title, EV.el('span', { class: 'rule' })]);
    if (action) h.appendChild(action);
    return h;
  };

  UI.card = function (title, bodyNode, opts) {
    opts = opts || {};
    var c = EV.el('div', { class: 'card ' + (opts.cls || '') });
    if (title || opts.head) {
      var h = EV.el('div', { class: 'card-h' });
      h.appendChild(EV.el('h3', { text: title || '', class: 'grow trunc' }));
      if (opts.head) h.appendChild(opts.head);
      c.appendChild(h);
    }
    var b = EV.el('div', { class: 'card-b' + (opts.flush ? ' flush' : '') });
    if (bodyNode) b.appendChild(bodyNode);
    c.appendChild(b);
    if (opts.footer) {
      var f = EV.el('div', { class: 'card-f' });
      for (var i = 0; i < opts.footer.length; i++) if (opts.footer[i]) f.appendChild(opts.footer[i]);
      c.appendChild(f);
    }
    c.body = b;
    return c;
  };

  UI.empty = function (title, text, action) {
    var e = EV.el('div', { class: 'empty' }, [
      EV.el('h3', { text: title }),
      text ? EV.el('p', { text: text }) : null
    ]);
    if (action) e.appendChild(action);
    return e;
  };

  UI.btn = function (label, cls, onClick, icon) {
    var b = EV.el('button', { class: 'btn ' + (cls || ''), type: 'button' });
    if (icon) b.innerHTML = UI.icon(icon, 16);
    b.appendChild(document.createTextNode(label));
    if (onClick) b.addEventListener('click', onClick);
    return b;
  };

  UI.acuityBadge = function (v) {
    var a = EV.model.acuity(v);
    return EV.el('span', { class: 'acu ' + a.c, title: a.l + ' — ' + a.hint }, [a.s]);
  };

  UI.flagChips = function (flags, max) {
    var w = EV.el('span', { class: 'flagchips' });
    var list = (flags || []).slice(0, max || 3);
    for (var i = 0; i < list.length; i++) {
      w.appendChild(EV.el('span', {
        class: 'flagchip' + (list[i].sev >= 2 ? ' sev2' : ''), text: list[i].l
      }));
    }
    if ((flags || []).length > list.length) {
      w.appendChild(EV.el('span', { class: 'flagchip', text: '+' + (flags.length - list.length) }));
    }
    return w;
  };

  /* A patient row, used on the board, the patient list and inside posts. */
  UI.patientRow = function (p, opts) {
    opts = opts || {};
    var d = EV.model.derive(p);
    var a = EV.model.acuity(p.acuity);
    var row = EV.el('button', {
      class: 'prow ' + a.c + (p.status === 'closed' ? ' closed' : '') +
        (d.worstFlag >= 2 && p.status !== 'closed' ? ' urgent' : ''),
      type: 'button'
    });
    row.appendChild(UI.acuityBadge(p.acuity));

    var mid = EV.el('span', { class: 'grow' });
    mid.appendChild(EV.el('span', { class: 'nm trunc', text: p.name || '(no name)' }));
    var sub = EV.el('span', { class: 'sub' });
    sub.appendChild(EV.el('span', { class: 'mrn', text: p.mrn || '—' }));
    if (EV.has(d.ageYears)) sub.appendChild(EV.el('span', { text: EV.fmt(d.ageYears, 0) + (p.sex ? ' ' + p.sex : '') }));
    if (p.chiefComplaint) sub.appendChild(EV.el('span', { class: 'trunc', text: p.chiefComplaint }));
    if (opts.showPost) {
      var po = EV.model.post(p.postId);
      if (po) sub.appendChild(EV.el('span', { text: po.code || po.name }));
    }
    mid.appendChild(sub);
    if (d.redFlags.length && p.status !== 'closed') mid.appendChild(UI.flagChips(d.redFlags));
    row.appendChild(mid);

    var rt = EV.el('span', { class: 'rt' });
    if (p.status === 'closed') {
      rt.appendChild(EV.el('span', { class: 'tag ' + EV.model.dispo(p.disposition).c, text: EV.model.dispo(p.disposition).l }));
    } else {
      rt.appendChild(EV.el('span', { class: 'los', text: d.los }));
    }
    row.appendChild(rt);

    row.addEventListener('click', function () {
      if (opts.onClick) opts.onClick(p);
      else UI.go('patient', p.id);
    });
    return row;
  };

  /* ---- passcode gate ------------------------------------------------------
     Guards bed/post configuration and the formulary editor. The unlock is
     per-session and expires after 15 minutes idle, because a tablet left on a
     table in a medical tent is not a secure terminal. */
  var unlockedUntil = 0;
  UI.isUnlocked = function () { return Date.now() < unlockedUntil; };
  UI.touchUnlock = function () { if (UI.isUnlocked()) unlockedUntil = Date.now() + 15 * 60000; };
  UI.lock = function () { unlockedUntil = 0; };

  UI.requireUnlock = function (why) {
    if (UI.isUnlocked()) { UI.touchUnlock(); return Promise.resolve(true); }
    return new Promise(function (resolve) {
      var input = EV.el('input', {
        type: 'password', inputmode: 'numeric', autocomplete: 'off',
        maxlength: 12, placeholder: '•••••',
        style: {
          fontFamily: 'var(--font-mono)', fontSize: '26px', letterSpacing: '.3em',
          textAlign: 'center', padding: '12px', width: '100%',
          border: '1px solid var(--line)', borderRadius: '8px', background: 'var(--ground)'
        }
      });
      var err = EV.el('div', { class: 'err', style: { minHeight: '16px' } });
      var tries = 0;

      var body = EV.el('div', { class: 'stack' }, [
        EV.el('p', { class: 'muted', style: { margin: 0 }, text: why || 'This section changes the configuration every post depends on.' }),
        input, err
      ]);

      var sh = UI.sheet({
        title: 'Configuration locked',
        body: body,
        footer: [],
        onClose: function () { resolve(UI.isUnlocked()); }
      });
      function submit() {
        if (EV.hashPass(input.value) === EV.settings.passcodeHash) {
          unlockedUntil = Date.now() + 15 * 60000;
          sh.close();
          resolve(true);
          EV.toast('Configuration unlocked for 15 minutes', 'ok');
        } else {
          tries++;
          input.value = '';
          err.textContent = tries >= 3 ? 'Still wrong. Ask the medical director for the code.' : 'Incorrect passcode';
          input.focus();
        }
      }
      input.addEventListener('keydown', function (e) { if (e.key === 'Enter') submit(); });
      sh.setFooter([
        UI.btn('Cancel', '', function () { sh.close(); }),
        UI.btn('Unlock', 'pri', submit, 'lock')
      ]);
      setTimeout(function () { input.focus(); }, 40);
    });
  };

  /* ---- shared module launchers -------------------------------------------
     Every inline field button routes through here so the three companion
     modules behave identically wherever they are opened from. */

  UI.openCalc = function (seedId, patient, onApply) {
    if (!EV.calc) { EV.toast('Calculators unavailable', 'warn'); return; }
    var sh = UI.sheet({ title: 'Clinical calculators', footer: [] });
    UI.renderCalcPanel(sh.body, { seed: seedId, patient: patient, onApply: onApply, sheet: sh });
  };

  UI.openRef = function (seedText, onPick) {
    if (!EV.ref) { EV.toast('Reference unavailable', 'warn'); return; }
    var sh = UI.sheet({ title: 'Clinical reference', footer: [] });
    UI.renderRefPanel(sh.body, { seed: seedText, onPick: onPick, sheet: sh });
  };

  UI.openFormulary = function (patient, onPick) {
    var sh = UI.sheet({ title: 'Formulary', footer: [] });
    UI.renderFormularyPicker(sh.body, { patient: patient, onPick: onPick, sheet: sh });
  };

  UI.openResus = function (patient) {
    var sh = UI.sheet({ title: 'Resuscitation', footer: [] });
    UI.renderResusPanel(sh.body, { patient: patient, sheet: sh });
  };

  /* Placeholders overwritten by 12-ui-patient.js / 13-ui-settings.js. Keeping
     them here means a missing module degrades to a message instead of a
     TypeError in the middle of a resuscitation. */
  function stub(name) {
    return function (root) {
      root.appendChild(UI.empty(name + ' unavailable', 'This module did not load. The rest of the app is unaffected.'));
    };
  }
  UI.renderCalcPanel = stub('Calculators');
  UI.renderRefPanel = stub('Reference');
  UI.renderFormularyPicker = stub('Formulary');
  UI.renderResusPanel = stub('Resuscitation');

})(window.EV = window.EV || {});
