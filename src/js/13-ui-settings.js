/* ==========================================================================
   13-ui-settings.js — configuration.

   Everything that one post changing would affect every other post sits behind
   the passcode: posts, beds, ambulances and the formulary. Device-local
   preferences (which post this tablet is, theme, text size) do not, because
   locking those just means a nurse cannot fix her own screen.
   ========================================================================== */
(function (EV) {
  'use strict';

  var UI = EV.ui;

  var TABS = [
    { k: 'event', l: 'Event', lock: false },
    { k: 'posts', l: 'Posts & beds', lock: true },
    { k: 'ambulances', l: 'Ambulances', lock: true },
    { k: 'formulary', l: 'Formulary', lock: true },
    { k: 'drive', l: 'Google Drive', lock: true },
    { k: 'device', l: 'This device', lock: false },
    { k: 'data', l: 'Data & diagnostics', lock: false }
  ];

  UI.route('settings', function (root, arg) {
    var tab = arg || 'event';

    var nav = EV.el('div', { class: 'chips', style: { marginBottom: '14px' } });
    TABS.forEach(function (t) {
      var c = EV.el('button', { class: 'chip' + (tab === t.k ? ' on' : ''), type: 'button' }, [t.l]);
      if (t.lock) c.appendChild(EV.h(UI.icon('lock', 13)));
      c.addEventListener('click', function () { UI.go('settings', t.k); });
      nav.appendChild(c);
    });
    root.appendChild(nav);

    var host = EV.el('div', { class: 'stack' });
    root.appendChild(host);

    var def = TABS.filter(function (t) { return t.k === tab; })[0];
    if (def && def.lock && !EV.model.isSuperAdmin()) {
      host.appendChild(lockedPanel(def.l));
      return;
    }
    UI.touchUnlock();

    var fn = {
      event: tabEvent, posts: tabPosts, ambulances: tabAmbulances,
      formulary: tabFormulary, drive: tabDrive, device: tabDevice, data: tabData
    }[tab] || tabEvent;
    fn(host);
  });

  function lockedPanel(title) {
    var atCC = EV.model.atCommandCenter();
    var cp = EV.model.commandPost();
    var e = EV.el('div', { class: 'empty' });
    e.appendChild(EV.h('<div style="color:var(--ink-3);margin-bottom:6px">' + UI.icon('lock', 28) + '</div>'));
    e.appendChild(EV.el('h3', { text: title + ' is locked' }));
    e.appendChild(EV.el('p', {
      text: atCC
        ? 'Posts, beds, ambulances and the formulary are shared by every team on this event. ' +
          'Sign in as super admin to change them.'
        : 'Only a super admin at the Command Center can change the configuration every post ' +
          'depends on. This device is posted at ' +
          ((EV.model.boundPost() && EV.model.boundPost().name) || 'another post') +
          (cp ? ', not at ' + cp.name : '') + '.'
    }));
    if (atCC) {
      e.appendChild(UI.btn('Sign in as super admin', 'pri', function () {
        UI.requireUnlock('Super admin unlocks the configuration for this event.')
          .then(function (ok) { if (ok) { EV.model.grantSuper(); UI.render(); } });
      }, 'lock'));
    } else if (cp) {
      e.appendChild(UI.chatButton('post', cp.id, cp.code || cp.name, 'pri'));
    }
    return e;
  }

  /* ====================================================================== */
  /* Event                                                                   */
  /* ====================================================================== */
  function tabEvent(host) {
    var ev = EV.model.event();
    if (!ev) {
      host.appendChild(UI.empty('No event yet', 'Create one from the board.',
        UI.btn('Go to the board', 'pri', function () { UI.go('board'); })));
      return;
    }
    var body = EV.el('div', { class: 'fgrid' });
    function bind(f, key, parse) {
      f.input.addEventListener('change', function () {
        var c = EV.clone(ev);
        c[key] = parse ? parse(f.input.value) : f.input.value;
        EV.store.put(c).then(function () { EV.toast('Saved', 'ok'); });
      });
      return f;
    }
    body.appendChild(EV.el('div', { class: 'wfull' }, [bind(UI.field({ label: 'Event name', value: ev.name }), 'name')]));
    body.appendChild(bind(UI.field({ label: 'Venue', value: ev.venue }), 'venue'));
    body.appendChild(bind(UI.field({ label: 'Medic on', value: ev.medicOn, hint: 'Medical Tent / Arena / Building' }), 'medicOn'));
    body.appendChild(bind(UI.field({ label: 'Organiser', value: ev.organiser }), 'organiser'));
    body.appendChild(stampField('Start date', 'Start time', ev, 'startAt'));
    body.appendChild(stampField('End date', 'End time', ev, 'endAt'));
    body.appendChild(bind(UI.field({ label: 'Est. audience', type: 'number', value: ev.audience }), 'audience', EV.num));
    body.appendChild(bind(UI.field({
      label: 'Package', type: 'select', value: ev.pkg,
      options: [{ v: 'basic', l: 'Basic' }, { v: 'intermediate', l: 'Intermediate' }, { v: 'mini-icu', l: 'Advanced (Mini ICU)' }]
    }), 'pkg'));
    body.appendChild(bind(UI.field({
      label: 'MRN prefix', value: ev.mrnPrefix, maxlength: 5,
      hint: 'Already-issued MRNs keep their old prefix'
    }), 'mrnPrefix'));
    body.appendChild(bind(UI.field({ label: 'Hospital', value: ev.hospital }), 'hospital'));
    body.appendChild(EV.el('div', { class: 'wfull' }, [
      bind(UI.field({ label: 'Notes', type: 'textarea', rows: 2, value: ev.notes }), 'notes')
    ]));

    host.appendChild(UI.card('Event', body));

    /* Lifecycle, stated plainly. */
    var status = EV.model.eventStatus(ev);
    var lb = EV.el('div', { class: 'stack tight' });
    lb.appendChild(EV.el('div', { class: 'row tight' }, [
      EV.el('span', {
        class: 'pill ' + (status === 'active' ? 'ok' : status === 'concluded' ? 'warn' : 'bad'),
        text: status === 'active' ? 'Running' : status === 'concluded' ? 'Concluded' : 'Closed'
      }),
      ev.concludedAt ? EV.el('span', { class: 'small muted', text: 'Concluded ' + EV.dmyhm(ev.concludedAt) }) : null,
      ev.driveHandoffAt ? EV.el('span', { class: 'small muted', text: 'Sent to Drive ' + EV.dmyhm(ev.driveHandoffAt) }) : null
    ]));
    var gate = EV.model.canConclude();
    if (status === 'active') {
      lb.appendChild(EV.el('div', { class: 'small muted', text: gate.ok
        ? 'The event has finished and every bed is empty — it is ready to conclude.'
        : (gate.why || 'The event is still running.') }));
      lb.appendChild(UI.btn('Conclude event', gate.ok ? 'bad' : '', function () {
        if (!gate.ok) { EV.toast(gate.why || 'Not ready', 'warn', 5000); return; }
        UI.concludeFlow();
      }, 'lock'));
    } else if (status === 'concluded') {
      lb.appendChild(EV.el('div', { class: 'small muted',
        text: 'Reopen window closes in ' + EV.durShort(EV.model.reopenLeft(ev)) +
          '. After that the local records on every device are deleted; Drive keeps the copy.' }));
      lb.appendChild(UI.btn('Reopen event', 'pri', function () {
        EV.model.reopenEvent().then(function () { EV.toast('Reopened', 'ok'); UI.render(); });
      }));
    }
    host.appendChild(UI.card('Event lifecycle', lb));

    var stats = EV.store.stats();
    host.appendChild(UI.card('This event holds', EV.el('div', { class: 'strip' }, [
      UI.stat('Patients', stats.patient || 0),
      UI.stat('Posts', stats.post || 0),
      UI.stat('Beds', stats.bed || 0),
      UI.stat('Ambulances', stats.ambulance || 0),
      UI.stat('Formulary edits', stats.formulary || 0)
    ])));
  }

  /* A date and a time that commit together as one stamp. */
  function stampField(dateLabel, timeLabel, rec, key) {
    var cur = rec[key] || (key === 'startAt' ? rec.startDate : rec.endDate) || EV.now();
    var d = UI.field({ label: dateLabel, type: 'date', cls: 'sm', value: EV.dateInput(cur) });
    var t = UI.field({ label: timeLabel, type: 'time', cls: 'sm', value: EV.hhmm(cur) });
    function commit() {
      var dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d.input.value);
      if (!dm) return;
      var tm = /^(\d{1,2}):(\d{2})$/.exec(t.input.value) || [0, 0, 0];
      var ms = new Date(+dm[1], +dm[2] - 1, +dm[3], +tm[1] || 0, +tm[2] || 0, 0, 0).getTime();
      var c = EV.clone(rec);
      c[key] = ms;
      EV.store.put(c).then(function () { EV.toast('Saved', 'ok'); });
    }
    d.input.addEventListener('change', commit);
    t.input.addEventListener('change', commit);
    var wrap = EV.el('div', { class: 'w2', style: { display: 'contents' } });
    wrap.appendChild(d); wrap.appendChild(t);
    return wrap;
  }

  /* ====================================================================== */
  /* Posts & beds                                                            */
  /* ====================================================================== */
  function tabPosts(host) {
    var posts = EV.model.posts();

    host.appendChild(UI.sectionHead('Command posts',
      UI.btn('Add post', 'sm pri', function () { postSheet(); }, 'plus')));

    if (!posts.length) {
      host.appendChild(UI.empty('No posts', 'Add the medical tents, the mini ICU and the command post.'));
    }

    posts.forEach(function (post) {
      var beds = EV.model.beds(post.id);
      var head = EV.el('div', { class: 'row tight' }, [
        /* Read out to the team on arrival — this screen is Command-Center-only,
           so the codes are visible exactly where they are handed over. */
        EV.el('span', {
          class: 'tag mono',
          title: 'The code this post\u2019s team types to join',
          text: 'Join ' + (post.joinCode || 'not set')
        }),
        UI.btn('Edit', 'sm ghost', function () { postSheet(post); }),
        UI.btn('Add bed', 'sm', function () { bedSheet(post); }, 'plus')
      ]);

      var body = EV.el('div', { class: 'stack tight' });
      body.appendChild(EV.el('div', {
        class: 'small muted',
        text: (EV.model.POST_KINDS.filter(function (k) { return k.v === post.kind; })[0] || {}).l +
          (post.location ? ' · ' + post.location : '') +
          ' · ' + beds.length + ' bed' + (beds.length === 1 ? '' : 's') +
          (post.staff && post.staff.length ? ' · ' + post.staff.length + ' staff' : '')
      }));

      if (beds.length) {
        var tbl = EV.el('table', { class: 'dt' });
        tbl.appendChild(EV.h('<thead><tr><th>Bed</th><th>Type</th><th>Status</th><th>Occupant</th><th></th></tr></thead>'));
        var tb = EV.el('tbody');
        beds.forEach(function (b) {
          var occupant = b.patientId && EV.store.get('patient', b.patientId);
          if (occupant && (occupant.status === 'closed' || occupant.bedId !== b.id)) occupant = null;
          var tr = EV.el('tr', { class: b.status === 'offline' ? 'off' : '' });
          tr.appendChild(EV.el('td', { class: 'mono strong', text: b.label }));
          tr.appendChild(EV.el('td', { text: (EV.model.BED_KINDS.filter(function (k) { return k.v === b.kind; })[0] || {}).l || b.kind }));
          var stTd = EV.el('td');
          stTd.appendChild(EV.el('span', {
            class: 'tag ' + (EV.model.BED_STATUS.filter(function (s) { return s.v === b.status; })[0] || {}).c,
            text: (EV.model.BED_STATUS.filter(function (s) { return s.v === b.status; })[0] || {}).l || b.status
          }));
          tr.appendChild(stTd);
          tr.appendChild(EV.el('td', { class: 'trunc', text: occupant ? occupant.name : '—' }));
          var act = EV.el('td', { class: 'right' });
          act.appendChild(UI.btn('Edit', 'sm ghost', function () { bedSheet(post, b); }));
          act.appendChild(UI.btn('', 'sm ghost', function () { removeBed(b, occupant); }, 'trash'));
          tr.appendChild(act);
          tb.appendChild(tr);
        });
        tbl.appendChild(tb);
        body.appendChild(EV.el('div', { class: 'tblw' }, [tbl]));

        body.appendChild(EV.el('div', { class: 'row tight', style: { marginTop: '6px' } }, [
          UI.btn('Add 1 more', 'sm ghost', function () { quickAddBeds(post, 1); }),
          UI.btn('+3 acute', 'sm ghost', function () { quickAddBeds(post, 3, 'acute'); }),
          UI.btn('+2 ice bath', 'sm ghost', function () { quickAddBeds(post, 2, 'ice-bath'); })
        ]));
      } else {
        body.appendChild(EV.el('div', { class: 'row tight' }, [
          UI.btn('Add first bed', 'sm', function () { bedSheet(post); }, 'plus'),
          UI.btn('+3 acute', 'sm ghost', function () { quickAddBeds(post, 3, 'acute'); })
        ]));
      }

      if (post.staff && post.staff.length) {
        var st = EV.el('div', { class: 'chips', style: { marginTop: '6px' } });
        post.staff.forEach(function (s) {
          st.appendChild(EV.el('span', { class: 'tag', text: s.name + (s.role ? ' · ' + s.role : '') }));
        });
        body.appendChild(st);
      }

      var titleRow = EV.el('span', { class: 'row tight grow', style: { minWidth: '0' } }, [
        EV.el('span', { class: 'trunc strong', text: (post.code ? post.code + ' · ' : '') + post.name }),
        post.isCommandCenter ? EV.el('span', { class: 'tag brand', text: 'Command Center' }) : null,
        post.id === EV.model.boundPostId() ? EV.el('span', { class: 'tag', text: 'this device' }) : null
      ]);
      var card = UI.card('', body, { head: head });
      var ch = EV.qs('.card-h', card);
      if (ch) ch.insertBefore(titleRow, ch.firstChild);
      host.appendChild(card);
    });
  }

  function quickAddBeds(post, n, kind) {
    var beds = EV.model.beds(post.id);
    var jobs = [];
    var prefix = kind === 'ice-bath' ? 'IB' : kind === 'resus' ? 'R' : 'B';
    var used = {};
    beds.forEach(function (b) { used[b.label] = 1; });
    var made = 0, i = 1;
    while (made < n && i < 100) {
      var label = prefix + i;
      if (!used[label]) {
        jobs.push(EV.store.put(EV.model.newBed({
          postId: post.id, label: label, kind: kind || 'acute', sort: beds.length + made
        })));
        used[label] = 1;
        made++;
      }
      i++;
    }
    Promise.all(jobs).then(function () { EV.toast(made + ' bed' + (made === 1 ? '' : 's') + ' added', 'ok'); });
  }

  function removeBed(bed, occupant) {
    if (occupant) {
      EV.toast(occupant.name + ' is in this bed — move them first', 'warn');
      return;
    }
    EV.confirm('Remove bed ' + bed.label + '? Patients already discharged from it keep their record.',
      { danger: true, ok: 'Remove bed' }).then(function (ok) {
        if (ok) EV.store.del('bed', bed.id).then(function () { EV.toast('Bed removed', 'ok'); });
      });
  }

  function postSheet(post) {
    var isNew = !post;
    var p = post ? EV.clone(post) : EV.model.newPost({ sort: EV.model.posts().length });
    var sh = UI.sheet({ title: isNew ? 'New command post' : 'Edit ' + p.name, footer: [] });
    var body = EV.el('div', { class: 'stack' });

    var code = UI.field({ label: 'Code', value: p.code, cls: 'sm', maxlength: 5, hint: 'Shows on every MRN', placeholder: 'P01' });
    var name = UI.field({ label: 'Name', value: p.name, req: true, placeholder: 'Medical Tent — Finish' });
    var kind = UI.field({
      label: 'Type', type: 'select', value: p.kind, cls: 'sm',
      options: EV.model.POST_KINDS.map(function (k) { return { v: k.v, l: k.l }; })
    });
    var loc = UI.field({ label: 'Location', value: p.location, cls: 'sm', placeholder: 'Gate 7 / Hall B / Stand 14' });

    /* Posts created before join codes existed have none — give them one as soon
       as the Command Center opens the post, so there is nothing left to forget. */
    if (!p.joinCode) p.joinCode = EV.model.newJoinCode();
    var join = UI.field({
      label: 'Join code', value: p.joinCode, cls: 'sm', maxlength: 8,
      hint: 'The team types this to join', placeholder: '0000'
    });
    body.appendChild(EV.el('div', { class: 'fgrid' }, [
      code, EV.el('div', { class: 'w2' }, [name]), kind, loc, join
    ]));
    body.appendChild(EV.el('div', { class: 'row tight' }, [
      UI.btn('Issue a new code', 'sm ghost', function () {
        join.input.value = EV.model.newJoinCode();
      }),
      EV.el('span', {
        class: 'tiny muted',
        text: 'Changing it does not sign out devices already working at this post.'
      })
    ]));

    /* The Command Center is where unrestricted access lives, so moving it is
       itself passcode-gated — otherwise the lock means nothing. */
    var ccHost = EV.el('div', { class: 'stack tight' });
    var wantCC = !!p.isCommandCenter;
    function drawCC() {
      EV.clear(ccHost);
      var current = EV.model.commandPost();
      ccHost.appendChild(EV.el('div', { class: 'f' }, [
        EV.el('label', {}, ['Command Center']),
        UI.segment({
          value: wantCC ? 'yes' : 'no', block: true,
          options: [{ v: 'no', l: 'Ordinary post' }, { v: 'yes', l: 'Command Center' }],
          onChange: function (v) {
            if (v === 'yes' && !wantCC) {
              UI.requireUnlock('Assigning the Command Center needs the admin passcode.')
                .then(function (ok) { wantCC = ok; drawCC(); });
            } else { wantCC = v === 'yes'; drawCC(); }
          }
        })
      ]));
      ccHost.appendChild(EV.el('div', {
        class: 'tiny muted',
        text: wantCC
          ? 'A super admin signed in at this post can edit every other post’s records, ' +
            'change the configuration and conclude the event.'
          : (current && current.id !== p.id
            ? 'Currently assigned to ' + (current.code || current.name) + '.'
            : 'No post is the Command Center yet.')
      }));
    }
    drawCC();
    body.appendChild(ccHost);

    body.appendChild(EV.el('div', { class: 'sec-h' }, ['Staff on this post', EV.el('span', { class: 'rule' })]));
    var staff = (p.staff || []).slice();
    var staffHost = EV.el('div', { class: 'stack tight' });
    function drawStaff() {
      EV.clear(staffHost);
      staff.forEach(function (s, i) {
        var r = EV.el('div', { class: 'row tight' });
        var nm = EV.el('input', { value: s.name, placeholder: 'Name', style: { flex: '1 1 140px', padding: '7px 9px', border: '1px solid var(--line)', borderRadius: '6px', background: 'var(--ground)', minHeight: '36px' } });
        nm.addEventListener('input', function () { staff[i].name = nm.value; });
        var rl = EV.el('select', { style: { flex: '0 1 160px', padding: '7px 9px', border: '1px solid var(--line)', borderRadius: '6px', background: 'var(--ground)', minHeight: '36px' } });
        EV.model.STAFF_ROLES.forEach(function (role) {
          rl.appendChild(EV.el('option', { value: role, selected: s.role === role ? true : null }, [role]));
        });
        rl.addEventListener('change', function () { staff[i].role = rl.value; });
        var x = EV.el('button', { class: 'iconbtn', type: 'button', 'aria-label': 'Remove' });
        x.innerHTML = UI.icon('trash', 15);
        x.addEventListener('click', function () { staff.splice(i, 1); drawStaff(); });
        r.appendChild(nm); r.appendChild(rl); r.appendChild(x);
        staffHost.appendChild(r);
      });
      staffHost.appendChild(UI.btn('Add staff', 'sm ghost', function () {
        staff.push({ name: '', role: EV.model.STAFF_ROLES[2] });
        drawStaff();
      }, 'plus'));
    }
    drawStaff();
    body.appendChild(staffHost);

    sh.setBody(body);
    sh.setFooter([
      !isNew ? UI.btn('Delete post', 'ghost', function () {
        var n = EV.model.openPatients(p.id).length;
        if (n) { EV.toast(n + ' open patient(s) are at this post', 'warn'); return; }
        EV.confirm('Delete "' + p.name + '" and its beds? Patient records stay.', { danger: true, ok: 'Delete' })
          .then(function (ok) {
            if (!ok) return;
            var jobs = EV.model.beds(p.id).map(function (b) { return EV.store.del('bed', b.id); });
            jobs.push(EV.store.del('post', p.id));
            Promise.all(jobs).then(function () {
              if (EV.settings.postId === p.id) { EV.settings.postId = ''; EV.save(); }
              sh.close();
              EV.toast('Post deleted', 'ok');
            });
          });
      }, 'trash') : null,
      UI.btn('Cancel', '', function () { sh.close(); }),
      UI.btn('Save', 'pri', function () {
        if (!String(name.input.value).trim()) { name.setError('Name the post'); return; }
        p.code = (code.input.value || '').toUpperCase().trim();
        p.name = name.input.value.trim();
        p.kind = kind.input.value;
        p.location = loc.input.value.trim();
        p.joinCode = String(join.input.value || '').trim() || EV.model.newJoinCode();
        p.staff = staff.filter(function (s) { return String(s.name).trim(); });
        p.isCommandCenter = wantCC;
        var extra = [];
        if (wantCC) {
          /* Exactly one Command Center: demote whoever held it. */
          EV.model.posts().forEach(function (other) {
            if (other.id !== p.id && other.isCommandCenter) {
              var oc = EV.clone(other);
              oc.isCommandCenter = false;
              extra.push(EV.store.put(oc));
            }
          });
          var evc = EV.clone(EV.model.event());
          evc.commandPostId = p.id;
          extra.push(EV.store.put(evc));
        }
        Promise.all(extra).then(function () { return EV.store.put(p); }).then(function () {
          if (isNew && !EV.settings.postId) { EV.settings.postId = p.id; EV.save(); }
          sh.close();
          EV.toast('Post saved', 'ok');
        });
      }, 'check')
    ]);
  }

  function bedSheet(post, bed) {
    var isNew = !bed;
    var b = bed ? EV.clone(bed) : EV.model.newBed({ postId: post.id, sort: EV.model.beds(post.id).length });
    var sh = UI.sheet({ title: isNew ? 'New bed · ' + post.name : 'Bed ' + b.label, footer: [] });
    var body = EV.el('div', { class: 'stack' });

    var label = UI.field({ label: 'Label', value: b.label, req: true, cls: 'sm', placeholder: 'B1' });
    var kind = UI.field({
      label: 'Type', type: 'select', value: b.kind, cls: 'sm',
      options: EV.model.BED_KINDS.map(function (k) { return { v: k.v, l: k.l }; })
    });
    body.appendChild(EV.el('div', { class: 'fgrid' }, [label, kind]));

    body.appendChild(EV.el('div', { class: 'f' }, [
      EV.el('label', {}, ['Status']),
      UI.segment({
        value: b.status, block: true,
        options: EV.model.BED_STATUS.map(function (s) { return { v: s.v, l: s.l }; }),
        onChange: function (v) { b.status = v; }
      })
    ]));

    sh.setBody(body);
    sh.setFooter([
      UI.btn('Cancel', '', function () { sh.close(); }),
      UI.btn('Save', 'pri', function () {
        if (!String(label.input.value).trim()) { label.setError('Give the bed a label'); return; }
        b.label = label.input.value.trim();
        b.kind = kind.input.value;
        if (b.status !== 'occupied') b.patientId = null;
        EV.store.put(b).then(function () { sh.close(); EV.toast('Bed saved', 'ok'); });
      }, 'check')
    ]);
  }

  /* ====================================================================== */
  /* Ambulances                                                              */
  /* ====================================================================== */
  function tabAmbulances(host) {
    var ambs = EV.model.ambulances();
    host.appendChild(UI.sectionHead('Ambulances',
      UI.btn('Add ambulance', 'sm pri', function () { ambSheet(); }, 'plus')));
    if (!ambs.length) {
      host.appendChild(UI.empty('No ambulances', 'Add each vehicle so transports can be logged against a callsign.'));
      return;
    }
    var tbl = EV.el('table', { class: 'dt' });
    tbl.appendChild(EV.h('<thead><tr><th>Callsign</th><th>Type</th><th>Plate</th><th>Crew</th><th>Status</th><th></th></tr></thead>'));
    var tb = EV.el('tbody');
    ambs.forEach(function (a) {
      var tr = EV.el('tr', { class: a.active === false ? 'off' : '' });
      tr.appendChild(EV.el('td', { class: 'mono strong', text: a.callsign }));
      tr.appendChild(EV.el('td', { text: a.kind.toUpperCase() }));
      tr.appendChild(EV.el('td', { text: a.plate || '—' }));
      tr.appendChild(EV.el('td', { class: 'trunc', text: (a.crew || []).map(function (c) { return c.name; }).join(', ') || '—' }));
      var st = EV.model.AMB_STATUS.filter(function (s) { return s.v === a.status; })[0] || {};
      tr.appendChild(EV.el('td', {}, [EV.el('span', { class: 'tag ' + st.c, text: st.l || a.status })]));
      var act = EV.el('td', { class: 'right' });
      act.appendChild(UI.btn('Edit', 'sm ghost', function () { ambSheet(a); }));
      act.appendChild(UI.btn('', 'sm ghost', function () {
        EV.confirm('Remove ' + a.callsign + '?', { danger: true, ok: 'Remove' }).then(function (ok) {
          if (ok) EV.store.del('ambulance', a.id);
        });
      }, 'trash'));
      tr.appendChild(act);
      tb.appendChild(tr);
    });
    tbl.appendChild(tb);
    host.appendChild(UI.card('', EV.el('div', { class: 'tblw' }, [tbl]), { flush: true }));
  }

  function ambSheet(amb) {
    var isNew = !amb;
    var a = amb ? EV.clone(amb) : EV.model.newAmbulance({
      callsign: 'AMB-' + (EV.model.ambulances().length + 1)
    });
    var sh = UI.sheet({ title: isNew ? 'New ambulance' : a.callsign, footer: [] });
    var body = EV.el('div', { class: 'stack' });

    var cs = UI.field({ label: 'Callsign', value: a.callsign, req: true, cls: 'sm' });
    var plate = UI.field({ label: 'Plate', value: a.plate, cls: 'sm', placeholder: 'B 1234 SHH' });
    var kind = UI.field({
      label: 'Capability', type: 'select', value: a.kind, cls: 'sm',
      options: [{ v: 'als', l: 'ALS — advanced' }, { v: 'bls', l: 'BLS — basic' }, { v: 'motor', l: 'Motorcycle / rapid responder' }]
    });
    body.appendChild(EV.el('div', { class: 'fgrid' }, [cs, plate, kind]));

    var crew = (a.crew || []).slice();
    var crewHost = EV.el('div', { class: 'stack tight' });
    function drawCrew() {
      EV.clear(crewHost);
      crew.forEach(function (c, i) {
        var r = EV.el('div', { class: 'row tight' });
        var nm = EV.el('input', { value: c.name, placeholder: 'Name', style: { flex: '1 1 140px', padding: '7px 9px', border: '1px solid var(--line)', borderRadius: '6px', background: 'var(--ground)', minHeight: '36px' } });
        nm.addEventListener('input', function () { crew[i].name = nm.value; });
        var rl = EV.el('select', { style: { flex: '0 1 150px', padding: '7px 9px', border: '1px solid var(--line)', borderRadius: '6px', background: 'var(--ground)', minHeight: '36px' } });
        EV.model.STAFF_ROLES.forEach(function (role) {
          rl.appendChild(EV.el('option', { value: role, selected: c.role === role ? true : null }, [role]));
        });
        rl.addEventListener('change', function () { crew[i].role = rl.value; });
        var x = EV.el('button', { class: 'iconbtn', type: 'button', 'aria-label': 'Remove' });
        x.innerHTML = UI.icon('trash', 15);
        x.addEventListener('click', function () { crew.splice(i, 1); drawCrew(); });
        r.appendChild(nm); r.appendChild(rl); r.appendChild(x);
        crewHost.appendChild(r);
      });
      crewHost.appendChild(UI.btn('Add crew', 'sm ghost', function () {
        crew.push({ name: '', role: 'Driver' }); drawCrew();
      }, 'plus'));
    }
    drawCrew();
    body.appendChild(EV.el('div', { class: 'sec-h' }, ['Crew', EV.el('span', { class: 'rule' })]));
    body.appendChild(crewHost);

    sh.setBody(body);
    sh.setFooter([
      UI.btn('Cancel', '', function () { sh.close(); }),
      UI.btn('Save', 'pri', function () {
        if (!String(cs.input.value).trim()) { cs.setError('Give it a callsign'); return; }
        a.callsign = cs.input.value.trim();
        a.plate = plate.input.value.trim();
        a.kind = kind.input.value;
        a.crew = crew.filter(function (c) { return String(c.name).trim(); });
        EV.store.put(a).then(function () { sh.close(); EV.toast('Ambulance saved', 'ok'); });
      }, 'check')
    ]);
  }

  /* ====================================================================== */
  /* Formulary editor                                                        */
  /* ====================================================================== */
  function tabFormulary(host) {
    if (!EV.formulary) {
      host.appendChild(UI.empty('Formulary module unavailable', 'The default catalogue did not load.'));
      return;
    }
    var state = UI.formState = UI.formState || { q: '', kind: 'all', cat: '' };
    var items = EV.formulary.load();

    var bar = EV.el('div', { class: 'row', style: { marginBottom: '10px' } });
    var q = UI.field({ cls: 'grow sm', placeholder: 'Search the formulary…', value: state.q });
    q.input.addEventListener('input', EV.debounce(function () { state.q = q.input.value; draw(); }, 150));
    bar.appendChild(q);
    bar.appendChild(UI.segment({
      value: state.kind,
      options: [{ v: 'all', l: 'All' }, { v: 'med', l: 'Medications' }, { v: 'supply', l: 'Supplies' }, { v: 'equipment', l: 'Equipment' }],
      onChange: function (v) { state.kind = v; draw(); }
    }));
    bar.appendChild(UI.btn('Add item', 'pri', function () { itemSheet(); }, 'plus'));
    host.appendChild(bar);

    host.appendChild(EV.el('div', {
      class: 'tiny muted', style: { marginBottom: '8px' },
      text: 'The default catalogue comes from your three standby manifests. Edits and additions stay with this event and sync to every post.'
    }));

    var tableHost = EV.el('div');
    host.appendChild(tableHost);

    function draw() {
      EV.clear(tableHost);
      var list = items.filter(function (i) {
        if (state.kind !== 'all' && i.kind !== state.kind) return false;
        if (state.cat && i.cat !== state.cat) return false;
        if (state.q) {
          var hay = EV.norm([i.name, i.generic, i.cat, i.form].join(' '));
          if (hay.indexOf(EV.norm(state.q)) === -1) return false;
        }
        return true;
      });
      list = EV.sortBy(list, function (i) { return (i.active === false ? '1' : '0') + i.cat + i.name; });

      if (!list.length) {
        tableHost.appendChild(UI.empty('Nothing matches', 'Try a shorter search, or add the item.'));
        return;
      }

      var tbl = EV.el('table', { class: 'dt' });
      tbl.appendChild(EV.h('<thead><tr><th>Item</th><th>Generic</th><th>Strength</th><th>Form</th>' +
        '<th class="n">Par</th><th>Flags</th><th></th></tr></thead>'));
      var tb = EV.el('tbody');
      list.forEach(function (it) {
        var tr = EV.el('tr', { class: it.active === false ? 'off' : '' });
        tr.appendChild(EV.el('td', { class: 'strong', text: it.name }));
        tr.appendChild(EV.el('td', { class: 'muted', text: it.generic && it.generic !== it.name ? it.generic : '—' }));
        tr.appendChild(EV.el('td', { class: 'mono', text: it.strength || it.dose || '—' }));
        tr.appendChild(EV.el('td', { text: it.form || '—' }));
        tr.appendChild(EV.el('td', { class: 'n', text: EV.has(it.par) ? String(it.par) : '—' }));
        var flags = EV.el('td');
        if (it.highAlert) flags.appendChild(EV.el('span', { class: 'tag bad', text: 'High alert' }));
        if (it.controlled) flags.appendChild(EV.el('span', { class: 'tag warn', text: 'Controlled' }));
        if (it.custom) flags.appendChild(EV.el('span', { class: 'tag info', text: 'Added' }));
        tr.appendChild(flags);
        var act = EV.el('td', { class: 'right nowrap' });
        act.appendChild(UI.btn('Edit', 'sm ghost', function () { itemSheet(it); }));
        act.appendChild(UI.btn(it.active === false ? 'Restore' : 'Remove', 'sm ghost', function () {
          toggleItem(it);
        }));
        tr.appendChild(act);
        tb.appendChild(tr);
      });
      tbl.appendChild(tb);
      tableHost.appendChild(EV.el('div', { class: 'tblw', style: { maxHeight: '62vh', overflowY: 'auto' } }, [tbl]));
      tableHost.appendChild(EV.el('div', {
        class: 'tiny muted', style: { marginTop: '6px' },
        text: list.length + ' of ' + items.length + ' items'
      }));
    }

    function toggleItem(it) {
      /* A shipped default is never deleted, only deactivated, so the catalogue
         can always be restored without reinstalling. */
      var rec = EV.store.get('formulary', it.id) || Object.assign({}, it, { _t: 'formulary' });
      var c = EV.clone(rec);
      c._t = 'formulary';
      c.id = it.id;
      c.active = it.active === false;
      EV.store.put(c).then(function () {
        items = EV.formulary.load();
        draw();
        EV.toast(c.active ? it.name + ' restored' : it.name + ' removed', 'ok');
      });
    }

    function itemSheet(item) {
      var isNew = !item;
      var it = item ? EV.clone(item) : {
        _t: 'formulary', id: '', name: '', generic: '', kind: 'med', cat: 'other',
        strength: '', form: '', dose: '', routes: [], defaultRoute: 'IV', unit: 'mg',
        par: undefined, highAlert: false, controlled: false, active: true, custom: true, notes: ''
      };
      var sh = UI.sheet({ title: isNew ? 'Add formulary item' : it.name, footer: [] });
      var body = EV.el('div', { class: 'stack' });

      var name = UI.field({ label: 'Name as written on the box', value: it.name, req: true, placeholder: 'Ketorolac' });
      var generic = UI.field({ label: 'Generic', value: it.generic, cls: 'sm', placeholder: 'Ketorolac tromethamine' });
      var kind = UI.field({
        label: 'Kind', type: 'select', value: it.kind, cls: 'sm',
        options: [{ v: 'med', l: 'Medication' }, { v: 'supply', l: 'Supply' }, { v: 'equipment', l: 'Equipment' }]
      });
      var cats = (EV.formulary.CATS || []).map(function (c) { return { v: c.id, l: c.l }; });
      var cat = UI.field({ label: 'Category', type: 'select', value: it.cat, cls: 'sm', options: cats });
      var strength = UI.field({ label: 'Strength', value: it.strength || it.dose, cls: 'sm', placeholder: '30mg/mL', hint: 'Used for the mL calculation' });
      var form = UI.field({ label: 'Form', value: it.form, cls: 'sm', placeholder: 'Ampoule / Kolf / Pcs' });
      var unit = UI.field({
        label: 'Dose unit', type: 'select', value: it.unit, cls: 'sm',
        options: ['mg', 'mcg', 'g', 'mL', 'IU', 'mEq', 'pcs', 'tab']
      });
      var route = UI.field({
        label: 'Default route', type: 'select', value: it.defaultRoute, cls: 'sm',
        options: EV.model.ROUTES, placeholder: '—'
      });
      var par = UI.field({ label: 'Par level', type: 'number', value: it.par, cls: 'sm n', hint: 'Qty carried per post' });

      body.appendChild(EV.el('div', { class: 'fgrid' }, [
        EV.el('div', { class: 'w2' }, [name]), generic, kind, cat, strength, form, unit, route, par
      ]));

      var flagRow = EV.el('div', { class: 'row' });
      var ha = EV.el('label', { class: 'chip', style: { cursor: 'pointer' } });
      var haBox = EV.el('input', { type: 'checkbox', checked: it.highAlert ? true : null });
      ha.appendChild(haBox); ha.appendChild(EV.el('span', { text: 'High alert' }));
      var ct = EV.el('label', { class: 'chip', style: { cursor: 'pointer' } });
      var ctBox = EV.el('input', { type: 'checkbox', checked: it.controlled ? true : null });
      ct.appendChild(ctBox); ct.appendChild(EV.el('span', { text: 'Controlled drug' }));
      flagRow.appendChild(ha); flagRow.appendChild(ct);
      body.appendChild(flagRow);

      var notes = UI.field({ label: 'Notes', value: it.notes, cls: 'sm', type: 'textarea', rows: 2 });
      body.appendChild(notes);

      sh.setBody(body);
      sh.setFooter([
        UI.btn('Cancel', '', function () { sh.close(); }),
        UI.btn('Save', 'pri', function () {
          if (!String(name.input.value).trim()) { name.setError('Name the item'); return; }
          it.name = name.input.value.trim();
          it.generic = generic.input.value.trim();
          it.kind = kind.input.value;
          it.cat = cat.input.value;
          it.strength = strength.input.value.trim();
          it.dose = it.strength;
          it.form = form.input.value.trim();
          it.unit = unit.input.value;
          it.defaultRoute = route.input.value;
          it.par = EV.num(par.input.value);
          it.highAlert = haBox.checked;
          it.controlled = ctBox.checked;
          it.notes = notes.input.value;
          it.active = true;
          it._t = 'formulary';
          if (!it.id) {
            it.id = 'cust-' + EV.slug(it.name) + '-' + EV.uid().slice(-4);
            it.custom = true;
          }
          EV.store.put(it).then(function () {
            items = EV.formulary.load();
            draw();
            sh.close();
            EV.toast('Formulary updated', 'ok');
          });
        }, 'check')
      ]);
    }

    draw();
  }

  /* ====================================================================== */
  /* Google Drive                                                            */
  /* ====================================================================== */
  function tabDrive(host) {
    var cfg = EV.settings.drive;

    var body = EV.el('div', { class: 'stack' });

    var onoff = EV.el('div', { class: 'f' }, [
      EV.el('label', {}, ['Drive upload']),
      UI.segment({
        value: cfg.enabled ? 'on' : 'off', block: true,
        options: [{ v: 'off', l: 'Off' }, { v: 'on', l: 'On' }],
        onChange: function (v) { cfg.enabled = v === 'on'; EV.save(); UI.render(); }
      })
    ]);
    body.appendChild(onoff);

    var endpoint = UI.field({
      label: 'Function endpoint', value: cfg.endpoint, cls: 'sm',
      hint: 'The Netlify function path. Leave as /api/drive unless you renamed it.'
    });
    endpoint.input.addEventListener('change', function () { cfg.endpoint = endpoint.input.value; EV.save(); });

    var folder = UI.field({
      label: 'Event folder name', value: cfg.folderName, cls: 'sm',
      placeholder: (EV.model.event() || {}).name || 'Event name',
      hint: 'A subfolder created inside the Drive folder you shared with the service account'
    });
    folder.input.addEventListener('change', function () { cfg.folderName = folder.input.value; EV.save(); });

    body.appendChild(EV.el('div', { class: 'fgrid' }, [endpoint, folder]));

    body.appendChild(EV.el('div', { class: 'f' }, [
      EV.el('label', {}, ['Upload patient PDFs automatically']),
      UI.segment({
        value: cfg.autoUpload ? 'yes' : 'no', block: true,
        options: [{ v: 'no', l: 'Only when I tap upload' }, { v: 'yes', l: 'Automatically when a record closes' }],
        onChange: function (v) { cfg.autoUpload = v === 'yes'; EV.save(); }
      })
    ]));

    var statusHost = EV.el('div');
    body.appendChild(statusHost);

    body.appendChild(EV.el('div', { class: 'row' }, [
      UI.btn('Test the connection', 'pri', function () { ping(); }, 'drive'),
      UI.btn('Upload the Excel recap now', '', function () { UI.uploadRecap(); }, 'xls'),
      UI.btn('Push all closed records', '', function () { UI.uploadAll(); }, 'down')
    ]));

    function ping() {
      EV.clear(statusHost);
      statusHost.appendChild(EV.el('div', { class: 'pill', text: 'Checking…' }));
      EV.store.fetchJson(cfg.endpoint, { action: 'ping' }).then(function (r) {
        EV.clear(statusHost);
        if (r && r.ok) {
          statusHost.appendChild(EV.el('div', { class: 'pill ok' }, [
            EV.el('span', { class: 'dot' }),
            'Connected to “' + (r.folder || 'the shared folder') + '”' + (r.account ? ' as ' + r.account : '')
          ]));
        } else {
          statusHost.appendChild(EV.el('div', { class: 'pill bad' }, [
            EV.el('span', { class: 'dot' }), (r && r.error) || 'Rejected'
          ]));
        }
      }).catch(function (e) {
        EV.clear(statusHost);
        statusHost.appendChild(EV.el('div', { class: 'pill bad' }, [
          EV.el('span', { class: 'dot' }),
          e.message === 'Failed to fetch'
            ? 'No response — is the site deployed on Netlify with the function enabled?'
            : e.message
        ]));
      });
    }

    host.appendChild(UI.card('Google Drive', body));

    var help = EV.el('div', { class: 'stack tight' });
    help.appendChild(EV.el('p', { class: 'small muted', text: 'Set this up once, on Netlify — the field devices need no Google login at all.' }));
    var ol = EV.el('ol', { style: { margin: '0', paddingLeft: '18px', fontSize: '13px', lineHeight: '1.7', color: 'var(--ink-2)' } });
    [
      'In Google Cloud, create a service account and download its JSON key. Enable the Google Drive API on that project.',
      'In Google Drive, create the destination folder and share it with the service account’s email address, as Editor.',
      'In Netlify → Site configuration → Environment variables, add GOOGLE_SERVICE_ACCOUNT_JSON (the whole key file) and GDRIVE_FOLDER_ID (the folder id from its URL).',
      'Redeploy, then press “Test the connection” above. A green light means every post can now write to that folder.'
    ].forEach(function (s) { ol.appendChild(EV.el('li', { text: s })); });
    help.appendChild(ol);
    help.appendChild(EV.el('p', {
      class: 'small muted',
      text: 'Patient PDFs go to <folder>/<event>/Patients/. The Excel recap is rewritten in place at <folder>/<event>/, so its link never changes.'
    }));
    host.appendChild(UI.card('How to connect it', help));
  }

  /* ====================================================================== */
  /* This device                                                             */
  /* ====================================================================== */
  function tabDevice(host) {
    var body = EV.el('div', { class: 'stack' });

    var posts = EV.model.posts();
    var postSel = UI.field({
      label: 'This device is posted at', type: 'select', value: EV.settings.postId,
      options: posts.map(function (p) { return { v: p.id, l: (p.code ? p.code + ' · ' : '') + p.name }; }),
      placeholder: 'Not set',
      hint: 'New patients default to this post'
    });
    postSel.input.addEventListener('change', function () { EV.settings.postId = postSel.input.value; EV.save(); });

    var who = UI.field({
      label: 'Who is using this device', value: EV.settings.deviceLabel, cls: 'sm',
      placeholder: 'Ns. Gaby', hint: 'Signs vitals, orders and notes by default'
    });
    who.input.addEventListener('change', function () { EV.settings.deviceLabel = who.input.value; EV.save(); });

    body.appendChild(EV.el('div', { class: 'fgrid' }, [postSel, who]));

    body.appendChild(EV.el('div', { class: 'f' }, [
      EV.el('label', {}, ['Text size']),
      UI.segment({
        value: String(EV.settings.ui.fontScale), block: true,
        options: [{ v: '0.92', l: 'Small' }, { v: '1', l: 'Normal' }, { v: '1.12', l: 'Large' }, { v: '1.25', l: 'Largest' }],
        onChange: function (v) { EV.settings.ui.fontScale = +v; EV.save(); EV.applyTheme(); }
      })
    ]));
    body.appendChild(EV.el('div', { class: 'f' }, [
      EV.el('label', {}, ['Density']),
      UI.segment({
        value: EV.settings.ui.density, block: true,
        options: [{ v: 'comfortable', l: 'Comfortable' }, { v: 'compact', l: 'Compact — more on screen' }],
        onChange: function (v) { EV.settings.ui.density = v; EV.save(); EV.applyTheme(); }
      })
    ]));

    host.appendChild(UI.card('This device', body));

    /* Sync */
    var sb = EV.el('div', { class: 'stack' });
    var s = EV.store.syncState;
    sb.appendChild(EV.el('div', { class: 'strip' }, [
      UI.stat('Status', s.error ? 'Error' : s.online ? 'Online' : 'Offline', s.error || ''),
      UI.stat('Queued', s.pending, 'waiting to send'),
      UI.stat('Last sync', s.lastPull ? EV.hhmm(s.lastPull) : '—'),
      UI.stat('Devices', s.devices || '—', 'on this event')
    ]));
    var syncOn = EV.el('div', { class: 'f' }, [
      EV.el('label', {}, ['Share with the other posts']),
      UI.segment({
        value: EV.settings.sync.enabled ? 'on' : 'off', block: true,
        options: [{ v: 'off', l: 'Off — this device only' }, { v: 'on', l: 'On' }],
        onChange: function (v) {
          EV.settings.sync.enabled = v === 'on';
          EV.save();
          if (v === 'on') EV.store.startAutoSync(); else EV.store.stopAutoSync();
        }
      })
    ]);
    sb.appendChild(syncOn);
    var sEnd = UI.field({ label: 'Sync endpoint', value: EV.settings.sync.endpoint, cls: 'sm' });
    sEnd.input.addEventListener('change', function () { EV.settings.sync.endpoint = sEnd.input.value; EV.save(); });
    sb.appendChild(sEnd);
    sb.appendChild(EV.el('div', { class: 'row' }, [
      UI.btn('Sync now', 'pri', function () {
        EV.store.sync().then(function (st) {
          EV.toast(st.error ? 'Sync failed: ' + st.error : 'Synced', st.error ? 'bad' : 'ok');
          UI.render();
        });
      }, 'sync'),
      UI.btn('Full resync', '', function () {
        EV.store.sync({ full: true }).then(function () { EV.toast('Full resync done', 'ok'); UI.render(); });
      })
    ]));
    host.appendChild(UI.card('Sync', sb));

    /* Passcode */
    var pb = EV.el('div', { class: 'stack' });
    pb.appendChild(EV.el('p', {
      class: 'small muted',
      text: UI.isUnlocked() ? 'Configuration is unlocked on this device for the next few minutes.' : 'Configuration is locked.'
    }));
    pb.appendChild(EV.el('div', { class: 'row' }, [
      UI.isUnlocked()
        ? UI.btn('Lock now', '', function () { UI.lock(); UI.render(); }, 'lock')
        : UI.btn('Unlock', 'pri', function () { UI.requireUnlock().then(function () { UI.render(); }); }, 'lock'),
      UI.btn('Change passcode', '', function () { changePass(); })
    ]));
    host.appendChild(UI.card('Configuration passcode', pb));
  }

  function changePass() {
    UI.requireUnlock('Confirm the current passcode before setting a new one.').then(function (ok) {
      if (!ok) return;
      var sh = UI.sheet({ title: 'New passcode', footer: [] });
      var a = UI.field({ label: 'New passcode', type: 'password', inputmode: 'numeric' });
      var b = UI.field({ label: 'Repeat', type: 'password', inputmode: 'numeric' });
      sh.setBody(EV.el('div', { class: 'stack' }, [
        EV.el('p', { class: 'small muted', text: 'Digits only. It is stored as a one-way hash, so it cannot be read back off the device — if it is lost, the only way back is clearing the app data.' }),
        a, b
      ]));
      sh.setFooter([
        UI.btn('Cancel', '', function () { sh.close(); }),
        UI.btn('Set passcode', 'pri', function () {
          if (!/^\d{4,12}$/.test(a.input.value)) { a.setError('4 to 12 digits'); return; }
          if (a.input.value !== b.input.value) { b.setError('They do not match'); return; }
          EV.settings.passcodeHash = EV.hashPass(a.input.value);
          EV.save();
          sh.close();
          EV.toast('Passcode changed', 'ok');
        })
      ]);
    });
  }

  /* ====================================================================== */
  /* Data & diagnostics                                                      */
  /* ====================================================================== */
  function tabData(host) {
    var body = EV.el('div', { class: 'stack' });
    body.appendChild(EV.el('div', { class: 'row' }, [
      UI.btn('Excel recap', 'pri', function () { UI.exportRecap(); }, 'xls'),
      UI.btn('Back up everything (JSON)', '', function () {
        var json = JSON.stringify(EV.store.exportAll());
        var ev = EV.model.event();
        var how = EV.download(new Blob([json], { type: 'application/json' }),
          'event-emr-backup-' + EV.slug((ev && ev.name) || 'event') + '-' + EV.dateInput(EV.now()) + '.json');
        if (how !== 'capability') EV.toast('Backup saved', 'ok');
      }, 'down'),
      UI.btn('Restore from a backup', '', function () { restore(); })
    ]));
    body.appendChild(EV.el('div', {
      class: 'tiny muted',
      text: 'A JSON backup is the belt-and-braces copy: it restores on any device and merges without creating duplicates.'
    }));
    host.appendChild(UI.card('Export & backup', body));

    /* Self-tests. These are the honest answer to "is this safe to use today". */
    var tb = EV.el('div', { class: 'stack tight' });
    var results = runSelfTests();
    var total = results.reduce(function (a, r) { return a + r.total; }, 0);
    var failed = results.reduce(function (a, r) { return a + r.fail; }, 0);
    tb.appendChild(EV.el('div', {}, [
      EV.el('span', {
        class: 'pill ' + (failed ? 'bad' : 'ok'),
        text: (total - failed) + ' / ' + total + ' checks pass'
      })
    ]));
    var tbl = EV.el('table', { class: 'dt' });
    tbl.appendChild(EV.h('<thead><tr><th>Module</th><th class="n">Pass</th><th class="n">Fail</th><th>First failure</th></tr></thead>'));
    var tbody = EV.el('tbody');
    results.forEach(function (r) {
      var tr = EV.el('tr');
      tr.appendChild(EV.el('td', { class: 'strong', text: r.name }));
      tr.appendChild(EV.el('td', { class: 'n', text: String(r.pass) }));
      tr.appendChild(EV.el('td', { class: 'n' + (r.fail ? ' ' : ''), text: String(r.fail) }));
      tr.appendChild(EV.el('td', {
        class: 'small muted trunc',
        text: r.failures && r.failures.length
          ? r.failures[0].name + ': expected ' + r.failures[0].expected + ', got ' + r.failures[0].got
          : (r.total ? 'all pass' : 'no tests')
      }));
      tbody.appendChild(tr);
    });
    tbl.appendChild(tbody);
    tb.appendChild(EV.el('div', { class: 'tblw' }, [tbl]));
    host.appendChild(UI.card('Self-tests', tb));

    if (EV.errors.length) {
      var eb = EV.el('div', { class: 'stack tight' });
      EV.errors.slice(0, 12).forEach(function (e) {
        eb.appendChild(EV.el('div', { class: 'small' }, [
          EV.el('span', { class: 'mono muted', text: EV.hhmmss(e.t) + ' ' }),
          EV.el('span', { class: 'tag bad', text: e.where }),
          EV.el('span', { text: ' ' + e.msg })
        ]));
      });
      host.appendChild(UI.card('Recent errors on this device', eb, {
        head: UI.btn('Clear', 'sm ghost', function () { EV.errors.length = 0; UI.render(); })
      }));
    }

    var db = EV.el('div', { class: 'stack' });
    db.appendChild(EV.el('p', {
      class: 'small muted',
      text: 'Clearing wipes this device only. Anything already synced to the other posts or uploaded to Drive is untouched.'
    }));
    db.appendChild(UI.btn('Clear all data on this device', 'bad', function () {
      UI.requireUnlock('Clearing the local database needs the configuration passcode.').then(function (ok) {
        if (!ok) return;
        EV.confirm('Delete every record stored on this device? Unsynced patients will be lost.',
          { danger: true, ok: 'Delete everything' }).then(function (yes) {
            if (!yes) return;
            EV.store.wipe().then(function () {
              EV.toast('Local data cleared', 'ok');
              UI.go('board');
            });
          });
      });
    }, 'trash'));
    host.appendChild(UI.card('Danger zone', db));

    host.appendChild(UI.card('About', EV.el('div', { class: 'small muted stack tight' }, [
      EV.el('div', { text: 'Mini Emergency & Critical Care Event EMR, version ' + EV.VERSION }),
      EV.el('div', { text: 'Device ' + EV.deviceId() }),
      EV.el('div', { text: 'Modules: ' + ['model', 'formulary', 'calc', 'resus', 'ref', 'pdf', 'xlsx', 'analytics'].filter(function (m) { return !!EV[m]; }).join(', ') }),
      EV.el('div', { text: 'A clinical record, not a decision-maker. Doses and scores must be checked against local protocol and the current drug reference before use.' })
    ])));
  }

  function runSelfTests() {
    var mods = [
      ['Model', EV.model], ['Formulary', EV.formulary], ['Calculators', EV.calc],
      ['Resuscitation', EV.resus], ['Reference', EV.ref], ['PDF', EV.pdf],
      ['Excel', EV.xlsx], ['Analytics', EV.analytics]
    ];
    return mods.map(function (m) {
      var name = m[0], mod = m[1];
      if (!mod || typeof mod.selfTest !== 'function') {
        return { name: name, pass: 0, fail: 0, total: 0, failures: [] };
      }
      try {
        var r = mod.selfTest() || {};
        return {
          name: name, pass: r.pass || 0, fail: r.fail || 0,
          total: r.total || 0, failures: r.failures || []
        };
      } catch (e) {
        EV.logError('selfTest:' + name, e);
        return { name: name, pass: 0, fail: 1, total: 1, failures: [{ name: 'threw', expected: 'no throw', got: e.message }] };
      }
    });
  }
  UI.runSelfTests = runSelfTests;

  function restore() {
    var input = EV.el('input', { type: 'file', accept: '.json,application/json', style: { display: 'none' } });
    document.body.appendChild(input);
    input.addEventListener('change', function () {
      var f = input.files && input.files[0];
      document.body.removeChild(input);
      if (!f) return;
      var rd = new FileReader();
      rd.onload = function () {
        try {
          var n = EV.store.importAll(JSON.parse(rd.result));
          EV.toast(n + ' records restored', 'ok');
          UI.render();
        } catch (e) {
          EV.toast('Could not read that file: ' + e.message, 'bad', 5000);
        }
      };
      rd.readAsText(f);
    });
    input.click();
  }

})(window.EV = window.EV || {});
