/* ==========================================================================
   11-ui-dash.js — the board.

   The screen the Command Center leaves open all day. It answers four
   questions without a click: how many patients are open and how sick, which
   posts still have a bed, where the ambulances are, and who needs someone to
   walk over right now.

   Every post sees the whole event — knowing another post is full is the point
   — but can only edit its own records. That line is drawn in EV.model, not
   here; this file just renders which side of it you are on.
   ========================================================================== */
(function (EV) {
  'use strict';

  var UI = EV.ui;

  /* ---- board -------------------------------------------------------------- */
  UI.route('board', function (root) {
    if (UI.needsLanding()) { UI.go('landing', '', true); return; }

    var ev = EV.model.event();
    var posts = EV.model.posts();
    var open = EV.model.openPatients();
    var all = EV.model.patients();
    var now = EV.now();
    var status = EV.model.eventStatus(ev);

    if (status !== 'active') root.appendChild(concludedBanner(ev, status));

    root.appendChild(eventHeader(ev, now));
    root.appendChild(statStrip(all, open, now));

    var conclude = EV.model.canConclude(now);
    if (conclude.ok) root.appendChild(concludeCard());

    /* Anyone sick enough to need a decision, pulled above the fold whichever
       post they are sitting in. */
    var urgent = EV.sortBy(open.filter(function (p) {
      var d = EV.model.derive(p, now);
      return d.worstFlag >= 2 || EV.model.normAcuity(p.acuity) === 1;
    }), function (p) {
      var d = EV.model.derive(p, now);
      return -(d.worstFlag * 10 + (4 - (EV.model.normAcuity(p.acuity) || 4)));
    });
    if (urgent.length) {
      root.appendChild(UI.sectionHead('Needs attention now'));
      var ul = EV.el('div', { class: 'plist' });
      urgent.forEach(function (p) { ul.appendChild(UI.patientRow(p, { showPost: true })); });
      root.appendChild(ul);
    }

    root.appendChild(UI.sectionHead('Posts & beds',
      EV.model.canConfigure()
        ? UI.btn('Configure', 'sm ghost', function () { UI.go('settings', 'posts'); }, 'gear')
        : null));

    if (!posts.length) {
      root.appendChild(UI.empty('No posts yet',
        'An admin at the Command Center adds the medical posts and their beds.'));
    } else {
      var board = EV.el('div', { class: 'board' });
      posts.forEach(function (p) { board.appendChild(postCard(p, now)); });
      root.appendChild(board);
    }

    var ambs = EV.model.ambulances();
    if (ambs.length) {
      root.appendChild(UI.sectionHead('Ambulances'));
      root.appendChild(ambulanceBoard(ambs));
    }

    if (status === 'active') root.appendChild(fab());
  });

  /* ---- banners ------------------------------------------------------------ */
  function concludedBanner(ev, status) {
    var left = EV.model.reopenLeft(ev);
    var b = EV.el('div', {
      class: 'banner ' + (status === 'closed' ? 'bad' : 'warn')
    });
    b.appendChild(EV.h(UI.icon('lock', 18)));
    var txt = EV.el('div', { class: 'grow' });
    txt.appendChild(EV.el('div', {
      class: 'strong',
      text: status === 'closed' ? 'This event is closed' : 'This event has been concluded'
    }));
    txt.appendChild(EV.el('div', {
      class: 'small',
      text: status === 'closed'
        ? 'Records are read-only. The copies in Google Drive are the lasting record.'
        : 'Everything is read-only. A super admin can reopen it for another ' + EV.durShort(left) + '.'
    }));
    b.appendChild(txt);
    if (status === 'concluded' && left) {
      b.appendChild(UI.btn('Reopen', '', function () {
        UI.requireUnlock('Reopening a concluded event needs the admin passcode.').then(function (ok) {
          if (!ok) return;
          EV.model.grantSuper();
          EV.model.reopenEvent().then(function () { EV.toast('Event reopened', 'ok'); UI.render(); });
        });
      }, 'lock'));
    }
    return b;
  }

  function concludeCard() {
    var c = EV.el('div', { class: 'banner ok' });
    c.appendChild(EV.h(UI.icon('check', 18)));
    var t = EV.el('div', { class: 'grow' });
    t.appendChild(EV.el('div', { class: 'strong', text: 'The event has finished and every bed is empty' }));
    t.appendChild(EV.el('div', {
      class: 'small',
      text: 'Send the records to Google Drive and close the event down.'
    }));
    c.appendChild(t);
    c.appendChild(UI.btn('Conclude event', 'pri', function () { UI.concludeFlow(); }, 'check'));
    return c;
  }

  /* ---- header ------------------------------------------------------------- */
  function eventHeader(ev, now) {
    var h = EV.el('div', { class: 'row', style: { marginBottom: '12px', alignItems: 'flex-start' } });

    var left = EV.el('div', { class: 'grow', style: { minWidth: '0' } });
    left.appendChild(EV.el('h1', { style: { fontSize: '21px', lineHeight: '1.15' }, text: ev.name }));
    var meta = EV.el('div', { class: 'row tight small muted', style: { marginTop: '3px' } });
    if (ev.venue) meta.appendChild(EV.el('span', { text: ev.venue }));
    meta.appendChild(EV.el('span', {
      text: EV.dmyhm(EV.model.eventStart(ev)) + ' → ' + EV.dmyhm(EV.model.eventEnd(ev))
    }));
    var end = EV.model.eventEnd(ev);
    if (end && now < end) {
      meta.appendChild(EV.el('span', { class: 'tag', text: EV.durShort(end - now) + ' to go' }));
    }
    if (EV.has(ev.audience)) {
      meta.appendChild(EV.el('span', { text: Number(ev.audience).toLocaleString() + ' expected' }));
    }
    left.appendChild(meta);
    h.appendChild(left);
    h.appendChild(whoAmI());
    return h;
  }

  /* The binding, stated rather than offered. There is no post picker here on
     purpose: a device belongs to its post for the life of the event. */
  function whoAmI() {
    var post = EV.model.boundPost();
    var team = EV.model.team();
    var isCC = EV.model.atCommandCenter();
    var isSuper = EV.model.isSuperAdmin();

    var box = EV.el('div', { class: 'whoami' + (isCC ? ' cc' : '') });
    var top = EV.el('div', { class: 'row tight' });
    top.appendChild(EV.el('span', { class: 'code', text: (post && post.code) || '—' }));
    top.appendChild(EV.el('span', { class: 'nm trunc', text: (post && post.name) || 'Not posted' }));
    if (isCC) top.appendChild(EV.el('span', { class: 'tag brand', text: 'Command Center' }));
    box.appendChild(top);

    if (team.length) {
      box.appendChild(EV.el('div', {
        class: 'tiny muted trunc',
        text: team.map(function (m) { return m.name + ' (' + m.role + ')'; }).join(' · ')
      }));
    }

    if (isCC) {
      box.appendChild(isSuper
        ? EV.el('div', { class: 'row tight', style: { marginTop: '4px' } }, [
          EV.el('span', { class: 'pill ok', text: 'Super admin · ' + EV.durShort(EV.model.superLeft()) }),
          UI.btn('Sign out', 'sm ghost', function () {
            EV.model.revokeSuper();
            EV.toast('Super admin signed out');
            UI.render();
          })
        ])
        : UI.btn('Sign in as super admin', 'sm', function () {
          UI.requireUnlock('Super admin unlocks every post on this event.').then(function (ok) {
            if (!ok) return;
            EV.model.grantSuper();
            EV.toast('Super admin for 30 minutes', 'ok');
            UI.render();
          });
        }, 'lock'));
    }
    return box;
  }

  /* ---- stat strip --------------------------------------------------------- */
  function statStrip(all, open, now) {
    var strip = EV.el('div', { class: 'strip' });
    var closed = all.filter(function (p) { return p.status === 'closed'; });
    var referred = all.filter(function (p) {
      return p.disposition === 'refer-hospital' || p.disposition === 'transport';
    });

    strip.appendChild(UI.stat('Open', open.length, all.length + ' seen today'));

    var mix = EV.el('div', { class: 'stat' });
    mix.appendChild(EV.el('label', { text: 'Triage mix' }));
    var bar = EV.el('div', { class: 'mixbar' });
    var any = false;
    for (var a = 1; a <= EV.model.MAX_ACUITY; a++) {
      var n = open.filter(function (p) { return EV.model.normAcuity(p.acuity) === a; }).length;
      if (!n) continue;
      any = true;
      var def = EV.model.acuity(a);
      bar.appendChild(EV.el('div', {
        title: def.s + ' ' + def.l + ' (' + def.colour + ') · ' + n,
        style: { flex: n + ' 1 0', background: 'var(--a' + a + ')' }
      }, [String(n)]));
    }
    if (!any) bar.appendChild(EV.el('div', { class: 'none' }, ['none open']));
    mix.appendChild(bar);
    strip.appendChild(mix);

    /* Capacity across the whole event, which is what decides where the next
       patient goes. */
    var posts = EV.model.posts();
    var free = 0, usable = 0, fullPosts = 0;
    posts.forEach(function (p) {
      var bs = EV.model.bedState(p.id);
      free += bs.free; usable += bs.usable;
      if (bs.full) fullPosts++;
    });
    strip.appendChild(UI.stat('Beds free', free + ' / ' + usable,
      fullPosts ? fullPosts + ' post' + (fullPosts === 1 ? '' : 's') + ' full' : 'across all posts',
      free === 0 && usable > 0 ? 'alert' : ''));

    strip.appendChild(UI.stat('Referred', referred.length, closed.length + ' closed'));

    var hours = arrivalsByHour(all, now);
    var last = hours.length ? hours[hours.length - 1].n : 0;
    var peak = hours.reduce(function (m, h) { return Math.max(m, h.n); }, 0);
    var rate = UI.stat('This hour', last, 'peak ' + peak + '/h');
    if (hours.length > 1 && EV.analytics) {
      var sp = EV.el('div', { class: 'spark' });
      sp.innerHTML = EV.analytics.sparkline(hours.map(function (h) { return h.n; }));
      rate.appendChild(sp);
    }
    strip.appendChild(rate);
    return strip;
  }

  function arrivalsByHour(patients, now) {
    if (!patients.length) return [];
    var HOUR = 3600000;
    var first = patients.reduce(function (m, p) { return Math.min(m, p.arrivalAt || now); }, now);
    var start = Math.floor(first / HOUR) * HOUR;
    var endH = Math.floor(now / HOUR) * HOUR;
    if ((endH - start) / HOUR > 23) start = endH - 23 * HOUR;
    var out = [];
    for (var t = start; t <= endH; t += HOUR) {
      var n = 0;
      for (var i = 0; i < patients.length; i++) {
        var at = patients[i].arrivalAt;
        if (at >= t && at < t + HOUR) n++;
      }
      out.push({ t: t, n: n });
    }
    return out;
  }

  /* ---- post card ---------------------------------------------------------- */
  function postCard(post, now) {
    var beds = EV.model.beds(post.id);
    var patients = EV.model.openPatients(post.id);
    var bs = EV.model.bedState(post.id);
    var mine = post.id === EV.model.boundPostId();
    var kind = EV.model.POST_KINDS.filter(function (k) { return k.v === post.kind; })[0] ||
      { l: post.kind, icon: '•' };

    var card = EV.el('section', {
      class: 'post' + (post.isCommandCenter ? ' is-command' : '') + (mine ? ' is-mine' : '')
    });

    var ph = EV.el('div', { class: 'ph' });
    if (post.code) ph.appendChild(EV.el('span', { class: 'code', text: post.code }));
    ph.appendChild(EV.el('div', { class: 'grow', style: { minWidth: '0' } }, [
      EV.el('div', { class: 'nm trunc', text: post.name }),
      EV.el('div', {
        class: 'kind',
        text: kind.icon + ' ' + kind.l + (post.location ? ' · ' + post.location : '') +
          (mine ? ' · your post' : '')
      })
    ]));
    ph.appendChild(EV.el('span', {
      class: 'pill' + (patients.length ? ' brand' : ''),
      text: patients.length + ' open'
    }));
    card.appendChild(ph);

    /* The one thing another post needs to know at a glance. */
    if (bs.full) {
      card.appendChild(EV.el('div', { class: 'bedfull' }, [
        EV.h(UI.icon('alert', 15)),
        EV.el('span', { class: 'grow', text: 'Bed full, Please Refer to Another Post.' }),
        /* A bed being wiped is about to free up — say so, or the post looks
           shut when it is thirty seconds from taking the next patient. */
        bs.cleaning
          ? EV.el('span', {
            class: 'tag warn',
            text: bs.cleaning + ' being cleaned'
          })
          : null
      ]));
    }

    if (beds.length) {
      /* Bed cards are listed by triage: the sickest patient at this post is
         always the top-left tile. */
      var ordered = EV.sortBy(beds, function (b) {
        var p = b.patientId && EV.store.get('patient', b.patientId);
        if (p && (p.status === 'closed' || p.bedId !== b.id)) p = null;
        var ac = p ? (EV.model.normAcuity(p.acuity) || 9) : 99;
        return ac * 1000 + (b.overflow ? 500 : 0) + (b.sort || 0);
      });
      var bg = EV.el('div', { class: 'beds' });
      ordered.forEach(function (b) { bg.appendChild(bedTile(b, now)); });
      card.appendChild(bg);
    }

    var unbedded = patients.filter(function (p) { return !p.bedId; });
    if (unbedded.length) {
      var q = EV.el('div', { class: 'queue' });
      q.appendChild(EV.el('div', { class: 'qh', text: 'Waiting · ' + unbedded.length }));
      var list = EV.el('div', { class: 'plist' });
      unbedded.forEach(function (p) { list.appendChild(UI.patientRow(p)); });
      q.appendChild(list);
      card.appendChild(q);
    } else if (!beds.length) {
      card.appendChild(EV.el('div', {
        class: 'queue muted small', style: { padding: '12px' },
        text: 'No beds configured and nobody waiting.'
      }));
    }

    /* Chat with this post — not with yourself. */
    if (!mine) {
      card.appendChild(EV.el('div', { class: 'post-f' }, [
        UI.chatButton('post', post.id, post.code || post.name)
      ]));
    }
    return card;
  }

  function bedTile(bed, now) {
    var p = bed.patientId ? EV.store.get('patient', bed.patientId) : null;
    /* Trust the patient record over the bed's own pointer, or a closed
       patient haunts the board. */
    if (p && (p.status === 'closed' || p.bedId !== bed.id)) p = null;

    var d = p ? EV.model.derive(p, now) : null;
    var acuity = p ? EV.model.acuity(p.acuity).c : '';
    var status = p ? 'occupied' : bed.status === 'occupied' ? 'free' : bed.status;

    var tile = EV.el('button', {
      class: 'bed ' + status + ' ' + acuity +
        (d && d.worstFlag >= 2 ? ' flag' : '') + (bed.overflow ? ' overflow' : ''),
      type: 'button',
      title: bed.overflow
        ? 'Wheelchair overflow — beyond the post’s bed capacity'
        : (EV.model.BED_KINDS.filter(function (k) { return k.v === bed.kind; })[0] || {}).l || bed.kind
    });

    var lbl = EV.el('span', { class: 'lbl' }, [bed.label || '—']);
    if (bed.kind === 'ice-bath') lbl.appendChild(EV.el('span', { title: 'Ice bath', text: '❄' }));
    if (bed.kind === 'resus') lbl.appendChild(EV.el('span', { title: 'Resuscitation', text: '✚' }));
    if (bed.overflow) lbl.appendChild(EV.el('span', { class: 'tag warn', text: 'overflow' }));
    tile.appendChild(lbl);

    if (p) {
      tile.appendChild(EV.el('span', { class: 'who trunc', text: p.name || '(no name)' }));
      tile.appendChild(EV.el('span', {
        class: 'meta trunc',
        text: d.los + ' · ' + (p.chiefComplaint || EV.model.acuity(p.acuity).l)
      }));
      tile.addEventListener('click', function () { UI.go('patient', p.id); });
    } else {
      tile.appendChild(EV.el('span', {
        class: 'who',
        text: status === 'free' ? 'Free' : status === 'cleaning' ? 'Cleaning' : 'Out of service'
      }));
      tile.appendChild(EV.el('span', {
        class: 'meta',
        text: (EV.model.BED_KINDS.filter(function (k) { return k.v === bed.kind; })[0] || {}).l || ''
      }));
      tile.addEventListener('click', function () { bedMenu(bed); });
    }
    return tile;
  }

  function bedMenu(bed) {
    var post = EV.store.get('post', bed.postId);
    if (!EV.model.canCreatePatient(bed.postId)) {
      EV.toast('Only ' + ((post && (post.code || post.name)) || 'that post') + ' can admit to this bed', 'warn');
      return;
    }
    var sh = UI.sheet({ title: (post ? post.name + ' · ' : '') + bed.label, footer: [] });
    var body = EV.el('div', { class: 'stack' });

    body.appendChild(UI.btn('New patient into this bed', 'pri block lg', function () {
      sh.close();
      UI.newPatient({ postId: bed.postId, bedId: bed.id });
    }, 'plus'));

    var waiting = EV.model.openPatients(bed.postId).filter(function (p) { return !p.bedId; });
    if (waiting.length) {
      body.appendChild(EV.el('div', { class: 'sec-h' }, ['Move someone in', EV.el('span', { class: 'rule' })]));
      var list = EV.el('div', { class: 'plist' });
      waiting.forEach(function (p) {
        list.appendChild(UI.patientRow(p, {
          onClick: function () {
            EV.model.assignBed(EV.clone(p), bed.id).then(function () {
              sh.close();
              EV.toast(p.name + ' → ' + bed.label, 'ok');
            });
          }
        }));
      });
      body.appendChild(list);
    }

    if (EV.model.canConfigure()) {
      body.appendChild(EV.el('div', { class: 'sec-h' }, ['Bed status', EV.el('span', { class: 'rule' })]));
      body.appendChild(UI.segment({
        value: bed.status, block: true,
        options: EV.model.BED_STATUS.map(function (s) { return { v: s.v, l: s.l }; }),
        onChange: function (v) {
          var b = EV.clone(bed);
          b.status = v;
          if (v !== 'occupied') b.patientId = null;
          EV.store.put(b).then(function () { EV.toast(bed.label + ' → ' + v, 'ok'); });
        }
      }));
    }
    sh.setBody(body);
  }

  /* ---- ambulances --------------------------------------------------------- */
  function ambulanceBoard(ambs) {
    var g = EV.el('div', {
      class: 'board',
      style: { gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))' }
    });
    ambs.forEach(function (a) {
      var st = EV.model.AMB_STATUS.filter(function (s) { return s.v === a.status; })[0] || { l: a.status, c: '' };
      var p = a.patientId ? EV.store.get('patient', a.patientId) : null;
      var card = EV.el('div', { class: 'card' });
      var b = EV.el('div', { class: 'card-b', style: { display: 'grid', gap: '5px' } });
      var top = EV.el('div', { class: 'row', style: { gap: '7px' } });
      top.appendChild(EV.el('span', { class: 'mono strong', style: { fontSize: '14px' }, text: a.callsign || 'AMB' }));
      top.appendChild(EV.el('span', { class: 'tag', text: String(a.kind || '').toUpperCase() }));
      top.appendChild(EV.el('span', { class: 'grow' }));
      top.appendChild(EV.el('span', { class: 'pill ' + st.c, text: st.l }));
      b.appendChild(top);
      b.appendChild(EV.el('div', {
        class: 'small muted trunc',
        text: p ? 'Carrying ' + p.name + (a.destination ? ' → ' + a.destination : '')
          : (a.plate || 'No plate recorded')
      }));
      var acts = EV.el('div', { class: 'row tight' });
      acts.appendChild(UI.chatButton('ambulance', a.id, a.callsign || 'Ambulance'));
      if (EV.model.canConfigure()) {
        acts.appendChild(UI.btn('Status', 'sm ghost', function () { ambulanceSheet(a); }));
      }
      b.appendChild(acts);
      card.appendChild(b);
      g.appendChild(card);
    });
    return g;
  }

  function ambulanceSheet(a) {
    var sh = UI.sheet({ title: a.callsign || 'Ambulance', footer: [] });
    var body = EV.el('div', { class: 'stack' });
    body.appendChild(EV.el('div', { class: 'sec-h' }, ['Status', EV.el('span', { class: 'rule' })]));
    body.appendChild(UI.segment({
      value: a.status,
      options: EV.model.AMB_STATUS.map(function (s) { return { v: s.v, l: s.l }; }),
      onChange: function (v) {
        var c = EV.clone(a);
        c.status = v;
        if (v === 'available') { c.patientId = null; c.destination = ''; }
        EV.store.put(c).then(function () { EV.toast(a.callsign + ' → ' + v, 'ok'); });
      }
    }));
    var dest = UI.field({ label: 'Destination', value: a.destination || '', placeholder: 'Receiving hospital' });
    dest.input.addEventListener('change', function () {
      var c = EV.clone(a); c.destination = dest.input.value; EV.store.put(c);
    });
    body.appendChild(dest);
    sh.setBody(body);
  }

  /* ---- new patient -------------------------------------------------------- */
  function fab() {
    var b = EV.el('button', { class: 'fab', type: 'button', title: 'Register a new patient (N)' });
    b.innerHTML = UI.icon('plus', 20) + '<span>New patient</span>';
    b.addEventListener('click', function () { UI.newPatient(); });
    return b;
  }

  document.addEventListener('keydown', function (e) {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    var t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
    if (UI.needsLanding()) return;
    if (e.key === 'n' || e.key === 'N') { e.preventDefault(); UI.newPatient(); }
    if (e.key === 'b' || e.key === 'B') { e.preventDefault(); UI.go('board'); }
  });

  /* ---- patient list ------------------------------------------------------- */
  UI.route('patients', function (root) {
    if (UI.needsLanding()) { UI.go('landing', '', true); return; }

    var state = UI.patientFilter = UI.patientFilter || { q: '', status: 'open', post: '' };

    var bar = EV.el('div', { class: 'row', style: { marginBottom: '12px' } });
    var q = UI.field({
      cls: 'grow sm', placeholder: 'Search name, record no. or complaint…', value: state.q,
      buttons: [{ label: '×', title: 'Clear', onClick: function (v, c) { c.value = ''; state.q = ''; draw(); } }]
    });
    q.input.addEventListener('input', EV.debounce(function () { state.q = q.input.value; draw(); }, 160));
    bar.appendChild(q);

    bar.appendChild(UI.segment({
      value: state.status,
      options: [{ v: 'open', l: 'Open' }, { v: 'closed', l: 'Closed' }, { v: 'all', l: 'All' }],
      onChange: function (v) { state.status = v; draw(); }
    }));

    var posts = EV.model.posts();
    if (posts.length > 1) {
      var ps = EV.el('select', { class: 'btn', style: { minHeight: '36px', fontWeight: '600' } });
      ps.appendChild(EV.el('option', { value: '' }, ['All posts']));
      posts.forEach(function (p) {
        ps.appendChild(EV.el('option', { value: p.id, selected: state.post === p.id ? true : null },
          [(p.code ? p.code + ' · ' : '') + p.name]));
      });
      ps.addEventListener('change', function () { state.post = ps.value; draw(); });
      bar.appendChild(ps);
    }
    bar.appendChild(UI.btn('Excel recap', '', function () { UI.exportRecap(); }, 'xls'));
    root.appendChild(bar);

    var host = EV.el('div');
    root.appendChild(host);
    if (EV.model.isLive(EV.model.event())) root.appendChild(fab());

    function draw() {
      EV.clear(host);
      var list = EV.model.patients(function (p) {
        if (state.status === 'open' && p.status === 'closed') return false;
        if (state.status === 'closed' && p.status !== 'closed') return false;
        if (state.post && p.postId !== state.post) return false;
        if (state.q) {
          var hay = EV.norm([p.name, p.mrn, p.bib, p.chiefComplaint, p.assessment].join(' '));
          if (hay.indexOf(EV.norm(state.q)) === -1) return false;
        }
        return true;
      });
      if (!list.length) {
        host.appendChild(UI.empty(
          state.q ? 'Nothing matches “' + state.q + '”' : 'No patients yet',
          state.q ? 'Try part of a name or a record number.'
            : 'Register the first patient with the button below, or press N.'));
        return;
      }
      host.appendChild(EV.el('div', { class: 'sec-h' }, [
        list.length + ' ' + (list.length === 1 ? 'patient' : 'patients'), EV.el('span', { class: 'rule' })
      ]));
      var plist = EV.el('div', { class: 'plist' });
      list.forEach(function (p) { plist.appendChild(UI.patientRow(p, { showPost: true })); });
      host.appendChild(plist);
    }
    draw();
  });

})(window.EV = window.EV || {});
