/* 04-calc.js — EV.calc
 * Clinical calculators for the Mini Emergency & Critical Care Event EMR.
 * Same shape as EDGE Calc: def/score/list/byId/search/run/selfTest + N/S/B/YN/H fields.
 * Vanilla ES2017. No deps. Golden tests run in the browser via EV.calc.selfTest().
 */
(function (EV) {
  'use strict';

  const C = {};
  EV.calc = C;
  C.VERSION = '1.0.0';

  /* ------------------------------------------------------------------ *
   * 0. Safe local helpers. Delegate to 00-core when it is loaded, but
   *    stay self-contained so selfTest() can run in isolation.
   * ------------------------------------------------------------------ */

  function has(v) {
    if (typeof EV.has === 'function') return EV.has(v);
    if (v === null || v === undefined || v === '') return false;
    if (typeof v === 'number' && isNaN(v)) return false;
    return true;
  }

  function num(v) {
    if (v === null || v === undefined || v === '') return undefined;
    if (typeof v === 'number') return isNaN(v) ? undefined : v;
    if (typeof v === 'boolean') return undefined;
    const n = parseFloat(String(v).replace(',', '.'));
    return isNaN(n) ? undefined : n;
  }

  /* private rounding — deterministic regardless of core */
  function rd(v, d) {
    if (!has(v) || typeof v !== 'number' || !isFinite(v)) return undefined;
    const p = Math.pow(10, has(d) ? d : 0);
    return Math.round(v * p) / p;
  }

  function f(v, d) {
    const x = rd(v, d);
    return has(x) ? String(x) : '—';
  }

  function rng(a, b, d, unit) {
    if (!has(a) || !has(b)) return '—';
    return f(a, d) + '-' + f(b, d) + (unit ? ' ' + unit : '');
  }

  function cap(v, max) {
    if (!has(v)) return undefined;
    if (!has(max)) return v;
    return v > max ? max : v;
  }

  function clamp(v, lo, hi) {
    if (!has(v)) return undefined;
    return v < lo ? lo : (v > hi ? hi : v);
  }

  /* 'mg = mL' at a stocked concentration */
  function amtVol(amount, unit, perMl, dAmt, dVol) {
    if (!has(amount)) return 'Enter weight';
    let s = f(amount, has(dAmt) ? dAmt : 1) + ' ' + unit;
    if (has(perMl) && perMl > 0) s += ' = ' + f(amount / perMl, has(dVol) ? dVol : 2) + ' mL';
    return s;
  }

  function norm(s) {
    return String(s === undefined || s === null ? '' : s)
      .toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function lev(a, b) {
    if (a === b) return 0;
    const m = a.length, n = b.length;
    if (!m) return n;
    if (!n) return m;
    if (Math.abs(m - n) > 2) return 3;
    let prev = [], cur = [];
    for (let j = 0; j <= n; j++) prev[j] = j;
    for (let i = 1; i <= m; i++) {
      cur = [i];
      for (let j = 1; j <= n; j++) {
        const cost = a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1;
        cur[j] = Math.min(cur[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
      }
      prev = cur;
    }
    return prev[n];
  }

  /* ------------------------------------------------------------------ *
   * 1. Patient canvas + weight engine (EV.model.derive style)
   * ------------------------------------------------------------------ */

  function ageYears(p) {
    if (!p) return undefined;
    const a = num(p.age);
    if (!has(a)) return undefined;
    return p.ageUnit === 'mo' ? a / 12 : a;
  }

  function lastVitals(p) {
    if (!p || !p.vitals || !p.vitals.length) return {};
    let best = null;
    for (let i = 0; i < p.vitals.length; i++) {
      const v = p.vitals[i];
      if (!v) continue;
      if (!best || num(v.t) === undefined || num(best.t) === undefined || num(v.t) >= num(best.t)) best = v;
    }
    return best || {};
  }

  function canvasOf(p) {
    const o = {};
    if (!p) return o;
    const a = ageYears(p);
    if (has(a)) o.age = a;
    if (has(num(p.weight))) o.weight = num(p.weight);
    if (has(num(p.height))) o.height = num(p.height);
    if (has(p.sex)) o.sex = p.sex;
    const lv = lastVitals(p);
    const keys = ['hr', 'sbp', 'dbp', 'rr', 'spo2', 'temp', 'gcs', 'pain', 'bgl'];
    for (let i = 0; i < keys.length; i++) {
      const n = num(lv[keys[i]]);
      if (has(n)) o[keys[i]] = n;
    }
    if (!has(o.weight) && has(num(lv.weight))) o.weight = num(lv.weight);
    return o;
  }

  /* Devine / Janmahasatian / Mosteller + a dosing-weight decision. */
  C.weights = function (kg, cm, sex, age) {
    const o = { abw: num(kg), ht: num(cm), sex: sex || '', age: num(age) };
    if (!has(o.abw) || o.abw <= 0) return o;
    const paed = has(o.age) && o.age < 18;
    o.isPaed = paed;
    if (has(o.ht) && o.ht >= 137) {
      const inches = o.ht / 2.54;
      const base = (String(sex).toUpperCase() === 'F') ? 45.5 : 50;
      o.ibw = base + 2.3 * (inches - 60);
      if (o.ibw > 0) o.adjbw = o.ibw + 0.4 * (o.abw - o.ibw);
      else { o.ibw = undefined; o.adjbw = undefined; }
    }
    if (has(o.ht) && o.ht > 0) {
      o.bmi = o.abw / Math.pow(o.ht / 100, 2);
      o.bsa = Math.sqrt(o.ht * o.abw / 3600);
      o.bsaDuBois = 0.007184 * Math.pow(o.ht, 0.725) * Math.pow(o.abw, 0.425);
      o.lbw = (String(sex).toUpperCase() === 'F')
        ? (9270 * o.abw) / (8780 + 244 * o.bmi)
        : (9270 * o.abw) / (6680 + 216 * o.bmi);
    }
    if (paed) {
      o.dosing = o.abw; o.basis = 'Actual body weight (paediatric)';
    } else if (has(o.bmi) && o.bmi >= 30 && has(o.adjbw)) {
      o.dosing = o.adjbw; o.basis = 'AdjBW (BMI >=30)';
    } else {
      o.dosing = o.abw; o.basis = 'Actual body weight';
    }
    /* total body water fraction for sodium maths */
    const female = String(sex).toUpperCase() === 'F';
    let frac = female ? 0.5 : 0.6;
    if (has(o.age) && o.age >= 65) frac = female ? 0.45 : 0.5;
    if (paed) frac = 0.6;
    o.tbw = o.abw * frac;
    o.tbwFrac = frac;
    return o;
  };

  C.dosingWeight = function (patient, override) {
    const p = patient || {};
    const w = has(num(override)) ? num(override) : canvasOf(p).weight;
    if (!has(w)) return undefined;
    return C.weights(w, canvasOf(p).height, p.sex, ageYears(p)).dosing;
  };

  /* ------------------------------------------------------------------ *
   * 2. Field helpers
   * ------------------------------------------------------------------ */

  function normOpts(list) {
    return (list || []).map(function (o) {
      if (Array.isArray(o)) {
        const r = { v: o[0], l: o[1] === undefined ? String(o[0]) : o[1] };
        r.p = (o.length > 2 && has(o[2])) ? o[2] : (typeof o[0] === 'number' ? o[0] : 0);
        return r;
      }
      if (o && typeof o === 'object') {
        const r = Object.assign({}, o);
        if (!has(r.l)) r.l = String(r.v);
        if (!has(r.p)) r.p = (typeof r.v === 'number' ? r.v : 0);
        return r;
      }
      return { v: o, l: String(o), p: 0 };
    });
  }

  function N(k, l, o) { return Object.assign({ t: 'n', k: k, l: l }, o || {}); }
  function S(k, l, opts, o) { return Object.assign({ t: 's', k: k, l: l, o: normOpts(opts) }, o || {}); }
  function B(k, l, p, o) { return Object.assign({ t: 'b', k: k, l: l, p: has(p) ? p : 1 }, o || {}); }
  function YN(k, l, p, o) { return Object.assign({ t: 'yn', k: k, l: l, p: has(p) ? p : 1 }, o || {}); }
  function H(l, hint) { return { t: 'h', l: l, hint: hint }; }

  /* Holliday-Segar maintenance. The 4-2-1 rule is the hourly form of the
     100/50/20 mL/kg/day rule; a burned child needs this WITH dextrose on top
     of the resuscitation volume, which is why Parkland reaches for it. */
  C.holliday = function (kg) {
    const w = num(kg);
    if (!has(w) || w <= 0) return { perHour: undefined, perDay: undefined };
    let perHour, perDay;
    if (w <= 10) { perHour = 4 * w; perDay = 100 * w; }
    else if (w <= 20) { perHour = 40 + 2 * (w - 10); perDay = 1000 + 50 * (w - 10); }
    else { perHour = 60 + 1 * (w - 20); perDay = 1500 + 20 * (w - 20); }
    return { perHour: rd(perHour, 1), perDay: rd(perDay, 0) };
  };
  const holliday = C.holliday;

  C.N = N; C.S = S; C.B = B; C.YN = YN; C.H = H;

  function findOpt(fld, val) {
    const os = fld.o || [];
    for (let i = 0; i < os.length; i++) if (String(os[i].v) === String(val)) return os[i];
    return null;
  }

  function ynVal(v) {
    if (v === true || v === 1) return true;
    if (v === false || v === 0) return false;
    if (v === 'y' || v === 'yes' || v === 'true' || v === '1') return true;
    if (v === 'n' || v === 'no' || v === 'false' || v === '0') return false;
    return undefined;
  }

  /* ------------------------------------------------------------------ *
   * 3. Registry
   * ------------------------------------------------------------------ */

  C.CATS = [
    { id: 'triage', l: 'Triage & early warning' },
    { id: 'heat', l: 'Heat & exertional' },
    { id: 'cardiac', l: 'Cardiac' },
    { id: 'trauma', l: 'Trauma' },
    { id: 'airway', l: 'Airway & drugs' },
    { id: 'metabolic', l: 'Metabolic & fluids' },
    { id: 'misc', l: 'Environmental & other' }
  ];

  C.defs = [];
  const byIdMap = {};

  function register(d, kind) {
    d.kind = kind;
    if (!d.t) d.t = [];
    if (!d.i) d.i = [];
    if (!d.tests) d.tests = [];
    C.defs.push(d);
    byIdMap[d.id] = d;
    return d;
  }

  C.def = function (d) { return register(d, 'calc'); };
  C.score = function (d) { return register(d, 'score'); };
  C.byId = function (id) { return byIdMap[id] || null; };
  C.list = function (cat) {
    if (!cat) return C.defs.slice();
    return C.defs.filter(function (d) { return d.c === cat; });
  };

  C.search = function (q) {
    const nq = norm(q);
    if (!nq) return C.defs.slice();
    const toks = nq.split(' ');
    const out = [];
    C.defs.forEach(function (d) {
      const hay = norm(d.id + ' ' + d.n + ' ' + (d.t || []).join(' ') + ' ' + (d.c || ''));
      const words = hay.split(' ');
      let sc = 0;
      if (norm(d.id) === nq) sc += 200;
      if (hay.indexOf(nq) >= 0) sc += 100;
      if (norm(d.n).indexOf(nq) === 0) sc += 60;
      toks.forEach(function (t) {
        let best = 0;
        for (let i = 0; i < words.length; i++) {
          const w = words[i];
          if (w === t) { if (best < 40) best = 40; continue; }
          if (w.indexOf(t) === 0) { if (best < 30) best = 30; continue; }
          if (t.length >= 4 && w.indexOf(t) >= 0) { if (best < 20) best = 20; continue; }
          if (t.length >= 4 && lev(w, t) <= 1) { if (best < 18) best = 18; }
        }
        sc += best;
      });
      if (sc > 0) out.push({ d: d, s: sc });
    });
    out.sort(function (a, b) { return b.s - a.s || (a.d.n < b.d.n ? -1 : 1); });
    return out.map(function (x) { return x.d; });
  };

  /* ------------------------------------------------------------------ *
   * 4. run()
   * ------------------------------------------------------------------ */

  function resolve(d, inputs, patient) {
    const v = {};
    const canvas = canvasOf(patient);
    (d.i || []).forEach(function (fld) {
      if (fld.t === 'h') return;
      let val = inputs[fld.k];
      if (!has(val) && fld.ctx) {
        const src = (fld.ctx === true) ? fld.k : fld.ctx;
        const cv = canvas[src];
        if (has(cv)) {
          val = fld.mapCtx ? fld.mapCtx(cv, canvas) : cv;
          v['__ctx_' + fld.k] = true;
        }
      }
      if (!has(val) && has(fld.dflt)) val = fld.dflt;
      if (fld.t === 'n') v[fld.k] = num(val);
      else if (fld.t === 'b') v[fld.k] = ynVal(val) === true;
      else if (fld.t === 'yn') v[fld.k] = ynVal(val);
      else v[fld.k] = has(val) ? val : undefined;
    });
    v.__canvas = canvas;
    return v;
  }

  function mkCtx(patient, v) {
    const p = patient || {};
    const flags = [];
    const canvas = v.__canvas || {};
    const o = {
      p: p, patient: p, flags: flags, canvas: canvas,
      flag: function (s) { if (s && flags.indexOf(s) < 0) flags.push(s); return s; },
      row: function (l, val, cls) {
        return { l: l, v: (val === undefined || val === null || val === '') ? '—' : String(val), cls: cls || '' };
      }
    };
    o.age = has(num(v.age)) ? num(v.age) : canvas.age;
    o.isPaed = has(o.age) ? o.age < 18 : undefined;
    o.sex = v.sex || canvas.sex || p.sex || '';
    o.ht = has(num(v.height)) ? num(v.height) : canvas.height;
    let w = num(v.wt);
    if (!has(w)) w = num(v.weight);
    if (!has(w)) w = canvas.weight;
    o.wt = has(w) && w > 0 ? w : undefined;
    o.W = has(o.wt) ? C.weights(o.wt, o.ht, o.sex, o.age) : {};
    o.dw = o.W.dosing;
    return o;
  }

  function scoreOf(d, v) {
    let s = 0;
    const parts = [], missing = [];
    (d.i || []).forEach(function (fld) {
      if (fld.t === 'h' || fld.noScore) return;
      const val = v[fld.k];
      let p;
      if (fld.t === 'n') {
        if (!has(val)) { if (!fld.opt) missing.push(fld.l); return; }
        p = fld.pts ? fld.pts(val, v) : 0;
      } else if (fld.t === 's') {
        if (!has(val)) { if (!fld.opt) missing.push(fld.l); return; }
        const o = findOpt(fld, val);
        p = fld.pts ? fld.pts(val, v) : (o ? o.p : 0);
      } else if (fld.t === 'yn') {
        if (val === undefined) { if (!fld.opt) missing.push(fld.l); return; }
        p = fld.pts ? fld.pts(val, v) : (val ? fld.p : 0);
      } else if (fld.t === 'b') {
        p = fld.pts ? fld.pts(val, v) : (val ? fld.p : 0);
      } else return;
      if (!has(p)) p = 0;
      s += p;
      parts.push({ l: fld.l, p: p, val: val, fld: fld });
    });
    s = rd(s, 4);
    return { s: missing.length ? undefined : s, parts: parts, missing: missing };
  }

  function bandOf(d, s) {
    if (!has(s)) return { l: 'Incomplete', cls: 'warn', note: 'Answer every field before reading this score.' };
    if (typeof d.band === 'function') return d.band(s) || {};
    const bs = d.bands || [];
    for (let i = 0; i < bs.length; i++) {
      const b = bs[i];
      const lo = has(b.lo) ? b.lo : -Infinity;
      const hi = has(b.hi) ? b.hi : Infinity;
      if (s >= lo && s <= hi) return b;
    }
    return {};
  }

  C.run = function (id, inputs, patient) {
    const d = C.byId(id);
    if (!d) {
      return { rows: [{ l: 'Unknown calculator', v: String(id), cls: 'bad' }], score: undefined, risk: '', flags: [] };
    }
    const v = resolve(d, inputs || {}, patient);
    const P = mkCtx(patient, v);
    let rows = [], score, risk = '';

    if (d.kind === 'score') {
      const sc = scoreOf(d, v);
      const b = bandOf(d, sc.s);
      score = sc.s;
      risk = b.l || '';
      rows.push(P.row(d.n, has(sc.s) ? (String(sc.s) + (has(d.max) ? ' / ' + d.max : '')) : 'Incomplete',
        has(sc.s) ? (b.cls || '') : 'warn'));
      rows.push(P.row('Interpretation', b.l || '—', b.cls || ''));
      if (b.note) rows.push(P.row('Action', b.note, b.cls || ''));
      if (sc.missing.length) {
        P.flag('Incomplete: ' + sc.missing.length + ' field(s) unanswered - score suppressed, do NOT read as low risk');
        rows.push(P.row('Unanswered', sc.missing.join(', '), 'bad'));
      }
      if (d.showParts !== false) {
        sc.parts.forEach(function (pt) {
          if (pt.p) rows.push(P.row(pt.l, '+' + f(pt.p, 2)));
        });
      }
      if (d.extra) {
        const er = d.extra(v, P, sc);
        if (er && er.length) rows = rows.concat(er);
      }
    } else {
      const out = d.out(v, P);
      if (Array.isArray(out)) rows = out;
      else if (out) {
        rows = out.rows || [];
        score = out.score;
        risk = out.risk || '';
        if (out.flags) out.flags.forEach(P.flag);
      }
    }

    rows = rows.filter(function (x) { return !!x; });
    if (d.verify) P.flag('Unverified threshold in this tool (' + (d.verifyNote || 'check against local protocol') + ')');
    return {
      rows: rows, score: score, risk: risk, flags: P.flags,
      id: d.id, n: d.n, v: d.v, ref: d.ref, verify: !!d.verify
    };
  };

  /* ------------------------------------------------------------------ *
   * 5. selfTest()
   * ------------------------------------------------------------------ */

  function findRow(rows, needle) {
    const nn = String(needle).toLowerCase();
    for (let i = 0; i < rows.length; i++) {
      if (String(rows[i].l).toLowerCase().indexOf(nn) >= 0) return rows[i];
    }
    return null;
  }

  function matches(hay, exp) {
    if (exp instanceof RegExp) return exp.test(String(hay));
    return String(hay).toLowerCase().indexOf(String(exp).toLowerCase()) >= 0;
  }

  C.selfTest = function () {
    const failures = [];
    let pass = 0, fail = 0;
    function assert(name, ok, expected, got) {
      if (ok) pass++;
      else { fail++; failures.push({ name: name, expected: String(expected), got: String(got) }); }
    }

    C.defs.forEach(function (d) {
      const tag = d.id;
      assert(tag + ': has version', !!d.v, 'semver string', d.v);
      assert(tag + ': has reference', !!d.ref && String(d.ref).length > 8, 'citation', d.ref);
      assert(tag + ': has >=1 golden test', (d.tests || []).length > 0, '>=1', (d.tests || []).length);

      (d.tests || []).forEach(function (t, ix) {
        const label = tag + '#' + (t.n || ix);
        let res;
        try {
          res = C.run(d.id, t.i || {}, t.p);
        } catch (err) {
          assert(label + ': runs', false, 'no throw', String(err && err.message ? err.message : err));
          return;
        }
        const e = t.e || {};
        if (has(e.score)) {
          assert(label + ': score', rd(res.score, 4) === rd(e.score, 4), e.score, res.score);
        }
        if (e.scoreUndef) {
          assert(label + ': score suppressed', !has(res.score), 'undefined', res.score);
        }
        if (e.risk !== undefined) {
          assert(label + ': risk', matches(res.risk, e.risk), e.risk, res.risk);
        }
        (e.rows || []).forEach(function (pair) {
          const row = findRow(res.rows, pair[0]);
          if (!row) { assert(label + ': row "' + pair[0] + '"', false, pair[1], 'row not found'); return; }
          assert(label + ': ' + pair[0], matches(row.v, pair[1]), pair[1], row.v);
        });
        (e.cls || []).forEach(function (pair) {
          const row = findRow(res.rows, pair[0]);
          if (!row) { assert(label + ': cls "' + pair[0] + '"', false, pair[1], 'row not found'); return; }
          assert(label + ': cls ' + pair[0], row.cls === pair[1], pair[1], row.cls);
        });
        (e.flags || []).forEach(function (fx) {
          const hit = res.flags.some(function (s) { return matches(s, fx); });
          assert(label + ': flag ' + fx, hit, fx, res.flags.join(' | ') || '(none)');
        });
        (e.noFlag || []).forEach(function (fx) {
          const hit = res.flags.some(function (s) { return matches(s, fx); });
          assert(label + ': no flag ' + fx, !hit, 'absent', res.flags.join(' | '));
        });
        (e.noRows || []).forEach(function (needle) {
          const all = res.rows.map(function (rw) { return rw.l + ' ' + rw.v; }).join(' | ');
          assert(label + ': must not say ' + needle, !matches(all, needle), 'absent', all);
        });
      });
    });

    /* engine-level assertions */
    assert('engine: byId unknown', C.byId('nope') === null, 'null', C.byId('nope'));
    assert('engine: run unknown id is safe', C.run('nope', {}).rows.length === 1, 1, C.run('nope', {}).rows.length);
    assert('engine: search exact id', C.search('news2').length > 0 && C.search('news2')[0].id === 'news2', 'news2', (C.search('news2')[0] || {}).id);
    assert('engine: search typo', (C.search('hyponatremia')[0] || {}).id === 'eah', 'eah', (C.search('hyponatremia')[0] || {}).id);
    assert('engine: search alias', C.search('parkland').length > 0, '>0', C.search('parkland').length);
    assert('engine: list(heat) non-empty', C.list('heat').length >= 6, '>=6', C.list('heat').length);
    assert('engine: num blank is undefined', num('') === undefined && num(null) === undefined, 'undefined', String(num('')));
    assert('engine: num zero stays zero', num(0) === 0 && num('0') === 0, 0, num('0'));
    assert('engine: cap', cap(560, 500) === 500 && cap(300, 500) === 300, '500/300', cap(560, 500) + '/' + cap(300, 500));
    assert('engine: dosing weight paed uses ABW', C.weights(20, 110, 'M', 6).dosing === 20, 20, C.weights(20, 110, 'M', 6).dosing);
    assert('engine: dosing weight obese uses AdjBW',
      rd(C.weights(110, 165, 'F', 40).dosing, 1) === 78.1, 78.1, rd(C.weights(110, 165, 'F', 40).dosing, 1));
    assert('engine: no weight -> no dosing weight', C.dosingWeight({ age: 30 }) === undefined, 'undefined', C.dosingWeight({ age: 30 }));
    assert('engine: canvas pulls last vitals',
      canvasOf({ vitals: [{ t: 1, hr: 80 }, { t: 2, hr: 120 }] }).hr === 120, 120,
      canvasOf({ vitals: [{ t: 1, hr: 80 }, { t: 2, hr: 120 }] }).hr);

    return { pass: pass, fail: fail, total: pass + fail, failures: failures };
  };

  /* ================================================================== *
   * TRIAGE & EARLY WARNING
   * ================================================================== */

  C.score({
    id: 'news2', n: 'NEWS2', c: 'triage', v: '1.0.0', max: 20,
    t: ['early warning', 'news', 'deterioration', 'sepsis', 'track and trigger'],
    ref: 'Royal College of Physicians. National Early Warning Score (NEWS) 2, 2017.',
    i: [
      N('rr', 'Respiratory rate', {
        u: '/min', min: 4, max: 60, ctx: 'rr',
        pts: function (n) { return n <= 8 ? 3 : n <= 11 ? 1 : n <= 20 ? 0 : n <= 24 ? 2 : 3; }
      }),
      S('scale', 'SpO2 target scale', [['1', 'Scale 1 (target 94-98%)', 0], ['2', 'Scale 2 (target 88-92%, CO2 retainer)', 0]], { dflt: '1' }),
      N('spo2', 'SpO2', {
        u: '%', min: 50, max: 100, ctx: 'spo2',
        pts: function (n, v) {
          if (String(v.scale) !== '2') return n >= 96 ? 0 : n >= 94 ? 1 : n >= 92 ? 2 : 3;
          if (String(v.o2) === 'o2') return n >= 97 ? 3 : n >= 95 ? 2 : n >= 93 ? 1 : n >= 88 ? 0 : n >= 86 ? 1 : n >= 84 ? 2 : 3;
          return n >= 88 ? 0 : n >= 86 ? 1 : n >= 84 ? 2 : 3;
        }
      }),
      S('o2', 'Air or supplemental oxygen', [['air', 'Air', 0], ['o2', 'Supplemental oxygen', 2]]),
      N('sbp', 'Systolic BP', {
        u: 'mmHg', min: 40, max: 300, ctx: 'sbp',
        pts: function (n) { return n <= 90 ? 3 : n <= 100 ? 2 : n <= 110 ? 1 : n <= 219 ? 0 : 3; }
      }),
      N('hr', 'Pulse', {
        u: '/min', min: 20, max: 250, ctx: 'hr',
        pts: function (n) { return n <= 40 ? 3 : n <= 50 ? 1 : n <= 90 ? 0 : n <= 110 ? 1 : n <= 130 ? 2 : 3; }
      }),
      S('loc', 'Consciousness', [['alert', 'Alert (A)', 0], ['cvpu', 'New confusion / Voice / Pain / Unresponsive', 3]]),
      N('temp', 'Temperature', {
        u: '°C', min: 25, max: 43, step: 0.1, ctx: 'temp',
        pts: function (n) { return n <= 35.0 ? 3 : n <= 36.0 ? 1 : n <= 38.0 ? 0 : n <= 39.0 ? 1 : 2; }
      })
    ],
    bands: [
      { lo: 0, hi: 0, l: 'Score 0 - routine monitoring', cls: 'ok', note: 'Routine observations, minimum 12-hourly.' },
      { lo: 1, hi: 4, l: 'Low - ward/post level', cls: 'ok', note: 'Medic to review, observations at least 4-6 hourly.' },
      { lo: 5, hi: 6, l: 'Medium - urgent review', cls: 'warn', note: 'Urgent medic review, continuous monitoring, consider transfer.' },
      { lo: 7, hi: Infinity, l: 'High - emergency response', cls: 'bad', note: 'Continuous monitoring, senior medic now, transfer to hospital by ambulance.' }
    ],
    extra: function (v, P, sc) {
      const rows = [];
      let worst = 0;
      sc.parts.forEach(function (pt) { if (pt.p > worst) worst = pt.p; });
      if (worst >= 3 && has(sc.s) && sc.s < 5) {
        P.flag('Single parameter scoring 3 - urgent review even though total is low');
        rows.push(P.row('Red score', 'One parameter scores 3 - urgent review', 'warn'));
      }
      if (has(sc.s) && sc.s >= 5) P.flag('NEWS2 >=5 - think sepsis, consider ambulance transfer');
      if (String(v.scale) === '2') rows.push(P.row('Note', 'Scale 2 selected - only for confirmed CO2 retainers', 'warn'));
      return rows;
    },
    tests: [
      {
        n: 'sick runner', i: { rr: 22, spo2: 93, scale: '1', o2: 'o2', sbp: 95, hr: 115, loc: 'alert', temp: 38.5 },
        e: { score: 11, risk: /High/, cls: [['NEWS2', 'bad']], flags: [/sepsis/] }
      },
      {
        n: 'well', i: { rr: 16, spo2: 98, scale: '1', o2: 'air', sbp: 120, hr: 70, loc: 'alert', temp: 36.8 },
        e: { score: 0, risk: /routine/, noFlag: [/sepsis/] }
      },
      {
        n: 'blank RR is not zero', i: { spo2: 98, scale: '1', o2: 'air', sbp: 120, hr: 70, loc: 'alert', temp: 36.8 },
        e: { scoreUndef: true, risk: /Incomplete/, flags: [/do NOT read as low risk/], rows: [['Unanswered', 'Respiratory rate']] }
      },
      {
        n: 'single red score', i: { rr: 16, spo2: 98, scale: '1', o2: 'air', sbp: 120, hr: 36, loc: 'alert', temp: 36.8 },
        e: { score: 3, flags: [/Single parameter scoring 3/] }
      },
      {
        n: 'scale 2 on oxygen', i: { rr: 16, spo2: 98, scale: '2', o2: 'o2', sbp: 120, hr: 70, loc: 'alert', temp: 36.8 },
        e: { score: 5 }
      },
      {
        n: 'autofill from patient vitals', i: { scale: '1', o2: 'air', loc: 'alert' },
        p: { vitals: [{ t: 1, rr: 28, spo2: 90, sbp: 85, hr: 135, temp: 34.8 }] },
        e: { score: 3 + 3 + 3 + 3 + 3, risk: /High/ }
      }
    ]
  });

  C.score({
    id: 'qsofa', n: 'qSOFA', c: 'triage', v: '1.0.0', max: 3,
    t: ['sepsis', 'quick sofa', 'infection'],
    ref: 'Singer M et al. Sepsis-3. JAMA 2016;315:801.',
    i: [
      N('rr', 'Respiratory rate', { u: '/min', min: 4, max: 60, ctx: 'rr', pts: function (n) { return n >= 22 ? 1 : 0; } }),
      N('gcs', 'GCS', { min: 3, max: 15, ctx: 'gcs', pts: function (n) { return n < 15 ? 1 : 0; } }),
      N('sbp', 'Systolic BP', { u: 'mmHg', min: 40, max: 300, ctx: 'sbp', pts: function (n) { return n <= 100 ? 1 : 0; } })
    ],
    bands: [
      { lo: 0, hi: 1, l: 'Low - qSOFA negative', cls: 'ok', note: 'Does not exclude sepsis; reassess if clinically unwell.' },
      { lo: 2, hi: 3, l: 'High - suspect sepsis', cls: 'bad', note: 'Cultures if available, antibiotics within 1 h, fluids, ambulance to hospital.' }
    ],
    extra: function (v, P, sc) {
      if (has(sc.s) && sc.s >= 2) P.flag('qSOFA >=2 - 10-fold increase in mortality, transfer now');
      return [];
    },
    tests: [
      { n: 'septic', i: { rr: 24, gcs: 13, sbp: 95 }, e: { score: 3, risk: /High/, flags: [/transfer now/] } },
      { n: 'well', i: { rr: 18, gcs: 15, sbp: 120 }, e: { score: 0, risk: /Low/ } },
      { n: 'blank SBP', i: { rr: 24, gcs: 15 }, e: { scoreUndef: true, risk: /Incomplete/ } }
    ]
  });

  C.def({
    id: 'shock-index', n: 'Shock Index (+ Age SI, Modified SI)', c: 'triage', v: '1.0.0',
    t: ['si', 'asi', 'msi', 'occult shock', 'haemorrhage', 'hemorrhage'],
    ref: 'Rady MY et al. Am J Emerg Med 1994;12:1. Zarzaur BL et al. J Trauma 2008;64:1010 (Age SI >50).',
    i: [
      N('hr', 'Heart rate', { u: '/min', min: 20, max: 250, ctx: 'hr' }),
      N('sbp', 'Systolic BP', { u: 'mmHg', min: 40, max: 300, ctx: 'sbp' }),
      N('dbp', 'Diastolic BP', { u: 'mmHg', min: 20, max: 200, ctx: 'dbp', opt: true }),
      N('age', 'Age', { u: 'years', min: 0, max: 110, ctx: 'age', opt: true })
    ],
    out: function (v, P) {
      const rows = [];
      if (!has(v.hr) || !has(v.sbp) || v.sbp <= 0) {
        rows.push(P.row('Shock index', 'Enter heart rate and systolic BP', 'warn'));
        P.flag('Heart rate and systolic BP required - a blank index is not a normal index');
        return { rows: rows, risk: 'Incomplete' };
      }
      const si = v.hr / v.sbp;
      let cls = '', risk = '';
      if (si < 0.5) { cls = 'warn'; risk = 'Low index - check cuff and rate'; }
      else if (si < 0.7) { cls = 'ok'; risk = 'Normal (0.5-0.7)'; }
      else if (si < 0.9) { cls = 'warn'; risk = 'Elevated - early compensation'; }
      else if (si < 1.3) { cls = 'bad'; risk = 'Significant - occult hypoperfusion'; }
      else { cls = 'bad'; risk = 'Critical - active haemorrhage or profound shock'; }
      rows.push(P.row('Shock index (HR/SBP)', f(si, 2), cls));
      rows.push(P.row('Interpretation', risk, cls));
      if (si >= 0.9) P.flag('Shock index >=0.9 - occult hypoperfusion, large-bore access and fluids');
      if (si >= 1.3) P.flag('Shock index >=1.3 - activate transfer and haemorrhage control now');

      if (has(v.dbp)) {
        const map = (v.sbp + 2 * v.dbp) / 3;
        const msi = v.hr / map;
        let mcls = 'ok', mint = 'Normal (0.7-1.3)';
        if (msi < 0.7) { mcls = 'warn'; mint = 'Low - hypodynamic, reduced stroke volume'; }
        else if (msi > 1.3) { mcls = 'bad'; mint = 'High - hypovolaemic / hyperdynamic'; }
        rows.push(P.row('MAP', f(map, 1) + ' mmHg', map < 65 ? 'bad' : ''));
        rows.push(P.row('Modified SI (HR/MAP)', f(msi, 2) + ' - ' + mint, mcls));
      }
      if (has(v.age)) {
        const asi = si * v.age;
        const acls = asi >= 50 ? 'bad' : '';
        rows.push(P.row('Age shock index (SI x age)', f(asi, 1), acls));
        if (asi >= 50) P.flag('Age shock index >50 - high mortality band, treat as major trauma');
      } else {
        rows.push(P.row('Age shock index', 'Enter age', 'warn'));
      }
      rows.push(P.row('Caveat', 'Beta-blockers, fitness and pregnancy blunt the index; pain and fear raise it.', ''));
      return { rows: rows, score: rd(si, 2), risk: risk };
    },
    tests: [
      {
        n: 'bleeding runner', i: { hr: 120, sbp: 90, dbp: 60, age: 40 },
        e: {
          score: 1.33, risk: /Critical/,
          rows: [['Shock index (HR/SBP)', '1.33'], ['Age shock index (SI', '53.3'], ['MAP', '70'], ['Modified SI', '1.71']],
          flags: [/>=1.3/, />50/]
        }
      },
      { n: 'normal', i: { hr: 70, sbp: 120 }, e: { score: 0.58, risk: /Normal/, noFlag: [/occult/] } },
      { n: 'blank is not normal', i: { hr: 120 }, e: { risk: /Incomplete/, flags: [/not a normal index/] } }
    ]
  });

  C.def({
    id: 'map', n: 'MAP & pulse pressure', c: 'triage', v: '1.0.0',
    t: ['mean arterial pressure', 'perfusion pressure', 'pulse pressure'],
    ref: 'Standard haemodynamics: MAP = (SBP + 2xDBP)/3. Surviving Sepsis Campaign 2021 (MAP target >=65).',
    i: [
      N('sbp', 'Systolic BP', { u: 'mmHg', min: 40, max: 300, ctx: 'sbp' }),
      N('dbp', 'Diastolic BP', { u: 'mmHg', min: 20, max: 200, ctx: 'dbp' })
    ],
    out: function (v, P) {
      if (!has(v.sbp) || !has(v.dbp)) {
        P.flag('Both pressures required');
        return { rows: [P.row('MAP', 'Enter systolic and diastolic BP', 'warn')], risk: 'Incomplete' };
      }
      const map = (v.sbp + 2 * v.dbp) / 3;
      const pp = v.sbp - v.dbp;
      const rows = [];
      let cls = 'ok', risk = 'Adequate perfusion pressure';
      if (map < 60) { cls = 'bad'; risk = 'MAP <60 - critical hypoperfusion'; }
      else if (map < 65) { cls = 'bad'; risk = 'MAP <65 - below organ perfusion target'; }
      else if (map > 110) { cls = 'warn'; risk = 'MAP >110 - hypertensive, look for cause'; }
      rows.push(P.row('MAP', f(map, 1) + ' mmHg', cls));
      rows.push(P.row('Pulse pressure', f(pp, 0) + ' mmHg', pp < 25 ? 'warn' : ''));
      rows.push(P.row('Interpretation', risk, cls));
      if (map < 65) P.flag('MAP <65 mmHg - fluids and/or vasopressor, reassess in 5 min');
      if (pp < 25) P.flag('Narrow pulse pressure - early hypovolaemia or tamponade');
      if (pp > 60 && v.sbp > 140) P.flag('Wide pulse pressure - consider aortic regurgitation or thyrotoxicosis');
      rows.push(P.row('Vasopressor', 'Norepinephrine (Vascon) 4 mg/50 mL, start 0.05-0.1 mcg/kg/min - see infusion tool', ''));
      return { rows: rows, score: rd(map, 1), risk: risk };
    },
    tests: [
      { n: 'normal', i: { sbp: 120, dbp: 80 }, e: { score: 93.3, rows: [['MAP', '93.3'], ['Pulse pressure', '40']], risk: /Adequate/ } },
      { n: 'shocked', i: { sbp: 85, dbp: 45 }, e: { score: 58.3, risk: /<60/, flags: [/MAP <65/] } },
      { n: 'narrow pp', i: { sbp: 100, dbp: 85 }, e: { flags: [/Narrow pulse pressure/] } },
      { n: 'blank', i: { sbp: 120 }, e: { risk: /Incomplete/ } }
    ]
  });

  C.score({
    id: 'gcs', n: 'Glasgow Coma Scale', c: 'triage', v: '1.0.0', max: 15,
    t: ['gcs', 'consciousness', 'coma', 'head injury', 'avpu'],
    ref: 'Teasdale G, Jennett B. Lancet 1974;2:81. Teasdale et al. structured approach 2014.',
    i: [
      S('e', 'Eye opening', [[4, 'Spontaneous'], [3, 'To speech'], [2, 'To pressure'], [1, 'None'], ['NT', 'Not testable (swelling)', 1]]),
      S('vb', 'Verbal response', [[5, 'Orientated'], [4, 'Confused'], [3, 'Words only'], [2, 'Sounds only'], [1, 'None'], ['T', 'Intubated / tracheostomy', 1]]),
      S('m', 'Best motor response', [[6, 'Obeys commands'], [5, 'Localises to pressure'], [4, 'Normal flexion (withdraws)'], [3, 'Abnormal flexion'], [2, 'Extension'], [1, 'None']])
    ],
    bands: [
      { lo: 15, hi: 15, l: 'Normal (15)', cls: 'ok', note: 'No impairment of consciousness.' },
      { lo: 13, hi: 14, l: 'Mild impairment (13-14)', cls: 'warn', note: 'Minor head injury pathway; apply Canadian CT Head Rule.' },
      { lo: 9, hi: 12, l: 'Moderate (9-12)', cls: 'bad', note: 'Continuous monitoring, airway watch, ambulance transfer.' },
      { lo: 3, hi: 8, l: 'Severe (<=8)', cls: 'bad', note: 'Secure the airway, RSI if trained, immediate transfer.' }
    ],
    extra: function (v, P, sc) {
      const rows = [];
      if (String(v.vb) === 'T') { rows.push(P.row('Report as', String(sc.s) + 'T (verbal not assessable)', 'warn')); P.flag('Verbal component not testable - report the score with a T suffix'); }
      if (String(v.e) === 'NT') P.flag('Eye component not testable - record NT, do not score as 1 without saying so');
      if (has(sc.s) && sc.s <= 8) P.flag('GCS <=8 - definitive airway, do not delay transfer');
      if (has(sc.s) && sc.s < 15) P.flag('Altered mental status in a collapsed athlete: check glucose, sodium and rectal temperature before anything else');
      return rows;
    },
    tests: [
      { n: 'normal', i: { e: 4, vb: 5, m: 6 }, e: { score: 15, risk: /Normal/, noFlag: [/definitive airway/] } },
      { n: 'moderate', i: { e: 3, vb: 4, m: 5 }, e: { score: 12, risk: /Moderate/, flags: [/collapsed athlete/] } },
      { n: 'severe', i: { e: 1, vb: 1, m: 1 }, e: { score: 3, risk: /Severe/, flags: [/definitive airway/] } },
      { n: 'intubated', i: { e: 1, vb: 'T', m: 4 }, e: { score: 6, rows: [['Report as', '6T']] } },
      { n: 'blank motor', i: { e: 4, vb: 5 }, e: { scoreUndef: true, risk: /Incomplete/ } }
    ]
  });

  C.score({
    id: 'pews', n: 'Paediatric Early Warning Score (Brighton)', c: 'triage', v: '1.0.0', max: 13,
    t: ['pews', 'paediatric', 'pediatric', 'child', 'deterioration'],
    ref: 'Monaghan A. Detecting and managing deterioration in children. Paediatr Nurs 2005;17:32 (Brighton PEWS).',
    i: [
      S('beh', 'Behaviour', [
        [0, 'Playing / appropriate'],
        [1, 'Sleeping'],
        [2, 'Irritable'],
        [3, 'Lethargic, confused, or reduced response to pain']
      ]),
      S('cv', 'Cardiovascular', [
        [0, 'Pink, or capillary refill 1-2 s'],
        [1, 'Pale, or capillary refill 3 s'],
        [2, 'Grey, or refill 4 s, or tachycardia +20 above normal'],
        [3, 'Grey and mottled, or refill >=5 s, or tachycardia +30 above normal, or bradycardia']
      ]),
      S('resp', 'Respiratory', [
        [0, 'Normal rate, no recession'],
        [1, '>10 above normal rate, accessory muscles, or FiO2 >=30% / 3 L/min'],
        [2, '>20 above normal rate, recession or tracheal tug, or FiO2 >=40% / 6 L/min'],
        [3, '>=5 below normal rate with recession or grunting, or FiO2 >=50% / 8 L/min']
      ]),
      YN('neb', 'Nebulisers more often than every 15 min', 2),
      YN('vom', 'Persistent vomiting after surgery', 2)
    ],
    bands: [
      { lo: 0, hi: 0, l: 'Routine', cls: 'ok', note: 'Routine observations.' },
      { lo: 1, hi: 2, l: 'Increase observations', cls: 'ok', note: 'Repeat observations within 1 h; tell the post lead.' },
      { lo: 3, hi: 3, l: 'Urgent review', cls: 'warn', note: 'Medic review within 15 min, continuous monitoring.' },
      { lo: 4, hi: 6, l: 'Immediate medic review', cls: 'bad', note: 'Senior medic now, prepare for ambulance transfer.' },
      { lo: 7, hi: Infinity, l: 'Critical', cls: 'bad', note: 'Resuscitation team, transfer to a paediatric-capable hospital.' }
    ],
    extra: function (v, P, sc) {
      if (has(sc.s) && sc.s >= 4) P.flag('PEWS >=4 - escalate now and arrange paediatric transfer');
      P.flag('PEWS needs age-specific normal ranges - confirm the child’s normal HR/RR band before scoring');
      return [];
    },
    tests: [
      { n: 'well child', i: { beh: 0, cv: 0, resp: 0, neb: 'n', vom: 'n' }, e: { score: 0, risk: /Routine/ } },
      { n: 'escalate', i: { beh: 1, cv: 1, resp: 2, neb: 'n', vom: 'n' }, e: { score: 4, risk: /Immediate/, flags: [/escalate now/] } },
      { n: 'max', i: { beh: 3, cv: 3, resp: 3, neb: 'y', vom: 'y' }, e: { score: 13, risk: /Critical/ } },
      { n: 'unanswered nebuliser', i: { beh: 1, cv: 1, resp: 1 }, e: { scoreUndef: true, risk: /Incomplete/, flags: [/do NOT read as low risk/] } }
    ]
  });

  /* ================================================================== *
   * HEAT & EXERTIONAL  — the event-medicine core
   * ================================================================== */

  /* Cooling rates, deg C per minute. CWI is the only one I treat as solid. */
  const COOL_RATES = {
    cwi:    { l: 'Cold-water immersion (1-15 C, tub)', mid: 0.20, lo: 0.15, hi: 0.35, solid: true },
    tarp:   { l: 'Tarp-assisted cooling with oscillation', mid: 0.15, lo: 0.11, hi: 0.20, solid: false },
    sheets: { l: 'Rotating iced sheets / towels', mid: 0.10, lo: 0.06, hi: 0.14, solid: false },
    evap:   { l: 'Evaporative (mist + high-flow fan)', mid: 0.06, lo: 0.04, hi: 0.09, solid: false },
    packs:  { l: 'Ice packs to neck, axillae, groin only', mid: 0.04, lo: 0.02, hi: 0.06, solid: false },
    ivf:    { l: 'Cold IV fluid alone', mid: 0.03, lo: 0.02, hi: 0.05, solid: false }
  };
  C.COOL_RATES = COOL_RATES;
  const COOL_TARGET = 38.6; /* stop active cooling here to avoid overshoot */

  C.def({
    id: 'heat-illness', n: 'Heat illness severity', c: 'heat', v: '1.0.0',
    t: ['heat stroke', 'heat exhaustion', 'hyperthermia', 'ehs', 'collapse', 'ice bath', 'cramps', 'syncope'],
    ref: 'Casa DJ et al. NATA Position Statement: Exertional Heat Illnesses. J Athl Train 2015;50:986. ACSM Position Stand, Med Sci Sports Exerc 2007;39:556.',
    i: [
      H('Rectal temperature is the only field-valid core measurement. Tympanic, oral, axillary and temporal readings cannot exclude heat stroke.'),
      N('temp', 'Core temperature', { u: '°C', min: 25, max: 45, step: 0.1, ctx: 'temp' }),
      S('site', 'Measurement site', [
        ['rectal', 'Rectal'], ['oesoph', 'Oesophageal'], ['tymp', 'Tympanic'],
        ['oral', 'Oral'], ['axilla', 'Axillary'], ['temporal', 'Temporal artery / forehead']
      ], { dflt: 'rectal' }),
      S('cns', 'CNS status', [
        ['normal', 'Normal, orientated'],
        ['mild', 'Irritable, mildly confused, odd behaviour'],
        ['marked', 'Marked confusion, agitation, combative'],
        ['seizure', 'Seizure'],
        ['coma', 'Unresponsive']
      ]),
      YN('exertional', 'Collapsed during or just after exertion'),
      S('skin', 'Skin', [['sweating', 'Sweating'], ['dry', 'Hot and dry (anhidrotic)'], ['unk', 'Not recorded']], { dflt: 'unk', opt: true }),
      YN('cramps', 'Painful muscle cramps', 0, { opt: true }),
      N('collapseMin', 'Minutes since collapse', { u: 'min', min: 0, max: 600, opt: true })
    ],
    out: function (v, P) {
      const rows = [];
      const cns = v.cns;
      const cnsAbnormal = has(cns) && cns !== 'normal';
      const siteOk = v.site === 'rectal' || v.site === 'oesoph';

      if (!siteOk && has(v.site)) {
        P.flag('Non-core site (' + v.site + ') underestimates true core temperature by 1-2 C - get a rectal reading before excluding heat stroke');
      }

      if (!has(v.temp)) {
        rows.push(P.row('Classification', 'Cannot classify - core temperature required', 'bad'));
        P.flag('Rectal core temperature required - an unmeasured temperature is NOT a normal temperature');
        if (cnsAbnormal) {
          rows.push(P.row('Act now', 'Altered mental status after exertion: start cooling, check glucose and sodium, call for transfer', 'bad'));
          P.flag('Altered mental status after exertion - treat as exertional heat stroke until a rectal temperature says otherwise');
        }
        return { rows: rows, risk: 'Incomplete' };
      }

      const t = v.temp;
      let cls = '', label = '', risk = '';
      const heatStroke = cnsAbnormal && t >= 40.0;

      if (heatStroke) {
        label = (v.exertional === true ? 'Exertional heat stroke' : 'Heat stroke (classic)');
        cls = 'bad';
        P.flag('HEAT STROKE - cool first, transport second. Target rectal 38.6 C.');
      } else if (t >= 40.0) {
        label = 'Heat injury - core >=40 C without CNS dysfunction';
        cls = 'bad';
        P.flag('Core >=40 C - begin active cooling now and recheck CNS every 2 minutes');
      } else if (cnsAbnormal) {
        label = 'CNS dysfunction WITHOUT hyperthermia';
        cls = 'bad';
        P.flag('Altered mental status with core <40 C - exclude hyponatraemia (EAH), hypoglycaemia, head injury and drugs BEFORE calling this heat exhaustion');
      } else if (t >= 38.5) {
        label = 'Heat exhaustion';
        cls = 'warn';
      } else if (v.cramps === true) {
        label = 'Heat cramps';
        cls = 'warn';
      } else {
        label = 'No heat illness by temperature and CNS criteria';
        cls = 'ok';
      }
      risk = label;

      rows.push(P.row('Classification', label, cls));
      rows.push(P.row('Core temperature', f(t, 1) + ' °C (' + f(t * 9 / 5 + 32, 1) + ' °F) ' + (siteOk ? 'core site' : 'NON-core site'), t >= 40 ? 'bad' : (t >= 38.5 ? 'warn' : '')));

      const coolNeeded = t >= 38.6;
      rows.push(P.row('Active cooling', coolNeeded ? 'Indicated - cold-water immersion is first line' : 'Not indicated at this temperature', coolNeeded ? 'bad' : 'ok'));
      if (coolNeeded) {
        const dT = t - COOL_TARGET;
        rows.push(P.row('Stop-cooling target', f(COOL_TARGET, 1) + ' °C rectal (stop here, overshoot causes rebound hypothermia)', 'warn'));
        rows.push(P.row('Degrees to remove', f(dT, 1) + ' °C', ''));
        rows.push(P.row('Estimated immersion time', f(dT / COOL_RATES.cwi.mid, 1) + ' min at 0.20 °C/min (range ' + f(dT / COOL_RATES.cwi.hi, 1) + '-' + f(dT / COOL_RATES.cwi.lo, 1) + ' min)', ''));
      }

      if (heatStroke) {
        rows.push(P.row('Golden window', 'Cool below 40 °C within 30 minutes of collapse - survival approaches 100% when this is met', 'bad'));
        if (has(v.collapseMin)) {
          const left = 30 - v.collapseMin;
          rows.push(P.row('Window remaining', left > 0 ? f(left, 0) + ' min' : 'EXCEEDED by ' + f(-left, 0) + ' min', left > 0 ? 'warn' : 'bad'));
          if (left <= 0) P.flag('30-minute cooling window exceeded - continue cooling en route, expect multi-organ injury');
        } else {
          rows.push(P.row('Window remaining', 'Enter minutes since collapse', 'warn'));
        }
        rows.push(P.row('Airway/circulation', 'Protect airway, high-flow O2, IV access x2, monitor ECG; do not delay cooling for cannulation', 'bad'));
        rows.push(P.row('Do not give', 'Antipyretics (paracetamol, ibuprofen) do not work in heat stroke and add hepatotoxicity', 'bad'));
        P.flag('Check glucose and point-of-care sodium in every collapsed athlete with altered mental status');
        P.flag('Send for rhabdomyolysis screen - CK, K, creatinine - after cooling');
      }
      if (v.skin === 'dry') rows.push(P.row('Skin', 'Anhidrosis is a late sign - a sweating patient can still have heat stroke', 'warn'));
      if (v.cramps === true) rows.push(P.row('Cramps', 'Oral salty fluid or 0.9% NaCl; passive stretch. Cramps alone are not heat stroke.', ''));

      return { rows: rows, score: rd(t, 1), risk: risk };
    },
    tests: [
      {
        n: 'exertional heat stroke', i: { temp: 41.2, site: 'rectal', cns: 'coma', exertional: 'y', collapseMin: 10 },
        e: {
          risk: /Exertional heat stroke/,
          rows: [['Degrees to remove', '2.6'], ['Estimated immersion time', '13'], ['Window remaining', '20'], ['Stop-cooling target', '38.6']],
          flags: [/HEAT STROKE/, /rhabdomyolysis/, /glucose and point-of-care sodium/]
        }
      },
      {
        n: 'heat exhaustion', i: { temp: 39.2, site: 'rectal', cns: 'normal', exertional: 'y' },
        e: { risk: /Heat exhaustion/, rows: [['Active cooling', 'Indicated']], noFlag: [/HEAT STROKE/] }
      },
      {
        n: 'altered but not hot - the EAH trap', i: { temp: 38.2, site: 'rectal', cns: 'marked', exertional: 'y' },
        e: { risk: /WITHOUT hyperthermia/, flags: [/exclude hyponatraemia/] }
      },
      {
        n: 'no temperature is not a normal temperature', i: { site: 'tymp', cns: 'marked', exertional: 'y' },
        e: { risk: /Incomplete/, flags: [/NOT a normal temperature/, /until a rectal temperature/], noRows: [/low risk/] }
      },
      {
        n: 'tympanic cannot exclude', i: { temp: 38.9, site: 'tymp', cns: 'normal', exertional: 'y' },
        e: { flags: [/underestimates true core/] }
      },
      {
        n: 'window exceeded', i: { temp: 40.8, site: 'rectal', cns: 'seizure', exertional: 'y', collapseMin: 45 },
        e: { rows: [['Window remaining', 'EXCEEDED by 15']], flags: [/window exceeded/] }
      }
    ]
  });

  C.def({
    id: 'ehs-cooling', n: 'Exertional heat stroke cooling target', c: 'heat', v: '1.0.0',
    verify: true,
    verifyNote: 'cooling rates for methods other than cold-water immersion are literature estimates; CWI rate, the 38.6 C stop target and the 30-minute window are well established',
    t: ['cooling', 'ice bath', 'immersion', 'cwi', 'tarp', 'ehs', 'heat stroke'],
    ref: 'Casa DJ et al. Exerc Sport Sci Rev 2007;35:141 (CWI gold standard). McDermott BP et al. J Athl Train 2009;44:84 (cooling rates). NATA 2015.',
    i: [
      N('temp', 'Current rectal temperature', { u: '°C', min: 30, max: 45, step: 0.1, ctx: 'temp' }),
      S('method', 'Cooling method available', [
        ['cwi', 'Cold-water immersion (1-15 C tub)'],
        ['tarp', 'Tarp-assisted cooling with oscillation'],
        ['sheets', 'Rotating iced sheets / towels'],
        ['evap', 'Evaporative (mist + fan)'],
        ['packs', 'Ice packs to neck, axillae, groin'],
        ['ivf', 'Cold IV fluid only']
      ], { dflt: 'cwi' }),
      N('collapseMin', 'Minutes since collapse', { u: 'min', min: 0, max: 600, opt: true }),
      N('target', 'Stop-cooling target', { u: '°C', min: 37, max: 39.5, step: 0.1, dflt: COOL_TARGET, opt: true })
    ],
    out: function (v, P) {
      const rows = [];
      if (!has(v.temp)) {
        P.flag('Rectal temperature required - cooling cannot be titrated blind');
        return { rows: [P.row('Cooling plan', 'Enter the current rectal temperature', 'bad')], risk: 'Incomplete' };
      }
      const target = has(v.target) ? v.target : COOL_TARGET;
      const m = COOL_RATES[v.method] || COOL_RATES.cwi;
      const dT = v.temp - target;

      rows.push(P.row('Current / target', f(v.temp, 1) + ' °C -> ' + f(target, 1) + ' °C', v.temp >= 40 ? 'bad' : 'warn'));

      if (dT <= 0) {
        rows.push(P.row('Cooling plan', 'STOP active cooling - at or below target', 'ok'));
        P.flag('Stop active cooling now - continuing past 38.6 C causes rebound hypothermia and shivering');
        rows.push(P.row('Next', 'Dry the patient, passive monitoring, rectal temperature every 10 min for 30 min (rebound is common)', ''));
        return { rows: rows, score: 0, risk: 'At target - stop cooling' };
      }

      rows.push(P.row('Method', m.l + (m.solid ? '' : ' (rate is an estimate)'), m.solid ? 'ok' : 'warn'));
      rows.push(P.row('Degrees to remove', f(dT, 1) + ' °C', ''));
      const minMid = dT / m.mid, minFast = dT / m.hi, minSlow = dT / m.lo;
      rows.push(P.row('Estimated time', f(minMid, 1) + ' min at ' + f(m.mid, 2) + ' °C/min (range ' + f(minFast, 1) + '-' + f(minSlow, 1) + ' min)', minMid > 30 ? 'bad' : ''));
      rows.push(P.row('Assumed rate', f(m.mid, 2) + ' °C/min', ''));

      if (!m.solid) P.flag('Cooling rate for this method is an estimate - escalate to cold-water immersion if available');
      if (minMid > 30) P.flag('This method will not cool fast enough - move to cold-water immersion or tarp-assisted cooling now');

      if (has(v.collapseMin)) {
        const finishAt = v.collapseMin + minMid;
        rows.push(P.row('Projected total time from collapse', f(finishAt, 0) + ' min', finishAt > 30 ? 'bad' : 'ok'));
        if (finishAt > 30) P.flag('Projected cooling finishes after the 30-minute window - increase cooling intensity');
      }

      rows.push(P.row('Technique', 'Torso and limbs immersed, head and airway supported out of the water, one person on the airway at all times', ''));
      rows.push(P.row('Monitoring', 'Continuous rectal probe if available, otherwise recheck every 5 min. Never use tympanic to guide cooling.', 'warn'));
      rows.push(P.row('Shivering', 'Expected and acceptable; do not stop cooling for shivering. Midazolam only if it obstructs cooling.', ''));
      rows.push(P.row('Sequence', 'Cool first, transport second - do not interrupt immersion to load the ambulance unless the airway is unsafe', 'bad'));
      rows.push(P.row('Fluids', '0.9% NaCl or Ringer lactate IV, titrated. Check sodium before volume loading a collapsed endurance athlete.', ''));
      return { rows: rows, score: rd(minMid, 1), risk: 'Cooling required' };
    },
    tests: [
      {
        n: 'immersion plan', i: { temp: 41.5, method: 'cwi' },
        e: { score: 14.5, rows: [['Degrees to remove', '2.9'], ['Estimated time', '14.5'], ['Assumed rate', '0.2']] }
      },
      {
        n: 'ice packs are too slow', i: { temp: 41.5, method: 'packs' },
        e: { score: 72.5, flags: [/will not cool fast enough/, /is an estimate/] }
      },
      {
        n: 'at target - stop', i: { temp: 38.4, method: 'cwi' },
        e: { score: 0, risk: /stop cooling/, flags: [/rebound hypothermia/] }
      },
      {
        n: 'window projection', i: { temp: 41.0, method: 'cwi', collapseMin: 25 },
        e: { rows: [['Projected total time', '37']], flags: [/after the 30-minute window/] }
      },
      { n: 'no temperature', i: { method: 'cwi' }, e: { risk: /Incomplete/, flags: [/cannot be titrated blind/] } }
    ]
  });

  C.def({
    id: 'eah', n: 'Exercise-associated hyponatraemia (EAH)', c: 'heat', v: '1.0.0',
    t: ['hyponatremia', 'hyponatraemia', 'sodium', 'hypertonic saline', '3%', 'water intoxication', 'marathon collapse', 'eahe'],
    ref: 'Hew-Butler T et al. 3rd International Exercise-Associated Hyponatremia Consensus, Carlsbad 2015. Clin J Sport Med 2015;25:303. Adrogue-Madias, NEJM 2000;342:1581.',
    i: [
      H('EAH is the commonest cause of death in marathon runners after cardiac arrest. Never volume-load a collapsed endurance athlete before you know the sodium.'),
      N('na', 'Serum / point-of-care sodium', { u: 'mmol/L', min: 100, max: 175, step: 1 }),
      S('sx', 'Neurological picture', [
        ['none', 'Asymptomatic'],
        ['mild', 'Headache, nausea, bloating, light-headedness'],
        ['vomit', 'Repeated vomiting'],
        ['confusion', 'Confusion, agitation, disorientation'],
        ['seizure', 'Seizure'],
        ['coma', 'Obtundation / unresponsive'],
        ['resp', 'Respiratory distress / pulmonary oedema']
      ]),
      N('wt', 'Current weight', { u: 'kg', min: 2, max: 250, step: 0.1, ctx: 'weight' }),
      N('dWt', 'Weight change during the event (+ gain, - loss)', { u: 'kg', min: -15, max: 15, step: 0.1, opt: true }),
      N('hours', 'Hours of activity', { u: 'h', min: 0, max: 48, step: 0.5, opt: true }),
      S('sex', 'Sex', [['M', 'Male'], ['F', 'Female']], { ctx: 'sex', opt: true })
    ],
    out: function (v, P) {
      const rows = [];
      const sx = v.sx;
      const encephalopathy = ['vomit', 'confusion', 'seizure', 'coma', 'resp'].indexOf(sx) >= 0;
      const anySx = has(sx) && sx !== 'none';
      const gain = has(v.dWt) && v.dWt > 0;

      P.flag('Give NO hypotonic and NO isotonic IV fluid to a collapsed endurance athlete until the sodium is known');
      P.flag('3% NaCl is not in the default event formulary - confirm stock before every endurance event');

      let sev = 'Unknown - sodium not measured', cls = 'warn', risk = sev;
      if (has(v.na)) {
        if (v.na >= 135) { sev = 'Not hyponatraemic (Na >=135)'; cls = 'ok'; }
        else if (v.na >= 130) { sev = 'Mild EAH (130-134)'; cls = 'warn'; }
        else if (v.na >= 125) { sev = 'Moderate EAH (125-129)'; cls = 'bad'; }
        else { sev = 'Severe EAH (<125)'; cls = 'bad'; }
        risk = sev;
        rows.push(P.row('Sodium', f(v.na, 0) + ' mmol/L', cls));
      } else {
        rows.push(P.row('Sodium', 'Not measured', 'bad'));
        P.flag('Point-of-care sodium is required to diagnose EAH - an i-STAT or equivalent belongs at every endurance event');
      }
      rows.push(P.row('Biochemical severity', sev, cls));
      rows.push(P.row('Encephalopathy (EAHE)', encephalopathy ? 'YES - ' + sx : (anySx ? 'Mild symptoms only' : 'No'), encephalopathy ? 'bad' : (anySx ? 'warn' : 'ok')));

      if (has(v.dWt)) {
        rows.push(P.row('Weight change', (v.dWt > 0 ? '+' : '') + f(v.dWt, 1) + ' kg', gain ? 'bad' : ''));
        if (gain) P.flag('Weight GAIN during the event - fluid overload, stop all oral and IV fluid');
      } else {
        rows.push(P.row('Weight change', 'Enter pre-race and current weight if known', 'warn'));
      }

      /* treatment */
      const treat = encephalopathy || (has(v.na) && v.na < 125) ||
        (!has(v.na) && encephalopathy);
      const paed = has(P.age) && P.age < 18;
      let bolusTxt;
      if (!has(v.wt)) {
        bolusTxt = 'Enter weight (adult default is 100 mL, but weight is needed to confirm the paediatric 2 mL/kg dose)';
        P.flag('Weight missing - hypertonic saline volume not calculated');
      } else {
        const perKg = 2 * v.wt;
        const bolus = cap(perKg, 100);
        bolusTxt = f(bolus, 0) + ' mL of 3% NaCl IV over 10 min (2 mL/kg, capped at the adult 100 mL dose)';
        if (perKg > 100) bolusTxt += ' [capped from ' + f(perKg, 0) + ' mL]';
      }

      if (treat) {
        rows.push(P.row('3% NaCl bolus', bolusTxt, 'bad'));
        rows.push(P.row('Repeat', 'May repeat up to 3 boluses total (max 300 mL adult) at 10-minute intervals until neurological improvement', 'bad'));
        rows.push(P.row('Goal', 'Acute rise of 4-6 mmol/L reverses cerebral oedema. Do not exceed 8-10 mmol/L in 24 h.', 'warn'));
        P.flag('Treat EAH encephalopathy with hypertonic saline - do NOT wait for hospital confirmation');
      } else if (has(v.na) && v.na < 135) {
        rows.push(P.row('3% NaCl bolus', 'Not indicated - mild/moderate EAH without encephalopathy', 'ok'));
        rows.push(P.row('Management', 'Fluid restriction, observe until spontaneous diuresis. Oral hypertonic solution (concentrated broth) if alert and swallowing.', 'warn'));
      } else if (!has(v.na) && anySx) {
        rows.push(P.row('3% NaCl bolus', 'Consider empirically if EAH encephalopathy is suspected and point-of-care sodium is unavailable: ' + bolusTxt, 'warn'));
      } else {
        rows.push(P.row('3% NaCl bolus', 'Not indicated on the information entered', 'ok'));
      }

      /* Adrogue-Madias estimate of the rise from one 100 mL bolus */
      if (has(v.na) && has(v.wt)) {
        const W = C.weights(v.wt, P.ht, v.sex || P.sex, P.age);
        const volL = has(v.wt) ? Math.min(2 * v.wt, 100) / 1000 : 0.1;
        const dNa = volL * (513 - v.na) / (W.tbw + volL);
        rows.push(P.row('Estimated rise per bolus (Adrogue-Madias)', f(dNa, 1) + ' mmol/L (TBW ' + f(W.tbw, 1) + ' L)', ''));
        rows.push(P.row('Observed clinical effect', 'Published experience is a rise of about 2 mmol/L per 100 mL bolus - faster than the formula predicts', ''));
      }

      rows.push(P.row('Never', 'No hypotonic fluid, no isotonic volume loading, no loop diuretics', 'bad'));
      rows.push(P.row('Disposition', 'Any EAH with symptoms: ambulance to hospital with repeat sodium. Asymptomatic mild: observe on site until passing urine.', 'warn'));
      rows.push(P.row('Differential', 'Also exclude hypoglycaemia, exertional heat stroke (rectal temp) and head injury in every collapsed athlete', ''));
      return { rows: rows, score: has(v.na) ? v.na : undefined, risk: risk };
    },
    tests: [
      {
        n: 'seizing runner', i: { na: 128, sx: 'seizure', wt: 70, dWt: 1.5, sex: 'M' }, p: { age: 35, sex: 'M' },
        e: {
          score: 128, risk: /Moderate EAH/,
          rows: [['3% NaCl bolus', '100 mL'], ['Estimated rise per bolus', '0.9'], ['Repeat', '300 mL'], ['Weight change', '+1.5']],
          flags: [/NO hypotonic/, /Weight GAIN/, /do NOT wait for hospital/]
        }
      },
      {
        n: 'mild asymptomatic', i: { na: 132, sx: 'none', wt: 65 },
        e: { risk: /Mild EAH/, rows: [['3% NaCl bolus', 'Not indicated'], ['Management', 'Fluid restriction']] }
      },
      {
        n: 'paediatric dose 2 mL/kg', i: { na: 124, sx: 'seizure', wt: 20 }, p: { age: 9 },
        e: { risk: /Severe EAH/, rows: [['3% NaCl bolus', '40 mL']] }
      },
      {
        n: 'no sodium available', i: { sx: 'confusion', wt: 70, dWt: 2.0 },
        e: { risk: /Unknown/, flags: [/Point-of-care sodium is required/], rows: [['3% NaCl bolus', '100 mL']] }
      },
      {
        n: 'weight missing blocks the dose', i: { na: 120, sx: 'coma' },
        e: { rows: [['3% NaCl bolus', 'Enter weight']], flags: [/Weight missing/] }
      },
      { n: 'normal sodium', i: { na: 140, sx: 'none', wt: 70 }, e: { risk: /Not hyponatraemic/ } }
    ]
  });

  C.def({
    id: 'sweat-rate', n: 'Sweat rate & fluid deficit', c: 'heat', v: '1.0.0',
    t: ['hydration', 'dehydration', 'fluid deficit', 'weight loss', 'rehydration', 'body mass'],
    ref: 'Sawka MN et al. ACSM Position Stand: Exercise and Fluid Replacement. Med Sci Sports Exerc 2007;39:377.',
    i: [
      N('pre', 'Pre-event weight', { u: 'kg', min: 2, max: 250, step: 0.1 }),
      N('post', 'Post-event weight', { u: 'kg', min: 2, max: 250, step: 0.1, ctx: 'weight' }),
      N('intake', 'Fluid drunk during event', { u: 'L', min: 0, max: 20, step: 0.1, opt: true }),
      N('urine', 'Urine passed during event', { u: 'L', min: 0, max: 5, step: 0.1, opt: true }),
      N('hours', 'Duration of activity', { u: 'h', min: 0.1, max: 48, step: 0.1 })
    ],
    out: function (v, P) {
      const rows = [];
      if (!has(v.pre) || !has(v.post)) {
        P.flag('Pre and post weights required - a missing weight is not a zero deficit');
        return { rows: [P.row('Fluid deficit', 'Enter pre-event and post-event weight', 'warn')], risk: 'Incomplete' };
      }
      const dMass = v.post - v.pre;             /* negative = loss */
      const pct = (dMass / v.pre) * 100;
      const intake = has(v.intake) ? v.intake : 0;
      const urine = has(v.urine) ? v.urine : 0;
      const sweat = (-dMass) + intake - urine;  /* litres, 1 kg ~ 1 L */

      rows.push(P.row('Body mass change', (dMass > 0 ? '+' : '') + f(dMass, 2) + ' kg', dMass > 0 ? 'bad' : ''));
      rows.push(P.row('% body mass change', (pct > 0 ? '+' : '') + f(pct, 1) + ' %', ''));

      let band = '', cls = 'ok';
      if (dMass > 0) { band = 'Weight GAIN - fluid overload, suspect exercise-associated hyponatraemia'; cls = 'bad'; }
      else if (-pct < 1) { band = 'Euhydrated (<1% loss)'; cls = 'ok'; }
      else if (-pct < 2) { band = 'Acceptable (1-2% loss)'; cls = 'ok'; }
      else if (-pct < 4) { band = 'Hypohydrated (2-4%) - performance and thermoregulation impaired'; cls = 'warn'; }
      else if (-pct < 6) { band = 'Significant (4-6%) - heat illness risk'; cls = 'bad'; }
      else { band = 'Severe (>6%) - urgent rehydration and medical review'; cls = 'bad'; }
      rows.push(P.row('Hydration status', band, cls));

      if (dMass > 0) {
        P.flag('Weight gain during the event - withhold further fluid and check point-of-care sodium before giving anything');
      }
      if (-pct >= 4) P.flag('Body mass loss >=4% - IV rehydration and observation before release');

      if (has(v.hours) && v.hours > 0) {
        rows.push(P.row('Sweat loss', f(sweat, 2) + ' L', ''));
        rows.push(P.row('Sweat rate', f(sweat / v.hours, 2) + ' L/h', sweat / v.hours > 1.8 ? 'warn' : ''));
        rows.push(P.row('Replacement guide for next event', f(sweat / v.hours * 1000 / 4, 0) + ' mL every 15 min to match sweat rate', ''));
      } else {
        rows.push(P.row('Sweat rate', 'Enter duration of activity', 'warn'));
      }

      if (dMass < 0) {
        const deficit = -dMass;
        rows.push(P.row('Fluid deficit to replace', f(deficit, 2) + ' L'));
        rows.push(P.row('Rehydration volume', f(deficit * 1.25, 2) + '-' + f(deficit * 1.5, 2) + ' L over 2-4 h (125-150% of deficit)', ''));
        rows.push(P.row('Route', 'Oral with sodium (ORS or salty food) unless vomiting, altered or >5% loss', ''));
      } else {
        rows.push(P.row('Rehydration volume', 'None - this patient is fluid overloaded', 'bad'));
      }
      return { rows: rows, score: rd(pct, 1), risk: band };
    },
    tests: [
      {
        n: 'classic marathon deficit', i: { pre: 70.0, post: 67.5, intake: 1.5, urine: 0.2, hours: 3 },
        e: {
          score: -3.6,
          rows: [['Sweat loss', '3.8'], ['Sweat rate', '1.27'], ['% body mass change', '-3.6'], ['Fluid deficit', '2.5'], ['Rehydration volume', '3.13-3.75']],
          risk: /Hypohydrated/
        }
      },
      {
        n: 'overdrinker', i: { pre: 60, post: 61.2, intake: 4, urine: 0.1, hours: 5 },
        e: {
          score: 2, risk: /GAIN/,
          rows: [['Sweat loss', '2.7'], ['Rehydration volume', 'fluid overloaded']],
          flags: [/withhold further fluid/]
        }
      },
      { n: 'severe loss', i: { pre: 80, post: 74, intake: 0.5, urine: 0, hours: 4 }, e: { score: -7.5, risk: /Severe/, flags: [/>=4%/] } },
      { n: 'blank weights', i: { hours: 3 }, e: { risk: /Incomplete/, flags: [/not a zero deficit/] } }
    ]
  });

  C.def({
    id: 'rhabdo', n: 'Rhabdomyolysis risk & fluid plan', c: 'heat', v: '1.0.0',
    t: ['rhabdomyolysis', 'ck', 'creatine kinase', 'myoglobinuria', 'dark urine', 'crush', 'exertional'],
    ref: 'Bosch X et al. NEJM 2009;361:62. Chavez LO et al. Crit Care 2016;20:135. CK >5x ULN defines rhabdomyolysis; CK >5000 U/L carries AKI risk.',
    i: [
      N('ck', 'Creatine kinase', { u: 'U/L', min: 0, max: 500000 }),
      N('wt', 'Weight', { u: 'kg', min: 2, max: 250, step: 0.1, ctx: 'weight' }),
      YN('exertional', 'Exertional cause (endurance event, collapse, heat)'),
      YN('darkUrine', 'Tea-coloured or cola-coloured urine'),
      YN('dipBlood', 'Urine dipstick positive for blood with no red cells on microscopy', 1, { opt: true }),
      N('k', 'Potassium', { u: 'mmol/L', min: 1, max: 10, step: 0.1, opt: true }),
      N('cr', 'Creatinine', { u: 'mg/dL', min: 0.1, max: 20, step: 0.1, opt: true }),
      YN('oliguria', 'Oliguria or anuria', 1, { opt: true }),
      YN('tenseLimb', 'Tense, swollen, exquisitely painful compartment', 1, { opt: true })
    ],
    out: function (v, P) {
      const rows = [];
      let band = '', cls = '', risk = '';

      if (!has(v.ck)) {
        band = 'Unknown - CK not available';
        cls = 'warn';
        rows.push(P.row('CK category', band, cls));
        P.flag('CK unavailable - treat clinically if there is exertional collapse with muscle pain or dark urine; a missing CK is not a negative CK');
        if (v.darkUrine === true || v.exertional === true) {
          rows.push(P.row('Act now', 'Start crystalloid and transfer for CK, potassium and creatinine', 'bad'));
        }
      } else {
        if (v.ck < 1000) { band = 'Below the rhabdomyolysis threshold (<1000 U/L)'; cls = 'ok'; }
        else if (v.ck < 5000) { band = 'Rhabdomyolysis, low AKI risk (1000-4999 U/L)'; cls = 'warn'; }
        else if (v.ck < 15000) { band = 'Rhabdomyolysis, moderate AKI risk (5000-14999 U/L)'; cls = 'bad'; }
        else if (v.ck < 40000) { band = 'High AKI risk (15000-39999 U/L)'; cls = 'bad'; }
        else { band = 'Very high AKI risk (>=40000 U/L)'; cls = 'bad'; }
        rows.push(P.row('CK', f(v.ck, 0) + ' U/L', cls));
        rows.push(P.row('CK category', band, cls));
        if (v.ck >= 5000) P.flag('CK >=5000 U/L - aggressive crystalloid and renal monitoring, admit');
        if (v.ck < 1000) P.flag('CK peaks 24-72 h after injury - an early normal CK does not exclude rhabdomyolysis, repeat it');
      }
      risk = band;

      if (!has(v.wt)) {
        rows.push(P.row('Initial fluid', 'Enter weight', 'bad'));
        rows.push(P.row('Urine output target', 'Enter weight', 'bad'));
        P.flag('Weight missing - fluid rate not calculated');
      } else {
        rows.push(P.row('Initial fluid (first 1-2 h)', f(10 * v.wt, 0) + '-' + f(20 * v.wt, 0) + ' mL/h crystalloid (10-20 mL/kg/h)', 'bad'));
        rows.push(P.row('Then titrate to', 'Urine output ' + f(3 * v.wt, 0) + ' mL/h (3 mL/kg/h), aim 200-300 mL/h in adults', 'warn'));
        rows.push(P.row('Urine output target', f(3 * v.wt, 0) + ' mL/h', 'warn'));
        rows.push(P.row('Fluid choice', '0.9% NaCl or Ringer lactate. Ringer lactate avoids hyperchloraemic acidosis in large volumes.', ''));
      }

      if (has(v.k)) {
        const kcls = v.k >= 6.5 ? 'bad' : (v.k >= 5.5 ? 'bad' : 'ok');
        rows.push(P.row('Potassium', f(v.k, 1) + ' mmol/L', kcls));
        if (v.k >= 5.5) P.flag('Hyperkalaemia - 12-lead ECG now, calcium gluconate 10% 10 mL IV, insulin + dextrose, salbutamol nebuliser');
        if (v.k >= 6.5) P.flag('Potassium >=6.5 - life-threatening, treat before transfer and monitor rhythm continuously');
      } else {
        rows.push(P.row('Potassium', 'Not measured - assume at risk in any significant rhabdomyolysis', 'warn'));
      }
      if (has(v.cr) && v.cr > 1.5) P.flag('Creatinine raised - established AKI, involve the receiving hospital early');
      if (v.oliguria === true) P.flag('Oliguria despite fluids - stop escalating volume, transfer for renal support');
      if (v.tenseLimb === true) P.flag('Tense painful compartment - measure compartment pressure, surgical emergency');
      if (v.darkUrine === true) rows.push(P.row('Urine', 'Dark urine with positive dipstick blood and no red cells = myoglobinuria', 'bad'));

      rows.push(P.row('AVOID', 'No NSAIDs - ketorolac, ibuprofen and mefenamic acid are all in the event kit and all nephrotoxic here', 'bad'));
      P.flag('No NSAIDs in suspected rhabdomyolysis - withhold ketorolac, ibuprofen, mefenamic acid');
      rows.push(P.row('Monitor', 'ECG for hyperkalaemia, potassium, calcium, phosphate, creatinine, urine output', ''));
      rows.push(P.row('Disposition', 'CK >5000, AKI, hyperkalaemia or heat stroke: ambulance to hospital', 'warn'));
      return { rows: rows, score: has(v.ck) ? v.ck : undefined, risk: risk };
    },
    tests: [
      {
        n: 'high risk exertional', i: { ck: 25000, wt: 70, exertional: 'y', darkUrine: 'y' },
        e: {
          score: 25000, risk: /High AKI risk/,
          rows: [['Initial fluid', '700-1400'], ['Urine output target', '210'], ['AVOID', 'NSAID']],
          flags: [/No NSAIDs/, /CK >=5000/]
        }
      },
      {
        n: 'no CK is not a negative CK', i: { exertional: 'y', darkUrine: 'y', wt: 60 },
        e: { risk: /Unknown/, flags: [/not a negative CK/], rows: [['Act now', 'crystalloid']] }
      },
      { n: 'hyperkalaemia', i: { ck: 8000, wt: 70, k: 6.0, exertional: 'y', darkUrine: 'n' }, e: { flags: [/Hyperkalaemia/] } },
      { n: 'weight missing', i: { ck: 12000, exertional: 'y', darkUrine: 'y' }, e: { rows: [['Initial fluid', 'Enter weight']], flags: [/Weight missing/] } },
      { n: 'early normal CK', i: { ck: 400, wt: 70, exertional: 'y', darkUrine: 'n' }, e: { risk: /Below the rhabdomyolysis threshold/, flags: [/peaks 24-72 h/] } }
    ]
  });

  C.def({
    id: 'wbgt', n: 'WBGT activity guidance', c: 'heat', v: '1.0.0',
    t: ['wet bulb', 'globe temperature', 'flag', 'race flag', 'cancellation', 'heat index', 'environment'],
    ref: 'ACSM Position Stand, Med Sci Sports Exerc 2007;39:556 (road race flag system). US Army TB MED 507 heat categories.',
    i: [
      H('Enter WBGT directly if the meter gives it, otherwise enter the three thermometer readings.'),
      N('wbgt', 'WBGT (if measured directly)', { u: '°C', min: 0, max: 45, step: 0.1, opt: true }),
      N('nwb', 'Natural wet bulb', { u: '°C', min: 0, max: 45, step: 0.1, opt: true }),
      N('globe', 'Black globe', { u: '°C', min: 0, max: 80, step: 0.1, opt: true }),
      N('dry', 'Dry bulb (air)', { u: '°C', min: 0, max: 55, step: 0.1, opt: true }),
      S('setting', 'Setting', [['out', 'Outdoors with solar load'], ['in', 'Indoors / no solar load']], { dflt: 'out' }),
      YN('acclim', 'Participants acclimatised to this heat', 0, { opt: true })
    ],
    out: function (v, P) {
      const rows = [];
      let w = v.wbgt, derived = false;
      if (!has(w)) {
        if (has(v.nwb) && has(v.globe) && (v.setting === 'in' || has(v.dry))) {
          w = (v.setting === 'in')
            ? 0.7 * v.nwb + 0.3 * v.globe
            : 0.7 * v.nwb + 0.2 * v.globe + 0.1 * v.dry;
          derived = true;
        }
      }
      if (!has(w)) {
        P.flag('WBGT required - air temperature alone does not predict heat illness');
        return { rows: [P.row('WBGT', 'Enter WBGT, or wet bulb + globe (+ dry bulb outdoors)', 'warn')], risk: 'Incomplete' };
      }
      rows.push(P.row('WBGT', f(w, 1) + ' °C (' + f(w * 9 / 5 + 32, 1) + ' °F)' + (derived ? ' [calculated]' : ''), ''));
      if (derived) rows.push(P.row('Formula', v.setting === 'in' ? '0.7 x wet bulb + 0.3 x globe' : '0.7 x wet bulb + 0.2 x globe + 0.1 x dry bulb', ''));

      let flag = '', cls = '', guide = '';
      if (w < 10) {
        flag = 'White - low heat risk'; cls = 'ok';
        guide = 'Hyperthermia unlikely; watch for hypothermia in wet or windy conditions, especially slower finishers.';
      } else if (w < 18) {
        flag = 'Green - low risk'; cls = 'ok';
        guide = 'Normal operations. Standard aid stations and fluid.';
      } else if (w < 23) {
        flag = 'Yellow - moderate risk'; cls = 'warn';
        guide = 'Brief participants, increase aid stations, slow the pace, watch unacclimatised and larger athletes.';
      } else if (w < 28) {
        flag = 'Red - high risk'; cls = 'bad';
        guide = 'Unacclimatised and high-risk participants should not compete. Extra ice and immersion tubs on course, shorten the event if possible.';
      } else {
        flag = 'Black - extreme risk'; cls = 'bad';
        guide = 'Consider cancellation, postponement or a shortened course. If it proceeds: immersion tubs at every post, ice, and a rectal thermometer at each post.';
      }
      rows.push(P.row('Race flag', flag, cls));
      rows.push(P.row('Guidance', guide, cls));

      const wf = w * 9 / 5 + 32;
      let armyCat = '';
      if (wf < 78) armyCat = 'Below Category 1';
      else if (wf < 82) armyCat = 'Category 1 (78-81.9 °F)';
      else if (wf < 85) armyCat = 'Category 2 (82-84.9 °F)';
      else if (wf < 88) armyCat = 'Category 3 (85-87.9 °F)';
      else if (wf < 90) armyCat = 'Category 4 (88-89.9 °F)';
      else armyCat = 'Category 5 (>=90 °F) - suspend strenuous activity';
      rows.push(P.row('Heat category (US Army)', armyCat, wf >= 88 ? 'bad' : ''));

      if (w >= 28) P.flag('WBGT >=28 C (Black flag) - recommend cancellation or shortening; brief the organiser in writing');
      if (w >= 23) P.flag('WBGT >=23 C - ice baths ready at every post before the start, not after the first casualty');
      if (v.acclim === false && w >= 18) P.flag('Unacclimatised field at WBGT >=18 C - acclimatisation takes 10-14 days, expect more casualties');
      if (w < 10) P.flag('Low WBGT - plan for hypothermia in slow finishers and in the medical tent');

      rows.push(P.row('Post readiness', 'Rectal thermometer, immersion tub, ice, point-of-care sodium and glucose at every post', 'warn'));
      rows.push(P.row('Re-measure', 'WBGT every 30 min during the event and log it', ''));
      return { rows: rows, score: rd(w, 1), risk: flag };
    },
    tests: [
      {
        n: 'calculated outdoor black flag', i: { nwb: 26, globe: 40, dry: 32, setting: 'out' },
        e: { score: 29.4, risk: /Black/, rows: [['WBGT', '29.4'], ['WBGT', '84.9'], ['Heat category', 'Category 2']], flags: [/Black flag/] }
      },
      { n: 'indoor formula', i: { nwb: 20, globe: 30, setting: 'in' }, e: { score: 23, risk: /Red/ } },
      { n: 'direct yellow', i: { wbgt: 20 }, e: { score: 20, risk: /Yellow/, noFlag: [/Black flag/] } },
      { n: 'cold race', i: { wbgt: 8 }, e: { risk: /White/, flags: [/hypothermia/] } },
      { n: 'nothing entered', i: { setting: 'out' }, e: { risk: /Incomplete/, flags: [/does not predict/] } }
    ]
  });

  /* ================================================================== *
   * CARDIAC
   * ================================================================== */

  C.score({
    id: 'heart', n: 'HEART score', c: 'cardiac', v: '1.0.0', max: 10,
    t: ['chest pain', 'acs', 'mace', 'troponin', 'heart score'],
    ref: 'Six AJ et al. Neth Heart J 2008;16:191. Backus BE et al. Int J Cardiol 2013;168:2153.',
    i: [
      S('hist', 'History', [[0, 'Slightly suspicious'], [1, 'Moderately suspicious'], [2, 'Highly suspicious']]),
      S('ecg', 'ECG', [[0, 'Normal'], [1, 'Non-specific repolarisation change / LBBB / pacing'], [2, 'Significant ST deviation']]),
      S('age', 'Age', [[0, 'Under 45'], [1, '45-64'], [2, '65 or older']], {
        ctx: 'age', mapCtx: function (a) { return a >= 65 ? 2 : (a >= 45 ? 1 : 0); }
      }),
      S('rf', 'Risk factors', [
        [0, 'No known risk factors'],
        [1, '1-2 risk factors'],
        [2, '3 or more, or known atherosclerotic disease']
      ], { hint: 'Diabetes, smoking, hypertension, dyslipidaemia, family history, obesity' }),
      S('trop', 'Troponin', [[0, 'At or below normal limit'], [1, '1-3x normal limit'], [2, 'More than 3x normal limit']])
    ],
    bands: [
      { lo: 0, hi: 3, l: 'Low risk (MACE ~1.7%)', cls: 'ok', note: 'Consider discharge with follow-up if serial troponin is available and negative.' },
      { lo: 4, hi: 6, l: 'Moderate risk (MACE ~16.6%)', cls: 'warn', note: 'Admit for serial troponin and observation - ambulance transfer.' },
      { lo: 7, hi: 10, l: 'High risk (MACE ~50.1%)', cls: 'bad', note: 'Early invasive strategy - transfer to a PCI-capable hospital now.' }
    ],
    extra: function (v, P, sc) {
      const rows = [];
      if (has(sc.s) && sc.s >= 4) P.flag('HEART >=4 - do not discharge from the event, ambulance transfer');
      if (String(v.ecg) === '2') P.flag('Significant ST deviation - 12-lead to the receiving PCI centre, aspirin 160-320 mg chewed plus ticagrelor 180 mg unless contraindicated');
      rows.push(P.row('At the post', 'Aspilet 80 mg x2-4 chewed, ISDN 5 mg SL if SBP >100 and no PDE5 inhibitor, O2 only if SpO2 <94%', ''));
      rows.push(P.row('Caution', 'The HEART score needs a troponin. Without one this is not a validated result.', 'warn'));
      return rows;
    },
    tests: [
      { n: 'moderate', i: { hist: 1, ecg: 1, age: 1, rf: 1, trop: 0 }, e: { score: 4, risk: /Moderate/, flags: [/do not discharge/] } },
      { n: 'maximum', i: { hist: 2, ecg: 2, age: 2, rf: 2, trop: 2 }, e: { score: 10, risk: /High/, flags: [/PCI centre/] } },
      { n: 'low', i: { hist: 0, ecg: 0, age: 0, rf: 0, trop: 0 }, e: { score: 0, risk: /Low/, noFlag: [/do not discharge/] } },
      { n: 'age autofilled from patient', i: { hist: 1, ecg: 0, rf: 0, trop: 0 }, p: { age: 70 }, e: { score: 3 } },
      { n: 'no troponin', i: { hist: 1, ecg: 1, age: 1, rf: 1 }, e: { scoreUndef: true, risk: /Incomplete/ } }
    ]
  });

  C.score({
    id: 'csrs', n: 'Canadian Syncope Risk Score', c: 'cardiac', v: '1.0.0', max: 11,
    t: ['syncope', 'collapse', 'faint', 'csrs'],
    ref: 'Thiruganasambandamoorthy V et al. JAMA Intern Med 2016;176:1480.',
    i: [
      YN('vaso', 'Predisposition to vasovagal symptoms (warm room, prolonged standing, fear, emotion, pain)', 1),
      YN('heart', 'History of heart disease (CAD, AF/flutter, CHF, valvular disease)', 1),
      YN('bp', 'Any systolic BP reading <90 or >180 mmHg', 2),
      YN('trop', 'Troponin above the 99th percentile', 2),
      YN('axis', 'Abnormal QRS axis (below -30 or above 100 degrees)', 1),
      YN('qrs', 'QRS duration >130 ms', 1),
      YN('qtc', 'Corrected QT interval >480 ms', 2),
      S('dx', 'Diagnosis at the post', [
        [0, 'Neither vasovagal nor cardiac'],
        [-2, 'Vasovagal syncope'],
        [2, 'Cardiac syncope']
      ])
    ],
    band: function (s) {
      if (s <= -2) return { l: 'Very low risk (0.4-0.7% serious outcome)', cls: 'ok', note: 'Discharge from the post with advice.' };
      if (s <= 0) return { l: 'Low risk (1.2-1.9%)', cls: 'ok', note: 'Discharge with advice; return if recurrent or exertional.' };
      if (s <= 3) return { l: 'Medium risk (3.1-8.1%)', cls: 'warn', note: 'Observe and arrange cardiology follow-up; transfer if any doubt.' };
      if (s <= 5) return { l: 'High risk (19.7-27.8%)', cls: 'bad', note: 'Ambulance transfer with monitoring.' };
      return { l: 'Very high risk (>=36%)', cls: 'bad', note: 'Monitored ambulance transfer now.' };
    },
    extra: function (v, P, sc) {
      const rows = [];
      if (has(sc.s) && sc.s >= 4) P.flag('Canadian Syncope Risk Score >=4 - monitored transfer');
      rows.push(P.row('Exertional syncope', 'Syncope DURING exertion is never low risk, whatever the score - think HCM, anomalous coronary, arrhythmia, aortic stenosis', 'bad'));
      P.flag('Syncope during exertion overrides this score - transfer for echo and ECG review');
      return rows;
    },
    tests: [
      {
        n: 'simple vasovagal', i: { vaso: 'y', heart: 'n', bp: 'n', trop: 'n', axis: 'n', qrs: 'n', qtc: 'n', dx: -2 },
        e: { score: -1, risk: /Low risk/ }
      },
      {
        n: 'cardiac', i: { vaso: 'n', heart: 'y', bp: 'y', trop: 'y', axis: 'n', qrs: 'n', qtc: 'y', dx: 2 },
        e: { score: 9, risk: /Very high/, flags: [/monitored transfer/] }
      },
      { n: 'very low', i: { vaso: 'y', heart: 'n', bp: 'n', trop: 'n', axis: 'n', qrs: 'n', qtc: 'n', dx: 0 }, e: { score: 1, risk: /Medium/ } },
      { n: 'unanswered', i: { vaso: 'y', heart: 'n', dx: 0 }, e: { scoreUndef: true, risk: /Incomplete/, flags: [/do NOT read as low risk/] } }
    ]
  });

  C.def({
    id: 'qtc', n: 'QTc (Bazett, Fridericia, Framingham, Hodges)', c: 'cardiac', v: '1.0.0',
    t: ['qt', 'qtc', 'long qt', 'torsade', 'ecg'],
    ref: 'Bazett HC. Heart 1920;7:353. Fridericia LS. Acta Med Scand 1920;53:469. Sagie A et al. Am J Cardiol 1992;70:797 (Framingham). Hodges M et al. 1983.',
    i: [
      N('qt', 'Measured QT interval', { u: 'ms', min: 150, max: 800 }),
      N('hr', 'Heart rate', { u: '/min', min: 25, max: 250, ctx: 'hr' }),
      S('sex', 'Sex', [['M', 'Male'], ['F', 'Female']], { ctx: 'sex', opt: true })
    ],
    out: function (v, P) {
      const rows = [];
      if (!has(v.qt) || !has(v.hr) || v.hr <= 0) {
        P.flag('QT and heart rate both required');
        return { rows: [P.row('QTc', 'Enter QT interval and heart rate', 'warn')], risk: 'Incomplete' };
      }
      const rr = 60 / v.hr;
      const baz = v.qt / Math.sqrt(rr);
      const fri = v.qt / Math.pow(rr, 1 / 3);
      const fra = v.qt + 154 * (1 - rr);
      const hod = v.qt + 1.75 * (v.hr - 60);
      const outsideRange = v.hr < 60 || v.hr >= 100;
      const preferred = outsideRange ? fri : baz;
      const prefName = outsideRange ? 'Fridericia' : 'Bazett';

      rows.push(P.row('RR interval', f(rr, 3) + ' s', ''));
      rows.push(P.row('QTc Bazett', f(baz, 1) + ' ms', ''));
      rows.push(P.row('QTc Fridericia', f(fri, 1) + ' ms', ''));
      rows.push(P.row('QTc Framingham', f(fra, 1) + ' ms', ''));
      rows.push(P.row('QTc Hodges', f(hod, 1) + ' ms', ''));

      const limit = (String(v.sex).toUpperCase() === 'F') ? 460 : 450;
      let risk = '', cls = 'ok';
      if (preferred >= 500) { risk = 'Markedly prolonged (>=500 ms) - high torsade risk'; cls = 'bad'; }
      else if (preferred > limit) { risk = 'Prolonged (above ' + limit + ' ms)'; cls = 'warn'; }
      else if (preferred < 340) { risk = 'Short QT (<340 ms) - consider short QT syndrome'; cls = 'warn'; }
      else { risk = 'Normal'; cls = 'ok'; }
      rows.push(P.row('Preferred correction', prefName + ' ' + f(preferred, 1) + ' ms', cls));
      rows.push(P.row('Interpretation', risk + ' (threshold ' + limit + ' ms)', cls));

      if (outsideRange) {
        rows.push(P.row('Why Fridericia', 'Bazett over-corrects above 100/min and under-corrects below 60/min', 'warn'));
        P.flag('Heart rate outside 60-100 - read the Fridericia value, not Bazett');
      }
      if (preferred >= 500) {
        P.flag('QTc >=500 ms - stop QT-prolonging drugs (ondansetron, haloperidol, macrolides), check K and Mg, have magnesium ready');
        rows.push(P.row('If torsade', 'MgSO4 2 g IV over 2 min (formulary: 400 mg/25 mL flacon), correct K, overdrive pace, defibrillate if pulseless', 'bad'));
      }
      rows.push(P.row('Measurement', 'Measure in lead II or V5, longest QT over 3 beats, tangent method, exclude U waves', ''));
      return { rows: rows, score: rd(preferred, 1), risk: risk };
    },
    tests: [
      { n: 'HR 60 identity', i: { qt: 400, hr: 60 }, e: { score: 400, rows: [['QTc Bazett', '400'], ['QTc Fridericia', '400'], ['QTc Framingham', '400'], ['QTc Hodges', '400']], risk: /Normal/ } },
      {
        n: 'tachycardic prolonged', i: { qt: 440, hr: 100, sex: 'M' },
        e: { score: 521.7, rows: [['QTc Bazett', '568'], ['QTc Fridericia', '521.7'], ['QTc Framingham', '501.6'], ['QTc Hodges', '510']], risk: /Markedly prolonged/, flags: [/ondansetron/] }
      },
      { n: 'female threshold', i: { qt: 420, hr: 70, sex: 'F' }, e: { risk: /Normal/ } },
      { n: 'missing HR', i: { qt: 400 }, e: { risk: /Incomplete/ } }
    ]
  });

  C.def({
    id: 'defib-energy', n: 'Defibrillation & cardioversion energy', c: 'cardiac', v: '1.0.0',
    t: ['defib', 'shock', 'joules', 'cardioversion', 'dc shock', 'vf', 'vt', 'af'],
    ref: 'AHA ACLS/PALS Guidelines 2020 (Circulation 2020;142:S366, S469). ERC Guidelines 2021.',
    i: [
      S('mode', 'Mode', [['defib', 'Defibrillation (VF / pulseless VT)'], ['sync', 'Synchronised cardioversion']], { dflt: 'defib' }),
      S('who', 'Patient', [['adult', 'Adult / post-pubertal'], ['paed', 'Paediatric (pre-pubertal)']], {
        ctx: 'age', mapCtx: function (a) { return a < 12 ? 'paed' : 'adult'; }, dflt: 'adult'
      }),
      N('wt', 'Weight', { u: 'kg', min: 2, max: 250, step: 0.1, ctx: 'weight', opt: true }),
      S('rhythm', 'Rhythm (for cardioversion)', [
        ['af', 'Atrial fibrillation'],
        ['flutter', 'Atrial flutter / SVT'],
        ['vt', 'Monomorphic VT with a pulse']
      ], { opt: true })
    ],
    out: function (v, P) {
      const rows = [];
      const paed = v.who === 'paed';
      const sync = v.mode === 'sync';
      let risk = '';

      if (paed) {
        if (!has(v.wt)) {
          P.flag('Weight missing - paediatric energy is weight-based and was not calculated');
          rows.push(P.row('Energy', 'Enter weight', 'bad'));
          rows.push(P.row('Estimate', 'If weight is truly unavailable: (age + 4) x 2 kg for 1-10 years, or a length-based tape', 'warn'));
          return { rows: rows, risk: 'Weight required' };
        }
        if (sync) {
          const first = 0.5 * v.wt, firstHi = 1 * v.wt, second = 2 * v.wt;
          rows.push(P.row('First shock', f(first, 0) + '-' + f(firstHi, 0) + ' J (0.5-1 J/kg)', 'bad'));
          rows.push(P.row('Second and subsequent', f(cap(second, 200), 0) + ' J (2 J/kg, capped at the adult 200 J)', 'bad'));
          risk = 'Paediatric synchronised cardioversion';
        } else {
          const first = cap(2 * v.wt, 200), second = cap(4 * v.wt, 200), max = cap(10 * v.wt, 200);
          rows.push(P.row('First shock', f(first, 0) + ' J (2 J/kg)', 'bad'));
          rows.push(P.row('Second shock', f(second, 0) + ' J (4 J/kg)', 'bad'));
          rows.push(P.row('Subsequent', 'At least ' + f(second, 0) + ' J, up to ' + f(max, 0) + ' J (10 J/kg or the adult dose, whichever is lower)', 'bad'));
          risk = 'Paediatric defibrillation';
        }
        rows.push(P.row('Pads', 'Paediatric pads under 10 kg or 1 year if available; adult pads are acceptable if paediatric pads are not. Anterior-posterior if pads overlap.', ''));
        rows.push(P.row('Adrenaline', '10 mcg/kg = ' + f(0.01 * v.wt, 2) + ' mg = ' + f(0.1 * v.wt, 1) + ' mL of 1:10,000, every 3-5 min', ''));
        rows.push(P.row('Amiodarone', f(cap(5 * v.wt, 300), 0) + ' mg (5 mg/kg, max 300 mg) after the 3rd and 5th shock', ''));
      } else {
        if (sync) {
          const rhythmTxt = v.rhythm === 'af' ? '120-200 J biphasic'
            : v.rhythm === 'flutter' ? '50-100 J biphasic'
              : v.rhythm === 'vt' ? '100 J biphasic'
                : 'AF 120-200 J, flutter/SVT 50-100 J, monomorphic VT 100 J (biphasic)';
          rows.push(P.row('First shock', rhythmTxt, 'bad'));
          rows.push(P.row('Escalation', 'Step up in increments to the maximum output if unsuccessful', ''));
          rows.push(P.row('Sedation', 'Midazolam 0.05 mg/kg IV +/- fentanyl 1 mcg/kg; have the airway kit open', 'warn'));
          rows.push(P.row('Synchronise', 'Press SYNC and confirm the marker tracks the R wave. Never sync polymorphic VT - defibrillate instead.', 'bad'));
          risk = 'Adult synchronised cardioversion';
        } else {
          rows.push(P.row('Biphasic', '150-200 J first shock (use the manufacturer value), then the same or higher', 'bad'));
          rows.push(P.row('Monophasic', '360 J for every shock', 'bad'));
          rows.push(P.row('Adrenaline', '1 mg IV/IO (1 ampoule of 1 mg) every 3-5 min after the 2nd shock', ''));
          rows.push(P.row('Amiodarone', '300 mg IV after the 3rd shock, then 150 mg after the 5th', ''));
          risk = 'Adult defibrillation';
        }
        if (has(v.wt) && v.wt < 40) P.flag('Adult energies selected but weight is under 40 kg - confirm the patient is post-pubertal');
      }
      rows.push(P.row('Always', 'Minimise pauses - charge during compressions, shock within 5 s of stopping, resume compressions immediately', 'bad'));
      rows.push(P.row('Pad placement', 'Anterolateral (right infraclavicular + V6 mid-axillary). Shave, dry, remove GTN patches, avoid pacemaker by 8 cm.', ''));
      return { rows: rows, risk: risk };
    },
    tests: [
      {
        n: 'paediatric defib 20 kg', i: { mode: 'defib', who: 'paed', wt: 20 },
        e: { rows: [['First shock', '40 J'], ['Second shock', '80 J'], ['Subsequent', '200 J'], ['Amiodarone', '100 mg'], ['Adrenaline', '0.2 mg']] }
      },
      {
        n: 'paediatric cardioversion 30 kg', i: { mode: 'sync', who: 'paed', wt: 30 },
        e: { rows: [['First shock', '15-30 J'], ['Second and subsequent', '60 J']] }
      },
      { n: 'adult defib', i: { mode: 'defib', who: 'adult' }, e: { rows: [['Biphasic', '150-200 J'], ['Monophasic', '360 J']] } },
      { n: 'adult AF cardioversion', i: { mode: 'sync', who: 'adult', rhythm: 'af' }, e: { rows: [['First shock', '120-200 J'], ['Synchronise', 'polymorphic']] } },
      { n: 'paediatric without weight', i: { mode: 'defib', who: 'paed' }, e: { risk: /Weight required/, flags: [/weight-based/] } },
      { n: 'paediatric cap at adult dose', i: { mode: 'defib', who: 'paed', wt: 60 }, e: { rows: [['Second shock', '200 J']] } }
    ]
  });

  C.score({
    id: 'wells-pe', n: 'Wells score for PE', c: 'cardiac', v: '1.0.0', max: 12.5,
    t: ['pulmonary embolism', 'wells', 'pe', 'dvt', 'd-dimer'],
    ref: 'Wells PS et al. Thromb Haemost 2000;83:416. Ann Intern Med 2001;135:98.',
    i: [
      YN('dvt', 'Clinical signs of DVT (leg swelling and tenderness along deep veins)', 3),
      YN('alt', 'PE is the most likely diagnosis, or equally likely to the alternative', 3),
      YN('hr', 'Heart rate above 100/min', 1.5),
      YN('immob', 'Immobilisation >=3 days or surgery in the previous 4 weeks', 1.5),
      YN('prev', 'Previous PE or DVT', 1.5),
      YN('haem', 'Haemoptysis', 1),
      YN('malig', 'Malignancy treated within 6 months, or palliative', 1)
    ],
    band: function (s) {
      if (s < 2) return { l: 'Low probability (three-tier) / PE unlikely', cls: 'ok', note: 'D-dimer; consider PERC to rule out without testing.' };
      if (s <= 4) return { l: 'Moderate probability / PE unlikely (two-tier)', cls: 'warn', note: 'D-dimer; if positive, CTPA.' };
      if (s <= 6) return { l: 'Moderate probability / PE likely (two-tier)', cls: 'bad', note: 'CTPA - transfer. Do not rely on D-dimer.' };
      return { l: 'High probability / PE likely', cls: 'bad', note: 'CTPA, consider empirical anticoagulation - transfer now.' };
    },
    extra: function (v, P, sc) {
      const rows = [];
      if (has(sc.s) && sc.s > 4) P.flag('Wells >4 - PE likely, imaging not D-dimer, ambulance transfer');
      rows.push(P.row('Two-tier cut-off', '<=4 PE unlikely, >4 PE likely', ''));
      rows.push(P.row('At the post', 'O2 if SpO2 <94%, IV access, ECG (S1Q3T3 is uncommon), avoid NSAIDs if anticoagulation is likely', ''));
      return rows;
    },
    tests: [
      {
        n: 'high', i: { dvt: 'y', alt: 'y', hr: 'y', immob: 'n', prev: 'n', haem: 'n', malig: 'n' },
        e: { score: 7.5, risk: /High probability/, flags: [/PE likely/] }
      },
      {
        n: 'all negative', i: { dvt: 'n', alt: 'n', hr: 'n', immob: 'n', prev: 'n', haem: 'n', malig: 'n' },
        e: { score: 0, risk: /Low probability/ }
      },
      {
        n: 'tachycardia only is still low', i: { dvt: 'n', alt: 'n', hr: 'y', immob: 'n', prev: 'n', haem: 'n', malig: 'n' },
        e: { score: 1.5, risk: /Low probability/ }
      },
      { n: 'unanswered is not zero', i: { dvt: 'n', alt: 'n' }, e: { scoreUndef: true, risk: /Incomplete/ } }
    ]
  });

  C.score({
    id: 'perc', n: 'PERC rule', c: 'cardiac', v: '1.0.0', max: 8,
    t: ['perc', 'pulmonary embolism', 'rule out', 'd-dimer'],
    ref: 'Kline JA et al. J Thromb Haemost 2004;2:1247; J Thromb Haemost 2008;6:772.',
    i: [
      H('Only valid when clinical gestalt puts the probability of PE below 15%. All eight must be answered NO to rule out.'),
      YN('age', 'Age 50 or older', 1, { ctx: 'age', mapCtx: function (a) { return a >= 50 ? 'y' : 'n'; } }),
      YN('hr', 'Heart rate 100/min or more', 1, { ctx: 'hr', mapCtx: function (h) { return h >= 100 ? 'y' : 'n'; } }),
      YN('spo2', 'SpO2 below 95% on room air', 1, { ctx: 'spo2', mapCtx: function (s) { return s < 95 ? 'y' : 'n'; } }),
      YN('leg', 'Unilateral leg swelling', 1),
      YN('haem', 'Haemoptysis', 1),
      YN('surg', 'Surgery or trauma needing general anaesthesia within 4 weeks', 1),
      YN('prev', 'Previous PE or DVT', 1),
      YN('horm', 'Oestrogen use (oral contraceptive, HRT)', 1)
    ],
    band: function (s) {
      if (s === 0) return { l: 'PERC negative - PE excluded', cls: 'ok', note: 'No D-dimer, no imaging, if pre-test probability really is under 15%.' };
      return { l: 'PERC positive (' + s + ' criteria) - cannot exclude PE', cls: 'warn', note: 'Apply Wells, then D-dimer or CTPA.' };
    },
    extra: function (v, P, sc) {
      if (has(sc.s) && sc.s > 0) P.flag('PERC positive - PE not excluded, continue the pathway');
      if (has(sc.s) && sc.s === 0) P.flag('PERC is only valid at a gestalt probability below 15% - if you are worried, it does not apply');
      return [];
    },
    tests: [
      {
        n: 'all negative', i: { age: 'n', hr: 'n', spo2: 'n', leg: 'n', haem: 'n', surg: 'n', prev: 'n', horm: 'n' },
        e: { score: 0, risk: /PERC negative/, flags: [/below 15%/] }
      },
      {
        n: 'older patient', i: { age: 'y', hr: 'n', spo2: 'n', leg: 'n', haem: 'n', surg: 'n', prev: 'n', horm: 'n' },
        e: { score: 1, risk: /PERC positive/, flags: [/not excluded/] }
      },
      {
        n: 'autofill from canvas', i: { leg: 'n', haem: 'n', surg: 'n', prev: 'n', horm: 'n' },
        p: { age: 55, vitals: [{ t: 1, hr: 110, spo2: 93 }] },
        e: { score: 3, risk: /PERC positive/ }
      },
      { n: 'unanswered', i: { age: 'n', hr: 'n' }, e: { scoreUndef: true, risk: /Incomplete/ } }
    ]
  });

  /* ================================================================== *
   * TRAUMA
   * ================================================================== */

  C.def({
    id: 'atls-shock', n: 'ATLS haemorrhagic shock class', c: 'trauma', v: '1.0.0',
    t: ['shock class', 'blood loss', 'haemorrhage', 'hemorrhage', 'atls', 'trauma'],
    ref: 'ATLS Advanced Trauma Life Support, 10th edition. American College of Surgeons, 2018.',
    i: [
      N('hr', 'Heart rate', { u: '/min', min: 20, max: 250, ctx: 'hr' }),
      N('sbp', 'Systolic BP', { u: 'mmHg', min: 40, max: 300, ctx: 'sbp', opt: true }),
      N('rr', 'Respiratory rate', { u: '/min', min: 4, max: 60, ctx: 'rr', opt: true }),
      N('gcs', 'GCS', { u: '', min: 3, max: 15, ctx: 'gcs', opt: true }),
      S('cns', 'Mental state', [
        [1, 'Slightly anxious'], [2, 'Mildly anxious'], [3, 'Anxious, confused'], [4, 'Confused, lethargic']
      ], { opt: true }),
      N('uo', 'Urine output', { u: 'mL/h', min: 0, max: 500, opt: true }),
      N('wt', 'Weight', { u: 'kg', min: 2, max: 250, step: 0.1, ctx: 'weight', opt: true }),
      S('who', 'Patient', [['adult', 'Adult (70 mL/kg)'], ['child', 'Child (80 mL/kg)'], ['infant', 'Infant (90 mL/kg)']], {
        ctx: 'age', mapCtx: function (a) { return a < 1 ? 'infant' : (a < 16 ? 'child' : 'adult'); }, dflt: 'adult'
      })
    ],
    out: function (v, P) {
      const rows = [];
      const classes = [];
      function add(l, c) { if (has(c)) { classes.push(c); rows.push(P.row(l, 'Class ' + c, c >= 3 ? 'bad' : (c >= 2 ? 'warn' : ''))); } }

      if (has(v.hr)) add('Heart rate suggests', v.hr < 100 ? 1 : (v.hr <= 120 ? 2 : (v.hr <= 140 ? 3 : 4)));
      if (has(v.sbp)) add('Systolic BP suggests', v.sbp >= 110 ? 1 : (v.sbp >= 90 ? 2 : (v.sbp >= 70 ? 3 : 4)));
      if (has(v.rr)) add('Respiratory rate suggests', v.rr <= 20 ? 1 : (v.rr <= 30 ? 2 : (v.rr <= 40 ? 3 : 4)));
      if (has(v.uo)) add('Urine output suggests', v.uo > 30 ? 1 : (v.uo >= 20 ? 2 : (v.uo >= 5 ? 3 : 4)));
      if (has(v.cns)) add('Mental state suggests', num(v.cns));
      if (has(v.gcs) && !has(v.cns)) add('GCS suggests', v.gcs >= 15 ? 1 : (v.gcs >= 14 ? 2 : (v.gcs >= 13 ? 3 : 4)));

      if (!classes.length) {
        P.flag('At least one vital sign required - no data is not Class I');
        return { rows: [P.row('Shock class', 'Enter heart rate and at least one other parameter', 'warn')], risk: 'Incomplete' };
      }

      let cl = 1;
      classes.forEach(function (c) { if (c > cl) cl = c; });
      const pctLo = [0, 0, 15, 31, 41][cl];
      const pctHi = [0, 15, 30, 40, 100][cl];
      const labels = ['', 'Class I - minimal', 'Class II - mild', 'Class III - moderate', 'Class IV - severe'];
      const risk = labels[cl];
      rows.unshift(P.row('Shock class', risk + ' (' + pctLo + '-' + pctHi + '% blood volume)', cl >= 3 ? 'bad' : (cl >= 2 ? 'warn' : 'ok')));

      const perKg = v.who === 'infant' ? 90 : (v.who === 'child' ? 80 : 70);
      if (has(v.wt)) {
        const bv = perKg * v.wt;
        rows.push(P.row('Estimated blood volume', f(bv, 0) + ' mL (' + perKg + ' mL/kg)', ''));
        rows.push(P.row('Estimated blood loss', f(bv * pctLo / 100, 0) + '-' + f(bv * pctHi / 100, 0) + ' mL', cl >= 3 ? 'bad' : ''));
      } else {
        rows.push(P.row('Estimated blood loss', 'Enter weight', 'warn'));
        P.flag('Weight missing - blood volume and loss not calculated');
      }

      if (cl >= 3) {
        P.flag('Class III/IV shock - control bleeding, blood products not crystalloid, tranexamic acid 1 g IV within 3 h, transfer now');
        rows.push(P.row('Resuscitation', 'Direct pressure, tourniquet, pelvic binder, splint. Permissive hypotension (SBP 80-90) until bleeding is controlled unless head injury.', 'bad'));
        rows.push(P.row('TXA', '1 g IV over 10 min within 3 h of injury, then 1 g over 8 h (not in the default event kit - add it for contact and motorsport events)', 'bad'));
      } else if (cl === 2) {
        rows.push(P.row('Resuscitation', 'Crystalloid 500 mL boluses titrated to response, re-examine after each', 'warn'));
      }
      rows.push(P.row('Trap', 'Young athletes, pregnancy and beta-blockers hold the blood pressure until a large loss; tachycardia may be absent', 'warn'));
      return { rows: rows, score: cl, risk: risk };
    },
    tests: [
      {
        n: 'class III', i: { hr: 130, sbp: 95, rr: 34, gcs: 14, wt: 70, who: 'adult' },
        e: {
          score: 3, risk: /Class III/,
          rows: [['Estimated blood volume', '4900'], ['Estimated blood loss', '1519-1960'], ['TXA', '1 g IV']],
          flags: [/tranexamic acid/]
        }
      },
      { n: 'class I', i: { hr: 80, sbp: 125, rr: 16, wt: 70 }, e: { score: 1, risk: /Class I/, noFlag: [/tranexamic/] } },
      { n: 'child volume', i: { hr: 150, sbp: 70, wt: 20, who: 'child' }, e: { score: 4, rows: [['Estimated blood volume', '1600']] } },
      { n: 'no weight', i: { hr: 130, sbp: 95 }, e: { rows: [['Estimated blood loss', 'Enter weight']], flags: [/Weight missing/] } },
      { n: 'nothing entered', i: { who: 'adult' }, e: { risk: /Incomplete/, flags: [/no data is not Class I/] } }
    ]
  });

  C.def({
    id: 'ottawa-ankle', n: 'Ottawa ankle & foot rules', c: 'trauma', v: '1.0.0',
    t: ['ankle', 'foot', 'sprain', 'x-ray', 'ottawa', 'fracture'],
    ref: 'Stiell IG et al. Ann Emerg Med 1992;21:384; JAMA 1993;269:1127. Sensitivity ~98-100% for clinically significant fracture.',
    i: [
      YN('malZone', 'Pain in the malleolar zone'),
      YN('midZone', 'Pain in the midfoot zone'),
      YN('latMal', 'Bone tenderness at the posterior edge or tip of the lateral malleolus (distal 6 cm)'),
      YN('medMal', 'Bone tenderness at the posterior edge or tip of the medial malleolus (distal 6 cm)'),
      YN('base5', 'Bone tenderness at the base of the 5th metatarsal'),
      YN('navic', 'Bone tenderness at the navicular'),
      YN('weight', 'Unable to bear weight for 4 steps, both immediately after injury and now'),
      YN('exclude', 'Intoxicated, distracting injury, reduced sensation, under 18 years, or more than 10 days since injury', 0, { opt: true })
    ],
    out: function (v, P) {
      const rows = [];
      const unanswered = [];
      ['malZone', 'midZone', 'latMal', 'medMal', 'base5', 'navic', 'weight'].forEach(function (k) {
        if (v[k] === undefined) unanswered.push(k);
      });
      if (unanswered.length) {
        P.flag('Answer every criterion - unanswered is not negative, and these rules only exclude fracture when fully applied');
        rows.push(P.row('Result', 'Incomplete - ' + unanswered.length + ' criteria unanswered', 'bad'));
        return { rows: rows, risk: 'Incomplete' };
      }
      if (v.exclude === true) {
        P.flag('Rule does not apply (exclusion present) - use clinical judgement and image if in doubt');
        rows.push(P.row('Result', 'Rule does not apply', 'warn'));
      }
      const ankle = v.malZone === true && (v.latMal === true || v.medMal === true || v.weight === true);
      const foot = v.midZone === true && (v.base5 === true || v.navic === true || v.weight === true);
      rows.push(P.row('Ankle X-ray', ankle ? 'INDICATED' : 'Not indicated', ankle ? 'bad' : 'ok'));
      rows.push(P.row('Foot X-ray', foot ? 'INDICATED' : 'Not indicated', foot ? 'bad' : 'ok'));
      if (!v.malZone && !v.midZone) rows.push(P.row('Note', 'No pain in either zone - the rule does not require imaging', 'ok'));
      if (ankle || foot) P.flag('X-ray indicated - splint, elevate, analgesia, refer for imaging');
      rows.push(P.row('At the post', 'RICE, elastic bandage 10 cm, long spalk or mitella for immobilisation, paracetamol or ibuprofen', ''));
      rows.push(P.row('Also check', 'Achilles tendon, syndesmosis squeeze test, proximal fibula, neurovascular status', ''));
      const risk = (ankle || foot) ? 'Imaging indicated' : 'No imaging indicated';
      return { rows: rows, risk: risk };
    },
    tests: [
      {
        n: 'lateral malleolus tenderness', i: { malZone: 'y', midZone: 'n', latMal: 'y', medMal: 'n', base5: 'n', navic: 'n', weight: 'n' },
        e: { risk: /Imaging indicated/, rows: [['Ankle X-ray', 'INDICATED'], ['Foot X-ray', 'Not indicated']], flags: [/X-ray indicated/] }
      },
      {
        n: 'midfoot navicular', i: { malZone: 'n', midZone: 'y', latMal: 'n', medMal: 'n', base5: 'n', navic: 'y', weight: 'n' },
        e: { rows: [['Foot X-ray', 'INDICATED']] }
      },
      {
        n: 'simple sprain', i: { malZone: 'y', midZone: 'n', latMal: 'n', medMal: 'n', base5: 'n', navic: 'n', weight: 'n' },
        e: { risk: /No imaging/, rows: [['Ankle X-ray', 'Not indicated']] }
      },
      { n: 'incomplete', i: { malZone: 'y' }, e: { risk: /Incomplete/, flags: [/unanswered is not negative/] } }
    ]
  });

  C.def({
    id: 'ottawa-knee', n: 'Ottawa knee rule', c: 'trauma', v: '1.0.0',
    t: ['knee', 'ottawa', 'x-ray', 'fracture', 'patella'],
    ref: 'Stiell IG et al. Ann Emerg Med 1995;26:405; JAMA 1996;275:611.',
    i: [
      YN('age', 'Age 55 or older', 1, { ctx: 'age', mapCtx: function (a) { return a >= 55 ? 'y' : 'n'; } }),
      YN('patella', 'Isolated patellar tenderness (no other bone tenderness)'),
      YN('fibula', 'Tenderness at the head of the fibula'),
      YN('flex', 'Unable to flex the knee to 90 degrees'),
      YN('weight', 'Unable to bear weight for 4 steps (transferring weight twice onto each leg, limping allowed)')
    ],
    out: function (v, P) {
      const keys = ['age', 'patella', 'fibula', 'flex', 'weight'];
      const unanswered = keys.filter(function (k) { return v[k] === undefined; });
      if (unanswered.length) {
        P.flag('Answer every criterion - unanswered is not negative');
        return { rows: [P.row('Result', 'Incomplete - ' + unanswered.length + ' criteria unanswered', 'bad')], risk: 'Incomplete' };
      }
      const positives = keys.filter(function (k) { return v[k] === true; });
      const rows = [];
      const xray = positives.length > 0;
      rows.push(P.row('Knee X-ray', xray ? 'INDICATED' : 'Not indicated', xray ? 'bad' : 'ok'));
      rows.push(P.row('Positive criteria', positives.length ? String(positives.length) : 'None', ''));
      if (xray) P.flag('Ottawa knee rule positive - immobilise and refer for imaging');
      rows.push(P.row('At the post', 'Knee immobiliser or long spalk, elevate, ice, crutches, paracetamol or ibuprofen', ''));
      rows.push(P.row('Exclusions', 'Under 18, penetrating trauma, isolated superficial injury, re-presentation for the same injury', 'warn'));
      return { rows: rows, risk: xray ? 'Imaging indicated' : 'No imaging indicated' };
    },
    tests: [
      { n: 'older patient', i: { age: 'y', patella: 'n', fibula: 'n', flex: 'n', weight: 'n' }, e: { risk: /Imaging indicated/, rows: [['Knee X-ray', 'INDICATED']] } },
      { n: 'young athlete, all negative', i: { age: 'n', patella: 'n', fibula: 'n', flex: 'n', weight: 'n' }, e: { risk: /No imaging/ } },
      { n: 'age autofilled', i: { patella: 'n', fibula: 'n', flex: 'n', weight: 'n' }, p: { age: 60 }, e: { risk: /Imaging indicated/ } },
      { n: 'incomplete', i: { age: 'n' }, e: { risk: /Incomplete/ } }
    ]
  });

  C.def({
    id: 'canadian-cspine', n: 'Canadian C-spine rule', c: 'trauma', v: '1.0.0',
    t: ['c-spine', 'cervical', 'collar', 'neck', 'canadian', 'immobilisation'],
    ref: 'Stiell IG et al. JAMA 2001;286:1841; NEJM 2003;349:2510.',
    i: [
      YN('applies', 'Alert (GCS 15), stable vital signs, blunt trauma, age 16 or over, no known vertebral disease or previous cervical surgery'),
      H('High-risk factors - any one mandates imaging'),
      YN('age65', 'Age 65 or older', 1, { ctx: 'age', mapCtx: function (a) { return a >= 65 ? 'y' : 'n'; } }),
      YN('mech', 'Dangerous mechanism (fall from 1 m or 5 stairs, axial load to the head, collision over 100 km/h or rollover or ejection, bicycle or recreational vehicle collision)'),
      YN('paraes', 'Paraesthesia in the extremities'),
      H('Low-risk factors - any one allows safe range-of-motion testing'),
      YN('rearEnd', 'Simple rear-end collision'),
      YN('sitting', 'Sitting up at the post'),
      YN('ambulatory', 'Ambulatory at any time since the injury'),
      YN('delayed', 'Delayed onset of neck pain'),
      YN('noMidline', 'No midline cervical tenderness'),
      H('Range of motion - only test if a low-risk factor is present'),
      YN('rotate', 'Able to actively rotate the neck 45 degrees left AND right', 0, { opt: true })
    ],
    out: function (v, P) {
      const rows = [];
      if (v.applies === undefined) {
        return { rows: [P.row('Result', 'Confirm the rule applies before using it', 'warn')], risk: 'Incomplete' };
      }
      if (v.applies === false) {
        P.flag('Canadian C-spine rule does not apply - maintain full spinal precautions and image');
        rows.push(P.row('Result', 'Rule does not apply - immobilise and image', 'bad'));
        return { rows: rows, risk: 'Rule does not apply' };
      }
      const highKeys = ['age65', 'mech', 'paraes'];
      const lowKeys = ['rearEnd', 'sitting', 'ambulatory', 'delayed', 'noMidline'];
      const unanswered = highKeys.concat(lowKeys).filter(function (k) { return v[k] === undefined; });
      const highRisk = highKeys.some(function (k) { return v[k] === true; });

      if (highRisk) {
        rows.push(P.row('Result', 'IMAGING REQUIRED - high-risk factor present', 'bad'));
        P.flag('High-risk factor present - collar on, imaging required, no range-of-motion testing');
        rows.push(P.row('Do not', 'Do not test range of motion when a high-risk factor is present', 'bad'));
        return { rows: rows, risk: 'Imaging required' };
      }
      if (unanswered.length) {
        P.flag('Answer every high-risk and low-risk criterion - unanswered is not negative');
        return { rows: [P.row('Result', 'Incomplete - ' + unanswered.length + ' criteria unanswered', 'bad')], risk: 'Incomplete' };
      }
      const lowRisk = lowKeys.some(function (k) { return v[k] === true; });
      if (!lowRisk) {
        rows.push(P.row('Result', 'IMAGING REQUIRED - no low-risk factor, range of motion cannot be assessed safely', 'bad'));
        P.flag('No low-risk factor - imaging required');
        return { rows: rows, risk: 'Imaging required' };
      }
      if (v.rotate === undefined) {
        rows.push(P.row('Result', 'Test active rotation 45 degrees left and right', 'warn'));
        return { rows: rows, risk: 'Assess range of motion' };
      }
      const ok = v.rotate === true;
      rows.push(P.row('Result', ok ? 'No imaging required - collar may be removed' : 'IMAGING REQUIRED - unable to rotate 45 degrees', ok ? 'ok' : 'bad'));
      if (ok) rows.push(P.row('Advice', 'Analgesia, mobilise, return if new neurology or worsening pain', 'ok'));
      else P.flag('Unable to rotate 45 degrees - collar on, imaging required');
      return { rows: rows, risk: ok ? 'No imaging required' : 'Imaging required' };
    },
    tests: [
      {
        n: 'elderly', i: { applies: 'y', age65: 'y', mech: 'n', paraes: 'n' },
        e: { risk: /Imaging required/, rows: [['Result', 'high-risk factor']], flags: [/no range-of-motion testing/] }
      },
      {
        n: 'walking well', i: {
          applies: 'y', age65: 'n', mech: 'n', paraes: 'n',
          rearEnd: 'n', sitting: 'y', ambulatory: 'y', delayed: 'n', noMidline: 'y', rotate: 'y'
        },
        e: { risk: /No imaging required/, rows: [['Result', 'collar may be removed']] }
      },
      {
        n: 'no low-risk factor', i: {
          applies: 'y', age65: 'n', mech: 'n', paraes: 'n',
          rearEnd: 'n', sitting: 'n', ambulatory: 'n', delayed: 'n', noMidline: 'n'
        },
        e: { risk: /Imaging required/, rows: [['Result', 'no low-risk factor']] }
      },
      { n: 'does not apply', i: { applies: 'n' }, e: { risk: /does not apply/, flags: [/full spinal precautions/] } },
      {
        n: 'cannot rotate', i: {
          applies: 'y', age65: 'n', mech: 'n', paraes: 'n',
          rearEnd: 'n', sitting: 'y', ambulatory: 'y', delayed: 'n', noMidline: 'y', rotate: 'n'
        },
        e: { risk: /Imaging required/, flags: [/Unable to rotate/] }
      }
    ]
  });

  C.def({
    id: 'nexus', n: 'NEXUS low-risk criteria', c: 'trauma', v: '1.0.0',
    t: ['nexus', 'c-spine', 'cervical', 'collar', 'neck'],
    ref: 'Hoffman JR et al. NEJM 2000;343:94.',
    i: [
      YN('midline', 'Midline cervical tenderness'),
      YN('deficit', 'Focal neurological deficit'),
      YN('alert', 'Abnormal alertness'),
      YN('intox', 'Evidence of intoxication'),
      YN('distract', 'Painful distracting injury')
    ],
    out: function (v, P) {
      const keys = ['midline', 'deficit', 'alert', 'intox', 'distract'];
      const unanswered = keys.filter(function (k) { return v[k] === undefined; });
      if (unanswered.length) {
        P.flag('Answer all five NEXUS criteria - unanswered is not negative');
        return { rows: [P.row('Result', 'Incomplete - ' + unanswered.length + ' criteria unanswered', 'bad')], risk: 'Incomplete' };
      }
      const positives = keys.filter(function (k) { return v[k] === true; });
      const rows = [];
      const clear = positives.length === 0;
      rows.push(P.row('Result', clear ? 'Cervical spine can be cleared clinically - no imaging' : 'IMAGING REQUIRED - ' + positives.length + ' criteria present', clear ? 'ok' : 'bad'));
      if (!clear) P.flag('NEXUS positive - maintain collar and image');
      rows.push(P.row('Note', 'NEXUS is less specific than the Canadian C-spine rule; in a sports event with an alert patient the Canadian rule spares more imaging', ''));
      return { rows: rows, risk: clear ? 'No imaging required' : 'Imaging required' };
    },
    tests: [
      { n: 'all negative', i: { midline: 'n', deficit: 'n', alert: 'n', intox: 'n', distract: 'n' }, e: { risk: /No imaging/, rows: [['Result', 'cleared clinically']] } },
      { n: 'midline tenderness', i: { midline: 'y', deficit: 'n', alert: 'n', intox: 'n', distract: 'n' }, e: { risk: /Imaging required/, flags: [/maintain collar/] } },
      { n: 'incomplete', i: { midline: 'n', deficit: 'n' }, e: { risk: /Incomplete/ } }
    ]
  });

  C.def({
    id: 'canadian-ct-head', n: 'Canadian CT head rule', c: 'trauma', v: '1.0.0',
    t: ['head injury', 'ct head', 'concussion', 'canadian', 'minor head injury'],
    ref: 'Stiell IG et al. Lancet 2001;357:1391.',
    i: [
      YN('applies', 'Minor head injury with witnessed loss of consciousness, amnesia or disorientation, GCS 13-15, age 16 or over, no anticoagulant or bleeding disorder, no obvious open skull fracture, no seizure after injury'),
      H('High risk - need for neurosurgical intervention'),
      YN('gcs2h', 'GCS below 15 two hours after injury'),
      YN('skull', 'Suspected open or depressed skull fracture'),
      YN('basal', 'Any sign of basal skull fracture (haemotympanum, raccoon eyes, CSF leak from ear or nose, Battle sign)'),
      YN('vomit', 'Two or more episodes of vomiting'),
      YN('age65', 'Age 65 or older', 1, { ctx: 'age', mapCtx: function (a) { return a >= 65 ? 'y' : 'n'; } }),
      H('Medium risk - clinically important brain injury'),
      YN('amnesia', 'Retrograde amnesia of 30 minutes or more'),
      YN('mech', 'Dangerous mechanism (pedestrian struck by a vehicle, occupant ejected, fall from over 3 feet or 5 stairs)')
    ],
    out: function (v, P) {
      const rows = [];
      if (v.applies === false) {
        P.flag('Canadian CT head rule does not apply - decide on clinical grounds, low threshold to image');
        return { rows: [P.row('Result', 'Rule does not apply', 'warn')], risk: 'Rule does not apply' };
      }
      const high = ['gcs2h', 'skull', 'basal', 'vomit', 'age65'];
      const med = ['amnesia', 'mech'];
      const unanswered = high.concat(med).filter(function (k) { return v[k] === undefined; });
      if (unanswered.length) {
        P.flag('Answer every criterion - unanswered is not negative');
        return { rows: [P.row('Result', 'Incomplete - ' + unanswered.length + ' criteria unanswered', 'bad')], risk: 'Incomplete' };
      }
      const hiPos = high.filter(function (k) { return v[k] === true; });
      const medPos = med.filter(function (k) { return v[k] === true; });
      let risk;
      if (hiPos.length) {
        risk = 'CT required (high risk)';
        rows.push(P.row('Result', 'CT HEAD REQUIRED - high-risk criterion present', 'bad'));
        P.flag('High-risk head injury criterion - ambulance transfer for CT, neuro observations en route');
      } else if (medPos.length) {
        risk = 'CT required (medium risk)';
        rows.push(P.row('Result', 'CT HEAD REQUIRED - medium-risk criterion present', 'bad'));
        P.flag('Medium-risk head injury criterion - transfer for CT');
      } else {
        risk = 'No CT required';
        rows.push(P.row('Result', 'No CT required by the rule', 'ok'));
        rows.push(P.row('Advice', 'Head injury advice sheet, responsible adult, return if vomiting, worsening headache, drowsiness or focal symptoms', 'ok'));
      }
      rows.push(P.row('Concussion', 'Any suspected concussion: immediate and permanent removal from play for that event, no same-day return, graded return-to-play protocol', 'bad'));
      P.flag('Suspected concussion - remove from play for the rest of the event, no same-day return');
      return { rows: rows, risk: risk };
    },
    tests: [
      { n: 'GCS 14 at 2 h', i: { applies: 'y', gcs2h: 'y', skull: 'n', basal: 'n', vomit: 'n', age65: 'n', amnesia: 'n', mech: 'n' }, e: { risk: /high risk/, flags: [/ambulance transfer for CT/] } },
      { n: 'amnesia only', i: { applies: 'y', gcs2h: 'n', skull: 'n', basal: 'n', vomit: 'n', age65: 'n', amnesia: 'y', mech: 'n' }, e: { risk: /medium risk/ } },
      { n: 'no criteria', i: { applies: 'y', gcs2h: 'n', skull: 'n', basal: 'n', vomit: 'n', age65: 'n', amnesia: 'n', mech: 'n' }, e: { risk: /No CT required/, flags: [/remove from play/] } },
      { n: 'does not apply', i: { applies: 'n' }, e: { risk: /does not apply/ } },
      { n: 'incomplete', i: { applies: 'y', gcs2h: 'n' }, e: { risk: /Incomplete/ } }
    ]
  });

  C.def({
    id: 'tbsa', n: 'TBSA burn area (rule of nines)', c: 'trauma', v: '1.0.0',
    t: ['burn', 'tbsa', 'rule of nines', 'lund browder', 'body surface area burn'],
    ref: 'Wallace AB. Lancet 1951;1:501 (rule of nines). Lund CC, Browder NC. Surg Gynecol Obstet 1944;79:352.',
    i: [
      H('Enter the percentage OF EACH REGION that is burned. Count partial thickness and deeper only - do not count simple erythema. A patient palm with fingers is about 1% TBSA.'),
      S('who', 'Patient', [['adult', 'Adult / over 10 years'], ['child', 'Child 10 years or under']], {
        ctx: 'age', mapCtx: function (a) { return a <= 10 ? 'child' : 'adult'; }, dflt: 'adult'
      }),
      N('head', 'Head and neck burned', { u: '% of region', min: 0, max: 100, opt: true }),
      N('armR', 'Right arm burned', { u: '% of region', min: 0, max: 100, opt: true }),
      N('armL', 'Left arm burned', { u: '% of region', min: 0, max: 100, opt: true }),
      N('trunkA', 'Anterior trunk burned', { u: '% of region', min: 0, max: 100, opt: true }),
      N('trunkP', 'Posterior trunk burned', { u: '% of region', min: 0, max: 100, opt: true }),
      N('legR', 'Right leg burned', { u: '% of region', min: 0, max: 100, opt: true }),
      N('legL', 'Left leg burned', { u: '% of region', min: 0, max: 100, opt: true }),
      N('perineum', 'Perineum burned', { u: '% of region', min: 0, max: 100, opt: true }),
      YN('inhalation', 'Facial burn, singed nasal hair, soot in the mouth, hoarseness or enclosed-space fire', 0, { opt: true }),
      YN('circum', 'Circumferential burn of a limb, neck or chest', 0, { opt: true })
    ],
    out: function (v, P) {
      const child = v.who === 'child';
      const regions = [
        { k: 'head', l: 'Head and neck', sz: child ? 18 : 9 },
        { k: 'armR', l: 'Right arm', sz: 9 },
        { k: 'armL', l: 'Left arm', sz: 9 },
        { k: 'trunkA', l: 'Anterior trunk', sz: 18 },
        { k: 'trunkP', l: 'Posterior trunk', sz: 18 },
        { k: 'legR', l: 'Right leg', sz: child ? 13.5 : 18 },
        { k: 'legL', l: 'Left leg', sz: child ? 13.5 : 18 },
        { k: 'perineum', l: 'Perineum', sz: 1 }
      ];
      const rows = [];
      let total = 0, any = false;
      regions.forEach(function (rg) {
        const pct = v[rg.k];
        if (!has(pct)) return;
        any = true;
        const contrib = rg.sz * clamp(pct, 0, 100) / 100;
        total += contrib;
        if (contrib > 0) rows.push(P.row(rg.l + ' (' + f(rg.sz, 1) + '% TBSA)', f(pct, 0) + '% of region = ' + f(contrib, 1) + '% TBSA', ''));
      });
      if (!any) {
        P.flag('Enter at least one burned region - a blank body map is not a 0% burn');
        return { rows: [P.row('TBSA', 'Enter the burned regions', 'warn')], risk: 'Incomplete' };
      }
      total = clamp(total, 0, 100);
      rows.unshift(P.row('Total TBSA', f(total, 1) + '%', total >= 20 ? 'bad' : (total >= 10 ? 'warn' : '')));
      rows.push(P.row('Chart used', child ? 'Paediatric (head 18%, each leg 13.5%)' : 'Adult rule of nines', ''));

      const threshold = child ? 10 : 15;
      const needsResus = total >= threshold;
      rows.push(P.row('Formal fluid resuscitation', needsResus
        ? 'YES - TBSA >=' + threshold + '% (' + (child ? 'child' : 'adult') + '). Use the Parkland tool.'
        : 'Not required by area alone - oral fluids and analgesia', needsResus ? 'bad' : 'ok'));
      if (needsResus) P.flag('TBSA >=' + threshold + '% - IV crystalloid resuscitation, open the Parkland calculator');
      if (total >= 20) P.flag('Major burn (>=20% TBSA) - burn centre, early airway assessment, keep warm');
      if (v.inhalation === true) P.flag('Inhalation injury suspected - intubate early while the airway is still passable, 100% oxygen, consider cyanide toxicity');
      if (v.circum === true) P.flag('Circumferential burn - serial neurovascular checks, escharotomy may be needed, do not apply tight dressings');

      rows.push(P.row('First aid', 'Cool running water 20 min (within 3 h of injury), then cling film or a clean dry sheet. Never ice.', ''));
      rows.push(P.row('Keep warm', 'Burn patients lose heat fast - cover, blankets, warm the ambulance', 'warn'));
      rows.push(P.row('Analgesia', 'Fentanyl 1 mcg/kg IV titrated; burns hurt more than you think', ''));
      return { rows: rows, score: rd(total, 1), risk: (needsResus ? 'Resuscitation required' : 'Minor by area') };
    },
    tests: [
      {
        n: 'adult head and one arm', i: { who: 'adult', head: 100, armR: 100 },
        e: { score: 18, risk: /Resuscitation required/, rows: [['Total TBSA', '18']], flags: [/Parkland/] }
      },
      {
        n: 'child head', i: { who: 'child', head: 100 }, p: { age: 5 },
        e: { score: 18, rows: [['Chart used', 'Paediatric']] }
      },
      {
        n: 'partial regions', i: { who: 'adult', trunkA: 50, legR: 25 },
        e: { score: 13.5, rows: [['Total TBSA', '13.5'], ['Formal fluid resuscitation', 'Not required']] }
      },
      {
        n: 'major with inhalation', i: { who: 'adult', head: 100, trunkA: 100, inhalation: 'y', circum: 'y' },
        e: { score: 27, flags: [/Major burn/, /Inhalation injury/, /Circumferential/] }
      },
      { n: 'blank map', i: { who: 'adult' }, e: { risk: /Incomplete/, flags: [/not a 0% burn/] } }
    ]
  });

  C.def({
    id: 'parkland', n: 'Parkland / ABA burn fluid', c: 'trauma', v: '1.0.0',
    t: ['parkland', 'burn fluid', 'resuscitation', 'brooke', 'abls'],
    ref: 'Baxter CR, Shires T. Ann NY Acad Sci 1968;150:874 (Parkland). ABA/ABLS Advanced Burn Life Support 2018 (2 mL/kg/% adult, 3 mL/kg/% paediatric).',
    i: [
      N('tbsa', 'TBSA burned (partial thickness and deeper)', { u: '%', min: 1, max: 100, step: 0.5 }),
      N('wt', 'Weight', { u: 'kg', min: 2, max: 250, step: 0.1, ctx: 'weight' }),
      N('hours', 'Hours since the burn', { u: 'h', min: 0, max: 24, step: 0.25, opt: true }),
      N('given', 'Crystalloid already given', { u: 'mL', min: 0, max: 20000, opt: true }),
      S('who', 'Patient', [['adult', 'Adult'], ['child', 'Child under 30 kg']], {
        ctx: 'weight', mapCtx: function (w) { return w < 30 ? 'child' : 'adult'; }, dflt: 'adult'
      })
    ],
    out: function (v, P) {
      const rows = [];
      if (!has(v.wt)) {
        P.flag('Weight missing - burn fluid volumes not calculated');
        return { rows: [P.row('Fluid', 'Enter weight', 'bad')], risk: 'Weight required' };
      }
      if (!has(v.tbsa)) {
        P.flag('TBSA required - use the TBSA tool first');
        return { rows: [P.row('Fluid', 'Enter TBSA', 'bad')], risk: 'TBSA required' };
      }
      const child = v.who === 'child';
      const threshold = child ? 10 : 15;
      if (v.tbsa < threshold) {
        rows.push(P.row('Resuscitation', 'Below the ' + threshold + '% threshold - oral fluids plus maintenance, no formula-driven IV resuscitation', 'ok'));
        P.flag('TBSA below the resuscitation threshold - do not formula-resuscitate, treat pain and give oral fluid');
      }

      const park = 4 * v.wt * v.tbsa;
      const abaPerKg = child ? 3 : 2;
      const aba = abaPerKg * v.wt * v.tbsa;
      rows.push(P.row('Parkland 24 h total (4 mL/kg/%)', f(park, 0) + ' mL', ''));
      rows.push(P.row('ABA/ABLS 24 h total (' + abaPerKg + ' mL/kg/%)', f(aba, 0) + ' mL', ''));
      rows.push(P.row('First 8 h (Parkland)', f(park / 2, 0) + ' mL', ''));
      rows.push(P.row('Next 16 h (Parkland)', f(park / 2, 0) + ' mL at ' + f(park / 32, 0) + ' mL/h', ''));

      const remain = has(v.hours) ? (8 - v.hours) : 8;
      if (has(v.hours)) {
        if (remain > 0) {
          const already = has(v.given) ? v.given : 0;
          const left = park / 2 - already;
          rows.push(P.row('Catch-up rate now (Parkland)', f(Math.max(left, 0) / remain, 0) + ' mL/h for the next ' + f(remain, 2) + ' h', 'bad'));
          rows.push(P.row('Catch-up rate now (ABA)', f(Math.max(aba / 2 - already, 0) / remain, 0) + ' mL/h', 'warn'));
          if (has(v.given)) rows.push(P.row('Already given', f(already, 0) + ' mL', ''));
        } else {
          rows.push(P.row('Catch-up rate now', 'Past the first 8 h - run the second-phase rate ' + f(park / 32, 0) + ' mL/h and titrate to urine output', 'warn'));
        }
      } else {
        rows.push(P.row('First 8 h rate (from time of injury)', f(park / 16, 0) + ' mL/h', 'bad'));
        rows.push(P.row('Catch-up rate', 'Enter hours since the burn to get the catch-up rate', 'warn'));
        P.flag('Time of injury not entered - the first-8-hour rate assumes you start at the moment of the burn');
      }

      rows.push(P.row('Fluid', 'Ringer lactate is the fluid of choice (NaCl 0.9% is acceptable)', ''));
      const uo = child ? 1 * v.wt : 0.5 * v.wt;
      rows.push(P.row('Urine output target', f(uo, 0) + ' mL/h (' + (child ? '1' : '0.5') + ' mL/kg/h)', 'warn'));
      if (child) {
        const maint = holliday(v.wt);
        rows.push(P.row('Plus maintenance (child)', f(maint.perHour, 0) + ' mL/h of dextrose-containing fluid, in addition to the resuscitation volume', 'warn'));
        P.flag('Children under 30 kg need maintenance fluid WITH dextrose on top of the burn resuscitation volume');
      }
      rows.push(P.row('Titrate, do not obey', 'The formula is a starting point. Titrate to urine output; over-resuscitation (fluid creep) causes compartment syndrome and oedema.', 'bad'));
      rows.push(P.row('Also', 'Analgesia, keep warm, tetanus status, remove rings and constricting items, no prophylactic antibiotics', ''));
      return { rows: rows, score: rd(park, 0), risk: 'Parkland ' + f(park, 0) + ' mL / 24 h' };
    },
    tests: [
      {
        n: '70 kg, 30%, 2 h in', i: { tbsa: 30, wt: 70, hours: 2, who: 'adult' },
        e: {
          score: 8400,
          rows: [['Parkland 24 h total', '8400'], ['First 8 h (Parkland)', '4200'], ['Catch-up rate now (Parkland)', '700'],
          ['ABA/ABLS 24 h total', '4200'], ['Catch-up rate now (ABA)', '350'], ['Urine output target', '35']]
        }
      },
      {
        n: 'no elapsed time', i: { tbsa: 30, wt: 70, who: 'adult' },
        e: { rows: [['First 8 h rate', '525'], ['Catch-up rate', 'Enter hours']], flags: [/assumes you start/] }
      },
      { n: 'no weight', i: { tbsa: 30 }, e: { risk: /Weight required/, flags: [/not calculated/] } },
      { n: 'below threshold', i: { tbsa: 8, wt: 70, who: 'adult' }, e: { rows: [['Resuscitation', 'Below the 15% threshold']], flags: [/do not formula-resuscitate/] } },
      {
        n: 'child adds maintenance', i: { tbsa: 20, wt: 20, who: 'child' }, p: { age: 6 },
        e: { rows: [['Plus maintenance (child)', '60'], ['Urine output target', '20'], ['ABA/ABLS 24 h total', '1200']], flags: [/WITH dextrose/] }
      }
    ]
  });

  C.def({
    id: 'rts', n: 'Revised Trauma Score', c: 'trauma', v: '1.0.0',
    t: ['rts', 'trauma score', 'triage', 'trauma centre'],
    ref: 'Champion HR et al. J Trauma 1989;29:623.',
    i: [
      N('gcs', 'GCS', { min: 3, max: 15, ctx: 'gcs' }),
      N('sbp', 'Systolic BP', { u: 'mmHg', min: 0, max: 300, ctx: 'sbp' }),
      N('rr', 'Respiratory rate', { u: '/min', min: 0, max: 60, ctx: 'rr' })
    ],
    out: function (v, P) {
      if (!has(v.gcs) || !has(v.sbp) || !has(v.rr)) {
        P.flag('All three parameters required - a missing value is not a normal value');
        return { rows: [P.row('RTS', 'Enter GCS, systolic BP and respiratory rate', 'warn')], risk: 'Incomplete' };
      }
      const g = v.gcs >= 13 ? 4 : v.gcs >= 9 ? 3 : v.gcs >= 6 ? 2 : v.gcs >= 4 ? 1 : 0;
      const s = v.sbp > 89 ? 4 : v.sbp >= 76 ? 3 : v.sbp >= 50 ? 2 : v.sbp >= 1 ? 1 : 0;
      const r = (v.rr >= 10 && v.rr <= 29) ? 4 : v.rr > 29 ? 3 : v.rr >= 6 ? 2 : v.rr >= 1 ? 1 : 0;
      const rts = 0.9368 * g + 0.7326 * s + 0.2908 * r;
      const trts = g + s + r;
      const rows = [];
      rows.push(P.row('RTS', f(rts, 4) + ' / 7.8408', rts < 4 ? 'bad' : (rts < 7 ? 'warn' : 'ok')));
      rows.push(P.row('Triage-RTS (coded sum)', String(trts) + ' / 12', trts <= 11 ? 'bad' : 'ok'));
      rows.push(P.row('Coded values', 'GCS ' + g + ', SBP ' + s + ', RR ' + r, ''));
      let risk;
      if (trts <= 11) {
        risk = 'Trauma centre triage positive';
        rows.push(P.row('Triage', 'Triage-RTS below 12 - transport to a trauma centre', 'bad'));
        P.flag('Triage-RTS <12 - transport to the highest level of trauma care available');
      } else {
        risk = 'Triage-RTS normal (12)';
        rows.push(P.row('Triage', 'Physiology normal - this does not exclude significant injury; use mechanism and anatomy too', 'warn'));
      }
      if (rts < 4) P.flag('RTS <4 - very high mortality, pre-alert the receiving hospital');
      return { rows: rows, score: rd(rts, 4), risk: risk };
    },
    tests: [
      { n: 'normal physiology', i: { gcs: 15, sbp: 120, rr: 16 }, e: { score: 7.8408, rows: [['Triage-RTS', '12']], risk: /normal/ } },
      { n: 'deranged', i: { gcs: 10, sbp: 80, rr: 32 }, e: { score: 5.8806, rows: [['Triage-RTS', '9'], ['Coded values', 'GCS 3, SBP 3, RR 3']], risk: /Trauma centre/, flags: [/highest level/] } },
      { n: 'agonal', i: { gcs: 3, sbp: 40, rr: 4 }, e: { score: 1.0234, flags: [/very high mortality/] } },
      { n: 'incomplete', i: { gcs: 15, sbp: 120 }, e: { risk: /Incomplete/, flags: [/not a normal value/] } }
    ]
  });

  C.def({
    id: 'compartment', n: 'Compartment pressure (delta P)', c: 'trauma', v: '1.0.0',
    t: ['compartment syndrome', 'delta p', 'fasciotomy', 'crush', 'intracompartmental'],
    ref: 'McQueen MM, Court-Brown CM. J Bone Joint Surg Br 1996;78:99 (delta P <30 mmHg).',
    i: [
      N('dbp', 'Diastolic BP', { u: 'mmHg', min: 20, max: 200, ctx: 'dbp' }),
      N('icp', 'Intracompartmental pressure', { u: 'mmHg', min: 0, max: 150 }),
      YN('painStretch', 'Pain on passive stretch of the compartment', 0, { opt: true }),
      YN('painOut', 'Pain out of proportion to the injury', 0, { opt: true }),
      YN('paraes', 'Paraesthesia or sensory loss in the compartment distribution', 0, { opt: true }),
      YN('tense', 'Tense, woody compartment on palpation', 0, { opt: true })
    ],
    out: function (v, P) {
      const rows = [];
      const clinical = [v.painStretch, v.painOut, v.paraes, v.tense].filter(function (x) { return x === true; }).length;
      if (clinical >= 2) P.flag('Two or more clinical features of compartment syndrome - surgical opinion now, do not wait for a pressure reading');

      if (!has(v.dbp) || !has(v.icp)) {
        rows.push(P.row('Delta P', 'Enter diastolic BP and compartment pressure', 'warn'));
        rows.push(P.row('Remember', 'Compartment syndrome is a CLINICAL diagnosis. Pain out of proportion plus pain on passive stretch is enough to act on.', 'bad'));
        P.flag('Pressures not entered - a missing delta P does not exclude compartment syndrome');
        return { rows: rows, risk: 'Incomplete', score: undefined };
      }
      const dp = v.dbp - v.icp;
      let risk, cls;
      if (dp < 30) { risk = 'Compartment syndrome - fasciotomy indicated'; cls = 'bad'; }
      else if (dp < 40) { risk = 'Borderline - repeat measurement, continuous monitoring'; cls = 'warn'; }
      else { risk = 'Compartment syndrome unlikely on pressure alone'; cls = 'ok'; }
      rows.push(P.row('Delta P (DBP - compartment)', f(dp, 0) + ' mmHg', cls));
      rows.push(P.row('Interpretation', risk, cls));
      rows.push(P.row('Absolute pressure', f(v.icp, 0) + ' mmHg' + (v.icp >= 30 ? ' - above the 30 mmHg concern threshold' : ''), v.icp >= 30 ? 'bad' : ''));
      if (dp < 30) P.flag('Delta P <30 mmHg - emergency fasciotomy, transfer to theatre, do not delay');
      rows.push(P.row('Do NOT', 'Do not elevate the limb above the heart, do not apply ice, do not bandage tightly - all reduce perfusion pressure', 'bad'));
      rows.push(P.row('Do', 'Split or remove casts and dressings, keep the limb at heart level, oxygen, analgesia, correct hypotension', ''));
      rows.push(P.row('Clinical features present', String(clinical) + ' of 4', clinical >= 2 ? 'bad' : ''));
      return { rows: rows, score: rd(dp, 0), risk: risk };
    },
    tests: [
      { n: 'fasciotomy', i: { dbp: 80, icp: 55 }, e: { score: 25, risk: /fasciotomy indicated/, flags: [/emergency fasciotomy/] } },
      { n: 'unlikely', i: { dbp: 80, icp: 20 }, e: { score: 60, risk: /unlikely/, noFlag: [/emergency fasciotomy/] } },
      { n: 'borderline', i: { dbp: 75, icp: 40 }, e: { score: 35, risk: /Borderline/ } },
      { n: 'clinical without pressures', i: { painStretch: 'y', painOut: 'y' }, e: { risk: /Incomplete/, flags: [/do not wait for a pressure reading/, /does not exclude/] } }
    ]
  });

  /* ================================================================== *
   * AIRWAY & DRUGS
   * ================================================================== */

  /* Stocked concentrations from the three standby manifests. */
  const CONC = {
    fentanyl: { l: 'Fentanyl 100 mcg/2 mL', perMl: 50, unit: 'mcg' },
    midazolam: { l: 'Midazolam 15 mg/3 mL', perMl: 5, unit: 'mg' },
    propofol: { l: 'Propofol 200 mg/20 mL', perMl: 10, unit: 'mg' },
    rocuronium: { l: 'Rocuronium 50 mg/5 mL', perMl: 10, unit: 'mg' },
    adr1000: { l: 'Epinephrine 1 mg/mL (1:1000)', perMl: 1, unit: 'mg' },
    adr10000: { l: 'Epinephrine 1:10,000 (1 mg diluted to 10 mL)', perMl: 0.1, unit: 'mg' },
    atropine: { l: 'Atropine 0.25 mg/mL', perMl: 0.25, unit: 'mg' },
    amiodarone: { l: 'Amiodarone 150 mg/3 mL', perMl: 50, unit: 'mg' },
    ketorolac: { l: 'Ketorolac 30 mg/mL', perMl: 30, unit: 'mg' },
    ondansetron: { l: 'Ondansetron 4 mg/2 mL', perMl: 2, unit: 'mg' },
    dexamethasone: { l: 'Dexamethasone 10 mg/mL', perMl: 10, unit: 'mg' },
    diphenhydramine: { l: 'Diphenhydramine 10 mg/mL', perMl: 10, unit: 'mg' },
    furosemide: { l: 'Furosemide 10 mg/mL', perMl: 10, unit: 'mg' },
    mgso4: { l: 'MgSO4 400 mg/25 mL (20%)', perMl: 16, unit: 'mg' },
    caGluconas: { l: 'Calcium gluconate 10%', perMl: 100, unit: 'mg' },
    d40: { l: 'D40 25 mL flacon (10 g per flacon)', perMl: 0.4, unit: 'g' },
    d10: { l: 'D10 500 mL (50 g per bag)', perMl: 0.1, unit: 'g' }
  };
  C.CONC = CONC;

  C.def({
    id: 'weight-engine', n: 'Weight engine (IBW, AdjBW, LBW, BSA, BMI)', c: 'airway', v: '1.0.0',
    t: ['ibw', 'adjbw', 'lbw', 'bsa', 'bmi', 'ideal body weight', 'dosing weight', 'devine', 'mosteller'],
    ref: 'Devine BJ. Drug Intell Clin Pharm 1974;8:650. Janmahasatian S et al. Clin Pharmacokinet 2005;44:1051 (LBW). Mosteller RD. NEJM 1987;317:1098 (BSA).',
    i: [
      N('wt', 'Actual body weight', { u: 'kg', min: 2, max: 300, step: 0.1, ctx: 'weight' }),
      N('height', 'Height', { u: 'cm', min: 40, max: 230, step: 0.5, ctx: 'height' }),
      S('sex', 'Sex', [['M', 'Male'], ['F', 'Female']], { ctx: 'sex' }),
      N('age', 'Age', { u: 'years', min: 0, max: 110, ctx: 'age', opt: true })
    ],
    out: function (v, P) {
      const rows = [];
      if (!has(v.wt)) {
        P.flag('Weight missing - nothing can be calculated');
        return { rows: [P.row('Weights', 'Enter actual body weight', 'bad')], risk: 'Weight required' };
      }
      const W = C.weights(v.wt, v.height, v.sex, has(v.age) ? v.age : P.age);
      rows.push(P.row('Actual body weight (ABW)', f(W.abw, 1) + ' kg', ''));
      if (!has(v.height)) {
        rows.push(P.row('Height needed for', 'IBW, AdjBW, LBW, BSA and BMI', 'warn'));
        P.flag('Height missing - only actual body weight is available');
      } else {
        if (has(W.ibw)) rows.push(P.row('Ideal body weight (Devine)', f(W.ibw, 1) + ' kg', ''));
        else rows.push(P.row('Ideal body weight (Devine)', 'Devine is not valid below 137 cm - use actual weight', 'warn'));
        if (has(W.adjbw)) rows.push(P.row('Adjusted body weight', f(W.adjbw, 1) + ' kg (IBW + 0.4 x excess)', ''));
        if (has(W.lbw)) rows.push(P.row('Lean body weight (Janmahasatian)', f(W.lbw, 1) + ' kg', ''));
        if (has(W.bmi)) {
          let bcls = '', btxt = '';
          if (W.bmi < 18.5) { bcls = 'warn'; btxt = ' - underweight'; }
          else if (W.bmi < 25) { bcls = 'ok'; btxt = ' - normal'; }
          else if (W.bmi < 30) { bcls = 'warn'; btxt = ' - overweight'; }
          else { bcls = 'bad'; btxt = ' - obese'; }
          rows.push(P.row('BMI', f(W.bmi, 1) + ' kg/m2' + btxt, bcls));
        }
        if (has(W.bsa)) rows.push(P.row('BSA (Mosteller)', f(W.bsa, 2) + ' m2', ''));
        if (has(W.bsaDuBois)) rows.push(P.row('BSA (Du Bois)', f(W.bsaDuBois, 2) + ' m2', ''));
      }
      rows.push(P.row('Dosing weight to use', f(W.dosing, 1) + ' kg - ' + W.basis, 'warn'));
      rows.push(P.row('Total body water', f(W.tbw, 1) + ' L (' + f(W.tbwFrac * 100, 0) + '% of body weight)', ''));
      rows.push(P.row('Which weight for what', 'ABW: adrenaline, defibrillation, fluids, suxamethonium. IBW/AdjBW: propofol maintenance, aminophylline. LBW: rocuronium, propofol induction, fentanyl. Paediatrics: actual weight, capped at the adult dose.', ''));
      if (has(W.bmi) && W.bmi >= 30) P.flag('BMI >=30 - use adjusted body weight for most dosing and never exceed the adult maximum');
      return { rows: rows, score: rd(W.dosing, 1), risk: W.basis };
    },
    tests: [
      {
        n: '180 cm male 80 kg', i: { wt: 80, height: 180, sex: 'M', age: 30 },
        e: {
          score: 80,
          rows: [['Ideal body weight', '75'], ['Adjusted body weight', '77'], ['Lean body weight', '61.7'],
          ['BMI', '24.7'], ['BSA (Mosteller)', '2'], ['Dosing weight', 'Actual body weight']]
        }
      },
      {
        n: 'obese female uses AdjBW', i: { wt: 110, height: 165, sex: 'F', age: 40 },
        e: { score: 78.1, rows: [['Ideal body weight', '56.9'], ['BMI', '40.4'], ['Dosing weight', 'AdjBW']], flags: [/BMI >=30/] }
      },
      {
        n: 'paediatric uses actual weight', i: { wt: 20, height: 110, sex: 'M', age: 6 },
        e: { score: 20, rows: [['Dosing weight', 'Actual body weight (paediatric)'], ['Ideal body weight', 'not valid below 137 cm']] }
      },
      { n: 'no height', i: { wt: 70, sex: 'M' }, e: { rows: [['Height needed for', 'IBW']], flags: [/Height missing/] } },
      { n: 'no weight', i: { height: 170 }, e: { risk: /Weight required/, flags: [/nothing can be calculated/] } }
    ]
  });

  C.def({
    id: 'rsi', n: 'RSI panel', c: 'airway', v: '1.0.0',
    t: ['rsi', 'intubation', 'induction', 'rocuronium', 'airway', 'ett', 'laryngoscope'],
    ref: 'Difficult Airway Society 2015 guidelines. ANZCA/ACEM RSI practice. Doses from standard emergency airway references; concentrations from the event formulary.',
    i: [
      N('wt', 'Weight', { u: 'kg', min: 2, max: 250, step: 0.1, ctx: 'weight' }),
      N('age', 'Age', { u: 'years', min: 0, max: 110, ctx: 'age', opt: true }),
      S('sex', 'Sex', [['M', 'Male'], ['F', 'Female']], { ctx: 'sex', opt: true }),
      YN('shock', 'Shocked, hypotensive or haemorrhaging', 0, { opt: true }),
      N('sbp', 'Systolic BP', { u: 'mmHg', min: 40, max: 300, ctx: 'sbp', opt: true })
    ],
    out: function (v, P) {
      const rows = [];
      const age = has(v.age) ? v.age : P.age;
      const paed = has(age) && age < 12;
      const shocked = v.shock === true || (has(v.sbp) && v.sbp < 90);

      rows.push(P.row('Checklist', 'Position 25-30 degrees or ramped, preoxygenate 3 min or 8 vital capacity breaths, nasal O2 15 L/min for apnoeic oxygenation, suction x2, bougie, size up and down ETT, LMA backup, capnography, post-intubation sedation drawn up', 'warn'));
      if (!has(v.wt)) {
        P.flag('Weight missing - no RSI doses calculated');
        rows.push(P.row('Doses', 'Enter weight - RSI doses are not calculated without it', 'bad'));
        if (has(age) && age >= 1 && age <= 10) rows.push(P.row('Weight estimate', 'If weight is unavailable: (age + 4) x 2 = ' + f((age + 4) * 2, 0) + ' kg, or use a length-based tape', 'warn'));
      } else {
        const w = v.wt;
        rows.push(P.row('Fentanyl (analgesia)', amtVol(cap(2 * w, 200), 'mcg', CONC.fentanyl.perMl) + '  [1-3 mcg/kg, ' + CONC.fentanyl.l + ']', ''));
        if (shocked) {
          rows.push(P.row('Induction - shocked', 'Midazolam ' + amtVol(cap(0.05 * w, 5), 'mg', CONC.midazolam.perMl) + ' (0.05 mg/kg) OR propofol ' + amtVol(1 * w, 'mg', CONC.propofol.perMl) + ' (1 mg/kg, halved for shock)', 'bad'));
          P.flag('Shocked patient - halve the induction dose, keep the paralytic dose full, have a vasopressor drawn up before you push');
        } else {
          rows.push(P.row('Induction - propofol', amtVol(2 * w, 'mg', CONC.propofol.perMl) + '  [1.5-2.5 mg/kg, ' + CONC.propofol.l + ']', ''));
          rows.push(P.row('Induction - midazolam', amtVol(0.2 * w, 'mg', CONC.midazolam.perMl) + '  [0.1-0.3 mg/kg, ' + CONC.midazolam.l + ']', ''));
        }
        rows.push(P.row('Rocuronium (RSI dose)', amtVol(1.2 * w, 'mg', CONC.rocuronium.perMl) + '  [1-1.2 mg/kg, ' + CONC.rocuronium.l + ']', 'bad'));
        rows.push(P.row('Ketamine (if stocked)', amtVol(1.5 * w, 'mg', 100) + '  [1-2 mg/kg; NOT in the default event formulary - add it for mass-gathering kits]', 'warn'));
        rows.push(P.row('Push-dose adrenaline', '1 mg in 100 mL NaCl = 10 mcg/mL. Give 0.5-2 mL (5-20 mcg) every 2-5 min for peri-intubation hypotension.', 'warn'));
        rows.push(P.row('Post-intubation sedation', 'Midazolam 0.02-0.1 mg/kg/h = ' + f(0.05 * w, 1) + ' mg/h, plus fentanyl 0.5-2 mcg/kg/h = ' + f(1 * w, 0) + ' mcg/h - use the infusion tool', ''));

        /* airway sizing */
        if (paed && has(age)) {
          const cuffed = age / 4 + 3.5;
          const uncuffed = age / 4 + 4;
          rows.push(P.row('ETT size (cuffed)', f(cuffed, 1) + ' mm ID  [age/4 + 3.5]', ''));
          rows.push(P.row('ETT size (uncuffed)', f(uncuffed, 1) + ' mm ID  [age/4 + 4]', ''));
          rows.push(P.row('ETT depth at lips', f(cuffed * 3, 1) + ' cm  [ID x 3], cross-check age/2 + 12 = ' + f(age / 2 + 12, 1) + ' cm', ''));
          rows.push(P.row('Blade', 'Miller 1-2 for infants, Macintosh 2 for small children', ''));
        } else {
          const female = String(v.sex || P.sex).toUpperCase() === 'F';
          rows.push(P.row('ETT size', female ? '7.0-7.5 mm ID (formulary stocks 7.0 and 7.5)' : '7.5-8.0 mm ID (formulary stocks 7.5)', ''));
          rows.push(P.row('ETT depth at lips', female ? '21 cm' : '23 cm', ''));
          rows.push(P.row('Blade', 'Macintosh 3, Macintosh 4 for a large adult', ''));
        }
        const lma = w < 5 ? '1' : w < 10 ? '1.5' : w < 20 ? '2' : w < 30 ? '2.5' : w < 50 ? '3' : w <= 70 ? '4' : '5';
        rows.push(P.row('LMA size (Air-Q)', 'Size ' + lma + ' for ' + f(w, 0) + ' kg (formulary stocks Air-Q size 4)', ''));
        const opa = w < 20 ? 'small (infant/child)' : (w < 50 ? 'Guedel red' : 'Guedel purple or red by jaw measurement');
        rows.push(P.row('OPA', opa + ' - size from incisors to angle of jaw', ''));
      }
      rows.push(P.row('Failed intubation', 'Plan A laryngoscopy x3 max, Plan B LMA, Plan C face mask with two-person technique, Plan D front-of-neck access. Declare the plan out loud before you start.', 'bad'));
      rows.push(P.row('Confirm', 'Waveform capnography is the only acceptable confirmation. No trace, wrong place.', 'bad'));
      P.flag('RSI at an event post: you are single-handed with no backup - consider bag-mask and rapid transfer instead unless the airway is unmaintainable');
      return { rows: rows, risk: has(v.wt) ? 'Doses calculated' : 'Weight required' };
    },
    tests: [
      {
        n: '70 kg adult male', i: { wt: 70, age: 35, sex: 'M' },
        e: {
          rows: [['Rocuronium', '84 mg'], ['Rocuronium', '8.4 mL'], ['Fentanyl', '140 mcg'], ['Fentanyl', '2.8 mL'],
          ['Induction - propofol', '140 mg'], ['Induction - propofol', '14 mL'], ['Induction - midazolam', '14 mg'],
          ['ETT size', '7.5-8.0'], ['LMA size', 'Size 4']],
          flags: [/single-handed/]
        }
      },
      {
        n: 'shocked halves induction', i: { wt: 70, age: 50, sbp: 80 },
        e: { rows: [['Induction - shocked', '3.5 mg'], ['Induction - shocked', '70 mg'], ['Rocuronium', '84 mg']], flags: [/halve the induction dose/] }
      },
      {
        n: 'paediatric ETT', i: { wt: 20, age: 6 },
        e: { rows: [['ETT size (cuffed)', '5'], ['ETT size (uncuffed)', '5.5'], ['ETT depth at lips', '15'], ['Rocuronium', '24 mg'], ['LMA size', 'Size 2.5']] }
      },
      {
        n: 'no weight refuses doses', i: { age: 6 },
        e: { risk: /Weight required/, rows: [['Doses', 'Enter weight'], ['Weight estimate', '20 kg']], flags: [/no RSI doses calculated/] }
      },
      { n: 'female adult sizing', i: { wt: 60, age: 30, sex: 'F' }, e: { rows: [['ETT size', '7.0-7.5'], ['ETT depth at lips', '21 cm'], ['LMA size', 'Size 4']] } }
    ]
  });

  const INF_PRESETS = {
    norepi: { l: 'Norepinephrine (Vascon)', mg: 4, mL: 50, unit: 'mcg/kg/min', lo: 0.05, hi: 0.5, note: 'Central line preferred; extravasation causes necrosis. 4 mg in 50 mL = 80 mcg/mL.' },
    adrenaline: { l: 'Adrenaline (Epinephrine)', mg: 1, mL: 50, unit: 'mcg/kg/min', lo: 0.05, hi: 0.5, note: '1 mg in 50 mL = 20 mcg/mL. First line for anaphylaxis refractory to IM, and for post-arrest.' },
    dopamine: { l: 'Dopamine', mg: 200, mL: 50, unit: 'mcg/kg/min', lo: 5, hi: 20, note: '200 mg/5 mL ampoule diluted to 50 mL = 4000 mcg/mL.' },
    dobutamine: { l: 'Dobutamine', mg: 250, mL: 50, unit: 'mcg/kg/min', lo: 2, hi: 20, note: '250 mg/5 mL ampoule diluted to 50 mL = 5000 mcg/mL. Inotrope, may drop blood pressure.' },
    nitroglycerin: { l: 'Nitroglycerin', mg: 50, mL: 50, unit: 'mcg/min', lo: 5, hi: 200, note: '50 mg in 50 mL = 1000 mcg/mL. Not weight based. Contraindicated with PDE5 inhibitors and in RV infarction.' },
    amiodarone: { l: 'Amiodarone maintenance', mg: 900, mL: 500, unit: 'mg/min', lo: 0.5, hi: 1, note: '1 mg/min for 6 h then 0.5 mg/min for 18 h after the 150-300 mg load.' },
    fentanyl: { l: 'Fentanyl', mg: 0.5, mL: 50, unit: 'mcg/kg/h', lo: 0.5, hi: 2, note: '500 mcg in 50 mL = 10 mcg/mL.' },
    midazolam: { l: 'Midazolam', mg: 50, mL: 50, unit: 'mg/kg/h', lo: 0.02, hi: 0.1, note: '50 mg in 50 mL = 1 mg/mL.' },
    mgso4: { l: 'Magnesium sulphate', mg: 2000, mL: 50, unit: 'mg/h', lo: 500, hi: 1000, note: 'Severe asthma, eclampsia, torsade. Watch reflexes and respiratory rate.' }
  };
  C.INF_PRESETS = INF_PRESETS;

  C.def({
    id: 'infusion', n: 'Infusion dose to mL/h (and back)', c: 'airway', v: '1.0.0',
    t: ['infusion', 'syringe pump', 'ml/h', 'mcg/kg/min', 'vasopressor', 'pump', 'rate'],
    ref: 'Standard dimensional analysis: rate (mL/h) = dose x weight x 60 / concentration (mcg/mL). Preset strengths from the event formulary.',
    i: [
      S('preset', 'Preset', [
        ['', 'Custom'],
        ['norepi', 'Norepinephrine (Vascon) 4 mg/50 mL'],
        ['adrenaline', 'Adrenaline 1 mg/50 mL'],
        ['dopamine', 'Dopamine 200 mg/50 mL'],
        ['dobutamine', 'Dobutamine 250 mg/50 mL'],
        ['nitroglycerin', 'Nitroglycerin 50 mg/50 mL'],
        ['amiodarone', 'Amiodarone 900 mg/500 mL'],
        ['fentanyl', 'Fentanyl 500 mcg/50 mL'],
        ['midazolam', 'Midazolam 50 mg/50 mL'],
        ['mgso4', 'MgSO4 2 g/50 mL']
      ], { opt: true }),
      S('dir', 'Direction', [['toRate', 'Dose -> mL/h'], ['toDose', 'mL/h -> dose']], { dflt: 'toRate' }),
      S('unit', 'Dose units', [
        ['mcg/kg/min', 'mcg/kg/min'], ['mcg/kg/h', 'mcg/kg/h'], ['mg/kg/h', 'mg/kg/h'],
        ['mcg/min', 'mcg/min'], ['mg/min', 'mg/min'], ['mg/h', 'mg/h']
      ], { opt: true }),
      N('dose', 'Dose', { min: 0, max: 100000, step: 0.01, opt: true }),
      N('rate', 'Pump rate', { u: 'mL/h', min: 0, max: 1000, step: 0.1, opt: true }),
      N('amount', 'Drug amount in the bag or syringe', { u: 'mg', min: 0.01, max: 100000, step: 0.01, opt: true }),
      N('vol', 'Diluent volume', { u: 'mL', min: 1, max: 1000, opt: true }),
      N('wt', 'Weight', { u: 'kg', min: 2, max: 250, step: 0.1, ctx: 'weight', opt: true })
    ],
    out: function (v, P) {
      const rows = [];
      const pre = v.preset ? INF_PRESETS[v.preset] : null;
      const amount = has(v.amount) ? v.amount : (pre ? pre.mg : undefined);
      const vol = has(v.vol) ? v.vol : (pre ? pre.mL : undefined);
      const unit = has(v.unit) ? v.unit : (pre ? pre.unit : undefined);

      if (pre) rows.push(P.row('Preset', pre.l + ' - ' + pre.note, ''));
      if (!has(amount) || !has(vol) || vol <= 0 || !has(unit)) {
        P.flag('Drug amount, diluent volume and dose units are all required');
        return { rows: [P.row('Rate', 'Enter drug amount, volume and dose units', 'warn')], risk: 'Incomplete' };
      }
      const concMcgMl = amount * 1000 / vol;
      rows.push(P.row('Concentration', f(concMcgMl, 1) + ' mcg/mL (' + f(amount, 2) + ' mg in ' + f(vol, 0) + ' mL = ' + f(concMcgMl / 1000, 3) + ' mg/mL)', ''));

      const weightBased = unit.indexOf('/kg/') >= 0;
      if (weightBased && !has(v.wt)) {
        P.flag('Weight missing - a weight-based infusion rate was not calculated');
        rows.push(P.row('Rate', 'Enter weight', 'bad'));
        return { rows: rows, risk: 'Weight required' };
      }
      const w = v.wt;

      /* dose -> mcg/h */
      function toMcgH(d) {
        if (unit === 'mcg/kg/min') return d * w * 60;
        if (unit === 'mcg/kg/h') return d * w;
        if (unit === 'mg/kg/h') return d * 1000 * w;
        if (unit === 'mcg/min') return d * 60;
        if (unit === 'mg/min') return d * 1000 * 60;
        if (unit === 'mg/h') return d * 1000;
        return undefined;
      }
      function fromMcgH(m) {
        if (unit === 'mcg/kg/min') return m / (w * 60);
        if (unit === 'mcg/kg/h') return m / w;
        if (unit === 'mg/kg/h') return m / (1000 * w);
        if (unit === 'mcg/min') return m / 60;
        if (unit === 'mg/min') return m / (1000 * 60);
        if (unit === 'mg/h') return m / 1000;
        return undefined;
      }

      let score;
      if (v.dir === 'toDose') {
        if (!has(v.rate)) {
          P.flag('Pump rate required');
          rows.push(P.row('Dose', 'Enter the pump rate', 'warn'));
          return { rows: rows, risk: 'Incomplete' };
        }
        const mcgH = v.rate * concMcgMl;
        const dose = fromMcgH(mcgH);
        rows.push(P.row('Pump rate', f(v.rate, 2) + ' mL/h', ''));
        rows.push(P.row('Delivered dose', f(dose, 3) + ' ' + unit, 'warn'));
        score = rd(dose, 3);
      } else {
        if (!has(v.dose)) {
          P.flag('Dose required');
          rows.push(P.row('Rate', 'Enter the dose', 'warn'));
          return { rows: rows, risk: 'Incomplete' };
        }
        const mcgH = toMcgH(v.dose);
        const rate = mcgH / concMcgMl;
        rows.push(P.row('Dose', f(v.dose, 3) + ' ' + unit, ''));
        rows.push(P.row('Pump rate', f(rate, 2) + ' mL/h', 'warn'));
        score = rd(rate, 2);
      }

      if (pre && has(pre.lo)) {
        rows.push(P.row('Usual range', f(pre.lo, 3) + '-' + f(pre.hi, 3) + ' ' + pre.unit, ''));
        const d = v.dir === 'toDose' ? score : v.dose;
        if (has(d) && pre.unit === unit) {
          if (d > pre.hi) P.flag('Dose above the usual range for ' + pre.l + ' - double-check the order and the pump');
          if (d < pre.lo) P.flag('Dose below the usual starting range for ' + pre.l);
        }
      }
      if (weightBased) rows.push(P.row('Weight used', f(w, 1) + ' kg', ''));
      rows.push(P.row('Range table', 'At this concentration: ' + buildRangeTable(concMcgMl, unit, w, pre), ''));
      rows.push(P.row('Safety', 'Two-person check for every vasopressor. Label the syringe with drug, amount, diluent volume and concentration.', 'warn'));
      return { rows: rows, score: score, risk: 'Calculated' };
    },
    tests: [
      {
        n: 'norepinephrine 0.1 mcg/kg/min at 70 kg', i: { preset: 'norepi', dir: 'toRate', dose: 0.1, wt: 70 },
        e: { score: 5.25, rows: [['Pump rate', '5.25'], ['Concentration', '80']] }
      },
      {
        n: 'reverse: 10.5 mL/h is 0.2 mcg/kg/min', i: { preset: 'norepi', dir: 'toDose', rate: 10.5, wt: 70 },
        e: { score: 0.2, rows: [['Delivered dose', '0.2']] }
      },
      {
        n: 'dopamine 10 mcg/kg/min', i: { preset: 'dopamine', dir: 'toRate', dose: 10, wt: 70 },
        e: { score: 10.5, rows: [['Concentration', '4000']] }
      },
      {
        n: 'nitroglycerin is not weight based', i: { preset: 'nitroglycerin', dir: 'toRate', dose: 20 },
        e: { score: 1.2, rows: [['Pump rate', '1.2']] }
      },
      {
        n: 'weight-based without weight refuses', i: { preset: 'norepi', dir: 'toRate', dose: 0.1 },
        e: { risk: /Weight required/, flags: [/was not calculated/] }
      },
      {
        n: 'custom 500 mg in 250 mL at 1 mg/h', i: { dir: 'toRate', unit: 'mg/h', dose: 1, amount: 500, vol: 250 },
        e: { score: 0.5, rows: [['Concentration', '2000']] }
      },
      {
        n: 'above range warns', i: { preset: 'norepi', dir: 'toRate', dose: 2, wt: 70 },
        e: { flags: [/above the usual range/] }
      }
    ]
  });

  function buildRangeTable(concMcgMl, unit, w, pre) {
    const lo = pre && has(pre.lo) ? pre.lo : 1;
    const hi = pre && has(pre.hi) ? pre.hi : 10;
    const steps = [lo, (lo + hi) / 2, hi];
    const parts = [];
    steps.forEach(function (d) {
      let mcgH;
      if (unit === 'mcg/kg/min') mcgH = d * w * 60;
      else if (unit === 'mcg/kg/h') mcgH = d * w;
      else if (unit === 'mg/kg/h') mcgH = d * 1000 * w;
      else if (unit === 'mcg/min') mcgH = d * 60;
      else if (unit === 'mg/min') mcgH = d * 1000 * 60;
      else mcgH = d * 1000;
      if (!has(mcgH)) return;
      parts.push(f(d, 3) + ' -> ' + f(mcgH / concMcgMl, 2) + ' mL/h');
    });
    return parts.join(', ');
  }

  C.def({
    id: 'paed-resus', n: 'Paediatric resuscitation doses', c: 'airway', v: '1.0.0',
    t: ['paediatric', 'pediatric', 'child', 'apls', 'pals', 'doses', 'kids', 'broselow'],
    ref: 'APLS Australia/UK 6th ed. AHA PALS 2020 (Circulation 2020;142:S469). Luscombe M, Owens B. Arch Dis Child 2007;92:412 (weight estimate).',
    i: [
      N('wt', 'Weight', { u: 'kg', min: 1, max: 100, step: 0.1, ctx: 'weight', opt: true }),
      N('age', 'Age', { u: 'years', min: 0, max: 18, step: 0.25, ctx: 'age', opt: true })
    ],
    out: function (v, P) {
      const rows = [];
      let w = v.wt;
      const age = has(v.age) ? v.age : P.age;
      let estimated = false;
      if (!has(w) && has(age) && age >= 1 && age <= 10) {
        w = (age + 4) * 2;
        estimated = true;
        P.flag('Weight ESTIMATED from age ((age + 4) x 2) - weigh the child as soon as possible and recalculate');
      }
      if (!has(w)) {
        P.flag('Weight missing and age outside the estimation range - no paediatric doses calculated');
        return { rows: [P.row('Doses', 'Enter weight (or age 1-10 years for an estimate)', 'bad')], risk: 'Weight required' };
      }
      rows.push(P.row('Weight used', f(w, 1) + ' kg' + (estimated ? ' (ESTIMATED from age)' : ''), estimated ? 'warn' : ''));
      if (has(age)) rows.push(P.row('Age', f(age, 1) + ' years', ''));

      function drug(l, perKg, unit, max, perMl, note) {
        const raw = perKg * w;
        const dose = cap(raw, max);
        let s = f(dose, dose < 1 ? 2 : (dose < 10 ? 2 : 1)) + ' ' + unit;
        if (has(perMl) && perMl > 0) s += ' = ' + f(dose / perMl, 2) + ' mL';
        if (has(max) && raw > max) s += '  [capped at the adult maximum ' + f(max, 1) + ' ' + unit + ']';
        if (note) s += '  [' + note + ']';
        rows.push(P.row(l, s, ''));
      }

      rows.push(P.row('— ARREST —', ' ', 'bad'));
      drug('Adrenaline IV/IO', 0.01, 'mg', 1, CONC.adr10000.perMl, '10 mcg/kg of 1:10,000, every 3-5 min');
      if (has(w) && w >= 50) {
        P.flag('At ' + f(w, 0) + ' kg use adult doses - adrenaline 1 mg, amiodarone 300 mg - rather than the per-kg figures above');
      }
      drug('Amiodarone (shockable arrest)', 5, 'mg', 300, CONC.amiodarone.perMl, 'after the 3rd and 5th shock');
      rows.push(P.row('Defibrillation', f(cap(2 * w, 200), 0) + ' J then ' + f(cap(4 * w, 200), 0) + ' J (2 then 4 J/kg)', 'bad'));
      drug('Fluid bolus - sepsis/hypovolaemia', 20, 'mL', 1000, undefined, '20 mL/kg, reassess after each bolus');
      drug('Fluid bolus - trauma/DKA/cardiac', 10, 'mL', 500, undefined, '10 mL/kg, more cautious');

      rows.push(P.row('— AIRWAY & BREATHING —', ' ', ''));
      drug('Atropine (bradycardia)', 0.02, 'mg', 0.5, CONC.atropine.perMl, '20 mcg/kg, minimum 0.1 mg');
      rows.push(P.row('Salbutamol nebuliser', (w < 20 ? '2.5 mg' : '5 mg') + ' with 2-4 mL NaCl, back to back if severe (formulary: Ventolin 2.5 mg respules)', ''));
      drug('MgSO4 (severe asthma)', 40, 'mg', 2000, CONC.mgso4.perMl, '40-50 mg/kg over 20 min');
      drug('Hydrocortisone', 4, 'mg', 100, undefined, 'or dexamethasone 0.15-0.6 mg/kg');

      rows.push(P.row('— NEURO —', ' ', ''));
      drug('Midazolam IV (seizure)', 0.1, 'mg', 10, CONC.midazolam.perMl, 'repeat once after 5 min');
      drug('Midazolam buccal/IN (seizure)', 0.3, 'mg', 10, CONC.midazolam.perMl, 'if no IV access');
      drug('D10 for hypoglycaemia', 2, 'mL', 250, undefined, '2 mL/kg of 10% dextrose = ' + f(0.2 * w, 1) + ' g; NEVER give D40 undiluted to a child');
      drug('Naloxone', 0.1, 'mg', 2, undefined, 'titrate to respiratory rate, not to consciousness');

      rows.push(P.row('— SYMPTOM CONTROL —', ' ', ''));
      drug('Paracetamol PO', 15, 'mg', 1000, undefined, 'every 4-6 h, max 60 mg/kg/day');
      drug('Ibuprofen PO', 10, 'mg', 400, undefined, 'with food, avoid if dehydrated or bleeding');
      drug('Ondansetron IV', 0.15, 'mg', 4, CONC.ondansetron.perMl, '0.1-0.15 mg/kg');
      drug('Fentanyl IV', 1, 'mcg', 100, CONC.fentanyl.perMl, '1 mcg/kg titrated, repeat every 5 min');
      drug('Diphenhydramine IV/IM', 1, 'mg', 50, CONC.diphenhydramine.perMl, 'adjunct only, never instead of adrenaline');
      drug('Ceftriaxone', 50, 'mg', 2000, undefined, '50 mg/kg; 100 mg/kg (max 4 g) if meningitis suspected');

      rows.push(P.row('— EQUIPMENT —', ' ', ''));
      if (has(age)) {
        rows.push(P.row('ETT (cuffed)', f(age / 4 + 3.5, 1) + ' mm ID, depth ' + f((age / 4 + 3.5) * 3, 1) + ' cm at lips', ''));
      }
      rows.push(P.row('Suction catheter', 'ETT internal diameter x 2 (Fr)', ''));
      rows.push(P.row('Every dose above', 'Capped at the adult dose - a 60 kg teenager does not get 900 mg of paracetamol', 'warn'));
      P.flag('Read every dose back aloud with a second person before giving it');
      return { rows: rows, score: rd(w, 1), risk: 'Doses for ' + f(w, 1) + ' kg' };
    },
    tests: [
      {
        n: '20 kg child', i: { wt: 20, age: 6 },
        e: {
          score: 20,
          rows: [['Adrenaline IV/IO', '0.2 mg'], ['Adrenaline IV/IO', '2 mL'], ['Amiodarone', '100 mg'],
          ['Defibrillation', '40 J'], ['Fluid bolus - sepsis', '400 mL'], ['Paracetamol', '300 mg'],
          ['D10 for hypoglycaemia', '40 mL'], ['Ondansetron', '3 mg']]
        }
      },
      {
        n: 'weight estimated from age', i: { age: 6 },
        e: { score: 20, rows: [['Weight used', 'ESTIMATED']], flags: [/Weight ESTIMATED from age/] }
      },
      {
        n: 'caps at adult dose', i: { wt: 80, age: 16 },
        e: { rows: [['Paracetamol', '1000 mg'], ['Paracetamol', 'capped'], ['Adrenaline IV/IO', '0.8 mg'], ['Ibuprofen', '400 mg'], ['Amiodarone', '300 mg']] }
      },
      { n: 'no weight, no usable age', i: { age: 15 }, e: { risk: /Weight required/, flags: [/no paediatric doses calculated/] } },
      { n: 'infant', i: { wt: 5, age: 0.5 }, e: { rows: [['Adrenaline IV/IO', '0.05 mg'], ['Defibrillation', '10 J'], ['Fluid bolus - sepsis', '100 mL']] } }
    ]
  });

  C.def({
    id: 'anaphylaxis', n: 'Anaphylaxis adrenaline dosing', c: 'airway', v: '1.0.0',
    t: ['anaphylaxis', 'adrenaline', 'epinephrine', 'allergy', 'epipen', 'sting', 'IM'],
    ref: 'Resuscitation Council UK Anaphylaxis Guidelines 2021. WAO Anaphylaxis Guidance 2020. Adrenaline IM 0.01 mg/kg, max 0.5 mg.',
    i: [
      N('wt', 'Weight', { u: 'kg', min: 2, max: 250, step: 0.1, ctx: 'weight', opt: true }),
      N('age', 'Age', { u: 'years', min: 0, max: 110, step: 0.25, ctx: 'age', opt: true }),
      N('doses', 'IM doses already given', { u: '', min: 0, max: 10, opt: true }),
      YN('bronchospasm', 'Wheeze or bronchospasm', 0, { opt: true }),
      YN('hypotension', 'Hypotension or collapse', 0, { opt: true }),
      YN('betaBlocker', 'On a beta-blocker', 0, { opt: true })
    ],
    out: function (v, P) {
      const rows = [];
      const age = has(v.age) ? v.age : P.age;

      rows.push(P.row('FIRST ACTION', 'Adrenaline IM into the anterolateral thigh. Nothing comes before it - not antihistamine, not steroid, not fluids.', 'bad'));
      rows.push(P.row('Position', 'Lie flat (or sit up only if breathing is the problem). NEVER stand the patient up - sudden death from an empty ventricle.', 'bad'));
      P.flag('Do not stand or walk an anaphylaxis patient - keep them lying flat');

      if (has(v.wt)) {
        const raw = 0.01 * v.wt;
        const dose = cap(raw, 0.5);
        let s = f(dose, 2) + ' mg = ' + f(dose / CONC.adr1000.perMl, 2) + ' mL of 1:1000 IM';
        if (raw > 0.5) s += '  [capped from ' + f(raw, 2) + ' mg at the adult maximum 0.5 mg]';
        rows.push(P.row('Adrenaline IM (weight-based)', s, 'bad'));
      } else {
        rows.push(P.row('Adrenaline IM (weight-based)', 'Weight missing - weight-based dose not calculated', 'warn'));
        P.flag('Weight missing - the weight-based dose was not calculated; use the age band below, it is a validated dose');
      }

      if (has(age)) {
        let band, bandDose;
        if (age >= 12) { band = '12 years and over / adult'; bandDose = 0.5; }
        else if (age >= 6) { band = '6-11 years'; bandDose = 0.3; }
        else if (age >= 0.5) { band = '6 months - 5 years'; bandDose = 0.15; }
        else { band = 'Under 6 months'; bandDose = 0.1; }
        rows.push(P.row('Adrenaline IM (age band)', f(bandDose, 2) + ' mg = ' + f(bandDose, 2) + ' mL of 1:1000 IM  [' + band + ']', 'bad'));
      } else {
        rows.push(P.row('Adrenaline IM (age band)', 'Enter age for the age-band dose', 'warn'));
      }

      rows.push(P.row('Repeat', 'Every 5 minutes if there is no improvement. Most deaths follow delayed or withheld adrenaline.', 'bad'));
      rows.push(P.row('Never IV bolus', 'Do NOT push IV adrenaline for anaphylaxis unless the patient is in cardiac arrest. Use IM, then an infusion.', 'bad'));
      P.flag('No IV bolus adrenaline in anaphylaxis unless in arrest - IM thigh, then infusion');

      const refractory = has(v.doses) && v.doses >= 2;
      if (refractory) {
        P.flag('Refractory anaphylaxis after 2 IM doses - start an adrenaline infusion and call for help');
        rows.push(P.row('Refractory - infusion', '1 mg in 50 mL = 20 mcg/mL, start 0.05-0.1 mcg/kg/min' +
          (has(v.wt) ? ' = ' + f(0.05 * v.wt * 60 / 20, 2) + '-' + f(0.1 * v.wt * 60 / 20, 2) + ' mL/h' : ' (enter weight for the rate)'), 'bad'));
      }

      if (has(v.wt)) {
        rows.push(P.row('IV fluid bolus', f(cap(20 * v.wt, 1000), 0) + ' mL crystalloid (20 mL/kg) rapidly, repeat as needed', ''));
      } else {
        rows.push(P.row('IV fluid bolus', '500-1000 mL crystalloid in an adult; 20 mL/kg in a child (enter weight)', ''));
      }
      if (v.bronchospasm === true) rows.push(P.row('Bronchospasm', 'Salbutamol nebuliser 2.5-5 mg (Ventolin respules) with oxygen, repeated. Adrenaline first.', 'warn'));
      if (v.hypotension === true) rows.push(P.row('Hypotension', 'Flat, legs up, repeat adrenaline, fluid bolus, then infusion', 'bad'));
      if (v.betaBlocker === true) {
        P.flag('On a beta-blocker - adrenaline may be less effective, consider glucagon 1-5 mg IV and atropine for bradycardia');
        rows.push(P.row('Beta-blocker', 'Glucagon 1-5 mg IV over 5 min; atropine for bradycardia', 'warn'));
      }
      rows.push(P.row('Adjuncts (after adrenaline)', 'Diphenhydramine 10-50 mg IM/IV for the rash only. Steroids are NOT first line and do not treat anaphylaxis.', ''));
      rows.push(P.row('Observation', 'Minimum 6 h after a severe reaction, 12 h if biphasic risk (repeat doses, severe asthma, slow response). Biphasic reactions occur in up to 1 in 5.', 'warn'));
      rows.push(P.row('Before discharge', 'Two adrenaline auto-injectors if available, written action plan, allergy clinic referral, remove the trigger', ''));
      return { rows: rows, risk: 'Adrenaline IM now' };
    },
    tests: [
      {
        n: '25 kg child', i: { wt: 25, age: 8 },
        e: {
          rows: [['Adrenaline IM (weight-based)', '0.25 mg'], ['Adrenaline IM (weight-based)', '0.25 mL'],
          ['Adrenaline IM (age band)', '0.3 mg'], ['IV fluid bolus', '500 mL']],
          flags: [/lying flat/, /No IV bolus/]
        }
      },
      {
        n: '80 kg adult capped', i: { wt: 80, age: 40 },
        e: { rows: [['Adrenaline IM (weight-based)', '0.5 mg'], ['Adrenaline IM (weight-based)', 'capped from 0.8'], ['Adrenaline IM (age band)', '0.5 mg'], ['IV fluid bolus', '1000 mL']] }
      },
      {
        n: 'no weight still gives the age-band dose', i: { age: 9 },
        e: { rows: [['Adrenaline IM (weight-based)', 'not calculated'], ['Adrenaline IM (age band)', '0.3 mg']], flags: [/validated dose/] }
      },
      {
        n: 'refractory', i: { wt: 70, age: 30, doses: 2 },
        e: { rows: [['Refractory - infusion', '10.5']], flags: [/Refractory anaphylaxis/] }
      },
      { n: 'infant band', i: { wt: 7, age: 0.75 }, e: { rows: [['Adrenaline IM (age band)', '0.15 mg'], ['Adrenaline IM (weight-based)', '0.07 mg']] } },
      { n: 'beta-blocker', i: { wt: 70, age: 60, betaBlocker: 'y' }, e: { flags: [/glucagon/i] } }
    ]
  });

  const LA_DRUGS = {
    lido: { l: 'Lidocaine plain', perKg: 3, max: 300 },
    lidoAdr: { l: 'Lidocaine with adrenaline', perKg: 7, max: 500 },
    bupi: { l: 'Bupivacaine plain', perKg: 2, max: 150 },
    bupiAdr: { l: 'Bupivacaine with adrenaline', perKg: 3, max: 200 },
    ropi: { l: 'Ropivacaine', perKg: 3, max: 200 },
    prilo: { l: 'Prilocaine', perKg: 6, max: 400 }
  };

  C.def({
    id: 'max-la', n: 'Maximum local anaesthetic dose', c: 'airway', v: '1.0.0',
    t: ['local anaesthetic', 'lidocaine', 'lignocaine', 'bupivacaine', 'last', 'toxicity', 'suturing'],
    ref: 'AAGBI Safety Guideline: Management of Severe Local Anaesthetic Toxicity, 2010. Standard maxima: lidocaine 3 mg/kg plain, 7 mg/kg with adrenaline; bupivacaine 2 mg/kg plain, 3 mg/kg with adrenaline.',
    i: [
      S('drug', 'Agent', [
        ['lido', 'Lidocaine plain (3 mg/kg, max 300 mg)'],
        ['lidoAdr', 'Lidocaine with adrenaline (7 mg/kg, max 500 mg)'],
        ['bupi', 'Bupivacaine plain (2 mg/kg, max 150 mg)'],
        ['bupiAdr', 'Bupivacaine with adrenaline (3 mg/kg, max 200 mg)'],
        ['ropi', 'Ropivacaine (3 mg/kg, max 200 mg)'],
        ['prilo', 'Prilocaine (6 mg/kg, max 400 mg)']
      ], { dflt: 'lido' }),
      N('conc', 'Concentration', { u: '%', min: 0.1, max: 5, step: 0.05, dflt: 1 }),
      N('wt', 'Weight', { u: 'kg', min: 2, max: 250, step: 0.1, ctx: 'weight' })
    ],
    out: function (v, P) {
      const rows = [];
      const d = LA_DRUGS[v.drug] || LA_DRUGS.lido;
      rows.push(P.row('Agent', d.l + ' (' + d.perKg + ' mg/kg, absolute maximum ' + d.max + ' mg)', ''));
      if (!has(v.wt)) {
        P.flag('Weight missing - maximum local anaesthetic dose not calculated');
        rows.push(P.row('Maximum dose', 'Enter weight', 'bad'));
      } else {
        const raw = d.perKg * v.wt;
        const dose = cap(raw, d.max);
        let s = f(dose, 0) + ' mg';
        if (raw > d.max) s += '  [capped from ' + f(raw, 0) + ' mg at the absolute maximum]';
        rows.push(P.row('Maximum dose', s, 'warn'));
        if (raw > d.max) P.flag('Weight-based dose exceeds the absolute maximum - the absolute cap wins');
        if (has(v.conc) && v.conc > 0) {
          const mgPerMl = v.conc * 10;
          rows.push(P.row('Maximum volume', f(dose / mgPerMl, 1) + ' mL of ' + f(v.conc, 2) + '% (' + f(mgPerMl, 1) + ' mg/mL)', 'warn'));
          rows.push(P.row('Per 10 mL given', f(10 * mgPerMl, 0) + ' mg = ' + f(10 * mgPerMl / dose * 100, 0) + '% of the maximum', ''));
        }
        rows.push(P.row('LAST rescue dose', '20% lipid emulsion ' + f(1.5 * v.wt, 0) + ' mL bolus (1.5 mL/kg) over 1 min, then ' + f(0.25 * v.wt, 1) + ' mL/min infusion', 'bad'));
      }
      rows.push(P.row('Technique', 'Aspirate before every injection, inject incrementally, never into an inflamed or infected field, use the lowest effective volume', ''));
      rows.push(P.row('Early toxicity', 'Perioral tingling, metallic taste, tinnitus, light-headedness, agitation - STOP injecting immediately', 'bad'));
      rows.push(P.row('Severe toxicity', 'Seizures, then cardiac arrest. Stop injecting, airway, 100% O2, benzodiazepine for seizures, lipid emulsion, prolonged CPR (recovery can take over an hour).', 'bad'));
      P.flag('Lipid emulsion (Intralipid 20%) is not in the default event formulary - add it to any kit used for nerve blocks or large-volume infiltration');
      rows.push(P.row('Digits and ears', 'Adrenaline-containing solutions are safe in digits in current practice, but plain is the conventional choice at an event post', ''));
      return { rows: rows, score: has(v.wt) ? rd(cap(d.perKg * v.wt, d.max), 0) : undefined, risk: d.l };
    },
    tests: [
      {
        n: 'lidocaine 1% in a 70 kg adult', i: { drug: 'lido', conc: 1, wt: 70 },
        e: { score: 210, rows: [['Maximum dose', '210 mg'], ['Maximum volume', '21 mL'], ['LAST rescue dose', '105 mL']] }
      },
      {
        n: 'lidocaine with adrenaline caps at 500', i: { drug: 'lidoAdr', conc: 1, wt: 80 },
        e: { score: 500, rows: [['Maximum dose', 'capped from 560'], ['Maximum volume', '50 mL']], flags: [/absolute cap wins/] }
      },
      {
        n: 'bupivacaine 0.5%', i: { drug: 'bupi', conc: 0.5, wt: 70 },
        e: { score: 140, rows: [['Maximum volume', '28 mL']] }
      },
      { n: 'no weight', i: { drug: 'lido', conc: 1 }, e: { rows: [['Maximum dose', 'Enter weight']], flags: [/not calculated/] } },
      { n: 'child', i: { drug: 'lido', conc: 1, wt: 20 }, e: { score: 60, rows: [['Maximum volume', '6 mL']] } }
    ]
  });

  /* ------------------------------------------------------------------ *
   * Category labels — the calculator sheet groups by these.             *
   * ------------------------------------------------------------------ */
  C.catLabel = function (id) {
    for (var i = 0; i < C.CATS.length; i++) if (C.CATS[i].id === id) return C.CATS[i].l;
    return 'Other';
  };
  C.catIds = function () {
    var out = [];
    for (var i = 0; i < C.CATS.length; i++) out.push(C.CATS[i].id);
    return out;
  };

})(window.EV = window.EV || {});
