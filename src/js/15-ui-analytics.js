/* ==========================================================================
   15-ui-analytics.js — the medical director's screen.

   Requirement 6: intake, medications administered, transfer vs discharge,
   acuity. Everything here is computed from the same ctx the Excel recap uses,
   so the dashboard and the spreadsheet can never disagree.
   ========================================================================== */
(function (EV) {
  'use strict';

  var UI = EV.ui;

  UI.route('analytics', function (root) {
    var ev = EV.model.event();
    if (!ev) { UI.go('board', '', true); return; }

    if (!EV.analytics) {
      root.appendChild(UI.empty('Analytics unavailable', 'The analytics module did not load.'));
      return;
    }

    var ctx = UI.ctx();
    var a;
    try {
      a = EV.analytics.compute(ctx);
    } catch (e) {
      EV.logError('analytics.compute', e);
      root.appendChild(UI.empty('Analytics could not be calculated', e.message));
      return;
    }

    var head = EV.el('div', { class: 'row', style: { marginBottom: '12px' } });
    head.appendChild(EV.el('div', { class: 'grow' }, [
      EV.el('h1', { style: { fontSize: '19px' }, text: 'Analytics' }),
      EV.el('div', { class: 'small muted', text: ev.name + ' · as at ' + EV.hhmm(EV.now()) })
    ]));
    head.appendChild(UI.btn('Excel recap', 'pri', function () { UI.exportRecap(); }, 'xls'));
    if (EV.settings.drive.enabled) {
      head.appendChild(UI.btn('Push to Drive', '', function () { UI.uploadRecap(); }, 'drive'));
    }
    head.appendChild(UI.btn('Print', '', function () { window.print(); }, 'print'));
    root.appendChild(head);

    /* ---- headline ------------------------------------------------------- */
    var t = a.totals || {};
    var strip = EV.el('div', { class: 'strip' });
    strip.appendChild(UI.stat('Total seen', t.patients || 0,
      EV.has(a.capacity && a.capacity.projectedTotal) ? 'projected ' + a.capacity.projectedTotal : ''));
    strip.appendChild(UI.stat('Still open', t.open || 0));
    strip.appendChild(UI.stat('Transported', (t.transported || 0),
      pctOf(t.transported, t.patients) + ' of all'));
    strip.appendChild(UI.stat('Returned to event', t.returnedToEvent || 0,
      pctOf(t.returnedToEvent, t.patients) + ' of all'));
    strip.appendChild(UI.stat('Median stay',
      EV.has(a.los && a.los.median) ? EV.durShort(a.los.median) : '—',
      EV.has(a.los && a.los.p90) ? 'p90 ' + EV.durShort(a.los.p90) : ''));
    if (a.beds) {
      strip.appendChild(UI.stat('Bed occupancy', (a.beds.occupancyPct || 0) + '%',
        a.beds.occupied + ' of ' + a.beds.total,
        a.beds.occupancyPct >= 90 ? 'alert' : ''));
    }
    root.appendChild(strip);

    /* ---- red flags ------------------------------------------------------ */
    if ((a.redFlags || []).length) {
      root.appendChild(UI.sectionHead('Open patients that need a decision'));
      var rf = EV.el('div', { class: 'stack tight' });
      a.redFlags.slice(0, 12).forEach(function (f) {
        var p = EV.store.get('patient', f.patientId);
        var row = EV.el('button', {
          class: 'prow' + (f.severity >= 2 ? ' urgent' : ''), type: 'button',
          style: { borderLeftColor: f.severity >= 2 ? 'var(--bad)' : 'var(--warn)' }
        });
        row.appendChild(EV.el('span', { class: 'grow' }, [
          EV.el('span', { class: 'nm', text: (f.name || (p && p.name) || 'Patient') }),
          EV.el('span', { class: 'sub' }, [
            EV.el('span', { class: 'mrn', text: f.mrn || (p && p.mrn) || '' }),
            EV.el('span', { text: f.why })
          ])
        ]));
        if (p) row.addEventListener('click', function () { UI.go('patient', p.id); });
        rf.appendChild(row);
      });
      root.appendChild(rf);
    }

    /* ---- charts --------------------------------------------------------- */
    var grid = EV.el('div', {
      style: { display: 'grid', gap: '12px', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', marginTop: '16px' }
    });

    grid.appendChild(chartCard('Arrivals per hour',
      'Intake rate against the hour the event is in.',
      function () {
        var rate = (a.rate && a.rate.perHour) || [];
        if (!rate.length) return null;
        return EV.analytics.bar(rate.map(function (r) {
          return { l: EV.hhmm(r.t), v: r.n };
        }), { yLabel: 'patients', accent: 'var(--brand)' });
      }));

    grid.appendChild(chartCard('Acuity',
      'How sick the people coming through actually are.',
      function () {
        var ac = (a.acuity || []).filter(function (x) { return x.n; });
        if (!ac.length) return null;
        return EV.analytics.donut(ac.map(function (x) {
          return { l: 'P' + x.v + ' ' + x.l, v: x.n, color: 'var(--a' + x.v + ')' };
        }), { centre: String((a.totals || {}).patients || 0), centreLabel: 'patients' });
      }));

    grid.appendChild(chartCard('Outcome',
      'Transfer versus discharge — the number the event organiser asks for.',
      function () {
        var dp = (a.disposition || []).filter(function (x) { return x.n; });
        if (!dp.length) return null;
        return EV.analytics.bar(dp.map(function (x) { return { l: x.l, v: x.n }; }),
          { horizontal: true, yLabel: 'patients' });
      }));

    grid.appendChild(chartCard('Presenting complaint',
      'What the medical plan actually needed to cover.',
      function () {
        var cc = (a.complaints || []).filter(function (x) { return x.n; });
        if (!cc.length) return null;
        return EV.analytics.bar(cc.map(function (x) {
          return { l: x.l, v: x.n, color: EV.model.catHue(x.cat) };
        }), { horizontal: true, yLabel: 'patients' });
      }));

    root.appendChild(grid);

    /* ---- tables --------------------------------------------------------- */
    root.appendChild(UI.sectionHead('By post'));
    root.appendChild(table(
      ['Post', 'Seen', 'Open', 'P1–P2', 'Median stay', 'Transferred'],
      (a.byPost || []).map(function (r) {
        var high = 0;
        (r.acuityMix || []).forEach(function (m) { if (m.v <= 2) high += m.n; });
        return [
          (r.code ? r.code + ' · ' : '') + r.name,
          { n: r.n }, { n: r.open }, { n: high },
          EV.has(r.medianLos) ? EV.durShort(r.medianLos) : '—',
          EV.has(r.transferRate) ? EV.r(r.transferRate, 0) + '%' : '—'
        ];
      }),
      'No posts have seen a patient yet.'
    ));

    root.appendChild(UI.sectionHead('Medications administered'));
    root.appendChild(table(
      ['Medication', 'Doses', 'Patients', 'Total'],
      (a.meds || []).slice(0, 40).map(function (m) {
        return [m.name, { n: m.n }, { n: m.patients },
        EV.has(m.totalDose) && m.totalDose ? EV.fmt(m.totalDose, 1) + ' ' + (m.unit || '') : '—'];
      }),
      'Nothing has been given yet.'
    ));

    root.appendChild(UI.sectionHead('Supplies used against par'));
    root.appendChild(table(
      ['Item', 'Used', 'Par', '% of par'],
      (a.supplies || []).slice(0, 40).map(function (s) {
        var pct = EV.has(s.pctOfPar) ? EV.r(s.pctOfPar, 0) : null;
        return [s.name, { n: s.qty }, { n: EV.has(s.par) ? s.par : '—' },
        pct == null ? '—' : { v: pct + '%', cls: pct >= 80 ? 'bad' : pct >= 50 ? 'warn' : '' }];
      }),
      'No supplies logged yet.'
    ));

    if ((a.transport || []).length) {
      root.appendChild(UI.sectionHead('Ambulance activity'));
      root.appendChild(table(
        ['Callsign', 'Trips', 'Median turnaround', 'Destinations'],
        a.transport.map(function (tr) {
          return [tr.callsign, { n: tr.trips },
          EV.has(tr.medianTurnaround) ? EV.durShort(tr.medianTurnaround) : '—',
          (tr.destinations || []).map(function (d) { return d.d + ' (' + d.n + ')'; }).join(', ') || '—'];
        }),
        'No transports yet.'
      ));
    }

    if (a.timeliness) {
      root.appendChild(UI.sectionHead('Timeliness'));
      root.appendChild(EV.el('div', { class: 'strip' }, [
        UI.stat('Triage delay', mins(a.timeliness.medianTriageDelay), 'median, arrival → triage'),
        UI.stat('Door to doctor', mins(a.timeliness.medianDoorToDoctor), 'median'),
        UI.stat('Door to transport', mins(a.timeliness.medianDoorToTransport), 'median')
      ]));
    }

    root.appendChild(EV.el('div', {
      class: 'tiny muted', style: { marginTop: '20px' },
      text: 'Counts are live from this device’s copy of the record. A post that has not synced recently is not in these numbers — ' +
        ((EV.store.syncState.devices || 0) + ' device(s) reporting, last sync ' +
          (EV.store.syncState.lastPull ? EV.hhmm(EV.store.syncState.lastPull) : 'never') + '.')
    }));
  });

  function pctOf(n, total) {
    if (!total) return '—';
    return EV.r((n || 0) / total * 100, 0) + '%';
  }
  function mins(ms) {
    if (!EV.has(ms)) return '—';
    return EV.r(ms / 60000, 0) + ' min';
  }

  function chartCard(title, sub, build) {
    var box = EV.el('div', { class: 'chartbox' });
    var svg = null;
    try { svg = build(); } catch (e) { EV.logError('chart:' + title, e); }
    if (svg) box.innerHTML = svg;
    else box.appendChild(EV.el('div', { class: 'muted small', style: { padding: '22px 0', textAlign: 'center' }, text: 'Nothing to chart yet.' }));

    var body = EV.el('div', { class: 'stack tight' }, [
      EV.el('div', { class: 'tiny muted', text: sub }),
      box
    ]);
    return UI.card(title, body);
  }

  function table(cols, rows, emptyMsg) {
    if (!rows || !rows.length) {
      return UI.empty('Nothing yet', emptyMsg);
    }
    var tbl = EV.el('table', { class: 'dt' });
    var thead = EV.el('thead');
    var tr = EV.el('tr');
    cols.forEach(function (c, i) {
      tr.appendChild(EV.el('th', { class: i ? 'right' : '', text: c }));
    });
    thead.appendChild(tr);
    tbl.appendChild(thead);
    var tb = EV.el('tbody');
    rows.forEach(function (r) {
      var row = EV.el('tr');
      r.forEach(function (cell, i) {
        if (cell && typeof cell === 'object') {
          if ('n' in cell) {
            row.appendChild(EV.el('td', { class: 'n', text: String(cell.n) }));
          } else {
            row.appendChild(EV.el('td', {
              class: 'n',
              style: cell.cls === 'bad' ? { color: 'var(--bad)', fontWeight: '600' }
                : cell.cls === 'warn' ? { color: 'var(--warn)', fontWeight: '600' } : null,
              text: String(cell.v)
            }));
          }
        } else {
          row.appendChild(EV.el('td', { class: i ? 'n' : 'strong', text: String(cell) }));
        }
      });
      tb.appendChild(row);
    });
    tbl.appendChild(tb);
    return UI.card('', EV.el('div', { class: 'tblw' }, [tbl]), { flush: true });
  }

})(window.EV = window.EV || {});
