/* ==========================================================================
   14-ui-modules.js — the three companion modules inside the chart, plus the
   document pipeline.

   Requirement 8 of the brief: the capabilities of EDGE Calc, EM Companion and
   Resus Companion, reachable from the small buttons beside the fields they
   belong to. Each panel is a sheet so it never loses the chart underneath.

   The document half (PDF, Excel, Drive) lives here too because they share the
   same ctx builder: a PDF and the recap must never disagree about what the
   record says.
   ========================================================================== */
(function (EV) {
  'use strict';

  var UI = EV.ui;

  /* ====================================================================== */
  /* Calculators — EDGE Calc                                                 */
  /* ====================================================================== */
  UI.renderCalcPanel = function (root, ctx) {
    ctx = ctx || {};
    if (!EV.calc || !EV.calc.list) {
      root.appendChild(UI.empty('Calculators unavailable', 'The calculator module did not load.'));
      return;
    }
    var p = ctx.patient;
    var state = { q: '', open: ctx.seed || null };

    var search = UI.field({
      placeholder: 'Search — NEWS2, Parkland, heat stroke, paracetamol…', cls: 'sm',
      buttons: [{ label: '×', title: 'Clear', onClick: function (v, c) { c.value = ''; state.q = ''; draw(); } }]
    });
    search.input.addEventListener('input', EV.debounce(function () {
      state.q = search.input.value; state.open = null; draw();
    }, 140));
    root.appendChild(search);

    if (p) {
      var d = EV.model.derive(p);
      var canvas = EV.el('div', { class: 'row tight', style: { margin: '8px 0' } });
      canvas.appendChild(EV.el('span', { class: 'tag brand', text: p.name || 'patient' }));
      if (EV.has(d.ageYears)) canvas.appendChild(EV.el('span', { class: 'tag', text: EV.fmt(d.ageYears, 0) + ' yr' }));
      canvas.appendChild(EV.el('span', {
        class: 'tag' + (EV.has(d.weight) ? '' : ' warn'),
        text: EV.has(d.weight) ? d.weight + ' kg' : 'no weight — dosing is blocked'
      }));
      var v = d.lastVitals;
      if (v && v.t) canvas.appendChild(EV.el('span', { class: 'tag', text: 'vitals ' + EV.hhmm(v.t) }));
      root.appendChild(canvas);
      root.appendChild(EV.el('div', {
        class: 'tiny muted', style: { marginBottom: '8px' },
        text: 'Fields marked from the chart fill themselves from this patient and stay live as you edit the record.'
      }));
    }

    var host = EV.el('div');
    root.appendChild(host);

    function draw() {
      EV.clear(host);
      if (state.open) { drawOne(state.open); return; }

      var list = state.q ? EV.calc.search(state.q) : EV.calc.list();
      if (!list.length) {
        host.appendChild(UI.empty('No calculator matches “' + state.q + '”',
          'Try the clinical name — "heat", "burn", "sodium", "GCS".'));
        return;
      }
      var groups = EV.groupBy(list, 'c');
      Object.keys(groups).forEach(function (cat) {
        host.appendChild(EV.el('div', { class: 'sec-h' }, [
          EV.calc.catLabel ? EV.calc.catLabel(cat) : cat, EV.el('span', { class: 'rule' })
        ]));
        var chips = EV.el('div', { class: 'chips' });
        groups[cat].forEach(function (c) {
          var b = EV.el('button', { class: 'chip', type: 'button', title: c.ref || '' }, [c.n]);
          if (c.verify) b.appendChild(EV.el('span', { class: 'tag warn', text: 'verify' }));
          b.addEventListener('click', function () { state.open = c.id; draw(); });
          chips.appendChild(b);
        });
        host.appendChild(chips);
      });
    }

    function drawOne(id) {
      var calc = EV.calc.byId(id);
      if (!calc) { state.open = null; draw(); return; }

      var back = UI.btn('All calculators', 'sm ghost', function () { state.open = null; draw(); }, 'back');
      host.appendChild(back);
      host.appendChild(EV.el('h2', { style: { margin: '8px 0 2px', fontSize: '17px' }, text: calc.n }));
      if (calc.ref) host.appendChild(EV.el('div', { class: 'tiny muted', text: calc.ref }));
      if (calc.verify) {
        host.appendChild(EV.el('div', {
          class: 'tag warn', style: { marginTop: '6px', display: 'inline-block' },
          text: 'Reference values transcribed from the source — confirm before clinical use'
        }));
      }

      var inputs = {};
      var grid = EV.el('div', { class: 'fgrid', style: { marginTop: '10px' } });
      var out = EV.el('div', { class: 'card', style: { marginTop: '10px' } });
      var outB = EV.el('div', { class: 'card-b' });
      out.appendChild(outB);

      (calc.i || []).forEach(function (f) {
        if (f.t === 'h') {
          grid.appendChild(EV.el('div', { class: 'wfull sec-h', style: { margin: '4px 0 0' } }, [f.l]));
          return;
        }
        /* Seed from the open patient's canvas where the field asks for it. */
        var seeded;
        if (f.ctx && p) seeded = canvasValue(f.k, p);
        inputs[f.k] = EV.has(seeded) ? seeded : undefined;

        var fd;
        if (f.t === 's') {
          fd = UI.field({
            label: f.l, type: 'select', cls: 'sm',
            options: (f.o || []).map(function (o) { return { v: o[1], l: o[0] }; }),
            placeholder: '—', value: inputs[f.k]
          });
          fd.input.addEventListener('change', function () { inputs[f.k] = EV.num(fd.input.value); recalc(); });
        } else if (f.t === 'b') {
          fd = EV.el('label', { class: 'chip', style: { cursor: 'pointer', minHeight: '38px' } });
          var box = EV.el('input', { type: 'checkbox' });
          box.addEventListener('change', function () { inputs[f.k] = box.checked ? 1 : 0; recalc(); });
          fd.appendChild(box);
          fd.appendChild(EV.el('span', { text: f.l }));
          grid.appendChild(EV.el('div', { class: 'wfull' }, [fd]));
          return;
        } else {
          fd = UI.field({
            label: f.l + (f.u ? ' (' + f.u + ')' : ''), type: 'number', inputmode: 'decimal',
            step: f.step || 'any', cls: 'sm n', value: EV.has(seeded) ? seeded : '',
            hint: f.ctx && EV.has(seeded) ? 'from the chart' : (f.hint || '')
          });
          fd.input.addEventListener('input', function () { inputs[f.k] = EV.num(fd.input.value); recalc(); });
        }
        grid.appendChild(fd);
      });
      host.appendChild(grid);
      host.appendChild(out);

      function recalc() {
        EV.clear(outB);
        var res;
        try {
          res = EV.calc.run(calc.id, inputs, p);
        } catch (e) {
          outB.appendChild(EV.el('div', { class: 'tag bad', text: 'Calculation failed: ' + e.message }));
          return;
        }
        if (!res || (!res.rows || !res.rows.length) && !EV.has(res.score)) {
          outB.appendChild(EV.el('div', { class: 'muted small', text: 'Fill the fields above — nothing is assumed to be zero.' }));
          return;
        }
        if (EV.has(res.score)) {
          outB.appendChild(EV.el('div', { class: 'row', style: { gap: '12px', marginBottom: '8px' } }, [
            EV.el('div', {}, [
              EV.el('div', { class: 'tiny muted', text: 'Score' }),
              EV.el('div', { class: 'mono', style: { fontSize: '30px', fontWeight: '600', lineHeight: '1' }, text: String(res.score) })
            ]),
            res.risk ? EV.el('div', { class: 'grow' }, [
              EV.el('div', { class: 'strong', text: res.risk })
            ]) : null
          ]));
        }
        (res.rows || []).forEach(function (r) {
          outB.appendChild(EV.el('div', {
            class: 'row', style: {
              justifyContent: 'space-between', borderBottom: '1px dotted var(--line-soft)',
              padding: '4px 0', gap: '10px'
            }
          }, [
            EV.el('span', { class: 'small', text: r.l }),
            EV.el('span', {
              class: 'mono strong',
              style: { color: r.cls === 'bad' ? 'var(--bad)' : r.cls === 'warn' ? 'var(--warn)' : r.cls === 'ok' ? 'var(--ok)' : 'inherit' },
              text: String(r.v)
            })
          ]));
        });
        (res.flags || []).forEach(function (f) {
          outB.appendChild(EV.el('div', { class: 'tag bad', style: { marginTop: '6px', marginRight: '4px' }, text: f }));
        });

        if (p) {
          outB.appendChild(EV.el('div', { class: 'row', style: { marginTop: '10px' } }, [
            UI.btn('Write to the notes', 'sm pri', function () {
              var line = calc.n + ': ' +
                (EV.has(res.score) ? res.score + (res.risk ? ' (' + res.risk + ')' : '') : '') + ' — ' +
                (res.rows || []).map(function (r) { return r.l + ' ' + r.v; }).join('; ');
              UI.cpptSheet(p, null);
              /* The sheet opens fresh; drop the line into the clipboard-free
                 way: prefill the O field once it exists. */
              setTimeout(function () {
                var ta = EV.qsa('.sheet textarea');
                if (ta[1]) {
                  ta[1].value = (ta[1].value ? ta[1].value.replace(/\s*$/, '') + '\n' : '') + line;
                  ta[1].focus();
                }
              }, 60);
            }, 'note'),
            ctx.onApply ? UI.btn('Use this', 'sm', function () {
              ctx.onApply(res);
              if (ctx.sheet) ctx.sheet.close();
            }, 'check') : null
          ]));
        }
      }
      recalc();
    }

    function canvasValue(key, p) {
      var d = EV.model.derive(p);
      var v = d.lastVitals || {};
      var map = {
        weight: d.weight, wt: d.weight, kg: d.weight,
        age: d.ageYears, years: d.ageYears,
        hr: EV.num(v.hr), sbp: EV.num(v.sbp), dbp: EV.num(v.dbp), rr: EV.num(v.rr),
        spo2: EV.num(v.spo2), temp: EV.num(v.temp), gcs: EV.num(v.gcs),
        bgl: EV.num(v.bgl), glucose: EV.num(v.bgl), pain: EV.num(v.pain),
        sex: p.sex === 'F' ? 0 : p.sex === 'M' ? 1 : undefined,
        map: d.map
      };
      return map[key];
    }

    draw();
  };

  /* ====================================================================== */
  /* Reference — EM Companion                                                */
  /* ====================================================================== */
  UI.renderRefPanel = function (root, ctx) {
    ctx = ctx || {};
    if (!EV.ref) {
      root.appendChild(UI.empty('Reference unavailable', 'The clinical reference module did not load.'));
      return;
    }
    var state = { q: ctx.seed || '', open: null, sec: 'pearls' };

    var search = UI.field({
      placeholder: 'Heat stroke, anaphylaxis, ankle sprain, pingsan…', cls: 'sm', value: state.q,
      buttons: [{ label: '×', title: 'Clear', onClick: function (v, c) { c.value = ''; state.q = ''; state.open = null; draw(); } }]
    });
    search.input.addEventListener('input', EV.debounce(function () {
      state.q = search.input.value; state.open = null; draw();
    }, 180));
    root.appendChild(search);

    var host = EV.el('div');
    root.appendChild(host);

    var loading = EV.el('div', { class: 'muted small', style: { padding: '14px 0' }, text: 'Loading the reference…' });
    host.appendChild(loading);

    Promise.resolve(EV.ref.ready || EV.ref.load()).then(function () {
      draw();
    }).catch(function (e) {
      EV.clear(host);
      host.appendChild(UI.empty('Reference could not load', e.message || String(e)));
    });

    function draw() {
      EV.clear(host);
      if (state.open) { drawTopic(state.open); return; }

      /* Quick cards first — the one-screen answers an event medic wants
         before they want a textbook chapter. */
      if (!state.q && EV.ref.QUICK && EV.ref.QUICK.length) {
        host.appendChild(EV.el('div', { class: 'sec-h' }, ['Field cards', EV.el('span', { class: 'rule' })]));
        var qc = EV.el('div', { class: 'chips' });
        EV.ref.QUICK.forEach(function (c) {
          var b = EV.el('button', { class: 'chip', type: 'button' }, [c.t]);
          b.addEventListener('click', function () { drawQuick(c); });
          qc.appendChild(b);
        });
        host.appendChild(qc);
      }

      var hits = state.q
        ? EV.ref.search(state.q, { limit: 40 })
        : (EV.ref.seed ? EV.ref.seed(ctx.seed || '') : []).slice(0, 12);

      host.appendChild(EV.el('div', { class: 'sec-h' }, [
        state.q ? hits.length + ' matches' : (ctx.seed ? 'For “' + ctx.seed + '”' : 'Common topics'),
        EV.el('span', { class: 'rule' })
      ]));

      if (!hits.length) {
        host.appendChild(UI.empty('Nothing found', 'Try a single word — "heat", "sprain", "anafilaksis".'));
        return;
      }
      var list = EV.el('div', { class: 'stack tight' });
      hits.forEach(function (h) {
        var b = EV.el('button', { class: 'prow', type: 'button', style: { borderLeftColor: 'var(--brand)' } });
        var mid = EV.el('span', { class: 'grow' });
        mid.appendChild(EV.el('span', { class: 'nm', text: h.t }));
        if (h.hits && h.hits.length) {
          mid.appendChild(EV.el('span', { class: 'sub trunc', text: h.hits[0].t }));
        }
        b.appendChild(mid);
        b.addEventListener('click', function () { state.open = h.id; draw(); });
        list.appendChild(b);
      });
      host.appendChild(list);
    }

    function drawQuick(card) {
      EV.clear(host);
      host.appendChild(UI.btn('Back', 'sm ghost', function () { draw(); }, 'back'));
      host.appendChild(EV.el('h2', { style: { margin: '10px 0 6px', fontSize: '18px' }, text: card.t }));
      var ul = EV.el('ul', { style: { margin: 0, paddingLeft: '18px', lineHeight: '1.7', fontSize: '14px' } });
      (card.li || []).forEach(function (li) {
        ul.appendChild(EV.el('li', { text: typeof li === 'string' ? li : li.t }));
      });
      host.appendChild(ul);
      if (ctx.onPick) {
        host.appendChild(EV.el('div', { style: { marginTop: '12px' } }, [
          UI.btn('Use this title', 'pri', function () {
            ctx.onPick(card.t);
            if (ctx.sheet) ctx.sheet.close();
          }, 'check')
        ]));
      }
    }

    function drawTopic(id) {
      EV.clear(host);
      var topic = EV.ref.byId(id);
      if (!topic) { state.open = null; draw(); return; }

      host.appendChild(UI.btn('Back to results', 'sm ghost', function () { state.open = null; draw(); }, 'back'));
      host.appendChild(EV.el('h2', { style: { margin: '10px 0 8px', fontSize: '18px' }, text: topic.t }));

      var secs = EV.ref.sections(id) || [];
      var tabs = EV.el('div', { class: 'chips', style: { marginBottom: '10px' } });
      var bodyHost = EV.el('div');
      var cur = secs[0] && secs[0].k;
      secs.forEach(function (s) {
        var b = EV.el('button', { class: 'chip' + (s.k === cur ? ' on' : ''), type: 'button' }, [s.l]);
        b.addEventListener('click', function () {
          cur = s.k;
          EV.qsa('button', tabs).forEach(function (x) { x.classList.remove('on'); });
          b.classList.add('on');
          showSec(s);
        });
        tabs.appendChild(b);
      });
      host.appendChild(tabs);
      host.appendChild(bodyHost);
      if (secs[0]) showSec(secs[0]);

      function showSec(s) {
        EV.clear(bodyHost);
        var div = EV.el('div', { style: { fontSize: '13.5px', lineHeight: '1.6' } });
        div.innerHTML = EV.ref.toHtml(s.nodes);
        bodyHost.appendChild(div);
      }

      if (ctx.onPick) {
        host.appendChild(EV.el('div', { style: { marginTop: '14px' } }, [
          UI.btn('Use “' + topic.t + '” as the assessment', 'pri', function () {
            ctx.onPick(topic.t);
            if (ctx.sheet) ctx.sheet.close();
          }, 'check')
        ]));
      }
    }
  };

  /* ====================================================================== */
  /* Formulary picker                                                        */
  /* ====================================================================== */
  UI.renderFormularyPicker = function (root, ctx) {
    ctx = ctx || {};
    if (!EV.formulary) {
      root.appendChild(UI.empty('Formulary unavailable', 'The default catalogue did not load.'));
      return;
    }
    var p = ctx.patient;
    var d = p ? EV.model.derive(p) : {};
    var items = EV.formulary.load();
    var state = { q: '', kind: 'med' };

    var search = UI.field({ placeholder: 'Ondansetron, NaCl, Vascon, kassa…', cls: 'sm' });
    search.input.addEventListener('input', EV.debounce(function () { state.q = search.input.value; draw(); }, 130));
    root.appendChild(search);
    root.appendChild(UI.segment({
      value: state.kind, block: true,
      options: [{ v: 'med', l: 'Medications' }, { v: 'supply', l: 'Supplies' }, { v: 'all', l: 'Everything' }],
      onChange: function (v) { state.kind = v; draw(); }
    }));

    if (p) {
      root.appendChild(EV.el('div', {
        class: 'row tight', style: { margin: '8px 0' }
      }, [
        EV.el('span', { class: 'tag brand', text: p.name || 'patient' }),
        EV.el('span', {
          class: 'tag' + (EV.has(d.weight) ? '' : ' warn'),
          text: EV.has(d.weight) ? d.weight + ' kg' : 'no weight recorded'
        })
      ]));
    }

    var host = EV.el('div');
    root.appendChild(host);

    function draw() {
      EV.clear(host);
      var list = state.q && EV.formulary.search
        ? EV.formulary.search(state.q)
        : items;
      list = list.filter(function (i) {
        if (i.active === false) return false;
        if (state.kind === 'med' && i.kind !== 'med') return false;
        if (state.kind === 'supply' && i.kind === 'med') return false;
        return true;
      });
      if (!list.length) {
        host.appendChild(UI.empty('Nothing matches',
          'The formulary is editable — add it in Settings → Formulary if the kit carries it.'));
        return;
      }
      var groups = EV.groupBy(list.slice(0, 220), 'cat');
      Object.keys(groups).sort().forEach(function (cat) {
        var catDef = (EV.formulary.CATS || []).filter(function (c) { return c.id === cat; })[0];
        host.appendChild(EV.el('div', { class: 'sec-h' }, [
          (catDef && catDef.l) || cat, EV.el('span', { class: 'rule' })
        ]));
        var stack = EV.el('div', { class: 'stack tight' });
        groups[cat].forEach(function (it) { stack.appendChild(itemRow(it)); });
        host.appendChild(stack);
      });
    }

    function itemRow(it) {
      var b = EV.el('button', {
        class: 'prow', type: 'button',
        style: { borderLeftColor: it.highAlert ? 'var(--bad)' : 'var(--line)' }
      });
      var mid = EV.el('span', { class: 'grow' });
      mid.appendChild(EV.el('span', { class: 'nm', text: it.name }));
      var bits = [];
      if (it.generic && it.generic !== it.name) bits.push(it.generic);
      if (it.strength || it.dose) bits.push(it.strength || it.dose);
      if (it.form) bits.push(it.form);
      mid.appendChild(EV.el('span', { class: 'sub', text: bits.join(' · ') }));
      b.appendChild(mid);

      var rt = EV.el('span', { class: 'rt' });
      if (it.highAlert) rt.appendChild(EV.el('span', { class: 'tag bad', text: 'High alert' }));
      if (it.controlled) rt.appendChild(EV.el('span', { class: 'tag warn', text: 'Controlled' }));
      b.appendChild(rt);

      b.addEventListener('click', function () { chooseItem(it); });
      return b;
    }

    /* Choosing an item opens the dose step rather than committing blind —
       the mL at the real vial strength is the whole point. */
    function chooseItem(it) {
      EV.clear(host);
      host.appendChild(UI.btn('Back to the list', 'sm ghost', function () { draw(); }, 'back'));
      host.appendChild(EV.el('h2', { style: { margin: '10px 0 2px', fontSize: '17px' }, text: it.name }));
      if (it.generic && it.generic !== it.name) host.appendChild(EV.el('div', { class: 'muted small', text: it.generic }));

      var conc = EV.formulary.conc ? EV.formulary.conc(it.id) : null;
      if (conc && conc.label) {
        host.appendChild(EV.el('div', { class: 'tag', style: { marginTop: '6px', display: 'inline-block' }, text: conc.label }));
      } else if (it.kind === 'med') {
        host.appendChild(EV.el('div', {
          class: 'tag warn', style: { marginTop: '6px', display: 'inline-block' },
          text: 'No strength recorded — the mL cannot be calculated'
        }));
      }

      var dose = UI.field({ label: 'Dose', type: 'number', inputmode: 'decimal', step: 'any', cls: 'sm n' });
      var unit = UI.field({
        label: 'Unit', type: 'select', value: it.unit || 'mg', cls: 'sm',
        options: ['mg', 'mcg', 'g', 'mL', 'IU', 'mEq', 'pcs', 'tab']
      });
      var route = UI.field({
        label: 'Route', type: 'select', value: it.defaultRoute || '', cls: 'sm',
        options: EV.model.ROUTES, placeholder: '—'
      });
      var grid = EV.el('div', { class: 'fgrid', style: { marginTop: '10px' } }, [dose, unit, route]);
      host.appendChild(grid);

      var mlOut = EV.el('div', { class: 'card', style: { marginTop: '10px' } });
      var mlB = EV.el('div', { class: 'card-b mono', style: { fontSize: '15px' } });
      mlOut.appendChild(mlB);
      host.appendChild(mlOut);

      function recompute() {
        EV.clear(mlB);
        var mg = EV.num(dose.input.value);
        if (!EV.has(mg)) {
          mlB.appendChild(EV.el('span', { class: 'muted small', text: 'Enter a dose to see the volume to draw up.' }));
          return;
        }
        if (conc && conc.perMl) {
          var ml = mg / conc.perMl;
          mlB.appendChild(EV.el('span', {
            style: { fontSize: '20px', fontWeight: '600' },
            text: EV.fmt(ml, ml < 1 ? 2 : 1) + ' mL'
          }));
          mlB.appendChild(EV.el('span', { class: 'muted small', text: '  at ' + conc.label }));
          if (ml > 20) {
            mlB.appendChild(EV.el('div', { class: 'tag warn', style: { marginTop: '6px' }, text: 'That is ' + Math.ceil(ml / (conc.ml || 1)) + ' ampoules — check the dose' }));
          }
        } else {
          mlB.appendChild(EV.el('span', { class: 'muted small', text: 'Volume unavailable — no strength recorded for this item.' }));
        }
        if (EV.has(d.weight) && EV.has(mg)) {
          mlB.appendChild(EV.el('div', {
            class: 'muted small', style: { marginTop: '4px' },
            text: EV.fmt(mg / d.weight, 2) + ' ' + (unit.input.value || 'mg') + '/kg at ' + d.weight + ' kg'
          }));
        }
      }
      dose.input.addEventListener('input', recompute);
      unit.input.addEventListener('change', recompute);
      recompute();

      host.appendChild(EV.el('div', { class: 'row', style: { marginTop: '12px' } }, [
        UI.btn('Add to the record', 'pri', function () {
          var payload = {
            dose: dose.input.value, unit: unit.input.value, route: route.input.value
          };
          if (ctx.onPick) {
            ctx.onPick(it, payload);
            if (ctx.sheet) ctx.sheet.close();
          } else if (p) {
            var o = EV.model.newOrder({
              kind: it.kind === 'med' ? (it.cat === 'fluid' ? 'fluid' : 'med') : 'supply',
              itemId: it.id, name: it.name, dose: payload.dose, unit: payload.unit,
              route: payload.route, by: EV.settings.deviceLabel || ''
            });
            var c = EV.clone(p);
            c.orders = (c.orders || []).concat([o]);
            EV.store.put(c).then(function () {
              EV.toast(it.name + ' recorded', 'ok');
              if (ctx.sheet) ctx.sheet.close();
            });
          }
        }, 'check')
      ]));
    }

    draw();
  };

  /* ====================================================================== */
  /* Resus Companion                                                         */
  /* ====================================================================== */
  UI.renderResusPanel = function (root, ctx) {
    ctx = ctx || {};
    if (!EV.resus) {
      root.appendChild(UI.empty('Resuscitation module unavailable', 'It did not load.'));
      return;
    }
    var p = ctx.patient;
    var state = { algo: null, node: null };
    var tickTimer = null;

    var host = EV.el('div');
    root.appendChild(host);

    function stopTick() { if (tickTimer) { clearInterval(tickTimer); tickTimer = null; } }
    if (ctx.sheet) {
      var origClose = ctx.sheet.close;
      ctx.sheet.close = function (v) { stopTick(); origClose(v); };
    }

    function draw() {
      EV.clear(host);
      stopTick();
      if (state.algo) { drawAlgo(); return; }

      var code = EV.resus.code;
      var running = code && code.state && code.state.running;

      var big = EV.el('button', {
        class: 'btn lg block ' + (running ? 'bad' : 'bad'),
        type: 'button',
        style: { minHeight: '62px', fontSize: '17px', justifyContent: 'space-between' }
      });
      big.appendChild(EV.el('span', { text: running ? 'CODE RUNNING — open the board' : 'START CODE' }));
      if (running) big.appendChild(EV.el('span', { class: 'mono', text: EV.mmss(EV.now() - code.state.t0) }));
      big.addEventListener('click', function () {
        if (!running && code && code.start) code.start(p ? p.id : null);
        drawCode();
      });
      host.appendChild(big);

      host.appendChild(EV.el('div', { class: 'sec-h' }, ['Algorithms', EV.el('span', { class: 'rule' })]));
      var chips = EV.el('div', { class: 'chips' });
      (EV.resus.ALGOS || []).forEach(function (a) {
        var b = EV.el('button', { class: 'chip', type: 'button' }, [a.title || a.id]);
        b.addEventListener('click', function () {
          state.algo = a.id;
          state.node = (a.nodes && a.nodes[0] && a.nodes[0].id) || null;
          draw();
        });
        chips.appendChild(b);
      });
      host.appendChild(chips);
      if (!(EV.resus.ALGOS || []).length) {
        host.appendChild(EV.el('div', { class: 'muted small', text: 'No algorithms loaded.' }));
      }
    }

    function drawCode() {
      EV.clear(host);
      stopTick();
      var code = EV.resus.code;
      if (!code || !code.state) { draw(); return; }

      host.appendChild(UI.btn('Algorithms', 'sm ghost', function () { draw(); }, 'back'));

      var bar = EV.el('div', { class: 'codebar', style: { marginTop: '8px' } });
      host.appendChild(bar);

      var actions = EV.el('div', { class: 'row', style: { marginTop: '10px' } });
      host.appendChild(actions);

      var logHost = EV.el('div', { style: { marginTop: '12px' } });
      host.appendChild(logHost);

      function paint() {
        if (code.tick) code.tick(EV.now());
        var s = code.state;
        EV.clear(bar);

        function k(label, value, cls) {
          var d2 = EV.el('div', { class: 'k ' + (cls || '') });
          d2.appendChild(EV.el('label', { text: label }));
          d2.appendChild(EV.el('b', { text: value }));
          return d2;
        }
        bar.appendChild(k('Elapsed', EV.mmss(EV.now() - s.t0), 'main'));
        bar.appendChild(k('CPR cycle', EV.mmss(s.cycleRemainingMs != null ? s.cycleRemainingMs : 0),
          (s.cycleRemainingMs != null && s.cycleRemainingMs <= 0) ? 'due' : 'cpr'));
        bar.appendChild(k('Adrenaline', s.lastEpi ? EV.mmss(EV.now() - s.lastEpi) : '—',
          s.epiDue ? 'due' : ''));
        bar.appendChild(k('Shocks', String(s.shocks || 0)));
        bar.appendChild(k('Cycles', String(s.cycles || 0)));

        EV.clear(actions);
        [
          ['Shock', 'shock', 'warn'],
          ['Adrenaline 1 mg', 'drug', 'pri'],
          ['Rhythm check', 'rhythm', ''],
          ['ROSC', 'rosc', 'ok'],
          ['Note', 'note', '']
        ].forEach(function (a) {
          actions.appendChild(UI.btn(a[0], a[2], function () {
            if (code.mark) code.mark(a[1], a[0]);
            paint();
          }));
        });
        actions.appendChild(UI.btn('End code', 'bad', function () {
          EV.confirm('End the resuscitation and write the note into the chart?').then(function (ok) {
            if (!ok) return;
            var entry = code.toCppt ? code.toCppt() : null;
            if (code.stop) code.stop();
            if (entry && p) {
              var c = EV.clone(p);
              var n = EV.model.newCppt({
                by: EV.settings.deviceLabel || '', phase: 'post',
                s: entry.s || '', o: entry.o || '', a: entry.a || '', p: entry.p || ''
              });
              c.cppt = (c.cppt || []).concat([n]);
              EV.store.put(c).then(function () {
                EV.toast('Resuscitation note written to the chart', 'ok');
                if (ctx.sheet) ctx.sheet.close();
              });
            } else {
              if (ctx.sheet) ctx.sheet.close();
            }
          });
        }));

        EV.clear(logHost);
        var events = (s.events || []).slice().reverse();
        if (events.length) {
          logHost.appendChild(EV.el('div', { class: 'sec-h' }, ['Log', EV.el('span', { class: 'rule' })]));
          var tl = EV.el('div', { class: 'tl' });
          events.forEach(function (e) {
            var row = EV.el('div', { class: 'e ' + (e.kind || 'note') });
            row.appendChild(EV.el('div', { class: 't', text: EV.mmss(e.t - s.t0) }));
            var l = EV.el('div', { class: 'l' });
            l.innerHTML = '<b><span class="kind"></span>' + EV.esc(e.label || e.kind) + '</b>';
            l.appendChild(EV.el('small', { text: EV.hhmmss(e.t) }));
            row.appendChild(l);
            tl.appendChild(row);
          });
          logHost.appendChild(tl);
        }
      }
      paint();
      tickTimer = setInterval(paint, 1000);
    }

    function drawAlgo() {
      EV.clear(host);
      stopTick();
      var algo = (EV.resus.ALGOS || []).filter(function (a) { return a.id === state.algo; })[0];
      if (!algo) { state.algo = null; draw(); return; }
      var node = (algo.nodes || []).filter(function (n) { return n.id === state.node; })[0] || (algo.nodes || [])[0];

      host.appendChild(UI.btn('All algorithms', 'sm ghost', function () { state.algo = null; draw(); }, 'back'));
      host.appendChild(EV.el('h2', { style: { margin: '10px 0 2px', fontSize: '18px' }, text: algo.title || algo.id }));
      if (!node) {
        host.appendChild(EV.el('div', { class: 'muted small', text: 'This algorithm has no steps.' }));
        return;
      }
      if (node.k) host.appendChild(EV.el('div', { class: 'tiny', style: { color: 'var(--brand)', fontWeight: '700', letterSpacing: '.1em', textTransform: 'uppercase' }, text: node.k }));
      if (node.h) host.appendChild(EV.el('h3', { style: { margin: '4px 0 8px', fontSize: '16px' }, text: node.h }));

      var ul = EV.el('ul', { style: { margin: '0 0 10px', paddingLeft: '18px', lineHeight: '1.65', fontSize: '14px' } });
      (node.li || []).forEach(function (li) {
        var t = typeof li === 'string' ? li : li.t;
        ul.appendChild(EV.el('li', { style: li && li.warn ? { color: 'var(--bad)', fontWeight: '600' } : null, text: t }));
      });
      host.appendChild(ul);

      /* Doses in mg and mL at the real vial strength, with the paediatric
         figure when we know the weight. */
      (node.dose || []).forEach(function (dz) {
        host.appendChild(doseRow(dz, p));
      });

      if ((node.next || []).length) {
        host.appendChild(EV.el('div', { class: 'sec-h' }, ['Next', EV.el('span', { class: 'rule' })]));
        var nx = EV.el('div', { class: 'chips' });
        node.next.forEach(function (n) {
          var b = EV.el('button', { class: 'chip', type: 'button' }, [n.l]);
          b.addEventListener('click', function () { state.node = n.to; drawAlgo(); });
          nx.appendChild(b);
        });
        host.appendChild(nx);
      }
      if (node.ref) host.appendChild(EV.el('div', { class: 'tiny muted', style: { marginTop: '12px' }, text: node.ref }));
    }

    function doseRow(dz, patient) {
      var d2 = patient ? EV.model.derive(patient) : {};
      var wt = d2.weight;
      var mg;
      if (EV.has(dz.fixed)) mg = dz.fixed;
      else if (EV.has(dz.mgPerKg) && EV.has(wt)) mg = dz.mgPerKg * wt;
      if (EV.has(mg) && EV.has(dz.max)) mg = Math.min(mg, dz.max);

      var conc = dz.formularyId && EV.formulary && EV.formulary.conc ? EV.formulary.conc(dz.formularyId) : null;
      var card = EV.el('div', { class: 'card', style: { marginBottom: '6px' } });
      var b = EV.el('div', { class: 'card-b', style: { display: 'flex', gap: '10px', alignItems: 'baseline', flexWrap: 'wrap' } });
      b.appendChild(EV.el('span', { class: 'strong', text: dz.drug }));
      if (EV.has(mg)) {
        b.appendChild(EV.el('span', { class: 'mono', style: { fontSize: '15px', fontWeight: '600' }, text: EV.fmt(mg, mg < 1 ? 3 : 1) + ' ' + (dz.unit || 'mg') }));
        if (conc && conc.perMl) {
          b.appendChild(EV.el('span', { class: 'mono', style: { color: 'var(--ok)', fontWeight: '600' }, text: '= ' + EV.fmt(mg / conc.perMl, 2) + ' mL' }));
          b.appendChild(EV.el('span', { class: 'tiny muted', text: conc.label }));
        }
      } else {
        b.appendChild(EV.el('span', {
          class: 'tag warn',
          text: EV.has(dz.mgPerKg) ? 'Weight needed — record it to get the dose' : 'Dose not specified'
        }));
      }
      if (dz.route) b.appendChild(EV.el('span', { class: 'tag', text: dz.route }));
      if (dz.note) b.appendChild(EV.el('span', { class: 'tiny muted', text: dz.note }));

      if (patient && EV.has(mg)) {
        b.appendChild(EV.el('span', { class: 'grow' }));
        b.appendChild(UI.btn('Log', 'sm pri', function () {
          var o = EV.model.newOrder({
            kind: 'med', itemId: dz.formularyId || '', name: dz.drug,
            dose: String(EV.fmt(mg, mg < 1 ? 3 : 1)), unit: dz.unit || 'mg',
            route: dz.route || 'IV', by: EV.settings.deviceLabel || ''
          });
          var c = EV.clone(patient);
          c.orders = (c.orders || []).concat([o]);
          EV.store.put(c).then(function () { EV.toast(dz.drug + ' logged', 'ok'); });
        }));
      }
      card.appendChild(b);
      return card;
    }

    draw();
  };

  /* ====================================================================== */
  /* Documents: PDF, Excel, Drive                                            */
  /* ====================================================================== */

  /* One ctx builder so a PDF, the recap and a Drive upload can never disagree
     about what the record holds. */
  UI.ctx = function () {
    return {
      event: EV.model.event(),
      posts: EV.model.posts(),
      beds: EV.model.beds(),
      ambulances: EV.model.ambulances(),
      patients: EV.model.patients(),
      formulary: EV.formulary ? EV.formulary.load() : [],
      logoName: 'siloam',
      generatedAt: EV.now(),
      app: 'Mini Emergency & Critical Care Event EMR',
      version: EV.VERSION
    };
  };

  function pdfName(p, kind) {
    var ev = EV.model.event();
    var slug = EV.slug((p.name || 'patient')).slice(0, 28);
    var suffix = kind === 'cppt' ? '-CPPT' : kind === 'transport' ? '-Transport' : '';
    return (p.mrn || 'NOMRN') + '-' + slug + suffix + '.pdf';
  }

  UI.buildPdf = function (p, kind) {
    if (!EV.pdf) throw new Error('The PDF module did not load');
    var ctx = UI.ctx();
    ctx.post = EV.model.post(p.postId);
    ctx.bed = p.bedId ? EV.store.get('bed', p.bedId) : null;
    ctx.ambulance = p.transport && p.transport.ambulanceId ? EV.store.get('ambulance', p.transport.ambulanceId) : null;
    var doc = kind === 'cppt' ? EV.pdf.cppt(p, ctx)
      : kind === 'transport' ? EV.pdf.transportForm(p, ctx)
        : EV.pdf.patientRecord(p, ctx);
    return doc;
  };

  UI.makePdf = function (p, kind) {
    try {
      var doc = UI.buildPdf(p, kind);
      var blob = doc.blob();
      var how = EV.download(blob, pdfName(p, kind));
      /* 'capability' means the viewer is still being asked — EV.download
         reports the outcome itself once they answer. */
      if (how !== 'capability') {
        EV.toast(how === 'tab' ? 'PDF opened in a new tab' : 'PDF saved', 'ok');
      }
    } catch (e) {
      EV.logError('pdf', e);
      EV.toast('PDF failed: ' + e.message, 'bad', 5000);
    }
  };

  /* Upload, or re-upload over the same Drive file so the link in the recap
     always resolves to the current chart. */
  UI.uploadPdf = function (p) {
    var cfg = EV.settings.drive;
    if (!cfg.enabled) return Promise.resolve(null);
    var doc;
    try {
      doc = UI.buildPdf(p, 'record');
    } catch (e) {
      EV.logError('pdf.upload', e);
      return Promise.reject(e);
    }
    var b64 = EV.bytesToB64(doc.bytes());

    return ensureFolders().then(function (ids) {
      return EV.store.fetchJson(cfg.endpoint, {
        action: 'upload',
        filename: pdfName(p, 'record'),
        mimeType: 'application/pdf',
        dataBase64: b64,
        parentId: ids.patients,
        fileId: p.pdfDriveId || undefined
      });
    }).then(function (r) {
      if (!r || !r.ok) throw new Error((r && r.error) || 'Drive rejected the upload');
      var c = EV.clone(EV.store.get('patient', p.id) || p);
      c.pdfDriveId = r.id;
      c.pdfSyncedAt = EV.now();
      return EV.store.put(c).then(function () { return r; });
    });
  };

  /* Create (once) the <folder>/<event>/ and /Patients subfolders, caching
     their ids in settings so every later upload is a single call. */
  function ensureFolders() {
    var cfg = EV.settings.drive;
    var ev = EV.model.event();
    var name = cfg.folderName || (ev && ev.name) || 'Event';
    if (cfg.eventFolderId && cfg.patientsFolderId) {
      return Promise.resolve({ event: cfg.eventFolderId, patients: cfg.patientsFolderId });
    }
    return EV.store.fetchJson(cfg.endpoint, { action: 'folder', name: name })
      .then(function (r) {
        if (!r || !r.ok) throw new Error((r && r.error) || 'Could not create the event folder');
        cfg.eventFolderId = r.id;
        return EV.store.fetchJson(cfg.endpoint, { action: 'folder', name: 'Patients', parentId: r.id });
      })
      .then(function (r2) {
        if (!r2 || !r2.ok) throw new Error((r2 && r2.error) || 'Could not create the Patients folder');
        cfg.patientsFolderId = r2.id;
        EV.save();
        return { event: cfg.eventFolderId, patients: cfg.patientsFolderId };
      });
  }
  UI.ensureDriveFolders = ensureFolders;

  UI.uploadAll = function () {
    var closed = EV.model.patients(function (p) { return p.status === 'closed'; });
    if (!closed.length) { EV.toast('No closed records to push', 'warn'); return Promise.resolve(); }
    var done = 0, failed = 0;
    EV.toast('Pushing ' + closed.length + ' records to Drive…');
    /* Serial, not parallel: twenty concurrent Drive creates from a phone on
       venue wifi is how you get rate-limited. */
    return closed.reduce(function (chain, p) {
      return chain.then(function () {
        return UI.uploadPdf(p).then(function () { done++; }, function () { failed++; });
      });
    }, Promise.resolve()).then(function () {
      EV.toast(done + ' uploaded' + (failed ? ', ' + failed + ' failed' : ''), failed ? 'warn' : 'ok', 4000);
      return UI.uploadRecap();
    });
  };

  function recapName() {
    var ev = EV.model.event();
    return 'Recap - ' + ((ev && ev.name) || 'Event').replace(/[\\/:*?"<>|]/g, ' ').slice(0, 80) + '.xlsx';
  }

  UI.buildRecap = function () {
    if (!EV.xlsx) throw new Error('The Excel module did not load');
    var ctx = UI.ctx();
    if (EV.analytics) {
      try { ctx.analytics = EV.analytics.compute(ctx); } catch (e) { EV.logError('analytics', e); }
    }
    return EV.xlsx.recap(ctx);
  };

  UI.exportRecap = function () {
    try {
      var bytes = UI.buildRecap();
      var blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      var how = EV.download(blob, recapName());
      if (how !== 'capability') {
        EV.toast(how === 'tab' ? 'Recap opened in a new tab' : 'Excel recap saved', 'ok');
      }
    } catch (e) {
      EV.logError('xlsx', e);
      EV.toast('Excel export failed: ' + e.message, 'bad', 5000);
    }
  };

  UI.uploadRecap = function () {
    var cfg = EV.settings.drive;
    if (!cfg.enabled) { EV.toast('Drive is switched off', 'warn'); return Promise.resolve(null); }
    var bytes;
    try {
      bytes = UI.buildRecap();
    } catch (e) {
      EV.logError('xlsx.upload', e);
      EV.toast('Excel build failed: ' + e.message, 'bad', 5000);
      return Promise.reject(e);
    }
    return ensureFolders().then(function (ids) {
      return EV.store.fetchJson(cfg.endpoint, {
        action: 'upload',
        filename: recapName(),
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        dataBase64: EV.bytesToB64(bytes),
        parentId: ids.event,
        fileId: cfg.recapFileId || undefined
      });
    }).then(function (r) {
      if (!r || !r.ok) throw new Error((r && r.error) || 'Drive rejected the recap');
      /* Keep the file id so the recap is rewritten in place — its link, once
         shared with the event director, never goes stale. */
      cfg.recapFileId = r.id;
      EV.save();
      EV.toast('Recap updated in Drive', 'ok');
      return r;
    }).catch(function (e) {
      EV.toast('Recap upload failed: ' + e.message, 'bad', 5000);
      throw e;
    });
  };

})(window.EV = window.EV || {});
