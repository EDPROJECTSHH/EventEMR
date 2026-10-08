/* ==========================================================================
   12-ui-patient.js — registration, the chart, CPPT and transport.

   Registration is deliberately four fields and a triage strip: at a finish
   line you get name, acuity and complaint before anything else, and the rest
   is filled in once the patient is on a bed. Nothing in the chart has a Save
   button — every control commits on change, because a half-finished form that
   nobody saved is the failure mode that actually happens at an event.
   ========================================================================== */
(function (EV) {
  'use strict';

  var UI = EV.ui;

  /* ====================================================================== */
  /* Registration                                                            */
  /* ====================================================================== */

  UI.newPatient = function (seed) {
    var ev = EV.model.event();
    if (!ev) { EV.toast('Create the event first', 'warn'); UI.go('board'); return; }

    if (!EV.model.isLive(ev)) { EV.toast('This event is no longer accepting patients', 'warn'); return; }
    var allPosts = EV.model.posts();
    /* A post can only admit to itself. The super admin at the Command Center
       can admit anywhere, which is what makes them useful during a surge. */
    var posts = EV.model.isSuperAdmin() ? allPosts
      : allPosts.filter(function (x) { return x.id === EV.model.boundPostId(); });
    if (!posts.length) posts = allPosts;
    var postId = (seed && seed.postId) || EV.model.boundPostId() || (posts[0] && posts[0].id) || '';
    if (!EV.model.canCreatePatient(postId)) { EV.toast('You can only admit to your own post', 'warn'); return; }
    var draft = EV.model.newPatient({ postId: postId, bedId: (seed && seed.bedId) || null });

    var sh = UI.sheet({ title: 'New patient', footer: [] });
    var body = EV.el('div', { class: 'stack' });

    /* --- the four things that matter in the first ten seconds --- */
    var name = UI.field({
      label: 'Name', req: true, placeholder: 'Full name, or "Unknown male, blue jacket"',
      autocomplete: 'off'
    });
    var bib = UI.field({ label: 'ID / ticket no.', placeholder: 'Badge, ticket or ID number', cls: 'sm' });
    var age = UI.field({ label: 'Age', type: 'number', inputmode: 'numeric', min: 0, max: 120, cls: 'sm n' });
    var ageUnit = UI.segment({ value: 'y', options: [{ v: 'y', l: 'yr' }, { v: 'mo', l: 'mo' }] });
    var sex = UI.segment({ value: '', options: [{ v: 'M', l: 'M' }, { v: 'F', l: 'F' }] });

    var ident = EV.el('div', { class: 'fgrid' }, [
      EV.el('div', { class: 'wfull' }, [name]),
      bib, age,
      EV.el('div', { class: 'f sm' }, [EV.el('label', {}, ['Age unit']), ageUnit]),
      EV.el('div', { class: 'f sm' }, [EV.el('label', {}, ['Sex']), sex])
    ]);
    body.appendChild(ident);

    /* --- triage --- */
    body.appendChild(EV.el('div', { class: 'sec-h' }, ['Triage', EV.el('span', { class: 'rule' })]));
    var acuity = 0;
    var acuitySeg = UI.segment({
      value: 0, block: true, cls: 'acuity', dataKey: 'a',
      options: EV.model.ACUITY.map(function (a) {
        return { v: a.v, l: a.s + ' ' + a.l, hint: a.hint };
      }),
      onChange: function (v) { acuity = v; }
    });
    body.appendChild(acuitySeg);

    var complaint = UI.field({
      label: 'Chief complaint', placeholder: 'What happened, in their words',
      buttons: [{
        label: 'ref', title: 'Open the clinical reference for this complaint',
        onClick: function (v) { UI.openRef(v); }
      }]
    });
    body.appendChild(complaint);

    var catSel = UI.field({
      label: 'Category', type: 'select', cls: 'sm',
      options: EV.model.COMPLAINT_CATS.map(function (c) { return { v: c.v, l: c.l }; }),
      placeholder: 'Auto from complaint'
    });
    /* Guess as they type, but stop guessing the moment they choose. */
    complaint.input.addEventListener('input', EV.debounce(function () {
      if (catSel.input.dataset.touched) return;
      catSel.input.value = EV.model.catFor(complaint.input.value);
    }, 200));
    catSel.input.addEventListener('change', function () { catSel.input.dataset.touched = '1'; });

    var arrivalMode = UI.field({
      label: 'Arrived by', type: 'select', cls: 'sm', value: 'walk-in',
      options: EV.model.ARRIVAL.map(function (a) { return { v: a.v, l: a.l }; })
    });
    var fromLoc = UI.field({
      label: 'From where', placeholder: 'Gate 7 / Hall B / Stand 14', cls: 'sm',
      hint: 'The location you would radio'
    });
    var arrivedAt = UI.field({
      label: 'Arrived at', type: 'time', cls: 'sm',
      value: (function () { var d = new Date(); return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2); })()
    });

    body.appendChild(EV.el('div', { class: 'fgrid' }, [catSel, arrivalMode, fromLoc, arrivedAt]));

    /* --- where --- */
    body.appendChild(EV.el('div', { class: 'sec-h' }, ['Location', EV.el('span', { class: 'rule' })]));
    var postSel = UI.field({
      label: 'Post', type: 'select', cls: 'sm', value: postId,
      options: posts.map(function (p) { return { v: p.id, l: (p.code ? p.code + ' · ' : '') + p.name }; })
    });
    var bedSel = UI.field({ label: 'Bed', type: 'select', cls: 'sm', options: [], placeholder: 'No bed / ambulatory' });
    function fillBeds() {
      var beds = EV.model.beds(postSel.input.value);
      EV.clear(bedSel.input);
      bedSel.input.appendChild(EV.el('option', { value: '' }, ['No bed / ambulatory']));
      beds.forEach(function (b) {
        var busy = b.status === 'occupied' && b.patientId;
        bedSel.input.appendChild(EV.el('option', {
          value: b.id,
          selected: (seed && seed.bedId === b.id) ? true : null,
          disabled: b.status === 'offline' ? true : null
        }, [b.label + (busy ? ' (occupied)' : b.status === 'cleaning' ? ' (cleaning)' : b.status === 'offline' ? ' (out of service)' : '')]));
      });
    }
    fillBeds();
    postSel.input.addEventListener('change', fillBeds);
    body.appendChild(EV.el('div', { class: 'fgrid' }, [postSel, bedSel]));

    /* --- quick clinical, optional --- */
    body.appendChild(EV.el('div', { class: 'sec-h' }, ['Quick clinical (optional)', EV.el('span', { class: 'rule' })]));
    var weight = UI.field({
      label: 'Weight', type: 'number', inputmode: 'decimal', step: '0.1', cls: 'sm n',
      hint: 'kg — unlocks dosing',
      buttons: [{
        label: 'fx', title: 'Weight engine: IBW, LBW, BSA, BMI',
        onClick: function () { UI.openCalc('weights', draftSnapshot()); }
      }]
    });
    var allergies = UI.field({
      label: 'Allergies', placeholder: 'NKDA', cls: 'sm',
      hint: 'Write NKDA if asked and none'
    });
    body.appendChild(EV.el('div', { class: 'fgrid' }, [weight, EV.el('div', { class: 'w2' }, [allergies])]));

    function draftSnapshot() {
      return EV.model.newPatient({
        name: name.input.value, age: EV.num(age.input.value), ageUnit: ageUnit.get(),
        sex: sex.get(), weight: EV.num(weight.input.value)
      });
    }

    function create(andOpen) {
      var nm = String(name.input.value).trim();
      if (!nm) { name.setError('A name or an identifying description is required'); name.input.focus(); return; }
      name.setError('');

      var post = EV.store.get('post', postSel.input.value);
      var seq = EV.model.nextSeq(postSel.input.value);
      var at = EV.now();
      if (arrivedAt.input.value) {
        var hm = /^(\d{1,2}):(\d{2})$/.exec(arrivedAt.input.value);
        if (hm) {
          var d = new Date();
          d.setHours(+hm[1], +hm[2], 0, 0);
          /* A time later than now means it was logged just after midnight for
             an event that started yesterday. */
          if (d.getTime() > at + 60000) d.setDate(d.getDate() - 1);
          at = d.getTime();
        }
      }

      var p = EV.model.newPatient({
        postId: postSel.input.value,
        bedId: null,
        mrn: EV.model.mrn(ev, post, seq),
        name: nm,
        bib: bib.input.value.trim(),
        age: EV.num(age.input.value),
        ageUnit: ageUnit.get(),
        sex: sex.get(),
        weight: EV.num(weight.input.value),
        allergies: allergies.input.value.trim(),
        arrivalAt: at,
        arrivalMode: arrivalMode.input.value,
        fromLocation: fromLoc.input.value.trim(),
        acuity: acuity || 0,
        triageAt: acuity ? EV.now() : undefined,
        triageBy: acuity ? (EV.settings.deviceLabel || '') : '',
        chiefComplaint: complaint.input.value.trim(),
        complaintCat: catSel.input.value || EV.model.catFor(complaint.input.value)
      });

      var bedId = bedSel.input.value;
      var job = bedId ? EV.model.assignBed(p, bedId) : EV.store.put(p);
      job.then(function () {
        EV.toast(p.mrn + ' registered', 'ok');
        sh.close();
        if (andOpen) UI.go('patient', p.id);
        else UI.render();
      });
    }

    sh.setBody(body);
    sh.setFooter([
      UI.btn('Cancel', '', function () { sh.close(); }),
      UI.btn('Register', '', function () { create(false); }),
      UI.btn('Register & open chart', 'pri', function () { create(true); }, 'check')
    ]);

    /* Enter anywhere in the identity block registers and opens — the common
       path when someone is standing in front of you. */
    body.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && e.target.tagName === 'INPUT') { e.preventDefault(); create(true); }
    });
    setTimeout(function () { name.input.focus(); }, 40);
  };

  /* ====================================================================== */
  /* The chart                                                               */
  /* ====================================================================== */

  UI.route('patient', function (root, id) {
    var p = EV.store.get('patient', id);
    if (!p) {
      root.appendChild(UI.empty('Patient not found', 'It may have been removed, or this device has not synced yet.',
        UI.btn('Back to the board', 'pri', function () { UI.go('board'); })));
      return;
    }
    var d = EV.model.derive(p);
    var editable = EV.model.canEditPatient(p);
    var reason = editable ? '' : EV.model.readOnlyReason(p);

    root.appendChild(patientHeader(p, d, editable));
    if (!editable) root.appendChild(readOnlyNote(reason, p));

    var grid = EV.el('div', { class: 'chart' });
    var left = EV.el('div', { class: 'stack' });
    var right = EV.el('div', { class: 'stack' });

    if (!editable) {
      /* A post that cannot edit still needs the summary — that is how the
         Command Center and the receiving post read a case. */
      left.appendChild(summaryCard(p, d));
      left.appendChild(vitalsCard(p, false));
      left.appendChild(ordersCard(p, false));
      left.appendChild(cpptCard(p, false));
      right.appendChild(identitySummary(p, d));
      right.appendChild(documentsCard(p, false));
    } else {
      left.appendChild(vitalsCard(p, true));
      left.appendChild(ordersCard(p, true));
      left.appendChild(cpptCard(p, true));
      right.appendChild(identityCard(p));
      right.appendChild(clinicalCard(p));
      right.appendChild(dispositionCard(p));
      right.appendChild(documentsCard(p, true));
    }

    grid.appendChild(left);
    grid.appendChild(right);
    root.appendChild(grid);
  });

  function patientHeader(p, d, editable) {
    var a = EV.model.acuity(p.acuity);
    var h = EV.el('div', { class: 'pthead ' + a.c });

    var back = EV.el('button', { class: 'iconbtn', type: 'button', 'aria-label': 'Back' });
    back.innerHTML = UI.icon('back');
    back.addEventListener('click', function () { history.length > 1 ? history.back() : UI.go('board'); });
    h.appendChild(back);

    var idblock = EV.el('div', { class: 'grow', style: { minWidth: '0' } });
    var line1 = EV.el('div', { class: 'row tight', style: { gap: '8px' } }, [
      UI.acuityBadge(p.acuity),
      EV.el('h1', { class: 'trunc', text: p.name || '(no name)' })
    ]);
    if (p.status === 'closed') {
      line1.appendChild(EV.el('span', { class: 'tag ' + EV.model.dispo(p.disposition).c, text: EV.model.dispo(p.disposition).l }));
    }
    idblock.appendChild(line1);

    var line2 = EV.el('div', { class: 'row tight small muted', style: { marginTop: '2px' } });
    line2.appendChild(EV.el('span', { class: 'mrn mono', text: p.mrn || '—' }));
    if (EV.has(d.ageYears)) line2.appendChild(EV.el('span', { text: EV.fmt(d.ageYears, 0) + ' ' + (p.sex || '') }));
    if (EV.has(d.weight)) line2.appendChild(EV.el('span', { text: d.weight + ' kg' }));
    if (p.bib) line2.appendChild(EV.el('span', { text: 'ID ' + p.bib }));
    var post = EV.model.post(p.postId);
    var bed = p.bedId && EV.store.get('bed', p.bedId);
    if (post) line2.appendChild(EV.el('span', { text: (post.code || post.name) + (bed ? ' · ' + bed.label : '') }));
    line2.appendChild(EV.el('span', { text: 'In ' + d.los }));
    idblock.appendChild(line2);

    if (p.allergies) {
      var al = /^(nkda|none|nil|no known|tidak ada|-)$/i.test(p.allergies.trim());
      idblock.appendChild(EV.el('div', { style: { marginTop: '4px' } }, [
        EV.el('span', { class: 'tag ' + (al ? '' : 'bad'), text: (al ? '' : '⚠ ') + 'Allergy: ' + p.allergies })
      ]));
    } else {
      idblock.appendChild(EV.el('div', { style: { marginTop: '4px' } }, [
        EV.el('span', { class: 'tag warn', text: 'Allergies not recorded' })
      ]));
    }
    if (d.redFlags.length) idblock.appendChild(EV.el('div', { style: { marginTop: '4px' } }, [UI.flagChips(d.redFlags, 6)]));
    h.appendChild(idblock);

    if (p.lockedAt) {
      idblock.appendChild(EV.el('div', { style: { marginTop: '4px' } }, [
        EV.el('span', { class: 'locked-badge' }, [
          'Discharged ' + EV.hhmm(p.lockedAt) + (p.lockedBy ? ' by ' + p.lockedBy : '')
        ])
      ]));
    }

    var acts = EV.el('div', { class: 'row tight' });
    if (editable) {
      acts.appendChild(UI.btn('Vitals', 'pri', function () { vitalsSheet(p); }, 'heart'));
      acts.appendChild(UI.btn('Order', '', function () { orderSheet(p); }, 'pill'));
      acts.appendChild(UI.btn('Note', '', function () { cpptSheet(p); }, 'note'));
      var code = UI.btn('CODE', 'bad', function () { UI.openResus(p); }, 'alert');
      code.title = 'Open the resuscitation board for this patient';
      acts.appendChild(code);
    } else {
      var po = EV.store.get('post', p.postId);
      if (po && po.id !== EV.model.boundPostId()) {
        acts.appendChild(UI.chatButton('post', po.id, po.code || po.name, ''));
      }
      acts.appendChild(UI.btn('Patient PDF', '', function () { UI.makePdf(p, 'record'); }, 'pdf'));
    }
    h.appendChild(acts);

    return h;
  }

  /* ---- identity ----------------------------------------------------------- */
  function identityCard(p) {
    var body = EV.el('div', { class: 'fgrid' });
    function bind(field, key, parse) {
      field.input.addEventListener('change', function () {
        var c = EV.clone(p);
        c[key] = parse ? parse(field.input.value) : field.input.value;
        EV.store.put(c);
      });
      return field;
    }
    body.appendChild(bind(UI.field({ label: 'Name', value: p.name, cls: 'sm wfull' }), 'name'));
    body.appendChild(bind(UI.field({
      label: 'Age', type: 'number', value: p.age, cls: 'sm n',
      buttons: [{ label: 'fx', title: 'Weight & dosing engine', onClick: function () { UI.openCalc('weights', p); } }]
    }), 'age', EV.num));
    body.appendChild(bind(UI.field({
      label: 'Weight (kg)', type: 'number', step: '0.1', value: p.weight, cls: 'sm n',
      buttons: [{ label: 'fx', title: 'Weight & dosing engine', onClick: function () { UI.openCalc('weights', p); } }]
    }), 'weight', EV.num));
    body.appendChild(bind(UI.field({
      label: 'Sex', type: 'select', value: p.sex, cls: 'sm',
      options: [{ v: 'M', l: 'Male' }, { v: 'F', l: 'Female' }], placeholder: '—'
    }), 'sex'));
    body.appendChild(bind(UI.field({ label: 'ID / ticket', value: p.bib, cls: 'sm' }), 'bib'));
    body.appendChild(bind(UI.field({ label: 'Nationality', value: p.nationality, cls: 'sm' }), 'nationality'));
    body.appendChild(bind(UI.field({ label: 'Phone', value: p.phone, cls: 'sm', type: 'tel' }), 'phone'));
    body.appendChild(bind(UI.field({ label: 'Next of kin', value: p.contactName, cls: 'sm' }), 'contactName'));
    body.appendChild(bind(UI.field({ label: 'Kin phone', value: p.contactPhone, cls: 'sm', type: 'tel' }), 'contactPhone'));
    body.appendChild(bind(UI.field({ label: 'Arrived from', value: p.fromLocation, cls: 'sm' }), 'fromLocation'));
    body.appendChild(bind(UI.field({
      label: 'Arrived by', type: 'select', value: p.arrivalMode, cls: 'sm',
      options: EV.model.ARRIVAL.map(function (a) { return { v: a.v, l: a.l }; })
    }), 'arrivalMode'));

    var move = UI.btn('Move', 'sm ghost', function () { movePatient(p); }, 'bed');
    return UI.card('Identity & arrival', body, { head: move });
  }

  function movePatient(p) {
    var sh = UI.sheet({ title: 'Move ' + (p.name || 'patient'), footer: [] });
    var body = EV.el('div', { class: 'stack' });
    var posts = EV.model.posts();

    var postSel = UI.field({
      label: 'Post', type: 'select', value: p.postId,
      options: posts.map(function (x) { return { v: x.id, l: (x.code ? x.code + ' · ' : '') + x.name }; })
    });
    var bedSel = UI.field({ label: 'Bed', type: 'select', options: [], placeholder: 'No bed / ambulatory' });
    function fill() {
      EV.clear(bedSel.input);
      bedSel.input.appendChild(EV.el('option', { value: '' }, ['No bed / ambulatory']));
      EV.model.beds(postSel.input.value).forEach(function (b) {
        var busy = b.patientId && b.patientId !== p.id;
        bedSel.input.appendChild(EV.el('option', {
          value: b.id, selected: p.bedId === b.id ? true : null,
          disabled: b.status === 'offline' ? true : null
        }, [b.label + (busy ? ' (occupied — will be released)' : '')]));
      });
    }
    fill();
    postSel.input.addEventListener('change', fill);
    body.appendChild(postSel);
    body.appendChild(bedSel);
    sh.setBody(body);
    sh.setFooter([
      UI.btn('Cancel', '', function () { sh.close(); }),
      UI.btn('Move', 'pri', function () {
        var c = EV.clone(p);
        c.postId = postSel.input.value;
        EV.model.assignBed(c, bedSel.input.value).then(function () {
          sh.close();
          EV.toast('Moved', 'ok');
        });
      })
    ]);
  }

  /* ---- vitals ------------------------------------------------------------- */
  var VCOLS = [
    { k: 'hr', l: 'HR', u: 'bpm', lo: 50, hi: 110, crit: [40, 130] },
    { k: 'sbp', l: 'SBP', u: 'mmHg', lo: 100, hi: 160, crit: [90, 200] },
    { k: 'dbp', l: 'DBP', u: 'mmHg', lo: 55, hi: 100, crit: [40, 120] },
    { k: 'rr', l: 'RR', u: '/min', lo: 12, hi: 20, crit: [8, 25] },
    { k: 'spo2', l: 'SpO₂', u: '%', lo: 95, hi: 100, crit: [92, 101] },
    { k: 'temp', l: 'Temp', u: '°C', lo: 36, hi: 37.5, crit: [35, 38.5] },
    { k: 'gcs', l: 'GCS', u: '', lo: 15, hi: 15, crit: [14, 16] },
    { k: 'bgl', l: 'BGL', u: 'mg/dL', lo: 70, hi: 180, crit: [60, 300] },
    { k: 'pain', l: 'Pain', u: '/10', lo: 0, hi: 3, crit: [0, 7] }
  ];
  function cellClass(col, v) {
    var n = EV.num(v);
    if (!EV.has(n)) return '';
    if (n < col.crit[0] || n > col.crit[1]) return 'ab';
    if (n < col.lo || n > col.hi) return 'warn';
    return '';
  }

  function vitalsCard(p, editable) {
    if (editable === undefined) editable = true;
    var vitals = EV.sortBy(p.vitals || [], 't', 'desc');
    var body;
    if (!vitals.length) {
      body = UI.empty('No vitals yet', 'Record the first set — NEWS2 and the red flags light up from here.',
        UI.btn('Record vitals', 'pri', function () { vitalsSheet(p); }, 'heart'));
    } else {
      var tbl = EV.el('table', { class: 'vt' });
      var thead = EV.el('thead');
      var hr = EV.el('tr');
      hr.appendChild(EV.el('th', { text: 'Time' }));
      VCOLS.forEach(function (c) { hr.appendChild(EV.el('th', { title: c.l + ' (' + c.u + ')', text: c.l })); });
      hr.appendChild(EV.el('th', { text: 'NEWS2' }));
      thead.appendChild(hr);
      tbl.appendChild(thead);

      var tb = EV.el('tbody');
      vitals.forEach(function (v) {
        var tr = EV.el('tr');
        tr.appendChild(EV.el('td', { text: EV.hhmm(v.t) }));
        VCOLS.forEach(function (c) {
          tr.appendChild(EV.el('td', {
            class: cellClass(c, v[c.k]),
            text: EV.has(EV.num(v[c.k])) ? String(v[c.k]) : '·'
          }));
        });
        var n2 = EV.model.news2(v);
        tr.appendChild(EV.el('td', {
          class: n2.band === 'high' ? 'ab' : n2.band === 'medium' ? 'warn' : '',
          title: n2.partial ? n2.n + ' of 7 parameters recorded' : 'complete',
          text: EV.has(n2.score) ? String(n2.score) + (n2.partial ? '*' : '') : '·'
        }));
        if (editable) tr.addEventListener('click', function () { vitalsSheet(p, v); });
        tb.appendChild(tr);
      });
      tbl.appendChild(tb);
      body = EV.el('div', { class: 'tblw' }, [tbl]);

      var n2last = EV.model.news2(EV.model.lastVitals(p));
      if (n2last.partial) {
        body.appendChild(EV.el('div', {
          class: 'tiny muted', style: { marginTop: '6px' },
          text: '* partial — scored on ' + n2last.n + ' of 7 parameters, so it reads low.'
        }));
      }
    }
    return UI.card('Vitals', body, {
      head: editable ? UI.btn('Add', 'sm pri', function () { vitalsSheet(p); }, 'plus') : null,
      flush: !!vitals.length
    });
  }

  function vitalsSheet(p, existing) {
    var sh = UI.sheet({ title: existing ? 'Edit vitals · ' + EV.hhmm(existing.t) : 'Record vitals', footer: [] });
    var v = existing ? EV.clone(existing) : EV.model.newVitals();
    var body = EV.el('div', { class: 'stack' });

    var live = EV.el('div', { class: 'card' });
    var liveB = EV.el('div', { class: 'card-b', style: { display: 'grid', gap: '6px' } });
    live.appendChild(liveB);

    var fields = {};
    var grid = EV.el('div', { class: 'fgrid tight' });
    VCOLS.forEach(function (c) {
      var f = UI.field({
        label: c.l + (c.u ? ' ' + c.u : ''), type: 'number', inputmode: 'decimal',
        step: c.k === 'temp' ? '0.1' : '1', value: v[c.k], cls: 'sm n'
      });
      f.input.addEventListener('input', function () {
        v[c.k] = EV.num(f.input.value);
        refresh();
      });
      fields[c.k] = f;
      grid.appendChild(f);
    });
    body.appendChild(grid);

    var o2row = EV.el('div', { class: 'row' });
    o2row.appendChild(EV.el('div', { class: 'f sm' }, [
      EV.el('label', {}, ['On oxygen']),
      UI.segment({
        value: v.o2 ? 'yes' : 'no',
        options: [{ v: 'no', l: 'Room air' }, { v: 'yes', l: 'On O₂' }],
        onChange: function (x) { v.o2 = x === 'yes'; refresh(); }
      })
    ]));
    o2row.appendChild(EV.el('div', { class: 'f sm' }, [
      EV.el('label', {}, ['AVPU']),
      UI.segment({
        value: v.avpu || '',
        options: [{ v: 'A', l: 'A' }, { v: 'V', l: 'V' }, { v: 'P', l: 'P' }, { v: 'U', l: 'U' }],
        onChange: function (x) { v.avpu = x; refresh(); }
      })
    ]));
    body.appendChild(o2row);
    body.appendChild(live);

    function refresh() {
      EV.clear(liveB);
      var n2 = EV.model.news2(v);
      var row = EV.el('div', { class: 'row', style: { gap: '10px' } });
      row.appendChild(EV.el('div', {}, [
        EV.el('div', { class: 'tiny muted', text: 'NEWS2' }),
        EV.el('div', {
          class: 'mono', style: {
            fontSize: '26px', fontWeight: '600',
            color: n2.band === 'high' ? 'var(--bad)' : n2.band === 'medium' ? 'var(--warn)' : 'var(--ink)'
          },
          text: EV.has(n2.score) ? String(n2.score) : '—'
        })
      ]));
      row.appendChild(EV.el('div', { class: 'grow' }, [
        EV.el('div', { class: 'small strong', text: n2.label || 'Not enough recorded' }),
        EV.el('div', {
          class: 'tiny muted',
          text: n2.n ? n2.n + ' of 7 parameters recorded' + (n2.missing ? ' — ' + n2.missing + ' missing' : '') : 'Nothing recorded yet'
        })
      ]));
      var map = EV.model.map(v.sbp, v.dbp);
      var si = EV.model.shockIndex(v.hr, v.sbp);
      var side = EV.el('div', { class: 'row tight' });
      if (EV.has(map)) side.appendChild(EV.el('span', { class: 'tag' + (map < 65 ? ' bad' : ''), text: 'MAP ' + map }));
      if (EV.has(si)) side.appendChild(EV.el('span', { class: 'tag' + (si >= 1 ? ' bad' : si >= 0.9 ? ' warn' : ''), text: 'SI ' + si }));
      row.appendChild(side);
      liveB.appendChild(row);
    }
    refresh();

    sh.setBody(body);
    sh.setFooter([
      existing ? UI.btn('Delete', 'ghost', function () {
        EV.confirm('Delete this set of vitals?', { danger: true, ok: 'Delete' }).then(function (ok) {
          if (!ok) return;
          var c = EV.clone(p);
          c.vitals = c.vitals.filter(function (x) { return x.t !== existing.t; });
          EV.store.put(c).then(function () { sh.close(); });
        });
      }, 'trash') : null,
      UI.btn('Cancel', '', function () { sh.close(); }),
      UI.btn('Save vitals', 'pri', function () {
        var c = EV.clone(p);
        v.by = v.by || EV.settings.deviceLabel || '';
        if (existing) {
          c.vitals = c.vitals.map(function (x) { return x.t === existing.t ? v : x; });
        } else {
          c.vitals = (c.vitals || []).concat([v]);
        }
        /* The latest weight recorded with vitals becomes the chart weight —
           a runner weighed at the tent is more current than registration. */
        if (EV.has(EV.num(v.weight))) c.weight = EV.num(v.weight);
        EV.store.put(c).then(function () { sh.close(); EV.toast('Vitals recorded', 'ok'); });
      }, 'check')
    ]);
  }

  /* ---- orders ------------------------------------------------------------- */
  function ordersCard(p, editable) {
    if (editable === undefined) editable = true;
    var orders = EV.sortBy(p.orders || [], 't', 'desc');
    var body;
    if (!orders.length) {
      body = UI.empty('Nothing given yet', 'Medications, fluids, supplies and procedures all log here and flow into the PDF and the Excel recap.',
        UI.btn('Add an order', 'pri', function () { orderSheet(p); }, 'pill'));
    } else {
      var tl = EV.el('div', { class: 'tl' });
      orders.forEach(function (o) {
        var e = EV.el('div', { class: 'e ' + (o.kind === 'med' ? 'med' : o.kind === 'fluid' ? 'fluid' : o.kind === 'procedure' ? 'proc' : 'note') });
        e.appendChild(EV.el('div', { class: 't', text: EV.hhmm(o.t) }));
        var l = EV.el('div', { class: 'l' });
        var line = EV.el('b', {});
        line.innerHTML = '<span class="kind"></span>' + EV.esc(o.name || '(unnamed)');
        l.appendChild(line);
        var bits = [];
        if (o.dose) bits.push(o.dose + (o.unit ? ' ' + o.unit : ''));
        if (o.route) bits.push(o.route);
        if (o.rate) bits.push(o.rate);
        if (o.qty && o.kind === 'supply') bits.push('×' + o.qty);
        if (o.by) bits.push('by ' + o.by);
        if (o.note) bits.push(o.note);
        if (bits.length) l.appendChild(EV.el('small', { text: bits.join(' · ') }));
        e.appendChild(l);
        var x = EV.el('button', { class: 'iconbtn', type: 'button', 'aria-label': 'Remove' });
        x.innerHTML = UI.icon('trash', 14);
        x.addEventListener('click', function (ev2) {
          ev2.stopPropagation();
          EV.confirm('Remove "' + (o.name || 'this order') + '" from the record?', { danger: true, ok: 'Remove' }).then(function (ok) {
            if (!ok) return;
            var c = EV.clone(p);
            c.orders = c.orders.filter(function (y) { return y.id !== o.id; });
            EV.store.put(c);
          });
        });
        if (editable) e.appendChild(x);
        tl.appendChild(e);
      });
      body = tl;
    }
    return UI.card('Medications, fluids & procedures', body, {
      head: editable ? UI.btn('Add', 'sm pri', function () { orderSheet(p); }, 'plus') : null
    });
  }

  function orderSheet(p, prefill) {
    var sh = UI.sheet({ title: 'Add to the record', footer: [] });
    var o = EV.model.newOrder(prefill || {});
    var body = EV.el('div', { class: 'stack' });

    body.appendChild(UI.segment({
      value: o.kind, block: true,
      options: [
        { v: 'med', l: 'Medication' }, { v: 'fluid', l: 'Fluid' },
        { v: 'supply', l: 'Supply' }, { v: 'procedure', l: 'Procedure' }
      ],
      onChange: function (v) { o.kind = v; redraw(); }
    }));

    var host = EV.el('div', { class: 'stack' });
    body.appendChild(host);

    function redraw() {
      EV.clear(host);
      var nameF = UI.field({
        label: o.kind === 'procedure' ? 'Procedure' : 'Item', value: o.name,
        placeholder: o.kind === 'procedure' ? 'IV cannula 18G right ACF' : 'Start typing — Ondansetron, NaCl, Kassa…',
        buttons: o.kind === 'procedure' ? null : [{
          label: 'Rx', title: 'Pick from the formulary',
          onClick: function () {
            UI.openFormulary(p, function (item, computed) {
              o.itemId = item.id;
              o.name = item.name + (item.generic && item.generic !== item.name ? ' (' + item.generic + ')' : '');
              o.unit = (computed && computed.unit) || item.unit || '';
              o.dose = (computed && computed.dose) || item.dose || '';
              o.route = (computed && computed.route) || item.defaultRoute || '';
              o.kind = item.kind === 'med' ? (item.cat === 'fluid' ? 'fluid' : 'med') : 'supply';
              redraw();
            });
          }
        }]
      });
      nameF.input.addEventListener('input', function () { o.name = nameF.input.value; });
      host.appendChild(nameF);

      if (o.kind === 'supply') {
        var qty = UI.field({ label: 'Quantity', type: 'number', value: o.qty, cls: 'sm n', min: 1 });
        qty.input.addEventListener('input', function () { o.qty = EV.num(qty.input.value) || 1; });
        host.appendChild(EV.el('div', { class: 'fgrid' }, [qty]));
      } else if (o.kind === 'procedure') {
        var note1 = UI.field({ label: 'Detail', type: 'textarea', rows: 2, value: o.note });
        note1.input.addEventListener('input', function () { o.note = note1.input.value; });
        host.appendChild(note1);
      } else {
        var dose = UI.field({
          label: 'Dose', value: o.dose, cls: 'sm',
          buttons: [{
            label: 'fx', title: 'Dose calculator for this patient',
            onClick: function () {
              UI.openCalc('infusion', p, function (res) {
                if (res && res.dose) { o.dose = res.dose; redraw(); }
              });
            }
          }]
        });
        dose.input.addEventListener('input', function () { o.dose = dose.input.value; });
        var unit = UI.field({
          label: 'Unit', value: o.unit, cls: 'sm', type: 'select', placeholder: '—',
          options: ['mg', 'mcg', 'g', 'mL', 'IU', 'mEq', 'puff', 'drop', 'tab', 'amp', 'vial']
        });
        unit.input.addEventListener('change', function () { o.unit = unit.input.value; });
        var route = UI.field({
          label: 'Route', value: o.route, cls: 'sm', type: 'select', placeholder: '—',
          options: EV.model.ROUTES
        });
        route.input.addEventListener('change', function () { o.route = route.input.value; });
        var rate = UI.field({ label: 'Rate / over', value: o.rate, cls: 'sm', placeholder: '20 mL/h · over 10 min' });
        rate.input.addEventListener('input', function () { o.rate = rate.input.value; });
        host.appendChild(EV.el('div', { class: 'fgrid' }, [dose, unit, route, rate]));

        /* If we know the item and the patient's weight, show the mL at the
           real vial strength — the number the nurse actually draws up. */
        if (o.itemId && EV.formulary) {
          var conc = EV.formulary.conc ? EV.formulary.conc(o.itemId) : null;
          var mg = EV.num(o.dose);
          if (conc && conc.perMl && EV.has(mg)) {
            host.appendChild(EV.el('div', { class: 'card' }, [
              EV.el('div', {
                class: 'card-b mono', style: { fontSize: '14px' },
                text: '= ' + EV.fmt(mg / conc.perMl, 2) + ' mL at ' + conc.label
              })
            ]));
          }
        }
      }

      var when = UI.field({ label: 'Given at', type: 'time', cls: 'sm', value: EV.hhmm(o.t) });
      when.input.addEventListener('change', function () {
        var m = /^(\d{1,2}):(\d{2})$/.exec(when.input.value);
        if (!m) return;
        var dt = new Date(o.t);
        dt.setHours(+m[1], +m[2], 0, 0);
        o.t = dt.getTime();
      });
      var by = UI.field({ label: 'Given by', cls: 'sm', value: o.by || EV.settings.deviceLabel || '' });
      by.input.addEventListener('input', function () { o.by = by.input.value; });
      host.appendChild(EV.el('div', { class: 'fgrid' }, [when, by]));

      if (o.kind !== 'procedure') {
        var note2 = UI.field({ label: 'Note', value: o.note, cls: 'sm' });
        note2.input.addEventListener('input', function () { o.note = note2.input.value; });
        host.appendChild(note2);
      }
    }
    redraw();

    sh.setBody(body);
    sh.setFooter([
      UI.btn('Cancel', '', function () { sh.close(); }),
      UI.btn('Add to record', 'pri', function () {
        if (!String(o.name).trim()) { EV.toast('Name the item first', 'warn'); return; }
        o.givenAt = o.t;
        var c = EV.clone(p);
        c.orders = (c.orders || []).concat([o]);
        EV.store.put(c).then(function () { sh.close(); EV.toast('Recorded', 'ok'); });
      }, 'check')
    ]);
  }
  UI.orderSheet = orderSheet;

  /* ---- CPPT / progress notes ---------------------------------------------- */
  function cpptCard(p, editable) {
    if (editable === undefined) editable = true;
    var notes = EV.sortBy(p.cppt || [], 't', 'desc');
    var body;
    if (!notes.length) {
      body = UI.empty('No progress notes',
        'The CPPT is what the receiving hospital reads. One note on arrival, one at each reassessment, one at handover.',
        UI.btn('Write the first note', 'pri', function () { cpptSheet(p); }, 'note'));
    } else {
      body = EV.el('div', { class: 'stack tight' });
      notes.forEach(function (n) { body.appendChild(cpptEntry(p, n)); });
    }
    return UI.card('CPPT — progress notes', body, {
      head: editable ? UI.btn('Add note', 'sm pri', function () { cpptSheet(p); }, 'plus') : null
    });
  }

  function cpptEntry(p, n) {
    var card = EV.el('div', { class: 'note-card' + (n.locked ? ' locked' : '') });
    var head = EV.el('div', { class: 'nh' });
    head.appendChild(EV.el('span', { class: 'who', text: n.by || 'Unsigned' }));
    if (n.role) head.appendChild(EV.el('span', { text: n.role }));
    head.appendChild(EV.el('span', { class: 'mono', text: EV.dmyhm(n.t) }));
    head.appendChild(EV.el('span', {
      class: 'tag ' + (n.phase === 'transport' ? 'warn' : n.phase === 'handover' ? 'info' : ''),
      text: n.phase === 'transport' ? 'In transit' : n.phase === 'handover' ? 'Handover' : 'On site'
    }));
    head.appendChild(EV.el('span', { class: 'grow' }));
    if (n.locked) {
      head.appendChild(EV.el('span', { class: 'tag', text: 'Signed' }));
    } else {
      if (UI.cpptEditable !== false && EV.model.canEditPatient(p)) {
        var edit = EV.el('button', { class: 'btn sm ghost', type: 'button', text: 'Edit' });
        edit.addEventListener('click', function () { cpptSheet(p, n); });
        head.appendChild(edit);
      }
    }
    card.appendChild(head);

    var soap = EV.el('div', { class: 'soap' });
    [['S', n.s], ['O', n.o], ['A', n.a], ['P', n.p]].forEach(function (pair) {
      if (!String(pair[1] || '').trim()) return;
      soap.appendChild(EV.el('div', { class: 'k', text: pair[0] }));
      soap.appendChild(EV.el('div', { class: 'v', text: pair[1] }));
    });
    card.appendChild(soap);
    return card;
  }

  function cpptSheet(p, existing) {
    var sh = UI.sheet({ title: existing ? 'Edit progress note' : 'New progress note', footer: [] });
    var n = existing ? EV.clone(existing) : EV.model.newCppt({ by: EV.settings.deviceLabel || '' });
    var body = EV.el('div', { class: 'stack' });

    body.appendChild(UI.segment({
      value: n.phase, block: true,
      options: [
        { v: 'post', l: 'On site' },
        { v: 'transport', l: 'In the ambulance' },
        { v: 'handover', l: 'Handover' }
      ],
      onChange: function (v) { n.phase = v; }
    }));

    var who = UI.field({ label: 'Written by', value: n.by, cls: 'sm' });
    var role = UI.field({
      label: 'Role', value: n.role, cls: 'sm', type: 'select',
      options: EV.model.STAFF_ROLES, placeholder: '—'
    });
    body.appendChild(EV.el('div', { class: 'fgrid' }, [who, role]));

    var S = UI.field({
      label: 'S — Subjective', type: 'textarea', rows: 2, value: n.s,
      placeholder: 'What the patient says and what happened'
    });
    var O = UI.field({
      label: 'O — Objective', type: 'textarea', rows: 3, value: n.o,
      placeholder: 'Examination and vitals',
      buttons: [{
        label: '↧', title: 'Pull in the latest vitals',
        onClick: function () {
          var v = EV.model.lastVitals(p);
          if (!v) { EV.toast('No vitals recorded yet', 'warn'); return; }
          O.input.value = (O.input.value ? O.input.value.replace(/\s*$/, '') + '\n' : '') + vitalsLine(v);
          O.input.focus();
        }
      }]
    });
    var A = UI.field({
      label: 'A — Assessment', type: 'textarea', rows: 2, value: n.a,
      placeholder: 'Working diagnosis',
      buttons: [{
        label: 'ref', title: 'Clinical reference',
        onClick: function (v) { UI.openRef(v || p.chiefComplaint); }
      }]
    });
    var P = UI.field({
      label: 'P — Plan', type: 'textarea', rows: 2, value: n.p,
      placeholder: 'Treatment given, reassessment interval, disposition intent'
    });
    body.appendChild(S); body.appendChild(O); body.appendChild(A); body.appendChild(P);

    /* First note of an encounter: seed it from the triage data so nobody
       retypes what they already entered. */
    if (!existing && !(p.cppt || []).length) {
      if (!S.input.value && p.chiefComplaint) {
        S.input.value = p.chiefComplaint +
          (p.fromLocation ? ' (from ' + p.fromLocation + ')' : '');
      }
      var lv = EV.model.lastVitals(p);
      if (!O.input.value && lv) O.input.value = vitalsLine(lv);
    }

    sh.setBody(body);
    sh.setFooter([
      UI.btn('Cancel', '', function () { sh.close(); }),
      UI.btn('Save', '', function () { commit(false); }),
      UI.btn('Save & sign', 'pri', function () { commit(true); }, 'check')
    ]);

    function commit(lock) {
      n.by = who.input.value; n.role = role.input.value;
      n.s = S.input.value; n.o = O.input.value; n.a = A.input.value; n.p = P.input.value;
      if (!(n.s || n.o || n.a || n.p).trim()) { EV.toast('Write something first', 'warn'); return; }
      if (lock && !String(n.by).trim()) { EV.toast('Sign it with a name', 'warn'); who.input.focus(); return; }
      n.locked = !!lock;
      var c = EV.clone(p);
      if (existing) c.cppt = c.cppt.map(function (x) { return x.id === n.id ? n : x; });
      else c.cppt = (c.cppt || []).concat([n]);
      EV.store.put(c).then(function () {
        sh.close();
        EV.toast(lock ? 'Note signed' : 'Note saved', 'ok');
      });
    }
  }
  UI.cpptSheet = cpptSheet;

  function vitalsLine(v) {
    var bits = [];
    if (EV.has(EV.num(v.hr))) bits.push('HR ' + v.hr);
    if (EV.has(EV.num(v.sbp))) bits.push('BP ' + v.sbp + '/' + (EV.has(EV.num(v.dbp)) ? v.dbp : '?'));
    if (EV.has(EV.num(v.rr))) bits.push('RR ' + v.rr);
    if (EV.has(EV.num(v.spo2))) bits.push('SpO2 ' + v.spo2 + '%' + (v.o2 ? ' on O2' : ' RA'));
    if (EV.has(EV.num(v.temp))) bits.push('T ' + v.temp + '°C');
    if (EV.has(EV.num(v.gcs))) bits.push('GCS ' + v.gcs);
    if (v.avpu) bits.push('AVPU ' + v.avpu);
    if (EV.has(EV.num(v.bgl))) bits.push('BGL ' + v.bgl);
    if (EV.has(EV.num(v.pain))) bits.push('Pain ' + v.pain + '/10');
    var n2 = EV.model.news2(v);
    if (EV.has(n2.score)) bits.push('NEWS2 ' + n2.score + (n2.partial ? ' (partial)' : ''));
    return EV.hhmm(v.t) + ' — ' + bits.join(', ');
  }
  UI.vitalsLine = vitalsLine;

  /* ---- clinical ----------------------------------------------------------- */
  function clinicalCard(p) {
    var body = EV.el('div', { class: 'stack tight' });
    function bind(f, key) {
      f.input.addEventListener('change', function () {
        var c = EV.clone(p);
        c[key] = f.input.value;
        if (key === 'chiefComplaint') c.complaintCat = c.complaintCat || EV.model.catFor(f.input.value);
        EV.store.put(c);
      });
      return f;
    }
    body.appendChild(bind(UI.field({
      label: 'Chief complaint', value: p.chiefComplaint, cls: 'sm',
      buttons: [{ label: 'ref', title: 'Clinical reference', onClick: function (v) { UI.openRef(v); } }]
    }), 'chiefComplaint'));

    body.appendChild(bind(UI.field({
      label: 'Allergies', value: p.allergies, cls: 'sm', placeholder: 'NKDA'
    }), 'allergies'));

    body.appendChild(bind(UI.field({
      label: 'Regular medications', value: p.homeMeds, cls: 'sm', placeholder: 'None'
    }), 'homeMeds'));

    body.appendChild(bind(UI.field({
      label: 'Relevant history', value: p.pmh, cls: 'sm', placeholder: 'Asthma, diabetes, cardiac history…'
    }), 'pmh'));

    body.appendChild(bind(UI.field({
      label: 'Examination', type: 'textarea', rows: 3, value: p.exam, cls: 'sm'
    }), 'exam'));

    body.appendChild(bind(UI.field({
      label: 'Assessment / working diagnosis', type: 'textarea', rows: 2, value: p.assessment, cls: 'sm',
      buttons: [{ label: 'ref', title: 'Clinical reference', onClick: function (v) { UI.openRef(v || p.chiefComplaint); } }]
    }), 'assessment'));

    body.appendChild(bind(UI.field({
      label: 'ICD-10', value: p.icd10, cls: 'sm', placeholder: 'T67.0 / S93.4'
    }), 'icd10'));

    var acuityRow = EV.el('div', { class: 'f sm' }, [
      EV.el('label', {}, ['Acuity']),
      UI.segment({
        value: p.acuity || 0, block: true, cls: 'acuity', dataKey: 'a',
        options: EV.model.ACUITY.map(function (a) { return { v: a.v, l: a.s, hint: a.l + ' — ' + a.hint }; }),
        onChange: function (v) {
          var c = EV.clone(p);
          c.acuity = v;
          if (!c.triageAt) { c.triageAt = EV.now(); c.triageBy = EV.settings.deviceLabel || ''; }
          EV.store.put(c);
        }
      })
    ]);
    body.appendChild(acuityRow);

    var calcBtn = UI.btn('Calculators', 'sm ghost', function () { UI.openCalc(null, p); }, 'chart');
    return UI.card('Clinical', body, { head: calcBtn });
  }

  /* ---- disposition -------------------------------------------------------
     Three outcomes, and each one asks the question a clinician would ask
     anyway: what did you tell them, where are you sending them, and why. */
  function dispositionCard(p) {
    var body = EV.el('div', { class: 'stack tight' });
    var cur = EV.model.dispo(p.disposition);
    var closed = p.status === 'closed';

    if (closed) {
      body.appendChild(EV.el('div', { class: 'banner ' + (cur.c || '') }, [
        EV.h(UI.icon('check', 17)),
        EV.el('div', { class: 'grow small' }, [
          EV.el('div', { class: 'strong', text: cur.l }),
          EV.el('div', {
            text: EV.hhmm(p.dispositionAt) + (p.dispositionBy ? ' by ' + p.dispositionBy : '') +
              ' · stayed ' + EV.durShort((p.dispositionAt || EV.now()) - p.arrivalAt)
          })
        ])
      ]));
      if (p.destination) {
        body.appendChild(EV.el('div', { class: 'small' }, [
          EV.el('span', { class: 'muted', text: 'Destination: ' }),
          EV.el('span', { class: 'strong', text: p.destination })
        ]));
      }
      if (p.dischargeInstructions) {
        body.appendChild(EV.el('div', { class: 'card' }, [
          EV.el('div', { class: 'card-b small' }, [
            EV.el('div', { class: 'tiny muted', text: 'Instructions given' }),
            EV.el('div', { style: { whiteSpace: 'pre-wrap' }, text: p.dischargeInstructions })
          ])
        ]));
      }
    } else {
      body.appendChild(EV.el('div', { class: 'stack tight' }, [
        UI.btn('Discharge', 'ok block lg', function () { dischargeDialog(p); }, 'check'),
        UI.btn('Closer observation at…', 'warn block lg', function () { transferDialog(p); }, 'bed'),
        UI.btn('Refer to hospital', 'block lg', function () { referDialog(p); }, 'amb')
      ]));
    }

    if ((p.transfers || []).length) {
      body.appendChild(EV.el('div', { class: 'sec-h' }, ['Transfers', EV.el('span', { class: 'rule' })]));
      p.transfers.forEach(function (t) {
        body.appendChild(EV.el('div', { class: 'small' }, [
          EV.el('span', { class: 'mono muted', text: EV.hhmm(t.at) + ' ' }),
          EV.el('span', { text: (t.fromLabel || '?') + ' → ' + (t.toLabel || '?') }),
          t.overflow ? EV.el('span', { class: 'tag warn', text: 'wheelchair' }) : null,
          t.reason ? EV.el('div', { class: 'tiny muted', text: t.reason }) : null
        ]));
      });
    }

    var head = closed
      ? UI.btn('Reopen', 'sm ghost', function () {
        EV.confirm('Reopen this record? It will become editable again at this post.')
          .then(function (ok) {
            if (!ok) return;
            var c = EV.clone(p);
            c.status = 'active'; c.closedAt = undefined; c.lockedAt = undefined;
            EV.store.put(c).then(function () { EV.toast('Reopened', 'ok'); });
          });
      })
      : null;
    return UI.card('Outcome', body, { head: head });
  }

  /* ---- discharge ---------------------------------------------------------- */
  function dischargeDialog(p) {
    var sh = UI.sheet({ title: 'Discharge ' + (p.name || 'patient'), footer: [] });
    var body = EV.el('div', { class: 'stack' });

    body.appendChild(EV.el('div', { class: 'banner warn' }, [
      EV.h(UI.icon('alert', 17)),
      EV.el('div', { class: 'grow small' }, [
        EV.el('div', { class: 'strong', text: 'Are you sure you want to discharge the patient?' }),
        EV.el('div', {
          text: 'The record is locked when you discharge. It stays editable for an addendum, ' +
            'but it is marked closed from that moment.'
        })
      ])
    ]));

    var v = EV.model.validate(p);
    if (v.warn.length) {
      var w = EV.el('div', { class: 'chips' });
      v.warn.forEach(function (x) { w.appendChild(EV.el('span', { class: 'tag warn', text: x.m })); });
      body.appendChild(EV.el('div', { class: 'stack tight' }, [
        EV.el('div', { class: 'tiny muted', text: 'Still missing from the record:' }), w
      ]));
    }

    var instructions = UI.field({
      label: 'Instructions, recommendations and discharge medication',
      type: 'textarea', rows: 5,
      placeholder: 'What you told the patient: what to watch for, what to take, when to come back, ' +
        'who to see. This prints on their copy.'
    });
    body.appendChild(instructions);

    var quick = EV.el('div', { class: 'chips' });
    ['Rest and oral fluids', 'Return if symptoms worsen', 'Paracetamol 500 mg up to 4× daily',
      'Ice and elevate the limb', 'See your own doctor within 48 hours',
      'Advised to stop activity for today'].forEach(function (t) {
        var c = EV.el('button', { class: 'chip sm', type: 'button' }, [t]);
        c.addEventListener('click', function () {
          instructions.input.value = (instructions.input.value ? instructions.input.value.replace(/\s*$/, '') + '\n' : '') + '• ' + t;
          instructions.input.focus();
        });
        quick.appendChild(c);
      });
    body.appendChild(quick);

    var note = UI.field({ label: 'Internal note (not shown to the patient)', cls: 'sm' });
    body.appendChild(note);

    sh.setBody(body);
    sh.setFooter([
      UI.btn('Cancel', '', function () { sh.close(); }),
      UI.btn('Discharge now', 'ok', function () {
        EV.model.discharge(p, {
          disposition: 'discharged',
          instructions: instructions.input.value,
          note: note.input.value,
          by: EV.settings.deviceLabel || ''
        }).then(function () {
          sh.close();
          EV.toast('Discharged — record locked', 'ok');
          UI.maybeUpload(EV.store.get('patient', p.id));
        });
      }, 'check')
    ]);
  }

  /* ---- inter-post transfer ------------------------------------------------ */
  function transferDialog(p) {
    var sh = UI.sheet({ title: 'Closer observation at…', footer: [] });
    var body = EV.el('div', { class: 'stack' });
    var chosen = { postId: '', bedId: '', overflow: false };

    body.appendChild(EV.el('p', {
      class: 'muted', style: { margin: 0 },
      text: 'The record closes here and reopens at the receiving post, with the whole chart intact.'
    }));

    var others = EV.model.posts().filter(function (x) {
      return x.id !== p.postId && x.kind !== 'command' && x.active !== false;
    });
    if (!others.length) {
      body.appendChild(UI.empty('Nowhere to transfer to', 'This event has only one treating post.'));
      sh.setBody(body);
      sh.setFooter([UI.btn('Close', '', function () { sh.close(); })]);
      return;
    }

    var listHost = EV.el('div', { class: 'stack tight' });
    var bedHost = EV.el('div');
    var reason = UI.field({
      label: 'Reason for inter-post transfer', type: 'textarea', rows: 2, req: true,
      placeholder: 'Needs longer observation · closer to the exit · we are full · has a bed free'
    });

    function drawPosts() {
      EV.clear(listHost);
      others.forEach(function (po) {
        var bs = EV.model.bedState(po.id);
        var row = EV.el('button', {
          class: 'prow' + (chosen.postId === po.id ? ' urgent' : ''), type: 'button',
          style: { borderLeftColor: bs.full ? 'var(--bad)' : 'var(--ok)' }
        });
        row.appendChild(EV.el('span', { class: 'grow' }, [
          EV.el('span', { class: 'nm', text: (po.code ? po.code + ' · ' : '') + po.name }),
          EV.el('span', { class: 'sub' }, [
            EV.el('span', { text: po.location || '' }),
            EV.el('span', { text: EV.model.openPatients(po.id).length + ' open' })
          ])
        ]));
        row.appendChild(EV.el('span', {
          class: 'tag ' + (bs.none ? '' : bs.full ? 'bad' : 'ok'),
          text: bs.none ? 'no beds configured'
            : bs.full ? 'Occupied — full' : bs.free + ' of ' + bs.usable + ' available'
        }));
        row.addEventListener('click', function () {
          chosen.postId = po.id; chosen.bedId = ''; chosen.overflow = false;
          drawPosts(); drawBeds();
        });
        listHost.appendChild(row);
      });
    }

    function drawBeds() {
      EV.clear(bedHost);
      if (!chosen.postId) return;
      var free = EV.model.freeBeds(chosen.postId);
      var po = EV.store.get('post', chosen.postId);

      if (free.length) {
        bedHost.appendChild(EV.el('div', { class: 'sec-h' }, ['Assign a bed', EV.el('span', { class: 'rule' })]));
        var chips = EV.el('div', { class: 'chips' });
        free.forEach(function (b) {
          var c = EV.el('button', {
            class: 'chip' + (chosen.bedId === b.id ? ' on' : ''), type: 'button'
          }, [b.label]);
          c.addEventListener('click', function () {
            chosen.bedId = b.id; chosen.overflow = false; drawBeds();
          });
          chips.appendChild(c);
        });
        bedHost.appendChild(chips);
        if (!chosen.bedId) chosen.bedId = free[0].id;
      } else {
        /* No bed free. Offer the wheelchair outside rather than refusing a
           patient who still needs watching. */
        bedHost.appendChild(EV.el('div', { class: 'banner warn' }, [
          EV.h(UI.icon('alert', 17)),
          EV.el('div', { class: 'grow small' }, [
            EV.el('div', { class: 'strong', text: ((po && po.name) || 'That post') + ' has no bed free' }),
            EV.el('div', {
              text: 'Is the patient willing to wait in a wheelchair outside the post? They can ' +
                'still be treated and given medication there.'
            })
          ])
        ]));
        bedHost.appendChild(UI.segment({
          value: chosen.overflow ? 'yes' : 'no', block: true,
          options: [{ v: 'no', l: 'No — choose another post' }, { v: 'yes', l: 'Yes — wheelchair outside' }],
          onChange: function (v) { chosen.overflow = v === 'yes'; }
        }));
      }
    }

    drawPosts();
    body.appendChild(listHost);
    body.appendChild(bedHost);
    body.appendChild(reason);
    sh.setBody(body);
    sh.setFooter([
      UI.btn('Cancel', '', function () { sh.close(); }),
      UI.btn('Transfer between posts', 'warn', function () {
        if (!chosen.postId) { EV.toast('Choose the receiving post', 'warn'); return; }
        if (!String(reason.input.value).trim()) { reason.setError('Say why'); return; }
        var free = EV.model.freeBeds(chosen.postId);
        if (!free.length && !chosen.overflow) {
          EV.toast('That post is full — choose another, or send them to the wheelchair area', 'warn', 5000);
          return;
        }
        EV.model.transferToPost(p, chosen.postId, {
          bedId: free.length ? chosen.bedId : '',
          overflow: !free.length && chosen.overflow,
          reason: reason.input.value.trim(),
          by: EV.settings.deviceLabel || ''
        }).then(function () {
          var po = EV.store.get('post', chosen.postId);
          /* Tell them it is coming — the record alone is not a handover. */
          EV.model.sendChat('post', chosen.postId, (po && (po.code || po.name)) || 'post',
            'Transferring ' + (p.name || 'a patient') + ' (' + (p.mrn || '') + ') to you' +
            (chosen.overflow ? ' — no bed free, waiting in a wheelchair' : '') +
            '. Reason: ' + reason.input.value.trim(), true);
          sh.close();
          EV.toast('Transferred to ' + ((po && (po.code || po.name)) || 'the other post'), 'ok', 4000);
          UI.go('board');
        });
      }, 'bed')
    ]);
  }

  /* ---- refer to hospital --------------------------------------------------- */
  function referDialog(p) {
    var sh = UI.sheet({ title: 'Refer to hospital', footer: [] });
    var body = EV.el('div', { class: 'stack' });
    var t = EV.clone(p.transport || {
      ambulanceId: '', destination: '', departAt: EV.now(),
      arriveAt: undefined, handoverTo: '', escort: '', note: ''
    });

    var ambs = EV.model.ambulances();
    var ambSel = UI.field({
      label: 'Ambulance', type: 'select', value: t.ambulanceId,
      options: ambs.map(function (a) {
        var st = EV.model.AMB_STATUS.filter(function (s) { return s.v === a.status; })[0] || {};
        return { v: a.id, l: a.callsign + ' · ' + (st.l || a.status) };
      }),
      placeholder: ambs.length ? 'Choose an ambulance (or own transport)' : 'No ambulances configured'
    });
    var dest = UI.field({
      label: 'Receiving hospital', value: t.destination, req: true,
      placeholder: 'Siloam Hospitals Kebon Jeruk — Emergency Department'
    });
    var depart = UI.field({ label: 'Departed', type: 'time', cls: 'sm', value: EV.hhmm(t.departAt) });
    var escort = UI.field({ label: 'Escorted by', value: t.escort, cls: 'sm' });
    var handover = UI.field({ label: 'Handed over to', value: t.handoverTo, cls: 'sm' });
    var note = UI.field({
      label: 'Handover note', type: 'textarea', rows: 3, value: t.note,
      placeholder: 'What the receiving team needs in the first minute.'
    });

    body.appendChild(ambSel);
    body.appendChild(dest);
    body.appendChild(EV.el('div', { class: 'fgrid' }, [depart, escort, handover]));
    body.appendChild(note);
    body.appendChild(EV.el('div', { class: 'row' }, [
      UI.btn('Transport form PDF', '', function () { UI.makePdf(p, 'transport'); }, 'pdf'),
      UI.btn('Full chart PDF', '', function () { UI.makePdf(p, 'record'); }, 'pdf'),
      UI.btn('Print', '', function () { window.print(); }, 'print')
    ]));

    sh.setBody(body);
    sh.setFooter([
      UI.btn('Cancel', '', function () { sh.close(); }),
      UI.btn('Refer and close record', 'pri', function () {
        if (!String(dest.input.value).trim()) { dest.setError('Name the receiving hospital'); return; }
        var m = /^(\d{1,2}):(\d{2})$/.exec(depart.input.value);
        if (m) { var d = new Date(t.departAt || EV.now()); d.setHours(+m[1], +m[2], 0, 0); t.departAt = d.getTime(); }
        t.ambulanceId = ambSel.input.value;
        t.destination = dest.input.value.trim();
        t.escort = escort.input.value;
        t.handoverTo = handover.input.value;
        t.note = note.input.value;

        var c = EV.clone(p);
        c.transport = t;
        c.transportId = t.ambulanceId || null;

        var jobs = [];
        if (t.ambulanceId) {
          var amb = EV.store.get('ambulance', t.ambulanceId);
          if (amb) {
            var ac = EV.clone(amb);
            ac.patientId = p.id;
            ac.destination = t.destination;
            ac.status = 'transporting';
            jobs.push(EV.store.put(ac));
          }
        }
        jobs.push(EV.model.discharge(c, {
          disposition: 'refer-hospital',
          destination: t.destination,
          instructions: t.note,
          by: EV.settings.deviceLabel || ''
        }));
        Promise.all(jobs).then(function () {
          sh.close();
          EV.toast('Referred to ' + t.destination, 'ok');
          UI.maybeUpload(EV.store.get('patient', p.id));
        });
      }, 'amb')
    ]);
  }

  /* ---- read-only views ----------------------------------------------------- */
  function readOnlyNote(reason, p) {
    var n = EV.el('div', { class: 'readonly-note' });
    n.appendChild(EV.h(UI.icon('lock', 16)));
    n.appendChild(EV.el('span', { class: 'grow', text: reason }));
    var po = EV.store.get('post', p.postId);
    if (po && po.id !== EV.model.boundPostId() && EV.model.isLive(EV.model.event())) {
      n.appendChild(UI.chatButton('post', po.id, po.code || po.name, ''));
    }
    if (EV.model.atCommandCenter() && !EV.model.isSuperAdmin()) {
      n.appendChild(UI.btn('Sign in as super admin', 'sm', function () {
        UI.requireUnlock('Super admin can edit any post’s records.').then(function (ok) {
          if (ok) { EV.model.grantSuper(); UI.render(); }
        });
      }, 'lock'));
    }
    return n;
  }

  /* The summary a post or the Command Center reads when the patient is not
     theirs: enough to make a decision, nothing to accidentally change. */
  function summaryCard(p, d) {
    var body = EV.el('div', { class: 'stack tight' });
    var v = d.lastVitals || {};

    function line(label, value) {
      if (!EV.has(value) || value === '') return;
      body.appendChild(EV.el('div', { class: 'row', style: { gap: '10px', alignItems: 'baseline' } }, [
        EV.el('span', { class: 'tiny muted', style: { minWidth: '110px' }, text: label }),
        EV.el('span', { class: 'grow strong', style: { whiteSpace: 'pre-wrap' }, text: String(value) })
      ]));
    }
    line('Presenting', p.chiefComplaint);
    line('Assessment', p.assessment);
    line('Allergies', p.allergies || 'Not recorded');
    line('Latest vitals', v.t ? UI.vitalsLine(v) : 'None recorded');
    if (EV.has(d.news2 && d.news2.score)) {
      line('NEWS2', d.news2.score + ' — ' + d.news2.label + (d.news2.partial ? ' (partial)' : ''));
    }
    line('Treatment', (p.orders || []).filter(function (o) { return o.kind !== 'supply'; })
      .map(function (o) { return o.name + (o.dose ? ' ' + o.dose + ' ' + (o.unit || '') : ''); })
      .join(', '));
    line('Outcome', p.disposition ? EV.model.dispo(p.disposition).l : 'Still open');
    if (p.destination) line('Destination', p.destination);
    if (p.dischargeInstructions) line('Instructions', p.dischargeInstructions);

    return UI.card('Summary', body);
  }

  function identitySummary(p, d) {
    var body = EV.el('div', { class: 'stack tight' });
    function row(l, v) {
      body.appendChild(EV.el('div', { class: 'row', style: { justifyContent: 'space-between', gap: '10px' } }, [
        EV.el('span', { class: 'tiny muted', text: l }),
        EV.el('span', { class: 'strong', text: EV.has(v) && v !== '' ? String(v) : '—' })
      ]));
    }
    row('Record no.', p.mrn);
    row('Age', EV.has(d.ageYears) ? EV.fmt(d.ageYears, 0) + ' yr' : '');
    row('Sex', p.sex);
    row('Weight', EV.has(d.weight) ? d.weight + ' kg' : '');
    row('ID / ticket', p.bib);
    row('Arrived', EV.hhmm(p.arrivalAt));
    row('From', p.fromLocation);
    var po = EV.store.get('post', p.postId);
    row('Post', po ? (po.code || po.name) : '');
    row('Triage', EV.model.acuity(p.acuity).s + ' ' + EV.model.acuity(p.acuity).l);
    row('Length of stay', d.los);
    return UI.card('Identity', body);
  }

  /* ---- documents ---------------------------------------------------------- */
  function documentsCard(p, editable) {
    if (editable === undefined) editable = true;
    var body = EV.el('div', { class: 'stack tight' });
    body.appendChild(EV.el('div', { class: 'row' }, [
      UI.btn('Patient PDF', 'pri', function () { UI.makePdf(p, 'record'); }, 'pdf'),
      UI.btn('CPPT PDF', '', function () { UI.makePdf(p, 'cppt'); }, 'note'),
      UI.btn('Transport form', '', function () { UI.makePdf(p, 'transport'); }, 'amb'),
      UI.btn('Print', '', function () { window.print(); }, 'print')
    ]));

    if (EV.settings.drive.enabled) {
      var row = EV.el('div', { class: 'row' });
      row.appendChild(UI.btn(p.pdfDriveId ? 'Update in Drive' : 'Upload to Drive', '', function () {
        UI.uploadPdf(p).then(function (r) {
          if (r) EV.toast(p.pdfDriveId ? 'Drive copy updated' : 'Uploaded to Drive', 'ok');
        });
      }, 'drive'));
      if (p.pdfDriveId) {
        row.appendChild(EV.el('span', {
          class: 'tiny muted',
          text: 'Last pushed ' + (p.pdfSyncedAt ? EV.hhmm(p.pdfSyncedAt) : 'never')
        }));
      }
      body.appendChild(row);
      body.appendChild(EV.el('div', {
        class: 'tiny muted',
        text: p.pdfDriveId
          ? 'Edits re-upload over the same Drive file, so the link in the recap always shows the current chart.'
          : 'The PDF is created fresh each time from the record, so it can never fall behind the chart.'
      }));
    } else {
      body.appendChild(EV.el('div', {
        class: 'tiny muted',
        text: 'Google Drive is switched off. Turn it on in Settings → Google Drive to push PDFs automatically.'
      }));
    }

    var v = EV.model.validate(p);
    if (v.errors.length || v.warn.length) {
      var list = EV.el('div', { class: 'stack tight', style: { marginTop: '8px' } });
      v.errors.forEach(function (e) { list.appendChild(EV.el('div', { class: 'tag bad', text: e.m })); });
      v.warn.forEach(function (w) { list.appendChild(EV.el('div', { class: 'tag warn', text: w.m })); });
      body.appendChild(EV.el('div', { class: 'sec-h' }, ['Record completeness', EV.el('span', { class: 'rule' })]));
      body.appendChild(list);
    }

    return UI.card('Documents', body);
  }

  /* Auto-push on close, when the user asked for it. Failures are logged and
     retried later rather than blocking the person in front of the patient. */
  function maybeUpload(p) {
    if (!p) return;
    var cfg = EV.settings.drive;
    if (!cfg.enabled || !cfg.autoUpload) return;
    UI.uploadPdf(p).catch(function (e) { EV.logError('drive.auto', e); });
  }
  UI.maybeUpload = maybeUpload;

})(window.EV = window.EV || {});
