/* ==========================================================================
   09-analytics.js — EV.analytics

   Two halves that never mix: compute() is pure arithmetic over the record
   arrays and knows nothing about the DOM; the chart functions return SVG
   strings and know nothing about patients. The Excel recap and the analytics
   screen both call compute(), so the spreadsheet and the dashboard cannot
   disagree.

   Every division is guarded and an empty event returns a valid zero-filled
   shape — a medical director opening this before the first patient arrives
   must see zeros, not a stack trace.
   ========================================================================== */
(function (EV) {
  'use strict';

  var A = EV.analytics = {};
  var HOUR = 3600000;

  function num(v) { return EV.has(v) && isFinite(v) ? +v : undefined; }
  function pct(n, d, places) {
    if (!d) return 0;
    return EV.r((n / d) * 100, places == null ? 1 : places);
  }
  function med(arr) { return EV.quantile(arr, 0.5); }

  /* ====================================================================== */
  /* compute                                                                 */
  /* ====================================================================== */

  A.compute = function (ctx) {
    ctx = ctx || {};
    var now = ctx.now || EV.now();
    var patients = ctx.patients || [];
    var posts = ctx.posts || [];
    var beds = ctx.beds || [];
    var ambulances = ctx.ambulances || [];
    var formulary = ctx.formulary || [];

    var out = {
      generatedAt: now,
      totals: {
        patients: patients.length, open: 0, closed: 0, transported: 0,
        discharged: 0, returnedToEvent: 0, refused: 0, died: 0, observation: 0,
        notTriaged: 0, withVitals: 0, medsGiven: 0
      },
      rate: { perHour: [], peakHour: 0, sinceOpen: 0, perHourAvg: 0 },
      acuity: [], byPost: [], complaints: [], meds: [], supplies: [],
      disposition: [], los: { median: undefined, p90: undefined, max: undefined, byAcuity: [] },
      timeliness: {
        medianTriageDelay: undefined, medianDoorToDoctor: undefined,
        medianDoorToTransport: undefined
      },
      beds: { total: beds.length, occupied: 0, free: 0, cleaning: 0, offline: 0, occupancyPct: 0, byPost: [] },
      transport: [], redFlags: [],
      capacity: { projectedTotal: undefined, vsExpected: undefined, surgeIndex: 0 }
    };

    /* ---- totals & dispositions ---- */
    var dispCount = Object.create(null);
    var i, j, p;
    for (i = 0; i < patients.length; i++) {
      p = patients[i];
      if (p.status === 'closed') out.totals.closed++; else out.totals.open++;
      if (!p.acuity) out.totals.notTriaged++;
      if ((p.vitals || []).length) out.totals.withVitals++;
      var d = p.disposition || '';
      dispCount[d] = (dispCount[d] || 0) + 1;
    }
    out.totals.transported = (dispCount['transport'] || 0) + (dispCount['refer-hospital'] || 0);
    out.totals.returnedToEvent = dispCount['return-to-event'] || 0;
    out.totals.discharged = dispCount['discharge-home'] || 0;
    out.totals.refused = dispCount['refused'] || 0;
    out.totals.died = dispCount['dead-on-scene'] || 0;
    out.totals.observation = dispCount['observation'] || 0;

    for (i = 0; i < EV.model.DISPOSITION.length; i++) {
      var dd = EV.model.DISPOSITION[i];
      var n = dispCount[dd.v] || 0;
      out.disposition.push({ k: dd.v, l: dd.l, n: n, pct: pct(n, patients.length, 0) });
    }
    if (dispCount['']) {
      out.disposition.push({
        k: '', l: 'Still open', n: dispCount[''], pct: pct(dispCount[''], patients.length, 0)
      });
    }

    /* ---- arrivals per hour ---- */
    if (patients.length) {
      var first = now, last = 0;
      for (i = 0; i < patients.length; i++) {
        var at = patients[i].arrivalAt || now;
        if (at < first) first = at;
        if (at > last) last = at;
      }
      var start = Math.floor(first / HOUR) * HOUR;
      var end = Math.floor(Math.max(last, now) / HOUR) * HOUR;
      /* Cap the window so a three-day event does not return 72 buckets. */
      if ((end - start) / HOUR > 47) start = end - 47 * HOUR;

      var buckets = Object.create(null);
      for (i = 0; i < patients.length; i++) {
        var b = Math.floor((patients[i].arrivalAt || now) / HOUR) * HOUR;
        if (b < start) b = start;
        buckets[b] = (buckets[b] || 0) + 1;
      }
      for (var t = start; t <= end; t += HOUR) {
        var c = buckets[t] || 0;
        out.rate.perHour.push({ t: t, n: c });
        if (c > out.rate.peakHour) out.rate.peakHour = c;
      }
      out.rate.sinceOpen = Math.max(0, now - first);
      var hours = Math.max(1, out.rate.sinceOpen / HOUR);
      out.rate.perHourAvg = EV.r(patients.length / hours, 1);

      /* Projection assumes the rate so far holds to the end of the event —
         stated plainly because a medical director will act on it. */
      var ev = ctx.event;
      if (ev && ev.endDate && ev.endDate > now) {
        var remainingH = (ev.endDate - now) / HOUR;
        out.capacity.projectedTotal = Math.round(patients.length + out.rate.perHourAvg * remainingH);
      }
      if (ev && EV.has(num(ev.audience)) && num(ev.audience) > 0) {
        /* Presentation rate per 1000 attendees — the number event medicine
           plans against. */
        out.capacity.vsExpected = EV.r((patients.length / num(ev.audience)) * 1000, 2);
      }
      out.capacity.surgeIndex = out.rate.perHourAvg
        ? EV.r(out.rate.peakHour / out.rate.perHourAvg, 2) : 0;
    }

    /* ---- acuity ---- */
    for (i = 0; i < EV.model.ACUITY.length; i++) {
      var a = EV.model.ACUITY[i];
      var cnt = 0;
      for (j = 0; j < patients.length; j++) if (patients[j].acuity === a.v) cnt++;
      out.acuity.push({ v: a.v, l: a.l, s: a.s, n: cnt, pct: pct(cnt, patients.length, 0) });
    }
    if (out.totals.notTriaged) {
      out.acuity.push({
        v: 0, l: 'Not triaged', s: '—', n: out.totals.notTriaged,
        pct: pct(out.totals.notTriaged, patients.length, 0)
      });
    }

    /* ---- length of stay ---- */
    var losAll = [], losBy = Object.create(null);
    for (i = 0; i < patients.length; i++) {
      p = patients[i];
      if (!p.arrivalAt) continue;
      var endT = p.status === 'closed' ? (p.closedAt || p.dispositionAt) : now;
      if (!endT || endT < p.arrivalAt) continue;
      var ms = endT - p.arrivalAt;
      losAll.push(ms);
      var key = p.acuity || 0;
      (losBy[key] = losBy[key] || []).push(ms);
    }
    out.los.median = med(losAll);
    out.los.p90 = EV.quantile(losAll, 0.9);
    out.los.max = losAll.length ? Math.max.apply(null, losAll) : undefined;
    for (var k in losBy) {
      out.los.byAcuity.push({
        v: +k, l: EV.model.acuity(+k).l, n: losBy[k].length,
        median: med(losBy[k]), p90: EV.quantile(losBy[k], 0.9)
      });
    }
    out.los.byAcuity.sort(function (x, y) { return x.v - y.v; });

    /* ---- timeliness ---- */
    var triageD = [], doorDoc = [], doorTx = [];
    for (i = 0; i < patients.length; i++) {
      p = patients[i];
      if (p.triageAt && p.arrivalAt && p.triageAt >= p.arrivalAt) triageD.push(p.triageAt - p.arrivalAt);
      /* "Door to doctor" is the first clinical act we can actually see: the
         first vitals set, order or note. */
      var firstAct = firstClinicalAt(p);
      if (EV.has(firstAct) && p.arrivalAt && firstAct >= p.arrivalAt) doorDoc.push(firstAct - p.arrivalAt);
      if (p.transport && p.transport.departAt && p.arrivalAt && p.transport.departAt >= p.arrivalAt) {
        doorTx.push(p.transport.departAt - p.arrivalAt);
      }
    }
    out.timeliness.medianTriageDelay = med(triageD);
    out.timeliness.medianDoorToDoctor = med(doorDoc);
    out.timeliness.medianDoorToTransport = med(doorTx);

    /* ---- by post ---- */
    for (i = 0; i < posts.length; i++) {
      var post = posts[i];
      var mine = [];
      for (j = 0; j < patients.length; j++) if (patients[j].postId === post.id) mine.push(patients[j]);
      var openN = 0, txN = 0, myLos = [], mix = Object.create(null);
      for (j = 0; j < mine.length; j++) {
        var mp = mine[j];
        if (mp.status !== 'closed') openN++;
        if (mp.disposition === 'transport' || mp.disposition === 'refer-hospital') txN++;
        var av = mp.acuity || 0;
        mix[av] = (mix[av] || 0) + 1;
        var e2 = mp.status === 'closed' ? (mp.closedAt || mp.dispositionAt) : now;
        if (mp.arrivalAt && e2 && e2 >= mp.arrivalAt) myLos.push(e2 - mp.arrivalAt);
      }
      var mixArr = [];
      for (var mk in mix) mixArr.push({ v: +mk, n: mix[mk] });
      mixArr.sort(function (x, y) { return x.v - y.v; });
      out.byPost.push({
        postId: post.id, code: post.code, name: post.name, kind: post.kind,
        n: mine.length, open: openN, acuityMix: mixArr,
        medianLos: med(myLos), transferRate: mine.length ? pct(txN, mine.length, 0) : undefined
      });
    }
    out.byPost.sort(function (x, y) { return y.n - x.n; });

    /* ---- complaints ---- */
    var ccCount = Object.create(null);
    for (i = 0; i < patients.length; i++) {
      var cat = patients[i].complaintCat || EV.model.catFor(patients[i].chiefComplaint) || 'other';
      ccCount[cat] = (ccCount[cat] || 0) + 1;
    }
    for (i = 0; i < EV.model.COMPLAINT_CATS.length; i++) {
      var cc = EV.model.COMPLAINT_CATS[i];
      var ccn = ccCount[cc.v] || 0;
      if (!ccn) continue;
      out.complaints.push({ cat: cc.v, l: cc.l, n: ccn, pct: pct(ccn, patients.length, 0) });
    }
    out.complaints.sort(function (x, y) { return y.n - x.n; });

    /* ---- orders: medications and supplies ---- */
    var medMap = Object.create(null), supMap = Object.create(null);
    for (i = 0; i < patients.length; i++) {
      p = patients[i];
      var orders = p.orders || [];
      var seenHere = Object.create(null);
      for (j = 0; j < orders.length; j++) {
        var o = orders[j];
        if (o.given === false) continue;
        var id = o.itemId || ('free:' + EV.norm(o.name));
        if (o.kind === 'supply') {
          var s = supMap[id] || (supMap[id] = { itemId: o.itemId || '', name: o.name, qty: 0 });
          s.qty += num(o.qty) || 1;
        } else {
          var m = medMap[id] || (medMap[id] = {
            itemId: o.itemId || '', name: o.name, n: 0, totalDose: 0,
            unit: o.unit || '', patients: 0, mixedUnits: false
          });
          m.n++;
          out.totals.medsGiven++;
          var dose = num(o.dose);
          if (EV.has(dose)) {
            /* Only sum a total when every administration used the same unit —
               adding mg to mL would be worse than reporting nothing. */
            if (!m.unit) m.unit = o.unit || '';
            if (o.unit && m.unit && o.unit !== m.unit) m.mixedUnits = true;
            m.totalDose += dose;
          }
          if (!seenHere[id]) { m.patients++; seenHere[id] = 1; }
        }
      }
    }
    for (var mi in medMap) {
      var mm = medMap[mi];
      if (mm.mixedUnits) { mm.totalDose = undefined; mm.unit = 'mixed'; }
      out.meds.push(mm);
    }
    out.meds.sort(function (x, y) { return y.n - x.n; });

    var byFormId = Object.create(null);
    for (i = 0; i < formulary.length; i++) byFormId[formulary[i].id] = formulary[i];
    for (var si in supMap) {
      var sp = supMap[si];
      var fitem = sp.itemId ? byFormId[sp.itemId] : null;
      sp.par = fitem && EV.has(num(fitem.par)) ? num(fitem.par) : undefined;
      sp.pctOfPar = EV.has(sp.par) && sp.par > 0 ? pct(sp.qty, sp.par, 0) : undefined;
      out.supplies.push(sp);
    }
    out.supplies.sort(function (x, y) {
      var xa = EV.has(x.pctOfPar) ? x.pctOfPar : -1;
      var ya = EV.has(y.pctOfPar) ? y.pctOfPar : -1;
      return ya - xa || y.qty - x.qty;
    });

    /* ---- beds ---- */
    var bedByPost = Object.create(null);
    for (i = 0; i < beds.length; i++) {
      var bd = beds[i];
      if (bd.status === 'occupied') out.beds.occupied++;
      else if (bd.status === 'free') out.beds.free++;
      else if (bd.status === 'cleaning') out.beds.cleaning++;
      else if (bd.status === 'offline') out.beds.offline++;
      var bp = bedByPost[bd.postId] || (bedByPost[bd.postId] = { postId: bd.postId, total: 0, occupied: 0, free: 0 });
      bp.total++;
      if (bd.status === 'occupied') bp.occupied++;
      if (bd.status === 'free') bp.free++;
    }
    /* Out-of-service beds are not capacity, so they come out of the
       denominator — otherwise a post with half its beds broken looks fine. */
    var usable = out.beds.total - out.beds.offline;
    out.beds.usable = usable;
    out.beds.occupancyPct = usable > 0 ? pct(out.beds.occupied, usable, 0) : 0;
    for (var bk in bedByPost) {
      var bpp = bedByPost[bk];
      var post2 = null;
      for (i = 0; i < posts.length; i++) if (posts[i].id === bk) post2 = posts[i];
      bpp.name = post2 ? post2.name : '—';
      bpp.code = post2 ? post2.code : '';
      bpp.occupancyPct = bpp.total ? pct(bpp.occupied, bpp.total, 0) : 0;
      out.beds.byPost.push(bpp);
    }

    /* ---- transport ---- */
    for (i = 0; i < ambulances.length; i++) {
      var amb = ambulances[i];
      var trips = [], dests = Object.create(null), turns = [];
      for (j = 0; j < patients.length; j++) {
        var tp = patients[j];
        if (!tp.transport || tp.transport.ambulanceId !== amb.id) continue;
        trips.push(tp);
        var dest = tp.transport.destination || 'Unspecified';
        dests[dest] = (dests[dest] || 0) + 1;
        if (tp.transport.departAt && tp.transport.arriveAt && tp.transport.arriveAt >= tp.transport.departAt) {
          turns.push(tp.transport.arriveAt - tp.transport.departAt);
        }
      }
      if (!trips.length) continue;
      var dArr = [];
      for (var dk in dests) dArr.push({ d: dk, n: dests[dk] });
      dArr.sort(function (x, y) { return y.n - x.n; });
      out.transport.push({
        ambulanceId: amb.id, callsign: amb.callsign, kind: amb.kind,
        trips: trips.length, medianTurnaround: med(turns), destinations: dArr
      });
    }
    out.transport.sort(function (x, y) { return y.trips - x.trips; });

    /* ---- red flags ----
       What the command post needs pushed at it. Open patients only — a closed
       record with an old abnormal observation is history, not a task. */
    for (i = 0; i < patients.length; i++) {
      p = patients[i];
      if (p.status === 'closed') continue;
      var der = EV.model.derive(p, now);
      var reasons = [];
      for (j = 0; j < der.redFlags.length; j++) reasons.push(der.redFlags[j]);
      if (!reasons.length) continue;
      var worst = 0;
      var why = [];
      for (j = 0; j < reasons.length; j++) {
        if (reasons[j].sev > worst) worst = reasons[j].sev;
        why.push(reasons[j].l);
      }
      out.redFlags.push({
        patientId: p.id, mrn: p.mrn, name: p.name,
        postId: p.postId, acuity: p.acuity,
        why: why.join(' · '), severity: worst
      });
    }
    out.redFlags.sort(function (x, y) {
      return y.severity - x.severity || (x.acuity || 9) - (y.acuity || 9);
    });

    return out;
  };

  function firstClinicalAt(p) {
    var best;
    var v = p.vitals || [], o = p.orders || [], c = p.cppt || [], i;
    for (i = 0; i < v.length; i++) if (!EV.has(best) || v[i].t < best) best = v[i].t;
    for (i = 0; i < o.length; i++) if (!EV.has(best) || o[i].t < best) best = o[i].t;
    for (i = 0; i < c.length; i++) if (!EV.has(best) || c[i].t < best) best = c[i].t;
    return best;
  }
  A.firstClinicalAt = firstClinicalAt;

  /* ====================================================================== */
  /* Charts                                                                  */
  /*                                                                         */
  /* SVG strings, no library. Colours come from CSS custom properties so the */
  /* same markup reads correctly in both themes — never a literal hex.       */
  /* ====================================================================== */

  function esc(s) { return EV.esc(s); }

  /* Axis ticks a human would choose: pick the STEP from the nice set first,
     then let the top follow from it. Deriving the step as top/4 is what
     produces gridlines at 7.5 and 22.5. `integer` is on for every count in
     this app - half a patient is not a tick. */
  function niceScale(v, target, integer) {
    target = target || 4;
    if (!EV.has(v) || v <= 0) return { top: integer ? 1 : 1, step: 1, ticks: 1 };
    var rough = v / target;
    var mag = Math.pow(10, Math.floor(Math.log(rough) / Math.LN10));
    var norm = rough / mag;
    var step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag;
    if (integer) step = Math.max(1, Math.round(step));
    var top = Math.ceil(v / step) * step;
    /* Floating point: 0.1*3 style drift would print 0.30000000000000004. */
    top = EV.r(top, 6);
    return { top: top, step: step, ticks: Math.max(1, Math.round(top / step)) };
  }
  A.niceScale = niceScale;
  function niceMax(v, target, integer) { return niceScale(v, target, integer).top; }
  A.niceMax = niceMax;

  function empty(w, h, msg) {
    return '<svg viewBox="0 0 ' + w + ' ' + h + '" role="img" aria-label="' + esc(msg) + '">' +
      '<text x="' + (w / 2) + '" y="' + (h / 2) + '" text-anchor="middle" ' +
      'fill="var(--ink-3)" font-size="11">' + esc(msg) + '</text></svg>';
  }

  A.bar = function (data, opts) {
    opts = opts || {};
    data = (data || []).filter(function (d) { return d && EV.has(num(d.v)); });
    if (!data.length) return empty(320, 120, 'No data yet');
    return opts.horizontal ? hbar(data, opts) : vbar(data, opts);
  };

  function vbar(data, opts) {
    var W = 520, H = 190, L = 34, R = 8, T = 14, B = 34;
    var iw = W - L - R, ih = H - T - B;
    var maxV = 0, i;
    for (i = 0; i < data.length; i++) maxV = Math.max(maxV, num(data[i].v));
    var sc = niceScale(maxV, 4, !opts.decimal);
    var top = sc.top, step = sc.step, nTicks = sc.ticks;
    var bw = iw / data.length;
    var s = ['<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' +
      esc(opts.title || 'Bar chart') + '"><title>' + esc(opts.title || 'Bar chart') + '</title>'];

    for (i = 0; i <= nTicks; i++) {
      var v = EV.r(step * i, 6);
      var y = EV.r(T + ih - (v / top) * ih, 2);
      s.push('<line class="grid" x1="' + L + '" y1="' + y + '" x2="' + (W - R) + '" y2="' + y +
        '" stroke="var(--line-soft)" stroke-width="1"/>');
      s.push('<text x="' + (L - 6) + '" y="' + (y + 3.5) + '" text-anchor="end" fill="var(--ink-3)" font-size="9">' +
        EV.r(v, v < 10 ? 1 : 0) + '</text>');
    }

    /* Label every bar when there is room, otherwise thin them out evenly so
       the axis never turns into a smudge. */
    var every = Math.ceil(data.length / Math.max(1, Math.floor(iw / 46)));
    for (i = 0; i < data.length; i++) {
      var d = data[i];
      var val = num(d.v);
      var bh = top > 0 ? (val / top) * ih : 0;
      var x = EV.r(L + i * bw + bw * 0.14, 2);
      var w = EV.r(bw * 0.72, 2);
      var y2 = EV.r(T + ih - bh, 2);
      s.push('<rect x="' + x + '" y="' + y2 + '" width="' + w + '" height="' + EV.r(Math.max(bh, val > 0 ? 1.5 : 0), 2) +
        '" rx="1.5" fill="' + (d.color || opts.accent || 'var(--brand)') + '"><title>' +
        esc(d.l) + ': ' + val + '</title></rect>');
      if (val > 0 && bh > 14 && bw > 20) {
        s.push('<text x="' + EV.r(x + w / 2, 2) + '" y="' + EV.r(y2 + 11, 2) +
          '" text-anchor="middle" fill="#fff" font-size="9" font-weight="600">' + val + '</text>');
      }
      if (i % every === 0) {
        s.push('<text x="' + EV.r(x + w / 2, 2) + '" y="' + (H - B + 13) +
          '" text-anchor="middle" fill="var(--ink-3)" font-size="9">' + esc(shorten(d.l, 7)) + '</text>');
      }
    }
    s.push('<line x1="' + L + '" y1="' + (T + ih) + '" x2="' + (W - R) + '" y2="' + (T + ih) +
      '" stroke="var(--line)" stroke-width="1"/>');
    if (opts.yLabel) {
      s.push('<text x="' + L + '" y="' + (H - 4) + '" fill="var(--ink-4)" font-size="9">' +
        esc(opts.yLabel) + '</text>');
    }
    s.push('</svg>');
    return s.join('');
  }

  function hbar(data, opts) {
    var rowH = 24, padT = 8, padB = 10;
    var W = 520, L = 128, R = 44;
    var H = padT + padB + data.length * rowH;
    var iw = W - L - R;
    var maxV = 0, i;
    for (i = 0; i < data.length; i++) maxV = Math.max(maxV, num(data[i].v));
    var top = niceScale(maxV, 4, true).top || 1;
    var s = ['<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' +
      esc(opts.title || 'Bar chart') + '"><title>' + esc(opts.title || 'Bar chart') + '</title>'];

    for (i = 0; i < data.length; i++) {
      var d = data[i];
      var val = num(d.v);
      var y = padT + i * rowH;
      var bw = top > 0 ? (val / top) * iw : 0;
      s.push('<text x="' + (L - 7) + '" y="' + (y + rowH / 2 + 3.5) + '" text-anchor="end" ' +
        'fill="var(--ink-2)" font-size="10">' + esc(shorten(d.l, 20)) + '</text>');
      s.push('<rect x="' + L + '" y="' + (y + 4) + '" width="' + EV.r(Math.max(bw, val > 0 ? 2 : 0), 2) +
        '" height="' + (rowH - 9) + '" rx="2" fill="' + (d.color || opts.accent || 'var(--brand)') +
        '"><title>' + esc(d.l) + ': ' + val + '</title></rect>');
      s.push('<text x="' + EV.r(L + Math.max(bw, 2) + 6, 2) + '" y="' + (y + rowH / 2 + 3.5) +
        '" fill="var(--ink-2)" font-size="10" font-weight="600">' + val +
        (opts.showPct && d.pct != null ? ' (' + d.pct + '%)' : '') + '</text>');
    }
    s.push('</svg>');
    return s.join('');
  }

  function shorten(s, n) {
    s = String(s == null ? '' : s);
    return s.length > n ? s.slice(0, n - 1) + '…' : s;
  }

  A.donut = function (data, opts) {
    opts = opts || {};
    data = (data || []).filter(function (d) { return d && num(d.v) > 0; });
    if (!data.length) return empty(320, 180, 'No data yet');

    var total = 0, i;
    for (i = 0; i < data.length; i++) total += num(data[i].v);

    var W = 420, H = 190, cx = 92, cy = 95, rOuter = 72, rInner = 46;
    var s = ['<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' +
      esc(opts.title || 'Donut chart') + '"><title>' + esc(opts.title || 'Donut chart') + '</title>'];

    var PAL = ['var(--brand)', 'var(--accent)', 'var(--info)', 'var(--ok)', 'var(--warn)', 'var(--bad)', 'var(--ink-3)'];
    var angle = -Math.PI / 2;
    for (i = 0; i < data.length; i++) {
      var frac = num(data[i].v) / total;
      var a2 = angle + frac * Math.PI * 2;
      var colour = data[i].color || PAL[i % PAL.length];
      /* A single slice covering the whole ring cannot be drawn as an arc —
         a 360° arc has identical endpoints and renders as nothing. */
      if (frac >= 0.9999) {
        s.push('<circle cx="' + cx + '" cy="' + cy + '" r="' + ((rOuter + rInner) / 2) +
          '" fill="none" stroke="' + colour + '" stroke-width="' + (rOuter - rInner) + '"/>');
      } else {
        s.push('<path d="' + arcPath(cx, cy, rOuter, rInner, angle, a2) + '" fill="' + colour +
          '"><title>' + esc(data[i].l) + ': ' + num(data[i].v) + ' (' + EV.r(frac * 100, 0) + '%)</title></path>');
      }
      angle = a2;
    }

    if (opts.centre != null) {
      s.push('<text x="' + cx + '" y="' + (cy + 2) + '" text-anchor="middle" fill="var(--ink)" ' +
        'font-size="24" font-weight="600">' + esc(opts.centre) + '</text>');
      if (opts.centreLabel) {
        s.push('<text x="' + cx + '" y="' + (cy + 17) + '" text-anchor="middle" fill="var(--ink-3)" ' +
          'font-size="9">' + esc(opts.centreLabel) + '</text>');
      }
    }

    var ly = 22;
    for (i = 0; i < data.length && i < 7; i++) {
      var col2 = data[i].color || PAL[i % PAL.length];
      s.push('<rect x="196" y="' + (ly - 8) + '" width="9" height="9" rx="2" fill="' + col2 + '"/>');
      s.push('<text x="211" y="' + ly + '" fill="var(--ink-2)" font-size="10">' +
        esc(shorten(data[i].l, 22)) + '</text>');
      s.push('<text x="' + (W - 10) + '" y="' + ly + '" text-anchor="end" fill="var(--ink-3)" ' +
        'font-size="10" font-weight="600">' + num(data[i].v) + '</text>');
      ly += 19;
    }
    s.push('</svg>');
    return s.join('');
  };

  function pt(cx, cy, r, a) {
    return EV.r(cx + r * Math.cos(a), 2) + ' ' + EV.r(cy + r * Math.sin(a), 2);
  }
  function arcPath(cx, cy, rO, rI, a1, a2) {
    var large = (a2 - a1) > Math.PI ? 1 : 0;
    return 'M' + pt(cx, cy, rO, a1) +
      ' A' + rO + ' ' + rO + ' 0 ' + large + ' 1 ' + pt(cx, cy, rO, a2) +
      ' L' + pt(cx, cy, rI, a2) +
      ' A' + rI + ' ' + rI + ' 0 ' + large + ' 0 ' + pt(cx, cy, rI, a1) + ' Z';
  }

  A.line = function (data, opts) {
    opts = opts || {};
    data = (data || []).filter(function (d) { return d && EV.has(num(d.v)); });
    if (data.length < 2) return empty(520, 170, 'Not enough points yet');
    var W = 520, H = 170, L = 34, R = 10, T = 12, B = 28;
    var iw = W - L - R, ih = H - T - B;
    var maxV = 0, i;
    for (i = 0; i < data.length; i++) maxV = Math.max(maxV, num(data[i].v));
    var lsc = niceScale(maxV, 4, !opts.decimal);
    var top = lsc.top;
    var dx = iw / (data.length - 1);
    var pts = [];
    for (i = 0; i < data.length; i++) {
      pts.push([EV.r(L + i * dx, 2), EV.r(T + ih - (num(data[i].v) / top) * ih, 2)]);
    }
    var s = ['<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' +
      esc(opts.title || 'Line chart') + '"><title>' + esc(opts.title || 'Line chart') + '</title>'];
    for (i = 0; i <= lsc.ticks; i++) {
      var y = EV.r(T + ih - (i / lsc.ticks) * ih, 2);
      s.push('<line x1="' + L + '" y1="' + y + '" x2="' + (W - R) + '" y2="' + y +
        '" stroke="var(--line-soft)" stroke-width="1"/>');
      s.push('<text x="' + (L - 6) + '" y="' + (y + 3.5) + '" text-anchor="end" fill="var(--ink-3)" font-size="9">' +
        EV.r(lsc.step * i, top < 10 ? 1 : 0) + '</text>');
    }
    var dPath = pts.map(function (p2, ix) { return (ix ? 'L' : 'M') + p2[0] + ' ' + p2[1]; }).join(' ');
    s.push('<path d="' + dPath + ' L' + pts[pts.length - 1][0] + ' ' + (T + ih) + ' L' + pts[0][0] + ' ' + (T + ih) +
      ' Z" fill="var(--brand-wash)"/>');
    s.push('<path d="' + dPath + '" fill="none" stroke="' + (opts.accent || 'var(--brand)') + '" stroke-width="2"/>');
    s.push('<circle cx="' + pts[pts.length - 1][0] + '" cy="' + pts[pts.length - 1][1] +
      '" r="3.2" fill="' + (opts.accent || 'var(--brand)') + '"/>');
    s.push('</svg>');
    return s.join('');
  };

  A.stackedBar = function (rows, opts) {
    opts = opts || {};
    rows = (rows || []).filter(function (r) { return r && (r.parts || []).length; });
    if (!rows.length) return empty(520, 120, 'No data yet');
    var rowH = 26, W = 520, L = 120, R = 40;
    var H = 10 + rows.length * rowH;
    var iw = W - L - R;
    var maxTotal = 0, i, j;
    for (i = 0; i < rows.length; i++) {
      var t = 0;
      for (j = 0; j < rows[i].parts.length; j++) t += num(rows[i].parts[j].v) || 0;
      maxTotal = Math.max(maxTotal, t);
    }
    if (!maxTotal) return empty(520, 120, 'No data yet');
    var s = ['<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' +
      esc(opts.title || 'Stacked bar') + '"><title>' + esc(opts.title || 'Stacked bar') + '</title>'];
    for (i = 0; i < rows.length; i++) {
      var y = 6 + i * rowH, x = L, tot = 0;
      s.push('<text x="' + (L - 7) + '" y="' + (y + rowH / 2 + 2) + '" text-anchor="end" ' +
        'fill="var(--ink-2)" font-size="10">' + esc(shorten(rows[i].l, 18)) + '</text>');
      for (j = 0; j < rows[i].parts.length; j++) {
        var pv = num(rows[i].parts[j].v) || 0;
        if (pv <= 0) continue;
        tot += pv;
        var w = (pv / maxTotal) * iw;
        s.push('<rect x="' + EV.r(x, 2) + '" y="' + (y + 4) + '" width="' + EV.r(w, 2) + '" height="' + (rowH - 11) +
          '" fill="' + (rows[i].parts[j].color || 'var(--brand)') + '"><title>' +
          esc(rows[i].parts[j].l) + ': ' + pv + '</title></rect>');
        x += w;
      }
      s.push('<text x="' + EV.r(x + 6, 2) + '" y="' + (y + rowH / 2 + 2) + '" fill="var(--ink-2)" ' +
        'font-size="10" font-weight="600">' + tot + '</text>');
    }
    s.push('</svg>');
    return s.join('');
  };

  A.sparkline = function (values, opts) {
    opts = opts || {};
    values = (values || []).filter(function (v) { return EV.has(num(v)); });
    if (values.length < 2) return empty(100, 26, '');
    var W = 100, H = 26;
    var max = Math.max.apply(null, values) || 1;
    var dx = W / (values.length - 1);
    var pts = values.map(function (v, i) {
      return [EV.r(i * dx, 2), EV.r(H - 2 - (v / max) * (H - 5), 2)];
    });
    var d = pts.map(function (p, i) { return (i ? 'L' : 'M') + p[0] + ' ' + p[1]; }).join(' ');
    var last = pts[pts.length - 1];
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" role="img" aria-label="trend">' +
      '<path d="' + d + ' L' + W + ' ' + H + ' L0 ' + H + ' Z" fill="var(--brand-wash)"/>' +
      '<path d="' + d + '" fill="none" stroke="' + (opts.accent || 'var(--brand)') +
      '" stroke-width="1.6" vector-effect="non-scaling-stroke"/>' +
      '<circle cx="' + last[0] + '" cy="' + last[1] + '" r="2.2" fill="' + (opts.accent || 'var(--brand)') + '"/>' +
      '</svg>';
  };

  A.heat = function (grid, opts) {
    opts = opts || {};
    if (!grid || !grid.rows || !grid.rows.length || !grid.cols || !grid.cols.length) {
      return empty(520, 120, 'No data yet');
    }
    var cw = 26, ch = 22, L = 96, T = 22;
    var W = Math.max(520, L + grid.cols.length * cw + 12);
    var H = T + grid.rows.length * ch + 10;
    var max = 0, i, j;
    for (i = 0; i < grid.rows.length; i++) {
      for (j = 0; j < grid.cols.length; j++) {
        max = Math.max(max, num((grid.values[i] || [])[j]) || 0);
      }
    }
    var s = ['<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' +
      esc(opts.title || 'Heat map') + '"><title>' + esc(opts.title || 'Heat map') + '</title>'];
    for (j = 0; j < grid.cols.length; j++) {
      if (j % 2 === 0) {
        s.push('<text x="' + EV.r(L + j * cw + cw / 2, 2) + '" y="14" text-anchor="middle" ' +
          'fill="var(--ink-3)" font-size="8">' + esc(shorten(grid.cols[j], 5)) + '</text>');
      }
    }
    for (i = 0; i < grid.rows.length; i++) {
      s.push('<text x="' + (L - 6) + '" y="' + (T + i * ch + ch / 2 + 3) + '" text-anchor="end" ' +
        'fill="var(--ink-2)" font-size="9">' + esc(shorten(grid.rows[i], 14)) + '</text>');
      for (j = 0; j < grid.cols.length; j++) {
        var v = num((grid.values[i] || [])[j]) || 0;
        var o = max > 0 ? 0.08 + 0.92 * (v / max) : 0.08;
        s.push('<rect x="' + EV.r(L + j * cw + 1, 2) + '" y="' + (T + i * ch + 1) + '" width="' + (cw - 2) +
          '" height="' + (ch - 2) + '" rx="2" fill="var(--brand)" fill-opacity="' + EV.r(o, 3) +
          '"><title>' + esc(grid.rows[i] + ' · ' + grid.cols[j]) + ': ' + v + '</title></rect>');
      }
    }
    s.push('</svg>');
    return s.join('');
  };

  /* ====================================================================== */
  /* Self test                                                               */
  /* ====================================================================== */

  A.selfTest = function () {
    var fails = [], n = 0;
    function eq(name, got, want) {
      n++;
      var g = JSON.stringify(got), w = JSON.stringify(want);
      if (g !== w) fails.push({ name: name, expected: w, got: g });
    }

    /* Statistics — a wrong median here is a wrong number in a report to the
       event organiser. */
    eq('median even', EV.quantile([10, 20, 30, 40], 0.5), 25);
    eq('median odd', EV.quantile([10, 20, 30], 0.5), 20);
    eq('p90 interpolates', EV.quantile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.9), 9.1);
    eq('quantile ignores blanks', EV.quantile([1, undefined, 3, null, ''], 0.5), 2);
    eq('quantile empty', EV.quantile([], 0.5), undefined);

    eq('niceScale 7 -> top 8 step 2', [niceScale(7, 4, true).top, niceScale(7, 4, true).step], [8, 2]);
    eq('niceScale 23 -> top 30 step 10', [niceScale(23, 4, true).top, niceScale(23, 4, true).step], [30, 10]);
    eq('niceScale 101 -> top 150 step 50', [niceScale(101, 4, true).top, niceScale(101, 4, true).step], [150, 50]);
    eq('niceScale 1 stays 1', niceScale(1, 4, true).top, 1);
    eq('niceScale 0 is safe', niceScale(0, 4, true).top, 1);
    eq('integer scale never steps below 1', niceScale(3, 4, true).step >= 1, true);
    /* Every gridline must land on a whole multiple of the step. */
    eq('ticks divide the top exactly', EV.r(niceScale(23, 4, true).step * niceScale(23, 4, true).ticks, 6), 30);

    /* The empty event must not throw and must return a usable shape. */
    var zero = A.compute({});
    eq('empty totals', zero.totals.patients, 0);
    eq('empty occupancy is 0 not NaN', zero.beds.occupancyPct, 0);
    eq('empty median is undefined not 0', zero.los.median, undefined);
    eq('empty arrays', zero.meds.length + zero.supplies.length + zero.redFlags.length, 0);

    /* A small real event. */
    var T0 = 1800000000000;
    var ev = { id: 'e1', name: 'Test Run', audience: 10000, endDate: T0 + 4 * HOUR };
    var posts = [{ id: 'p1', code: 'ICU', name: 'Mini ICU' }, { id: 'p2', code: 'P01', name: 'Tent 1' }];
    var beds = [
      { id: 'b1', postId: 'p1', status: 'occupied' },
      { id: 'b2', postId: 'p1', status: 'free' },
      { id: 'b3', postId: 'p2', status: 'offline' }
    ];
    var ambs = [{ id: 'a1', callsign: 'AMB-1', kind: 'als' }];
    var form = [{ id: 'kassa', name: 'Kassa Steril', par: 10 }];

    function P(o) {
      return Object.assign(EV.model.newPatient({
        eventId: 'e1', postId: 'p1', arrivalAt: T0, acuity: 3
      }), o);
    }
    var patients = [
      P({
        id: 'x1', name: 'A', acuity: 1, arrivalAt: T0, triageAt: T0 + 60000,
        status: 'closed', closedAt: T0 + 30 * 60000, disposition: 'transport',
        dispositionAt: T0 + 30 * 60000,
        transport: { ambulanceId: 'a1', destination: 'Siloam KJ', departAt: T0 + 25 * 60000, arriveAt: T0 + 45 * 60000 },
        vitals: [{ t: T0 + 2 * 60000, spo2: 85, sbp: 80 }],
        orders: [
          { id: 'o1', t: T0 + 5 * 60000, kind: 'med', itemId: 'epi', name: 'Epinephrine', dose: '1', unit: 'mg', given: true },
          { id: 'o2', t: T0 + 6 * 60000, kind: 'supply', itemId: 'kassa', name: 'Kassa Steril', qty: 4, given: true }
        ],
        complaintCat: 'cardiac'
      }),
      P({
        id: 'x2', name: 'B', acuity: 4, postId: 'p2', arrivalAt: T0 + HOUR,
        status: 'closed', closedAt: T0 + HOUR + 10 * 60000,
        disposition: 'return-to-event', dispositionAt: T0 + HOUR + 10 * 60000,
        complaintCat: 'msk',
        orders: [{ id: 'o3', t: T0 + HOUR, kind: 'med', itemId: 'epi', name: 'Epinephrine', dose: '0.5', unit: 'mg', given: true }]
      }),
      P({ id: 'x3', name: 'C', acuity: 2, arrivalAt: T0 + 2 * HOUR, complaintCat: 'heat' })
    ];

    var r = A.compute({
      event: ev, posts: posts, beds: beds, ambulances: ambs,
      patients: patients, formulary: form, now: T0 + 2 * HOUR + 10 * 60000
    });

    eq('counts patients', r.totals.patients, 3);
    eq('counts open', r.totals.open, 1);
    eq('counts closed', r.totals.closed, 2);
    eq('counts transported', r.totals.transported, 1);
    eq('counts returned', r.totals.returnedToEvent, 1);

    eq('acuity buckets', r.acuity[0].n, 1);
    eq('acuity percent', r.acuity[0].pct, 33);

    /* Occupancy excludes the out-of-service bed: 1 occupied of 2 usable. */
    eq('bed usable excludes offline', r.beds.usable, 2);
    eq('bed occupancy', r.beds.occupancyPct, 50);

    /* LOS set is [30 min, 10 min, 10 min] - the median is 10. */
    eq('median LOS', r.los.median, 10 * 60000);
    eq('triage delay median', r.timeliness.medianTriageDelay, 60000);
    eq('door to transport', r.timeliness.medianDoorToTransport, 25 * 60000);

    eq('meds aggregated across patients', r.meds[0].n, 2);
    eq('meds count distinct patients', r.meds[0].patients, 2);
    eq('meds sum the dose', r.meds[0].totalDose, 1.5);
    eq('supplies qty', r.supplies[0].qty, 4);
    eq('supplies against par', r.supplies[0].pctOfPar, 40);

    eq('by post sorted by volume', r.byPost[0].postId, 'p1');
    eq('post transfer rate', r.byPost[0].transferRate, 50);

    eq('transport trips', r.transport[0].trips, 1);
    eq('transport turnaround', r.transport[0].medianTurnaround, 20 * 60000);

    /* x1 is closed with an SpO2 of 85 and an SBP of 80 and must NOT appear.
       x3 is open at acuity 2 with nothing recorded, which is exactly what the
       command post needs pushed at it. */
    eq('one red flag', r.redFlags.length, 1);
    eq('red flag is the open patient', r.redFlags[0].patientId, 'x3');
    eq('red flag explains itself', /No vitals/.test(r.redFlags[0].why), true);

    eq('arrivals bucketed hourly', r.rate.perHour.length, 3);
    eq('peak hour', r.rate.peakHour, 1);
    eq('presentations per 1000', r.capacity.vsExpected, 0.3);

    /* A medication given in two different units must not be summed. */
    var mixed = A.compute({
      patients: [P({
        id: 'm1', orders: [
          { id: 'q1', t: T0, kind: 'med', itemId: 'z', name: 'Z', dose: '5', unit: 'mg', given: true },
          { id: 'q2', t: T0, kind: 'med', itemId: 'z', name: 'Z', dose: '5', unit: 'mL', given: true }
        ]
      })]
    });
    eq('mixed units are not summed', mixed.meds[0].totalDose, undefined);
    eq('mixed units flagged', mixed.meds[0].unit, 'mixed');

    /* Charts: well-formed SVG, populated and empty. */
    function svgOk(s) {
      return typeof s === 'string' &&
        s.indexOf('<svg') === 0 &&
        s.indexOf('viewBox=') !== -1 &&
        s.lastIndexOf('</svg>') === s.length - 6;
    }
    eq('bar svg', svgOk(A.bar([{ l: 'a', v: 3 }, { l: 'b', v: 7 }])), true);
    eq('bar horizontal svg', svgOk(A.bar([{ l: 'a', v: 3 }], { horizontal: true })), true);
    eq('bar empty svg', svgOk(A.bar([])), true);
    eq('donut svg', svgOk(A.donut([{ l: 'a', v: 2 }, { l: 'b', v: 1 }])), true);
    eq('donut single slice svg', svgOk(A.donut([{ l: 'only', v: 5 }])), true);
    eq('donut empty svg', svgOk(A.donut([])), true);
    eq('line svg', svgOk(A.line([{ v: 1 }, { v: 4 }, { v: 2 }])), true);
    eq('line too short', svgOk(A.line([{ v: 1 }])), true);
    eq('stacked svg', svgOk(A.stackedBar([{ l: 'p', parts: [{ l: 'a', v: 1 }, { l: 'b', v: 2 }] }])), true);
    eq('sparkline svg', svgOk(A.sparkline([1, 3, 2, 5])), true);
    eq('heat svg', svgOk(A.heat({ rows: ['r'], cols: ['c1', 'c2'], values: [[1, 2]] })), true);
    eq('heat empty', svgOk(A.heat(null)), true);

    /* Chart labels must be escaped — a patient could be called "A & B". */
    eq('chart escapes markup',
      A.bar([{ l: '<script>', v: 1 }], { horizontal: true }).indexOf('<script>') === -1, true);

    return { pass: n - fails.length, fail: fails.length, total: n, failures: fails };
  };

})(window.EV = window.EV || {});
