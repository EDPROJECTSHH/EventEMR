/* ==========================================================================
   16-boot.js — wiring. Last file in the bundle.
   ========================================================================== */
(function (EV) {
  'use strict';

  function boot() {
    EV.applyTheme();

    var app = document.getElementById('app');
    if (!app) { return; }

    EV.store.open().then(function () {
      /* Register the logo with the PDF writer once, so every document can
         draw it without re-decoding. */
      if (EV.pdf && EV.pdf.registerJpeg && EV.LOGO_JPEG) {
        try {
          EV.pdf.registerJpeg('siloam', EV.LOGO_JPEG, EV.LOGO_JPEG_W || 420, EV.LOGO_JPEG_H || 170);
        } catch (e) { EV.logError('pdf.logo', e); }
      }

      /* The reference is 2 MB; load it in the background so the board is
         usable immediately and the module is ready by the time anyone opens
         a chart. */
      if (EV.ref && EV.ref.load) {
        try { EV.ref.load(); } catch (e) { EV.logError('ref.load', e); }
      }

      EV.ui.mount(app);
      EV.ui.mountChat();

      var boot = document.getElementById('boot');
      if (boot && boot.parentNode) boot.parentNode.removeChild(boot);

      /* A concluded event that has outlived its reopen window tidies itself
         up before anything else draws. */
      EV.ui.sweepConcluded();

      /* Nothing but the landing page works without a binding. */
      if (EV.ui.needsLanding() && EV.ui.current.name !== 'landing') {
        EV.ui.go('landing', '', true);
      }

      if (EV.settings.sync.enabled && EV.settings.eventId) EV.store.startAutoSync();

      /* Run the self-tests once at startup and say so if anything is broken —
         the alternative is a silently wrong dose. */
      setTimeout(function () {
        var res = EV.ui.runSelfTests ? EV.ui.runSelfTests() : [];
        var fail = res.reduce(function (n, r) { return n + r.fail; }, 0);
        var total = res.reduce(function (n, r) { return n + r.total; }, 0);
        EV.selfTest = { fail: fail, total: total, detail: res };
        if (fail) {
          EV.toast(fail + ' of ' + total + ' self-tests FAILED — check Settings → Data', 'bad', 9000);
        }
      }, 400);
    });

    /* Service worker: the venue wifi will drop. Only when served over http(s)
       — the single-file artifact build has no origin to register against. */
    if ('serviceWorker' in navigator && location.protocol.indexOf('http') === 0) {
      window.addEventListener('load', function () {
        navigator.serviceWorker.register('sw.js').catch(function () { /* fine without it */ });
      });
    }

    /* A field tablet gets closed mid-sentence; make the last write count. */
    window.addEventListener('beforeunload', function () {
      if (EV.store.syncState.pending && EV.settings.sync.enabled) {
        try { EV.store.sync(); } catch (e) { /* best effort */ }
      }
    });

    window.addEventListener('error', function (e) {
      EV.logError('window', e.error || new Error(e.message));
    });
    window.addEventListener('unhandledrejection', function (e) {
      EV.logError('promise', e.reason || new Error('unhandled rejection'));
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

})(window.EV = window.EV || {});
