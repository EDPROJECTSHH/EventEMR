/* ==========================================================================
   02-model.js — the record shapes and everything derived from them.

   One rule runs through this file: a blank field is blank, never zero. A
   patient with no recorded respiratory rate must not score 0 on NEWS2 and
   come out looking well.
   ========================================================================== */
(function (EV) {
  'use strict';

  var M = EV.model = {};

  /* ---- vocabularies ------------------------------------------------------ */

  /* Three levels, by colour, the way a tent actually triages. Everything that
     sorts, stripes or counts reads from here. */
  M.ACUITY = [
    { v: 1, l: 'Immediate', s: 'T1', c: 'a1', colour: 'Red', target: 0,
      hint: 'Life threat — resuscitate now' },
    { v: 2, l: 'Urgent', s: 'T2', c: 'a2', colour: 'Orange', target: 15,
      hint: 'Serious — treat within minutes' },
    { v: 3, l: 'Non-urgent', s: 'T3', c: 'a3', colour: 'Green', target: 60,
      hint: 'Minor — safe to wait' }
  ];
  M.MAX_ACUITY = 3;
  /* Records made before the scale was reduced carry 4 and 5; fold them into
     Non-urgent rather than showing a level that no longer exists. */
  M.normAcuity = function (v) {
    var n = +v;
    if (!n || isNaN(n) || n < 1) return 0;
    return n > M.MAX_ACUITY ? M.MAX_ACUITY : n;
  };
  M.acuity = function (v) {
    var n = M.normAcuity(v);
    for (var i = 0; i < M.ACUITY.length; i++) if (M.ACUITY[i].v === n) return M.ACUITY[i];
    return { v: 0, l: 'Not triaged', s: '—', c: 'a0', colour: '', target: 0, hint: '' };
  };

  M.POST_KINDS = [
    { v: 'mini-icu', l: 'Mini ICU', icon: '◆' },
    { v: 'medical-tent', l: 'Medical tent', icon: '▲' },
    { v: 'first-aid', l: 'First aid post', icon: '+' },
    { v: 'ice-bath', l: 'Cooling / ice bath', icon: '❄' },
    { v: 'roaming', l: 'Roaming team', icon: '⇢' },
    { v: 'ambulance', l: 'Ambulance / transport', icon: '⇄' },
    { v: 'command', l: 'Command post', icon: '★' }
  ];
  M.BED_KINDS = [
    { v: 'resus', l: 'Resuscitation' },
    { v: 'acute', l: 'Acute / emergent care' },
    { v: 'observation', l: 'Observation' },
    { v: 'ice-bath', l: 'Immersive ice bath' },
    { v: 'wheelchair', l: 'Wheelchair' },
    { v: 'stretcher', l: 'Stretcher / trolley' }
  ];
  M.BED_STATUS = [
    { v: 'free', l: 'Free', c: 'ok' },
    { v: 'occupied', l: 'Occupied', c: 'bad' },
    { v: 'cleaning', l: 'Cleaning', c: 'warn' },
    { v: 'offline', l: 'Out of service', c: '' }
  ];
  M.AMB_STATUS = [
    { v: 'available', l: 'Available', c: 'ok' },
    { v: 'dispatched', l: 'Dispatched', c: 'warn' },
    { v: 'on-scene', l: 'On scene', c: 'warn' },
    { v: 'transporting', l: 'Transporting', c: 'bad' },
    { v: 'at-hospital', l: 'At hospital', c: 'info' },
    { v: 'returning', l: 'Returning', c: 'info' },
    { v: 'oos', l: 'Out of service', c: '' }
  ];
  M.ARRIVAL = [
    { v: 'walk-in', l: 'Walk-in' },
    { v: 'wheelchair', l: 'Wheelchair' },
    { v: 'stretcher', l: 'Stretcher' },
    { v: 'carried', l: 'Carried / assisted' },
    { v: 'ambulance', l: 'Ambulance' },
    { v: 'referred', l: 'Referred from another post' }
  ];
  M.DISPOSITION = [
    { v: 'discharged', l: 'Discharged', c: 'ok', closes: true },
    { v: 'observation-transfer', l: 'Closer observation at…', c: 'warn', closes: true },
    { v: 'refer-hospital', l: 'Refer to hospital', c: 'info', closes: true },
    /* Not offered in the picker, but a real outcome that must stay reportable
       and must keep rendering on old records. */
    { v: 'refused', l: 'Refused care / left', c: 'warn', closes: true, hidden: true },
    { v: 'dead-on-scene', l: 'Died on scene', c: 'bad', closes: true, hidden: true },
    { v: 'return-to-event', l: 'Discharged', c: 'ok', closes: true, hidden: true, legacy: true },
    { v: 'discharge-home', l: 'Discharged', c: 'ok', closes: true, hidden: true, legacy: true },
    { v: 'transport', l: 'Refer to hospital', c: 'info', closes: true, hidden: true, legacy: true },
    { v: 'observation', l: 'Under observation', c: 'warn', closes: false, hidden: true, legacy: true }
  ];
  M.DISPOSITION_CHOICES = M.DISPOSITION.filter(function (d) { return !d.hidden; });
  M.dispo = function (v) {
    for (var i = 0; i < M.DISPOSITION.length; i++) if (M.DISPOSITION[i].v === v) return M.DISPOSITION[i];
    return { v: '', l: 'Open', c: '', closes: false };
  };

  /* The complaint buckets an event medical director actually reports on.
     `t` are the typed phrases that map into the bucket. */
  M.COMPLAINT_CATS = [
    { v: 'msk', l: 'Musculoskeletal / sprain', hue: '#9a3412', t: ['sprain', 'ankle', 'knee', 'strain', 'twisted', 'shoulder', 'wrist', 'hip', 'back pain', 'muscle'] },
    { v: 'cramp', l: 'Cramps / exertional', hue: '#b45309', t: ['cramp', 'kram', 'spasm', 'exertional', 'fatigue', 'exhaustion'] },
    { v: 'heat', l: 'Heat illness', hue: '#c2410c', t: ['heat', 'hyperthermia', 'overheat', 'collapse in heat', 'heat stroke', 'heat exhaustion'] },
    { v: 'wound', l: 'Wound / abrasion / blister', hue: '#a16207', t: ['blister', 'abrasion', 'graze', 'laceration', 'cut', 'luka', 'chafing', 'burn'] },
    { v: 'cardiac', l: 'Chest pain / cardiac', hue: '#b0121b', t: ['chest pain', 'nyeri dada', 'palpitation', 'cardiac', 'angina', 'arrest', 'collapse'] },
    { v: 'resp', l: 'Breathing', hue: '#0f6e6e', t: ['short of breath', 'sob', 'breathless', 'sesak', 'asthma', 'wheeze', 'cough'] },
    { v: 'neuro', l: 'Neuro / syncope / head', hue: '#4338ca', t: ['faint', 'syncope', 'pingsan', 'dizzy', 'seizure', 'kejang', 'head injury', 'headache', 'confusion', 'unconscious'] },
    { v: 'gi', l: 'GI / nausea', hue: '#a16207', t: ['nausea', 'vomit', 'muntah', 'diarrhoea', 'diarrhea', 'abdominal', 'stomach', 'mual'] },
    { v: 'allergy', l: 'Allergy / anaphylaxis', hue: '#be123c', t: ['allergy', 'anaphylaxis', 'rash', 'hives', 'urticaria', 'sting', 'bite', 'alergi'] },
    { v: 'metabolic', l: 'Metabolic / glycaemic', hue: '#0369a1', t: ['hypoglyc', 'diabetes', 'sugar', 'dehydration', 'dehidrasi', 'hyponatr'] },
    { v: 'eent', l: 'Eye / ENT / dental', hue: '#15803d', t: ['eye', 'mata', 'nosebleed', 'epistaxis', 'ear', 'dental', 'tooth', 'throat'] },
    { v: 'psych', l: 'Behavioural', hue: '#6d28d9', t: ['anxiety', 'panic', 'agitat', 'intoxicat', 'drunk', 'mabuk', 'overdose'] },
    { v: 'obgyn', l: 'Obstetric / gynae', hue: '#be185d', t: ['pregnan', 'hamil', 'labour', 'labor', 'vaginal'] },
    { v: 'other', l: 'Other', hue: '#64737b', t: [] }
  ];
  /* Guess the bucket from free text so the analytics are usable even when
     nobody picked one. Longest matching phrase wins. */
  M.catFor = function (text) {
    var s = EV.norm(text);
    if (!s) return 'other';
    var best = '', bestLen = 0;
    for (var i = 0; i < M.COMPLAINT_CATS.length; i++) {
      var c = M.COMPLAINT_CATS[i];
      for (var j = 0; j < c.t.length; j++) {
        if (s.indexOf(c.t[j]) !== -1 && c.t[j].length > bestLen) {
          best = c.v; bestLen = c.t[j].length;
        }
      }
    }
    return best || 'other';
  };
  M.catLabel = function (v) {
    for (var i = 0; i < M.COMPLAINT_CATS.length; i++) if (M.COMPLAINT_CATS[i].v === v) return M.COMPLAINT_CATS[i].l;
    return 'Other';
  };
  M.catHue = function (v) {
    for (var i = 0; i < M.COMPLAINT_CATS.length; i++) if (M.COMPLAINT_CATS[i].v === v) return M.COMPLAINT_CATS[i].hue;
    return '#64737b';
  };

  M.ROUTES = ['IV', 'IM', 'PO', 'SC', 'NEB', 'INH', 'SL', 'PR', 'TOP', 'IN', 'IO'];
  M.STAFF_ROLES = ['Doctor', 'Nurse', 'Paramedic', 'Driver', 'Physiotherapist', 'Logistic', 'Other'];
  /* "Other" is free text — the role box asks for the specific title. */
  M.ROLE_NEEDS_DETAIL = 'Other';

  /* ---- factories --------------------------------------------------------- */

  /* Event lifecycle:
       active     — running; posts can register and treat
       concluded  — wrapped up; everything is read-only, but a super admin can
                    reopen it for REOPEN_WINDOW
       closed     — permanently over; local cache is cleared, the landing page
                    offers a new event. The Drive copy is the record. */
  M.REOPEN_WINDOW = 2 * 60 * 60 * 1000;

  M.newEvent = function (o) {
    var now = EV.now();
    return Object.assign({
      _t: 'event', id: EV.uid('ev'), name: '', venue: '', medicOn: '',
      startAt: now, endAt: now + 8 * 3600000,
      audience: undefined,
      pkg: 'intermediate', organiser: '', notes: '', mrnPrefix: 'EV',
      hospital: 'Siloam Hospitals',
      status: 'active', concludedAt: undefined, closedAt: undefined,
      concludedBy: '', driveHandoffAt: undefined,
      commandPostId: '', active: true
    }, o || {});
  };

  /* Old records stored separate dates; read either shape. */
  M.eventStart = function (ev) { return (ev && (ev.startAt || ev.startDate)) || undefined; };
  M.eventEnd = function (ev) { return (ev && (ev.endAt || ev.endDate)) || undefined; };
  M.eventStatus = function (ev, now) {
    if (!ev) return 'none';
    now = now || EV.now();
    if (ev.status === 'closed') return 'closed';
    if (ev.status === 'concluded') {
      return (ev.concludedAt && now > ev.concludedAt + M.REOPEN_WINDOW) ? 'closed' : 'concluded';
    }
    return 'active';
  };
  M.isLive = function (ev) { return M.eventStatus(ev) === 'active'; };
  M.reopenLeft = function (ev, now) {
    if (!ev || ev.status !== 'concluded' || !ev.concludedAt) return 0;
    return Math.max(0, ev.concludedAt + M.REOPEN_WINDOW - (now || EV.now()));
  };

  /* The code a team types to join a post. Four digits: long enough that it is
     not guessed in the three tries the join sheet allows, short enough to read
     out over a radio in a noisy tent. Issued by the Command Center, which is
     the only place posts can be created. */
  M.newJoinCode = function () {
    return String(1000 + Math.floor(Math.random() * 9000));
  };

  M.newPost = function (o) {
    return Object.assign({
      _t: 'post', id: EV.uid('po'), eventId: EV.settings.eventId,
      code: '', name: '', kind: 'medical-tent', location: '',
      staff: [], active: true, sort: 0, seq: 0,
      isCommandCenter: false, joinCode: M.newJoinCode()
    }, o || {});
  };

  M.newBed = function (o) {
    return Object.assign({
      _t: 'bed', id: EV.uid('bd'), postId: '', label: '',
      kind: 'acute', status: 'free', patientId: null, sort: 0,
      overflow: false
    }, o || {});
  };

  M.newAmbulance = function (o) {
    return Object.assign({
      _t: 'ambulance', id: EV.uid('am'), eventId: EV.settings.eventId,
      callsign: '', plate: '', crew: [], kind: 'bls',
      status: 'available', patientId: null, destination: '', active: true,
      joinCode: M.newJoinCode()
    }, o || {});
  };

  M.newPatient = function (o) {
    var t = EV.now();
    return Object.assign({
      _t: 'patient', id: EV.uid('pt'),
      eventId: EV.settings.eventId, postId: EV.settings.postId, bedId: null, mrn: '',
      name: '', age: undefined, ageUnit: 'y', sex: '', bib: '', nationality: '',
      lockedAt: undefined, lockedBy: '', dischargeInstructions: '',
      transfers: [],
      phone: '', contactName: '', contactPhone: '', weight: undefined,
      arrivalAt: t, arrivalMode: 'walk-in', fromLocation: '',
      acuity: 0, triageAt: undefined, triageBy: '',
      chiefComplaint: '', complaintCat: '',
      allergies: '', homeMeds: '', pmh: '',
      vitals: [], exam: '', assessment: '', icd10: '',
      orders: [], cppt: [],
      disposition: '', dispositionAt: undefined, dispositionBy: '', dispositionNote: '',
      destination: '', transportId: null, transport: null,
      status: 'active', closedAt: undefined, createdAt: t,
      pdfDriveId: '', pdfSyncedAt: 0
    }, o || {});
  };

  M.newVitals = function (o) {
    return Object.assign({
      t: EV.now(), hr: undefined, sbp: undefined, dbp: undefined, rr: undefined,
      spo2: undefined, temp: undefined, gcs: undefined, pain: undefined,
      bgl: undefined, weight: undefined, avpu: '', o2: '', by: ''
    }, o || {});
  };

  M.newOrder = function (o) {
    return Object.assign({
      id: EV.uid('or'), t: EV.now(), kind: 'med', itemId: '', name: '',
      dose: '', unit: '', route: '', rate: '', qty: 1, by: '', note: '',
      given: true, givenAt: EV.now()
    }, o || {});
  };

  M.newCppt = function (o) {
    return Object.assign({
      id: EV.uid('cp'), t: EV.now(), by: '', role: '', phase: 'post',
      s: '', o: '', a: '', p: '', locked: false
    }, o || {});
  };

  /* ---- MRN ---------------------------------------------------------------
     Human-sayable over a radio: EVENT-POST-SEQ. The sequence is per post so
     two posts can both be offline and never collide. */
  M.mrn = function (event, post, seq) {
    var pre = ((event && event.mrnPrefix) || 'EV').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5) || 'EV';
    var pc = ((post && post.code) || 'P0').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5) || 'P0';
    var n = String(seq == null ? 1 : seq);
    while (n.length < 4) n = '0' + n;
    return pre + '-' + pc + '-' + n;
  };
  /* Next sequence for a post, derived from what is already on this device —
     the post code keeps it unique across posts even while offline. */
  M.nextSeq = function (postId) {
    var pts = EV.store.all('patient', function (p) { return p.postId === postId; });
    var max = 0;
    for (var i = 0; i < pts.length; i++) {
      var m = /-(\d{1,6})$/.exec(pts[i].mrn || '');
      if (m && +m[1] > max) max = +m[1];
    }
    return max + 1;
  };

  /* ---- vitals helpers ---------------------------------------------------- */

  M.lastVitals = function (p) {
    var v = (p && p.vitals) || [];
    if (!v.length) return null;
    var best = v[0];
    for (var i = 1; i < v.length; i++) if (v[i].t > best.t) best = v[i];
    return best;
  };
  M.map = function (sbp, dbp) {
    var s = EV.num(sbp), d = EV.num(dbp);
    if (!EV.has(s) || !EV.has(d)) return undefined;
    return EV.r((s + 2 * d) / 3, 0);
  };
  M.shockIndex = function (hr, sbp) {
    var h = EV.num(hr), s = EV.num(sbp);
    if (!EV.has(h) || !EV.has(s) || s <= 0) return undefined;
    return EV.r(h / s, 2);
  };

  /* NEWS2. Only scores the parameters that were actually recorded, and
     reports how many were missing so the UI can say "4 of 7 recorded"
     instead of implying a complete assessment. */
  M.news2 = function (v, opts) {
    if (!v) return { score: undefined, n: 0, missing: 7, parts: [], band: '' };
    opts = opts || {};
    var parts = [], n = 0, total = 0, any3 = false;
    function add(label, val, pts) {
      if (pts == null) { parts.push({ l: label, v: '—', p: null }); return; }
      n++; total += pts; if (pts >= 3) any3 = true;
      parts.push({ l: label, v: val, p: pts });
    }
    var rr = EV.num(v.rr);
    add('Resp rate', rr, !EV.has(rr) ? null : rr <= 8 ? 3 : rr <= 11 ? 1 : rr <= 20 ? 0 : rr <= 24 ? 2 : 3);

    var sp = EV.num(v.spo2);
    /* Scale 1 (the default). Scale 2 is for chronic hypercapnic patients and
       is not something an event post should be guessing at. */
    add('SpO2', sp, !EV.has(sp) ? null : sp <= 91 ? 3 : sp <= 93 ? 2 : sp <= 95 ? 1 : 0);

    add('Supplemental O2', v.o2 ? 'Yes' : 'Air', v.o2 === undefined || v.o2 === null ? null : (v.o2 ? 2 : 0));

    var sbp = EV.num(v.sbp);
    add('Systolic BP', sbp, !EV.has(sbp) ? null : sbp <= 90 ? 3 : sbp <= 100 ? 2 : sbp <= 110 ? 1 : sbp <= 219 ? 0 : 3);

    var hr = EV.num(v.hr);
    add('Pulse', hr, !EV.has(hr) ? null : hr <= 40 ? 3 : hr <= 50 ? 1 : hr <= 90 ? 0 : hr <= 110 ? 1 : hr <= 130 ? 2 : 3);

    var gcs = EV.num(v.gcs);
    var alert = v.avpu ? v.avpu === 'A' : (EV.has(gcs) ? gcs >= 15 : undefined);
    add('Consciousness', alert === undefined ? '—' : (alert ? 'Alert' : 'Not alert'),
      alert === undefined ? null : (alert ? 0 : 3));

    var tp = EV.num(v.temp);
    add('Temperature', tp, !EV.has(tp) ? null : tp <= 35 ? 3 : tp <= 36 ? 1 : tp <= 38 ? 0 : tp <= 39 ? 1 : 2);

    if (!n) return { score: undefined, n: 0, missing: 7, parts: parts, band: '' };
    var band = total >= 7 ? 'high' : (total >= 5 || any3) ? 'medium' : total >= 1 ? 'low' : 'none';
    return {
      score: total, n: n, missing: 7 - n, parts: parts, any3: any3, band: band,
      partial: n < 7,
      label: band === 'high' ? 'High — emergency response'
        : band === 'medium' ? 'Medium — urgent review'
          : band === 'low' ? 'Low' : 'Normal'
    };
  };

  /* ---- derived ----------------------------------------------------------- */

  M.ageYears = function (p) {
    var a = EV.num(p && p.age);
    if (!EV.has(a)) return undefined;
    return p.ageUnit === 'mo' ? EV.r(a / 12, 2) : a;
  };

  M.derive = function (p, now) {
    now = now || EV.now();
    var v = M.lastVitals(p) || {};
    var ay = M.ageYears(p);
    var wt = EV.num(p.weight) || EV.num(v.weight);
    var n2 = M.news2(v);
    var open = p.status !== 'closed';
    var dwell = open ? now - (p.arrivalAt || now) : (p.closedAt || now) - (p.arrivalAt || now);
    var ac = M.acuity(p.acuity);

    var d = {
      ageYears: ay,
      isPaed: EV.has(ay) && ay < 14,
      isInfant: EV.has(ay) && ay < 1,
      weight: wt,
      lastVitals: v,
      map: M.map(v.sbp, v.dbp),
      shockIndex: M.shockIndex(v.hr, v.sbp),
      news2: n2,
      acuityLabel: ac.l,
      acuityClass: ac.c,
      dispoLabel: M.dispo(p.disposition).l,
      isOpen: open,
      dwellMs: dwell,
      los: EV.durShort(dwell),
      overTarget: open && ac.v >= 1 && ac.v <= 2 && dwell > 60 * 60000,
      triageDelay: EV.mins(p.arrivalAt, p.triageAt),
      doorToDispo: EV.mins(p.arrivalAt, p.dispositionAt),
      medsGiven: (p.orders || []).filter(function (o) { return o.kind === 'med' && o.given; }),
      vitalsAgeMs: v.t ? now - v.t : undefined,
      redFlags: []
    };

    /* Red flags — what the command post needs pushed at it, not buried. */
    var f = d.redFlags;
    var sp = EV.num(v.spo2), sbp = EV.num(v.sbp), hr = EV.num(v.hr), gcs = EV.num(v.gcs),
      temp = EV.num(v.temp), bgl = EV.num(v.bgl), rr = EV.num(v.rr);

    if (EV.has(sp) && sp < 92) f.push({ k: 'spo2', l: 'SpO₂ ' + sp + '%', sev: sp < 88 ? 2 : 1 });
    if (EV.has(sbp) && sbp < 90) f.push({ k: 'sbp', l: 'SBP ' + sbp, sev: 2 });
    if (EV.has(hr) && (hr < 40 || hr > 130)) f.push({ k: 'hr', l: 'HR ' + hr, sev: 2 });
    if (EV.has(rr) && (rr < 8 || rr > 24)) f.push({ k: 'rr', l: 'RR ' + rr, sev: rr < 8 || rr > 30 ? 2 : 1 });
    if (EV.has(gcs) && gcs < 15) f.push({ k: 'gcs', l: 'GCS ' + gcs, sev: gcs <= 12 ? 2 : 1 });
    if (EV.has(temp) && temp >= 40) f.push({ k: 'temp', l: 'Core ' + temp + '°C', sev: 2 });
    if (EV.has(temp) && temp <= 35) f.push({ k: 'temp', l: 'Hypothermic ' + temp + '°C', sev: 1 });
    if (EV.has(bgl) && bgl < 70) f.push({ k: 'bgl', l: 'BGL ' + bgl, sev: bgl < 54 ? 2 : 1 });
    if (n2.band === 'high') f.push({ k: 'news2', l: 'NEWS2 ' + n2.score, sev: 2 });
    else if (n2.band === 'medium') f.push({ k: 'news2', l: 'NEWS2 ' + n2.score, sev: 1 });

    if (open && ac.v && ac.v <= 2 && EV.has(d.vitalsAgeMs) && d.vitalsAgeMs > 15 * 60000) {
      f.push({ k: 'stale', l: 'No vitals for ' + EV.durShort(d.vitalsAgeMs), sev: 1 });
    }
    if (open && ac.v && ac.v <= 2 && !p.vitals.length) {
      f.push({ k: 'novitals', l: 'No vitals recorded', sev: 2 });
    }
    if (d.overTarget) f.push({ k: 'los', l: 'Open ' + d.los + ' at ' + ac.s, sev: 1 });
    if (!EV.has(wt) && d.medsGiven.length && d.isPaed) {
      f.push({ k: 'weight', l: 'Paediatric meds given with no weight', sev: 2 });
    }
    d.worstFlag = f.reduce(function (m, x) { return Math.max(m, x.sev); }, 0);
    return d;
  };

  /* ---- validation -------------------------------------------------------- */

  /* Deliberately permissive: a half-filled record saved at a run-past is far
     better than a blocked form. Only the things that break downstream are
     errors; everything else is a warning the chart shows but does not gate. */
  M.validate = function (p) {
    var errors = [], warn = [];
    if (!String(p.name || '').trim()) errors.push({ f: 'name', m: 'Name is required' });
    if (!p.arrivalAt) errors.push({ f: 'arrivalAt', m: 'Arrival time is required' });

    var a = EV.num(p.age);
    if (EV.has(a)) {
      if (p.ageUnit === 'y' && (a < 0 || a > 120)) errors.push({ f: 'age', m: 'Age 0–120 years' });
      if (p.ageUnit === 'mo' && (a < 0 || a > 36)) errors.push({ f: 'age', m: 'Use years above 36 months' });
    } else warn.push({ f: 'age', m: 'No age — paediatric dosing is unavailable' });

    var w = EV.num(p.weight);
    if (EV.has(w) && (w < 1 || w > 350)) errors.push({ f: 'weight', m: 'Weight 1–350 kg' });

    if (!p.acuity) warn.push({ f: 'acuity', m: 'Not triaged' });
    if (!String(p.chiefComplaint || '').trim()) warn.push({ f: 'chiefComplaint', m: 'No chief complaint' });
    if (!String(p.allergies || '').trim()) warn.push({ f: 'allergies', m: 'Allergies not asked' });

    for (var i = 0; i < (p.vitals || []).length; i++) {
      var v = p.vitals[i], pre = 'Vitals ' + EV.hhmm(v.t) + ': ';
      if (EV.has(EV.num(v.hr)) && (v.hr < 10 || v.hr > 300)) errors.push({ f: 'vitals', m: pre + 'HR out of range' });
      if (EV.has(EV.num(v.spo2)) && (v.spo2 < 10 || v.spo2 > 100)) errors.push({ f: 'vitals', m: pre + 'SpO₂ out of range' });
      if (EV.has(EV.num(v.temp)) && (v.temp < 25 || v.temp > 45)) errors.push({ f: 'vitals', m: pre + 'Temperature out of range' });
      if (EV.has(EV.num(v.sbp)) && EV.has(EV.num(v.dbp)) && +v.dbp > +v.sbp) errors.push({ f: 'vitals', m: pre + 'Diastolic above systolic' });
      if (EV.has(EV.num(v.gcs)) && (v.gcs < 3 || v.gcs > 15)) errors.push({ f: 'vitals', m: pre + 'GCS 3–15' });
    }

    if (p.disposition && !p.dispositionAt) warn.push({ f: 'dispositionAt', m: 'Disposition has no time' });
    if (p.disposition === 'transport' && !(p.transport && p.transport.ambulanceId)) {
      warn.push({ f: 'transport', m: 'Transported but no ambulance recorded' });
    }
    return { ok: !errors.length, errors: errors, warn: warn };
  };

  /* ---- bed / patient coupling -------------------------------------------
     Kept in one place so the dashboard, the chart and the settings screen
     can never disagree about who is in which bed. */

  M.assignBed = function (patient, bedId) {
    var jobs = [];
    var old = patient.bedId && EV.store.get('bed', patient.bedId);
    if (old && old.id !== bedId) {
      var o = EV.clone(old);
      o.patientId = null; o.status = 'cleaning';
      jobs.push(EV.store.put(o));
    }
    if (bedId) {
      var b = EV.store.get('bed', bedId);
      if (b) {
        /* Taking an occupied bed must release whoever was in it, or the
           board shows two patients in one bed forever. */
        if (b.patientId && b.patientId !== patient.id) {
          var prev = EV.store.get('patient', b.patientId);
          if (prev) {
            var pc = EV.clone(prev);
            pc.bedId = null;
            jobs.push(EV.store.put(pc));
          }
        }
        var nb = EV.clone(b);
        nb.patientId = patient.id; nb.status = 'occupied';
        jobs.push(EV.store.put(nb));
      }
    }
    patient.bedId = bedId || null;
    jobs.push(EV.store.put(patient));
    return Promise.all(jobs);
  };

  M.releaseBed = function (patient, status) {
    if (!patient.bedId) return EV.store.put(patient);
    var b = EV.store.get('bed', patient.bedId);
    var jobs = [];
    if (b) {
      var nb = EV.clone(b);
      nb.patientId = null;
      nb.status = status || 'cleaning';
      jobs.push(EV.store.put(nb));
    }
    patient.bedId = null;
    jobs.push(EV.store.put(patient));
    return Promise.all(jobs);
  };

  M.close = function (patient, disposition, by, note) {
    var d = M.dispo(disposition);
    patient.disposition = disposition;
    patient.dispositionAt = patient.dispositionAt || EV.now();
    patient.dispositionBy = by || patient.dispositionBy;
    if (note) patient.dispositionNote = note;
    if (d.closes) {
      patient.status = 'closed';
      patient.closedAt = EV.now();
      return M.releaseBed(patient, 'cleaning');
    }
    patient.status = 'active';
    return EV.store.put(patient);
  };

  M.reopen = function (patient) {
    patient.status = 'active';
    patient.closedAt = undefined;
    return EV.store.put(patient);
  };

  /* ---- lookups used everywhere ------------------------------------------- */
  M.event = function () { return EV.store.get('event', EV.settings.eventId); };
  M.post = function (id) { return EV.store.get('post', id || EV.settings.postId); };
  M.posts = function () {
    return EV.sortBy(EV.store.all('post', function (p) {
      return p.eventId === EV.settings.eventId;
    }), function (p) { return (p.sort || 0) * 1000 + String(p.code); });
  };
  M.beds = function (postId) {
    return EV.sortBy(EV.store.all('bed', function (b) {
      return !postId || b.postId === postId;
    }), 'sort');
  };
  M.ambulances = function () {
    return EV.sortBy(EV.store.all('ambulance', function (a) {
      return a.eventId === EV.settings.eventId;
    }), 'callsign');
  };
  M.patients = function (filter) {
    var all = EV.store.all('patient', function (p) { return p.eventId === EV.settings.eventId; });
    if (filter) all = all.filter(filter);
    return EV.sortBy(all, 'arrivalAt', 'desc');
  };
  M.openPatients = function (postId) {
    return M.patients(function (p) {
      return p.status !== 'closed' && (!postId || p.postId === postId);
    });
  };

  /* ====================================================================== */
  /* Device binding                                                          */
  /*                                                                         */
  /* A device is tied to one post for the life of the event. That is a       */
  /* clinical safety property, not a convenience: every MRN, every bed and   */
  /* every note is attributed to the post that made it, and a tablet that    */
  /* could be re-pointed mid-shift would silently misfile records. Once      */
  /* bound, the only way out is the super-admin passcode.                    */
  /* ====================================================================== */

  M.binding = function () {
    var b = EV.settings.bind;
    if (!b || !b.eventId || !b.postId) return null;
    return b;
  };
  M.isBound = function () {
    var b = M.binding();
    return !!(b && b.eventId === EV.settings.eventId);
  };
  M.boundPostId = function () {
    var b = M.binding();
    return b ? b.postId : '';
  };
  M.boundPost = function () { return EV.store.get('post', M.boundPostId()); };
  M.team = function () {
    var b = M.binding();
    return (b && b.team) || [];
  };

  M.bind = function (eventId, postId, team) {
    EV.settings.bind = {
      eventId: eventId, postId: postId,
      team: (team || []).slice(),
      boundAt: EV.now(), deviceId: EV.deviceId()
    };
    EV.settings.eventId = eventId;
    EV.settings.postId = postId;
    EV.save();
    return EV.settings.bind;
  };
  /* Only ever called behind the super-admin passcode. */
  M.unbind = function () {
    EV.settings.bind = null;
    EV.settings.postId = '';
    EV.save();
  };

  /* ---- super admin ------------------------------------------------------
     Unrestricted access belongs to a person standing at the post that has
     been designated the Command Center — not to anyone who knows a code on
     any tablet. Both conditions must hold. */
  var superUntil = 0;
  M.SUPER_WINDOW = 30 * 60000;

  M.commandPost = function () {
    var posts = M.posts();
    for (var i = 0; i < posts.length; i++) if (posts[i].isCommandCenter) return posts[i];
    var ev = M.event();
    return (ev && ev.commandPostId) ? EV.store.get('post', ev.commandPostId) : undefined;
  };
  M.atCommandCenter = function () {
    var cp = M.commandPost();
    return !!(cp && cp.id === M.boundPostId());
  };
  M.isSuperAdmin = function () {
    return M.atCommandCenter() && Date.now() < superUntil;
  };
  M.grantSuper = function () { superUntil = Date.now() + M.SUPER_WINDOW; };
  M.revokeSuper = function () { superUntil = 0; };
  M.superLeft = function () { return Math.max(0, superUntil - Date.now()); };

  /* ---- what this device may do ------------------------------------------
     Everyone can SEE the whole event — the point of the board is knowing how
     the other posts are coping. Editing is confined to your own post unless
     you are the super admin at the Command Center. */
  M.canEditPatient = function (p) {
    if (!p) return false;
    if (M.isSuperAdmin()) return true;
    if (!M.isLive(M.event())) return false;
    return p.postId === M.boundPostId();
  };
  M.canCreatePatient = function (postId) {
    if (!M.isLive(M.event())) return false;
    if (M.isSuperAdmin()) return true;
    return !postId || postId === M.boundPostId();
  };
  M.canConfigure = function () { return M.isSuperAdmin(); };
  /* Why a given record is read-only, in words a user can act on. */
  M.readOnlyReason = function (p) {
    var ev = M.event();
    if (!M.isLive(ev)) {
      return M.eventStatus(ev) === 'closed'
        ? 'This event is closed.'
        : 'This event has been concluded. A super admin can reopen it.';
    }
    if (p && p.postId !== M.boundPostId() && !M.isSuperAdmin()) {
      var po = EV.store.get('post', p.postId);
      return 'This patient belongs to ' + ((po && (po.code || po.name)) || 'another post') +
        '. You can read the record but only their team can edit it.';
    }
    return '';
  };

  /* ====================================================================== */
  /* Beds: occupancy, overflow, transfer                                     */
  /* ====================================================================== */

  M.bedState = function (postId) {
    var beds = M.beds(postId);
    var total = 0, free = 0, occupied = 0, offline = 0, cleaning = 0;
    for (var i = 0; i < beds.length; i++) {
      var b = beds[i];
      if (b.overflow) continue;              /* spill-over is not capacity */
      total++;
      if (b.status === 'offline') offline++;
      else if (b.status === 'occupied') occupied++;
      else if (b.status === 'cleaning') cleaning++;
      else free++;
    }
    return {
      total: total, free: free, occupied: occupied, offline: offline, cleaning: cleaning,
      usable: total - offline,
      full: (total - offline) > 0 && free === 0,
      none: total === 0
    };
  };

  M.freeBeds = function (postId) {
    return M.beds(postId).filter(function (b) {
      return !b.overflow && b.status === 'free' && !b.patientId;
    });
  };

  /* A patient a full post agreed to take waits in a wheelchair outside it.
     The bed is real — it holds a patient, takes orders and appears on the
     board — it just does not count as capacity. */
  M.nextOverflowBed = function (postId) {
    var beds = M.beds(postId);
    var used = {}, n = 0, i;
    for (i = 0; i < beds.length; i++) {
      if (!beds[i].overflow) continue;
      used[beds[i].label] = beds[i];
      var m = /(\d+)$/.exec(beds[i].label);
      if (m && +m[1] > n) n = +m[1];
      if (!beds[i].patientId && beds[i].status !== 'offline') return beds[i];
    }
    return M.newBed({
      postId: postId, label: 'Wheelchair ' + (n + 1), kind: 'wheelchair',
      overflow: true, sort: 900 + n
    });
  };

  /* Move a patient to another post. Closes the record at the origin and
     reopens it at the destination, keeping one continuous chart and an
     explicit trail of who sent whom where and why. */
  M.transferToPost = function (patient, toPostId, opts) {
    opts = opts || {};
    var from = patient.postId;
    var fromPost = EV.store.get('post', from);
    var toPost = EV.store.get('post', toPostId);
    var c = EV.clone(patient);
    var now = EV.now();

    c.transfers = (c.transfers || []).concat([{
      at: now, fromPostId: from, toPostId: toPostId,
      fromLabel: (fromPost && (fromPost.code || fromPost.name)) || '',
      toLabel: (toPost && (toPost.code || toPost.name)) || '',
      reason: opts.reason || '', by: opts.by || EV.settings.deviceLabel || '',
      overflow: !!opts.overflow
    }]);

    /* The note the receiving team reads first. */
    c.cppt = (c.cppt || []).concat([M.newCppt({
      t: now, by: opts.by || EV.settings.deviceLabel || '', role: 'Transfer',
      phase: 'handover',
      s: 'Transferred from ' + ((fromPost && (fromPost.code || fromPost.name)) || 'another post') +
         ' to ' + ((toPost && (toPost.code || toPost.name)) || 'this post') + '.',
      o: opts.reason || '',
      a: c.assessment || '',
      p: opts.overflow
        ? 'Accepted into wheelchair overflow — no bed free at the destination.'
        : 'Continue care at the receiving post.',
      locked: true
    })]);

    var jobs = [];
    /* Release the origin bed before the record moves. */
    if (c.bedId) {
      var ob = EV.store.get('bed', c.bedId);
      if (ob) {
        var obc = EV.clone(ob);
        obc.patientId = null;
        obc.status = 'cleaning';
        jobs.push(EV.store.put(obc));
      }
    }

    c.postId = toPostId;
    c.bedId = null;
    c.status = 'active';
    c.closedAt = undefined;
    c.disposition = '';
    c.dispositionAt = undefined;
    c.lockedAt = undefined;

    if (opts.bedId) {
      jobs.push(M.assignBed(c, opts.bedId));
    } else if (opts.overflow) {
      var wb = M.nextOverflowBed(toPostId);
      jobs.push(EV.store.put(wb).then(function () { return M.assignBed(c, wb.id); }));
    } else {
      jobs.push(EV.store.put(c));
    }
    return Promise.all(jobs).then(function () { return c; });
  };

  /* Discharge locks the record. It stays editable — an addendum after the
     fact is normal and better than a second, contradictory record — but the
     lock is what tells the next reader this encounter was closed on purpose. */
  M.discharge = function (patient, opts) {
    opts = opts || {};
    var c = EV.clone(patient);
    var now = EV.now();
    c.disposition = opts.disposition || 'discharged';
    c.dispositionAt = now;
    c.dispositionBy = opts.by || EV.settings.deviceLabel || '';
    c.dispositionNote = opts.note || c.dispositionNote || '';
    c.dischargeInstructions = opts.instructions || '';
    if (opts.destination) c.destination = opts.destination;
    c.status = 'closed';
    c.closedAt = now;
    c.lockedAt = now;
    c.lockedBy = c.dispositionBy;
    return M.releaseBed(c, 'cleaning');
  };

  /* ====================================================================== */
  /* Chat                                                                    */
  /* ====================================================================== */

  M.newChat = function (o) {
    return Object.assign({
      _t: 'chat', id: EV.uid('ch'), eventId: EV.settings.eventId,
      fromKind: 'post', fromId: '', fromLabel: '',
      toKind: 'post', toId: '', toLabel: '',
      text: '', at: EV.now(), by: '', urgent: false
    }, o || {});
  };

  /* A conversation is identified by the unordered pair of endpoints, so both
     sides land in the same thread however they address each other. */
  M.chatKey = function (aKind, aId, bKind, bId) {
    var a = aKind + ':' + aId, b = bKind + ':' + bId;
    return a < b ? a + '|' + b : b + '|' + a;
  };
  M.myChatEndpoint = function () {
    var post = M.boundPost();
    return { kind: 'post', id: M.boundPostId(), label: (post && (post.code || post.name)) || 'This post' };
  };
  M.chatThread = function (otherKind, otherId) {
    var me = M.myChatEndpoint();
    var key = M.chatKey(me.kind, me.id, otherKind, otherId);
    var all = EV.store.all('chat', function (m) {
      return m.eventId === EV.settings.eventId &&
        M.chatKey(m.fromKind, m.fromId, m.toKind, m.toId) === key;
    });
    return EV.sortBy(all, 'at');
  };
  M.chatThreads = function () {
    var me = M.myChatEndpoint();
    if (!me.id) return [];
    var all = EV.store.all('chat', function (m) { return m.eventId === EV.settings.eventId; });
    var byKey = Object.create(null);
    for (var i = 0; i < all.length; i++) {
      var m = all[i];
      var mine = (m.fromKind === me.kind && m.fromId === me.id) ||
        (m.toKind === me.kind && m.toId === me.id);
      if (!mine) continue;
      var other = (m.fromKind === me.kind && m.fromId === me.id)
        ? { kind: m.toKind, id: m.toId, label: m.toLabel }
        : { kind: m.fromKind, id: m.fromId, label: m.fromLabel };
      var k = other.kind + ':' + other.id;
      var t = byKey[k] || (byKey[k] = {
        key: k, kind: other.kind, id: other.id, label: other.label,
        messages: [], last: 0, unread: 0
      });
      t.messages.push(m);
      if (m.at > t.last) { t.last = m.at; t.label = other.label || t.label; }
      if (m.fromId !== me.id && m.at > (M.chatSeen(k) || 0)) t.unread++;
    }
    var out = [];
    for (var kk in byKey) {
      byKey[kk].messages = EV.sortBy(byKey[kk].messages, 'at');
      out.push(byKey[kk]);
    }
    return EV.sortBy(out, 'last', 'desc');
  };
  /* Read marks are per device, so they never sync and never collide. */
  M.chatSeen = function (key) {
    var m = EV.settings.chatSeen || {};
    return m[key] || 0;
  };
  M.markChatSeen = function (key, at) {
    EV.settings.chatSeen = EV.settings.chatSeen || {};
    EV.settings.chatSeen[key] = at || EV.now();
    EV.save();
  };
  M.unreadChats = function () {
    var t = M.chatThreads(), n = 0;
    for (var i = 0; i < t.length; i++) n += t[i].unread;
    return n;
  };
  M.sendChat = function (otherKind, otherId, otherLabel, text, urgent) {
    var me = M.myChatEndpoint();
    if (!me.id) return Promise.reject(new Error('This device is not bound to a post'));
    if (!String(text || '').trim()) return Promise.resolve(null);
    return EV.store.put(M.newChat({
      fromKind: me.kind, fromId: me.id, fromLabel: me.label,
      toKind: otherKind, toId: otherId, toLabel: otherLabel,
      text: String(text).trim(), by: EV.settings.deviceLabel || '', urgent: !!urgent
    }));
  };

  /* ---- conclusion -------------------------------------------------------
     Offered only when the event's scheduled end has passed AND every bed is
     empty: concluding with a patient still on a bed would strand a live
     record. */
  M.canConclude = function (now) {
    var ev = M.event();
    if (!ev || M.eventStatus(ev) !== 'active') return { ok: false, why: '' };
    if (!M.isSuperAdmin()) return { ok: false, why: '' };
    now = now || EV.now();
    var end = M.eventEnd(ev);
    if (end && now < end) {
      return { ok: false, why: 'Scheduled to run until ' + EV.dmyhm(end) + '.' };
    }
    var open = M.openPatients().length;
    if (open) {
      return { ok: false, why: open + ' patient' + (open === 1 ? ' is' : 's are') + ' still open.' };
    }
    var occ = EV.store.all('bed', function (b) { return b.status === 'occupied' && b.patientId; });
    if (occ.length) return { ok: false, why: occ.length + ' bed(s) still occupied.' };
    return { ok: true, why: '' };
  };

  M.concludeEvent = function (by) {
    var ev = EV.clone(M.event());
    ev.status = 'concluded';
    ev.concludedAt = EV.now();
    ev.concludedBy = by || EV.settings.deviceLabel || '';
    return EV.store.put(ev);
  };
  M.reopenEvent = function () {
    var ev = EV.clone(M.event());
    ev.status = 'active';
    ev.concludedAt = undefined;
    ev.concludedBy = '';
    return EV.store.put(ev);
  };
  M.closeEvent = function () {
    var ev = EV.clone(M.event());
    ev.status = 'closed';
    ev.closedAt = EV.now();
    return EV.store.put(ev);
  };

  /* Every event this device knows about, for the landing page. */
  M.allEvents = function () {
    return EV.sortBy(EV.store.all('event'), function (e) {
      return -(M.eventStart(e) || 0);
    });
  };
  M.activeEvents = function () {
    return M.allEvents().filter(function (e) { return M.eventStatus(e) !== 'closed'; });
  };

  /* ---- self test --------------------------------------------------------- */
  M.selfTest = function () {
    var fails = [], n = 0;
    function eq(name, got, want) {
      n++;
      var g = JSON.stringify(got), w = JSON.stringify(want);
      if (g !== w) fails.push({ name: name, expected: w, got: g });
    }

    eq('map 120/80', M.map(120, 80), 93);
    eq('map blank dbp', M.map(120, ''), undefined);
    eq('shockIndex 100/80', M.shockIndex(100, 80), 1.25);
    eq('shockIndex sbp 0', M.shockIndex(100, 0), undefined);

    /* The one that matters: an empty vitals set must not read as "normal". */
    var empty = M.news2({});
    eq('news2 empty score', empty.score, undefined);
    eq('news2 empty missing', empty.missing, 7);

    var well = M.news2({ rr: 16, spo2: 98, o2: false, sbp: 120, hr: 70, avpu: 'A', temp: 36.8 });
    eq('news2 well', well.score, 0);
    eq('news2 well complete', well.partial, false);

    var sick = M.news2({ rr: 26, spo2: 90, o2: true, sbp: 88, hr: 125, avpu: 'V', temp: 39.5 });
    /* 3 + 3 + 2 + 3 + 2 + 3 + 2 = 18 (temp 39.5 is the >=39.1 band, worth 2) */
    eq('news2 sick', sick.score, 18);
    eq('news2 sick band', sick.band, 'high');

    var one3 = M.news2({ rr: 16, spo2: 98, o2: false, sbp: 85, hr: 70, avpu: 'A', temp: 36.8 });
    eq('news2 single 3 is medium', one3.band, 'medium');

    var partial = M.news2({ hr: 70, spo2: 98 });
    eq('news2 partial counted', partial.n, 2);
    eq('news2 partial flagged', partial.partial, true);

    eq('cat sprained ankle', M.catFor('twisted ankle on the kerb'), 'msk');
    eq('cat heat', M.catFor('heat exhaustion at km 32'), 'heat');
    eq('cat indonesian', M.catFor('pingsan di garis finish'), 'neuro');
    eq('cat chest pain beats collapse', M.catFor('chest pain'), 'cardiac');
    eq('cat unknown', M.catFor('zzzz'), 'other');
    eq('cat blank', M.catFor(''), 'other');

    eq('acuity has three levels', M.ACUITY.length, 3);
    eq('T1 is red', M.acuity(1).colour, 'Red');
    eq('T2 is orange', M.acuity(2).colour, 'Orange');
    eq('T3 is green', M.acuity(3).colour, 'Green');
    eq('legacy P4 folds into T3', M.acuity(4).v, 3);
    eq('legacy P5 folds into T3', M.acuity(5).v, 3);
    eq('untriaged stays 0', M.acuity(0).v, 0);
    eq('blank acuity stays 0', M.acuity(undefined).v, 0);

    eq('legacy disposition still reads', M.dispo('return-to-event').l, 'Discharged');
    eq('discharge closes', M.dispo('discharged').closes, true);
    eq('picker hides legacy values', M.DISPOSITION_CHOICES.length, 3);

    eq('roles are the five asked for plus paramedic and logistic',
      M.STAFF_ROLES.join(','), 'Doctor,Nurse,Paramedic,Driver,Physiotherapist,Logistic,Other');

    eq('chat key is order independent',
      M.chatKey('post', 'a', 'ambulance', 'b'), M.chatKey('ambulance', 'b', 'post', 'a'));

    eq('mrn pads', M.mrn({ mrnPrefix: 'JRF' }, { code: 'P03' }, 7), 'JRF-P03-0007');
    eq('mrn sanitises', M.mrn({ mrnPrefix: 'j r/f' }, { code: 'p-3' }, 12), 'JRF-P3-0012');

    eq('ageYears months', M.ageYears({ age: 18, ageUnit: 'mo' }), 1.5);
    eq('ageYears blank', M.ageYears({ age: '', ageUnit: 'y' }), undefined);

    eq('quantile median', EV.quantile([1, 2, 3, 4], 0.5), 2.5);
    eq('quantile p90 interpolates', EV.quantile([0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100], 0.9), 90);
    eq('quantile single', EV.quantile([5], 0.9), 5);
    eq('quantile empty', EV.quantile([], 0.5), undefined);

    var p = M.newPatient({ name: 'Test', acuity: 1, vitals: [M.newVitals({ spo2: 85, sbp: 80 })] });
    var d = M.derive(p);
    eq('derive flags hypoxia+shock', d.redFlags.filter(function (x) {
      return x.k === 'spo2' || x.k === 'sbp';
    }).length, 2);
    eq('derive worst flag', d.worstFlag, 2);

    var blank = M.derive(M.newPatient({ name: 'X' }));
    eq('derive on blank patient is safe', blank.redFlags.length >= 0 && blank.news2.score === undefined, true);

    var v = M.validate(M.newPatient({ name: '' }));
    eq('validate needs a name', v.errors.length >= 1, true);
    var v2 = M.validate(M.newPatient({ name: 'A', vitals: [M.newVitals({ sbp: 80, dbp: 120 })] }));
    eq('validate catches dbp>sbp', v2.errors.some(function (e) { return /Diastolic/.test(e.m); }), true);

    return { pass: n - fails.length, fail: fails.length, total: n, failures: fails };
  };

})(window.EV = window.EV || {});
