/* ==========================================================================
   17-ui-landing.js — the way in.

   A device arrives knowing nothing. It either joins an event that is already
   running — pick the event, pick the post, name the team, launch — or, with
   the admin passcode, creates one.

   Picking the post is the one irreversible choice in the app. Every MRN, bed
   and note is attributed to the post that made it, so a tablet that could be
   re-pointed mid-shift would quietly misfile records. The flow says so before
   it commits, and only the super-admin passcode can undo it.
   ========================================================================== */
(function (EV) {
  'use strict';

  var UI = EV.ui;

  /* ---- routing guard ------------------------------------------------------
     Anything other than the landing route needs a live binding. */
  UI.needsLanding = function () {
    var ev = EV.model.event();
    if (!ev) return true;
    if (EV.model.eventStatus(ev) === 'closed') return true;
    return !EV.model.isBound();
  };

  /* Sync is keyed by eventId, so a device that has never joined one can only
     ever see events already in its own store — which on a fresh tablet is none.
     That is why a second post used to find nothing here and fall through to
     creating a duplicate event. Ask the server for the index, merge it in, and
     the local-first render below then has something real to list. Best effort:
     offline, or a server that cannot answer, renders exactly what it did before. */
  var discoveredAt = 0;
  var discovering = null;

  function discoverEvents() {
    /* Hand back the in-flight call rather than a stale 0. Admin login asks for
       this the instant the screen opens, while the render's own call is still
       on the wire — answering 0 there is what would create the duplicate. */
    if (discovering) return discovering;
    var cfg = EV.settings.sync;
    if (!cfg || !cfg.enabled || !cfg.endpoint) return Promise.resolve(0);
    if (!EV.online()) return Promise.resolve(0);
    /* Doubles as the loop guard: the re-render below re-enters this route. */
    if (EV.now() - discoveredAt < 8000) return Promise.resolve(0);
    discoveredAt = EV.now();
    discovering = EV.store.fetchJson(cfg.endpoint, { action: 'events' }).then(function (res) {
      if (!res || res.ok === false) return 0;
      var list = res.events || [];
      return list.length ? EV.store.bulk(list) : 0;
    })['catch'](function () { return 0; }).then(function (n) {
      discovering = null;
      return n;
    });
    return discovering;
  }

  UI.route('landing', function (root) {
    var wrap = EV.el('div', { class: 'landing' });
    root.appendChild(wrap);

    wrap.appendChild(hero());

    var events = EV.model.activeEvents();
    if (events.length) {
      wrap.appendChild(UI.sectionHead('Events running now'));
      var list = EV.el('div', { class: 'stack tight' });
      events.forEach(function (ev) { list.appendChild(eventCard(ev)); });
      wrap.appendChild(list);
      wrap.appendChild(EV.el('div', { class: 'row', style: { marginTop: '16px' } }, [
        UI.btn('Create a new event', '', function () { createEvent(); }, 'plus'),
        UI.btn('Log in as admin', 'ghost', function () { adminLogin(); }, 'lock')
      ]));
    } else {
      wrap.appendChild(EV.el('div', { class: 'empty', style: { marginTop: '18px' } }, [
        EV.el('h3', { text: 'No event is running' }),
        EV.el('p', {
          text: 'Create the event once, on any device. Every other post then joins it from this same screen.'
        }),
        EV.el('div', { class: 'row', style: { justifyContent: 'center' } }, [
          UI.btn('Create new event', 'pri lg', function () { createEvent(); }, 'plus'),
          UI.btn('Log in as admin', 'lg', function () { adminLogin(); }, 'lock')
        ])
      ]));
    }

    var closed = EV.model.allEvents().filter(function (e) {
      return EV.model.eventStatus(e) === 'closed';
    });
    if (closed.length) {
      wrap.appendChild(UI.sectionHead('Finished'));
      var cl = EV.el('div', { class: 'stack tight' });
      closed.slice(0, 6).forEach(function (ev) {
        cl.appendChild(EV.el('div', { class: 'prow closed', style: { cursor: 'default' } }, [
          EV.el('span', { class: 'grow' }, [
            EV.el('span', { class: 'nm', text: ev.name }),
            EV.el('span', { class: 'sub' }, [
              EV.el('span', { text: EV.dmy(EV.model.eventStart(ev)) }),
              EV.el('span', { text: (ev.venue || '') })
            ])
          ]),
          EV.el('span', { class: 'tag', text: 'Closed' })
        ]));
      });
      wrap.appendChild(cl);
    }

    discoverEvents().then(function (found) {
      if (found > 0 && wrap.isConnected) UI.go('landing');
    });
  });

  function hero() {
    var h = EV.el('div', { class: 'landing-hero' });
    h.appendChild(EV.h(
      '<span class="plate"><img src="' + (EV.LOGO || 'assets/siloam.png') +
      '" alt="Siloam Hospitals" width="190" height="77"></span>'
    ));
    h.appendChild(EV.el('h1', { text: 'Mini Emergency & Critical Care Event EMR' }));
    h.appendChild(EV.el('p', {
      text: 'Patient records for a medical standby — every post on one board, working with or without a signal.'
    }));
    return h;
  }

  function eventCard(ev) {
    var status = EV.model.eventStatus(ev);
    var posts = EV.store.all('post', function (p) { return p.eventId === ev.id; });
    var open = EV.store.all('patient', function (p) {
      return p.eventId === ev.id && p.status !== 'closed';
    }).length;

    var card = EV.el('div', { class: 'card event-card' });
    var b = EV.el('div', { class: 'card-b' });

    var top = EV.el('div', { class: 'row', style: { alignItems: 'flex-start' } });
    top.appendChild(EV.el('div', { class: 'grow', style: { minWidth: '0' } }, [
      EV.el('h2', { style: { fontSize: '19px' }, text: ev.name || 'Untitled event' }),
      EV.el('div', { class: 'small muted', style: { marginTop: '2px' } }, [
        [ev.venue, EV.dmyhm(EV.model.eventStart(ev)) + ' → ' + EV.dmyhm(EV.model.eventEnd(ev))]
          .filter(Boolean).join('  ·  ')
      ])
    ]));
    top.appendChild(EV.el('span', {
      class: 'pill ' + (status === 'active' ? 'ok' : 'warn'),
      text: status === 'active' ? 'Running' : 'Concluded'
    }));
    b.appendChild(top);

    b.appendChild(EV.el('div', { class: 'row tight small muted', style: { marginTop: '8px' } }, [
      EV.el('span', { text: posts.length + ' post' + (posts.length === 1 ? '' : 's') }),
      EV.el('span', { text: open + ' open patient' + (open === 1 ? '' : 's') })
    ]));

    if (status === 'concluded') {
      var left = EV.model.reopenLeft(ev);
      b.appendChild(EV.el('div', {
        class: 'tag warn', style: { marginTop: '8px', display: 'inline-block' },
        text: left
          ? 'Concluded — a super admin can reopen it for another ' + EV.durShort(left)
          : 'Concluded — the reopen window has passed'
      }));
    }
    card.appendChild(b);

    var f = EV.el('div', { class: 'card-f' });
    if (status === 'active') {
      if (!posts.length) {
        f.appendChild(EV.el('span', {
          class: 'small muted grow',
          text: 'No posts yet — an admin must add them before anyone can join.'
        }));
        f.appendChild(UI.btn('Set up posts', '', function () { adminInto(ev); }, 'gear'));
      } else {
        f.appendChild(UI.btn('Join this event', 'pri', function () { joinFlow(ev); }, 'check'));
      }
    } else {
      f.appendChild(UI.btn('Reopen', '', function () { reopen(ev); }, 'lock'));
    }
    card.appendChild(f);
    return card;
  }

  /* ---- create ------------------------------------------------------------- */
  function createEvent() {
    UI.requireUnlock('Creating an event needs the admin passcode.').then(function (ok) {
      if (!ok) return;
      var sh = UI.sheet({ title: 'New event', footer: [] });
      var body = EV.el('div', { class: 'stack' });

      var name = UI.field({ label: 'Event name', req: true, placeholder: 'Company Family Day 2026' });
      var venue = UI.field({ label: 'Venue', placeholder: 'Indonesia Arena' });
      var medicOn = UI.field({ label: 'Medic on', value: 'Medical Tent', placeholder: 'Arena / Building / Medical Tent' });
      var organiser = UI.field({ label: 'Organiser', placeholder: 'Who is running the event' });

      var today = EV.dateInput(EV.now());
      var startD = UI.field({ label: 'Start date', type: 'date', value: today, req: true });
      var startT = UI.field({ label: 'Start time', type: 'time', value: '07:00', req: true });
      var endD = UI.field({ label: 'End date', type: 'date', value: today, req: true });
      var endT = UI.field({ label: 'End time', type: 'time', value: '18:00', req: true });

      var aud = UI.field({ label: 'Expected attendance', type: 'number', inputmode: 'numeric', placeholder: '5000' });
      var prefix = UI.field({
        label: 'Record prefix', maxlength: 5, placeholder: 'CFD',
        hint: 'Appears on every record: CFD-P01-0001'
      });
      var pkg = UI.field({
        label: 'Package', type: 'select', value: 'intermediate',
        options: [{ v: 'basic', l: 'Basic' }, { v: 'intermediate', l: 'Intermediate' },
        { v: 'mini-icu', l: 'Advanced (Mini ICU)' }]
      });

      name.input.addEventListener('input', function () {
        if (prefix.input.dataset.touched) return;
        var words = String(name.input.value).replace(/[^A-Za-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean);
        prefix.input.value = words.filter(function (w) { return !/^(the|of|and|20\d\d)$/i.test(w); })
          .map(function (w) { return w[0]; }).join('').toUpperCase().slice(0, 4) || 'EV';
      });
      prefix.input.addEventListener('input', function () { prefix.input.dataset.touched = '1'; });

      body.appendChild(EV.el('div', { class: 'fgrid' }, [
        EV.el('div', { class: 'wfull' }, [name]), venue, medicOn, organiser
      ]));
      body.appendChild(EV.el('div', { class: 'sec-h' }, ['When', EV.el('span', { class: 'rule' })]));
      body.appendChild(EV.el('div', { class: 'fgrid' }, [startD, startT, endD, endT]));
      body.appendChild(EV.el('div', { class: 'sec-h' }, ['Scale', EV.el('span', { class: 'rule' })]));
      body.appendChild(EV.el('div', { class: 'fgrid' }, [aud, prefix, pkg]));

      var seedWrap = EV.el('label', { class: 'chip', style: { cursor: 'pointer', marginTop: '10px' } });
      var seedBox = EV.el('input', { type: 'checkbox', checked: true });
      seedWrap.appendChild(seedBox);
      seedWrap.appendChild(EV.el('span', {
        text: 'Create a starter layout — a Command Center, two medical posts with beds, and one ambulance'
      }));
      body.appendChild(seedWrap);

      var err = EV.el('div', { class: 'err' });
      body.appendChild(err);

      sh.setBody(body);
      sh.setFooter([
        UI.btn('Cancel', '', function () { sh.close(); }),
        UI.btn('Create event', 'pri', function () {
          err.textContent = '';
          if (!String(name.input.value).trim()) { name.setError('Name the event'); return; }
          var startAt = stamp(startD.input.value, startT.input.value);
          var endAt = stamp(endD.input.value, endT.input.value);
          if (!startAt || !endAt) { err.textContent = 'Enter both a start and an end.'; return; }
          if (endAt <= startAt) { err.textContent = 'The end must be after the start.'; return; }

          var ev = EV.model.newEvent({
            name: name.input.value.trim(), venue: venue.input.value.trim(),
            medicOn: medicOn.input.value.trim(), organiser: organiser.input.value.trim(),
            startAt: startAt, endAt: endAt,
            audience: EV.num(aud.input.value),
            mrnPrefix: (prefix.input.value || 'EV').toUpperCase(),
            pkg: pkg.input.value
          });
          EV.settings.eventId = ev.id;
          EV.save();
          EV.store.put(ev)
            .then(function () { if (seedBox.checked) return seedLayout(ev); })
            .then(function () {
              sh.close();
              EV.toast('Event created', 'ok');
              joinFlow(ev);
            });
        }, 'check')
      ]);
      setTimeout(function () { name.input.focus(); }, 40);
    });
  }

  function stamp(dateStr, timeStr) {
    if (!dateStr) return undefined;
    var d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
    if (!d) return undefined;
    var t = /^(\d{1,2}):(\d{2})$/.exec(timeStr || '00:00') || [0, 0, 0];
    return new Date(+d[1], +d[2] - 1, +d[3], +t[1] || 0, +t[2] || 0, 0, 0).getTime();
  }

  function seedLayout(ev) {
    var defs = [
      { code: 'CMD', name: 'Command Center', kind: 'command', cc: true, beds: [] },
      {
        code: 'P01', name: 'Medical Post 1', kind: 'medical-tent', beds: [
          ['Bed 1', 'resus'], ['Bed 2', 'acute'], ['Bed 3', 'observation']]
      },
      {
        code: 'P02', name: 'Medical Post 2', kind: 'medical-tent', beds: [
          ['Bed 1', 'acute'], ['Bed 2', 'observation']]
      }
    ];
    var jobs = [], firstId = '';
    defs.forEach(function (d, i) {
      var post = EV.model.newPost({
        eventId: ev.id, code: d.code, name: d.name, kind: d.kind,
        sort: i, isCommandCenter: !!d.cc
      });
      if (d.cc) firstId = post.id;
      jobs.push(EV.store.put(post));
      d.beds.forEach(function (bd, bi) {
        jobs.push(EV.store.put(EV.model.newBed({
          postId: post.id, label: bd[0], kind: bd[1], sort: bi
        })));
      });
    });
    jobs.push(EV.store.put(EV.model.newAmbulance({
      eventId: ev.id, callsign: 'AMB-1', kind: 'als', status: 'available'
    })));
    return Promise.all(jobs).then(function () {
      if (firstId) {
        var e2 = EV.clone(EV.store.get('event', ev.id));
        e2.commandPostId = firstId;
        return EV.store.put(e2);
      }
    });
  }

  /* ---- join --------------------------------------------------------------- */
  function joinFlow(ev) {
    EV.settings.eventId = ev.id;
    EV.save();

    var posts = EV.sortBy(EV.store.all('post', function (p) {
      return p.eventId === ev.id && p.active !== false;
    }), 'sort');

    if (!posts.length) {
      EV.toast('This event has no posts yet', 'warn');
      adminInto(ev);
      return;
    }

    var sh = UI.sheet({ title: 'Join ' + ev.name, footer: [] });
    var chosen = { postId: '', team: [] };

    stepPost();

    function stepPost() {
      var body = EV.el('div', { class: 'stack' });
      body.appendChild(EV.el('p', {
        class: 'muted', style: { margin: 0 },
        text: 'Which post is this device at? Everything recorded here will be filed against it.'
      }));

      var sel = UI.field({
        label: 'Input EMR data as', type: 'select', req: true,
        placeholder: 'Choose a post',
        options: posts.map(function (p) {
          var bs = EV.model.bedState(p.id);
          return {
            v: p.id,
            l: (p.code ? p.code + ' · ' : '') + p.name +
              (p.isCommandCenter ? '  (Command Center)' : '') +
              (bs.total ? '  — ' + bs.free + ' of ' + bs.usable + ' beds free' : '')
          };
        })
      });
      body.appendChild(sel);

      var note = EV.el('div', { class: 'card', style: { borderColor: 'var(--warn)' } }, [
        EV.el('div', { class: 'card-b small' }, [
          EV.el('div', { class: 'strong', style: { color: 'var(--warn)' }, text: 'This choice is permanent' }),
          EV.el('div', {
            class: 'muted',
            text: 'A device stays with its post for the whole event, so records are never misfiled. ' +
              'Only a super admin at the Command Center can move it afterwards.'
          })
        ])
      ]);
      body.appendChild(note);

      sh.setBody(body);
      sh.setFooter([
        UI.btn('Cancel', '', function () { sh.close(); }),
        UI.btn('Next — your team', 'pri', function () {
          if (!sel.input.value) { sel.setError('Choose the post'); return; }
          chosen.postId = sel.input.value;
          stepTeam();
        })
      ]);
    }

    function stepTeam() {
      var post = EV.store.get('post', chosen.postId);
      var body = EV.el('div', { class: 'stack' });
      body.appendChild(EV.el('p', {
        class: 'muted', style: { margin: 0 },
        text: 'Who is working at ' + ((post && post.name) || 'this post') + '? Names here sign the ' +
          'vitals, orders and notes made on this device.'
      }));

      var team = (post && post.staff && post.staff.length)
        ? post.staff.map(function (s) { return { name: s.name, role: s.role, detail: s.detail || '' }; })
        : [{ name: '', role: 'Doctor', detail: '' }];

      var host = EV.el('div', { class: 'stack tight' });
      function draw() {
        EV.clear(host);
        team.forEach(function (m, i) {
          host.appendChild(memberRow(m, i));
        });
        host.appendChild(UI.btn('Add someone', 'sm ghost', function () {
          team.push({ name: '', role: 'Nurse', detail: '' });
          draw();
        }, 'plus'));
      }
      function memberRow(m, i) {
        var row = EV.el('div', { class: 'row tight', style: { alignItems: 'flex-end' } });
        var nm = UI.field({ label: i === 0 ? 'Name' : '', cls: 'sm grow', value: m.name, placeholder: 'Full name' });
        nm.input.addEventListener('input', function () { team[i].name = nm.input.value; });
        var rl = UI.field({
          label: i === 0 ? 'Role' : '', cls: 'sm', type: 'select', value: m.role,
          options: EV.model.STAFF_ROLES
        });
        var detail = UI.field({
          label: i === 0 ? 'Specify' : '', cls: 'sm', value: m.detail, placeholder: 'e.g. Radiographer'
        });
        detail.style.display = m.role === EV.model.ROLE_NEEDS_DETAIL ? '' : 'none';
        detail.input.addEventListener('input', function () { team[i].detail = detail.input.value; });
        rl.input.addEventListener('change', function () {
          team[i].role = rl.input.value;
          detail.style.display = rl.input.value === EV.model.ROLE_NEEDS_DETAIL ? '' : 'none';
        });
        var x = EV.el('button', { class: 'iconbtn', type: 'button', 'aria-label': 'Remove' });
        x.innerHTML = UI.icon('trash', 15);
        x.addEventListener('click', function () { team.splice(i, 1); if (!team.length) team.push({ name: '', role: 'Doctor', detail: '' }); draw(); });
        row.appendChild(nm); row.appendChild(rl); row.appendChild(detail); row.appendChild(x);
        return row;
      }
      draw();
      body.appendChild(host);

      sh.setBody(body);
      sh.setFooter([
        UI.btn('Back', '', function () { stepPost(); }),
        UI.btn('Launch EMR', 'pri lg', function () {
          var clean = team.filter(function (m) { return String(m.name).trim(); })
            .map(function (m) {
              return {
                name: m.name.trim(),
                role: m.role === EV.model.ROLE_NEEDS_DETAIL && m.detail ? m.detail.trim() : m.role
              };
            });
          if (!clean.length) { EV.toast('Add at least one name', 'warn'); return; }

          EV.model.bind(ev.id, chosen.postId, clean);
          if (!EV.settings.deviceLabel) EV.settings.deviceLabel = clean[0].name;
          /* Keep the post's staff list in step with who actually turned up. */
          var p2 = EV.clone(EV.store.get('post', chosen.postId));
          p2.staff = clean;
          EV.save();
          EV.store.put(p2).then(function () {
            sh.close();
            EV.toast('Posted at ' + (p2.code || p2.name), 'ok');
            if (EV.settings.sync.enabled) EV.store.startAutoSync();
            UI.go('board');
          });
        }, 'check')
      ]);
    }
  }

  /* ---- admin -------------------------------------------------------------- */
  function adminLogin() {
    UI.requireUnlock('Admin access to this device.').then(function (ok) {
      if (!ok) return;
      /* Wait for the server's event index before concluding there is nothing to
         join — otherwise a post that opens the app and signs straight in makes a
         second event alongside the one it should have joined. */
      return discoverEvents().then(function () {
        var events = EV.model.activeEvents();
        if (!events.length) { createEvent(); return; }
        if (events.length === 1) { adminInto(events[0]); return; }
        var sh = UI.sheet({ title: 'Admin — choose an event', footer: [] });
        var body = EV.el('div', { class: 'stack tight' });
        events.forEach(function (ev) {
          var b = EV.el('button', { class: 'prow', type: 'button' }, [
            EV.el('span', { class: 'grow' }, [
              EV.el('span', { class: 'nm', text: ev.name }),
              EV.el('span', { class: 'sub', text: EV.dmyhm(EV.model.eventStart(ev)) })
            ])
          ]);
          b.addEventListener('click', function () { sh.close(); adminInto(ev); });
          body.appendChild(b);
        });
        sh.setBody(body);
      });
    });
  }

  /* An admin setting an event up has not joined a post yet, so bind the device
     to the Command Center (creating one if the event has none) — otherwise the
     settings screens have no identity to work from. */
  function adminInto(ev) {
    EV.settings.eventId = ev.id;
    EV.save();
    var cp = EV.store.all('post', function (p) {
      return p.eventId === ev.id && p.isCommandCenter;
    })[0];
    var ready = cp ? Promise.resolve(cp) : (function () {
      var post = EV.model.newPost({
        eventId: ev.id, code: 'CMD', name: 'Command Center',
        kind: 'command', isCommandCenter: true, sort: 0
      });
      return EV.store.put(post).then(function () {
        var e2 = EV.clone(EV.store.get('event', ev.id));
        e2.commandPostId = post.id;
        return EV.store.put(e2).then(function () { return post; });
      });
    })();

    ready.then(function (post) {
      EV.model.bind(ev.id, post.id, EV.model.team().length ? EV.model.team() : [{ name: 'Admin', role: 'Logistic' }]);
      EV.model.grantSuper();
      EV.toast('Signed in at the Command Center', 'ok');
      UI.go('settings', 'posts');
    });
  }

  function reopen(ev) {
    var left = EV.model.reopenLeft(ev);
    if (!left) {
      EV.confirm('The two-hour reopen window has passed. This event can only be closed now.',
        { ok: 'Close it', danger: true }).then(function (ok) {
          if (!ok) return;
          EV.settings.eventId = ev.id; EV.save();
          EV.model.closeEvent().then(function () { UI.render(); });
        });
      return;
    }
    UI.requireUnlock('Reopening a concluded event needs the admin passcode.').then(function (ok) {
      if (!ok) return;
      EV.settings.eventId = ev.id;
      EV.save();
      EV.model.grantSuper();
      EV.model.reopenEvent().then(function () {
        EV.toast('Event reopened', 'ok');
        UI.render();
      });
    });
  }

  UI.joinFlow = joinFlow;
  UI.createEvent = createEvent;

})(window.EV = window.EV || {});
