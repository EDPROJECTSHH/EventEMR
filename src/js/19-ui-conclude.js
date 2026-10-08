/* ==========================================================================
   19-ui-conclude.js — closing the event down.

   Two deliberate steps, in this order: get the records out, then lock the
   doors. Concluding before the Drive handoff would leave the only copy of the
   day's charts in the browser storage of twenty borrowed tablets.

   After concluding there is a two-hour window to reopen — long enough for the
   "wait, one more patient" that always happens. After that the event closes
   for good and the local cache is cleared; Drive keeps the record.
   ========================================================================== */
(function (EV) {
  'use strict';

  var UI = EV.ui;

  UI.concludeFlow = function () {
    var ev = EV.model.event();
    if (!ev) return;
    var gate = EV.model.canConclude();
    if (!gate.ok) { EV.toast(gate.why || 'Not ready to conclude', 'warn', 5000); return; }

    var sh = UI.sheet({ title: 'Conclude ' + ev.name, footer: [] });
    var body = EV.el('div', { class: 'stack' });

    var patients = EV.model.patients();
    var closed = patients.filter(function (p) { return p.status === 'closed'; });

    body.appendChild(EV.el('p', {
      class: 'muted', style: { margin: 0 },
      text: 'Send every record to Google Drive first. Once the event is concluded it becomes ' +
        'read-only, and after two hours the copies on these devices are deleted.'
    }));

    body.appendChild(EV.el('div', { class: 'strip' }, [
      UI.stat('Patients', patients.length, closed.length + ' closed'),
      UI.stat('Posts', EV.model.posts().length),
      UI.stat('Already in Drive',
        patients.filter(function (p) { return p.pdfDriveId; }).length + ' / ' + patients.length)
    ]));

    /* ---- step 1: the handoff ---- */
    body.appendChild(EV.el('div', { class: 'sec-h' }, ['1 · Send the records', EV.el('span', { class: 'rule' })]));

    var driveOn = EV.settings.drive.enabled;
    var progress = EV.el('div', { class: 'stack tight' });
    var handedOff = !!ev.driveHandoffAt;

    function drawStep1() {
      EV.clear(progress);
      if (!driveOn) {
        progress.appendChild(EV.el('div', { class: 'banner warn' }, [
          EV.h(UI.icon('alert', 17)),
          EV.el('div', { class: 'grow small' }, [
            EV.el('div', { class: 'strong', text: 'Google Drive is switched off' }),
            EV.el('div', {
              text: 'Turn it on in Settings → Google Drive, or download the files to this device ' +
                'and file them yourself.'
            })
          ])
        ]));
        progress.appendChild(EV.el('div', { class: 'row' }, [
          UI.btn('Open Drive settings', '', function () { sh.close(); UI.go('settings', 'drive'); }, 'gear'),
          UI.btn('Download Excel recap instead', '', function () { UI.exportRecap(); }, 'xls')
        ]));
        return;
      }
      if (handedOff) {
        progress.appendChild(EV.el('div', { class: 'banner ok' }, [
          EV.h(UI.icon('check', 17)),
          EV.el('div', { class: 'grow small' }, [
            EV.el('div', { class: 'strong', text: 'Records sent to Drive' }),
            EV.el('div', { text: EV.dmyhm(ev.driveHandoffAt) })
          ])
        ]));
      }
      progress.appendChild(EV.el('div', { class: 'row' }, [
        UI.btn(handedOff ? 'Send again' : 'Send everything to Drive', handedOff ? '' : 'pri',
          function (e) { runHandoff(e.currentTarget); }, 'drive'),
        UI.btn('Download Excel recap', '', function () { UI.exportRecap(); }, 'xls')
      ]));
    }

    function runHandoff(btn) {
      if (btn) { btn.disabled = true; btn.textContent = 'Sending…'; }
      var line = EV.el('div', { class: 'small muted' });
      progress.appendChild(line);
      line.textContent = 'Uploading patient records…';

      UI.uploadAll().then(function () {
        line.textContent = 'Updating the Excel recap…';
        return UI.uploadRecap();
      }).then(function () {
        var e2 = EV.clone(EV.model.event());
        e2.driveHandoffAt = EV.now();
        return EV.store.put(e2);
      }).then(function () {
        handedOff = true;
        EV.toast('Everything is in Drive', 'ok');
        drawStep1();
        drawStep2();
      }).catch(function (err) {
        EV.logError('conclude.handoff', err);
        line.innerHTML = '';
        line.appendChild(EV.el('span', {
          class: 'tag bad',
          text: 'Upload failed: ' + (err.message || err) + ' — fix it, or download the files instead.'
        }));
        if (btn) { btn.disabled = false; btn.textContent = 'Try again'; }
      });
    }
    drawStep1();
    body.appendChild(progress);

    /* ---- step 2: the lock ---- */
    body.appendChild(EV.el('div', { class: 'sec-h' }, ['2 · Close the event', EV.el('span', { class: 'rule' })]));
    var step2 = EV.el('div', { class: 'stack tight' });
    body.appendChild(step2);

    function drawStep2() {
      EV.clear(step2);
      if (!handedOff) {
        step2.appendChild(EV.el('div', {
          class: 'small muted',
          text: 'Send the records first. You can still conclude without doing so, but the only ' +
            'copies will be on the devices, and they are deleted two hours later.'
        }));
      }
      step2.appendChild(EV.el('div', { class: 'small muted' }, [
        'Concluding makes every record read-only on every post, and locks all posts. ' +
        'For the next two hours a super admin can reopen it.'
      ]));
      step2.appendChild(UI.btn(
        handedOff ? 'Conclude event' : 'Conclude without sending',
        handedOff ? 'bad' : 'warn',
        function () { confirmConclude(handedOff); }, 'lock'));
    }
    drawStep2();

    function confirmConclude(sent) {
      EV.confirm(
        'Conclude event?\n\n' + ev.name + ' will become read-only on every post.' +
        (sent ? '' : '\n\nThe records have NOT been sent to Drive.'),
        { danger: true, ok: 'Conclude event', cancel: 'Not yet' }
      ).then(function (ok) {
        if (!ok) return;
        EV.model.concludeEvent(EV.settings.deviceLabel).then(function () {
          sh.close();
          EV.toast('Event concluded', 'ok', 5000);
          UI.render();
        });
      });
    }

    sh.setBody(body);
    sh.setFooter([UI.btn('Not now', '', function () { sh.close(); })]);
  };

  /* ---- the two-hour sweep -------------------------------------------------
     A concluded event closes itself once the window passes. The local cache
     goes with it; Drive is the lasting record. Checked on load and every
     minute, because a tablet left on a table should tidy itself up. */
  var sweeping = false;

  UI.sweepConcluded = function () {
    if (sweeping) return;
    var ev = EV.model.event();
    if (!ev || ev.status !== 'concluded' || !ev.concludedAt) return;
    if (EV.model.reopenLeft(ev) > 0) return;

    sweeping = true;
    EV.model.closeEvent()
      .then(function () {
        /* Push the closure out before wiping, so the other posts learn the
           event is over rather than just going quiet. */
        if (EV.settings.sync.enabled) return EV.store.sync().catch(function () {});
      })
      .then(function () {
        EV.model.unbind();
        EV.settings.eventId = '';
        EV.settings.chatSeen = {};
        EV.settings.chatOpen = [];
        EV.settings.drive.eventFolderId = '';
        EV.settings.drive.patientsFolderId = '';
        EV.settings.drive.recapFileId = '';
        EV.save();
        return EV.store.wipe();
      })
      .then(function () {
        sweeping = false;
        EV.toast('The event is closed. Local records cleared — the copies in Drive remain.', 'warn', 8000);
        UI.go('landing');
      })
      .catch(function (e) {
        sweeping = false;
        EV.logError('conclude.sweep', e);
      });
  };

  setInterval(function () {
    if (!document.hidden) UI.sweepConcluded();
  }, 60000);

})(window.EV = window.EV || {});
