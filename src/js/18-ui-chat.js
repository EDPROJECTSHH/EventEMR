/* ==========================================================================
   18-ui-chat.js — talking to the other posts.

   Radio traffic at an event is mostly four questions: have you got a bed,
   have you got an ambulance, where is it, and can you take this patient. This
   puts those in writing, against the post or the vehicle they concern, so the
   answer is still there when the shift changes.

   Messages ride the same sync as the records — a post with no signal queues
   them and they land when it comes back. Nothing here is real-time; it is a
   log, and it says plainly when a message has not left the device yet.
   ========================================================================== */
(function (EV) {
  'use strict';

  var UI = EV.ui;
  var dock = null, panels = Object.create(null);

  /* ---- the dock ----------------------------------------------------------
     Bottom right, beside New patient. Collapsed it is one button with an
     unread count; opened it stacks the conversations that are live. */
  UI.mountChat = function () {
    if (dock) return dock;
    dock = EV.el('div', { class: 'chatdock', id: 'chatdock' });
    document.body.appendChild(dock);
    EV.on('change:chat', function () { UI.renderChat(); });
    EV.on('bulk', function () { UI.renderChat(); });
    UI.renderChat();
    return dock;
  };

  UI.unmountChat = function () {
    if (dock && dock.parentNode) dock.parentNode.removeChild(dock);
    dock = null;
    panels = Object.create(null);
  };

  UI.renderChat = function () {
    if (!dock) return;
    if (!EV.model.isBound() || !EV.model.event()) { dock.hidden = true; return; }
    dock.hidden = false;
    EV.clear(dock);

    var open = EV.settings.chatOpen || [];
    var threads = EV.model.chatThreads();

    /* Any conversation with something unread opens itself — that is the
       point of a radio call. */
    threads.forEach(function (t) {
      if (t.unread && open.indexOf(t.key) === -1) open.push(t.key);
    });
    EV.settings.chatOpen = open;

    open.forEach(function (key) {
      var t = threads.filter(function (x) { return x.key === key; })[0];
      if (!t) {
        var parts = key.split(':');
        t = { key: key, kind: parts[0], id: parts.slice(1).join(':'), label: labelFor(parts[0], parts.slice(1).join(':')), messages: [], unread: 0 };
      }
      dock.appendChild(panel(t));
    });

    dock.appendChild(launcher(threads));
  };

  function labelFor(kind, id) {
    if (kind === 'ambulance') {
      var a = EV.store.get('ambulance', id);
      return (a && a.callsign) || 'Ambulance';
    }
    var p = EV.store.get('post', id);
    return (p && (p.code || p.name)) || 'Post';
  }

  function launcher(threads) {
    var unread = threads.reduce(function (n, t) { return n + t.unread; }, 0);
    var b = EV.el('button', {
      class: 'chatlaunch' + (unread ? ' has-unread' : ''), type: 'button',
      title: 'Messages from the other posts'
    });
    b.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" ' +
      'stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 9 9 0 0 1-3.9-.9L3 20.5l1.5-4.1A8.4 8.4 0 0 1 3 11.5 8.4 8.4 0 0 1 12 3a8.4 8.4 0 0 1 9 8.5z"/></svg>';
    b.appendChild(EV.el('span', { class: 'lbl', text: 'Messages' }));
    if (unread) b.appendChild(EV.el('span', { class: 'cnt', text: String(unread) }));
    b.addEventListener('click', function () { directory(); });
    return b;
  }

  /* ---- directory ---------------------------------------------------------- */
  function directory() {
    var sh = UI.sheet({ title: 'Messages', footer: [] });
    var body = EV.el('div', { class: 'stack' });
    var me = EV.model.myChatEndpoint();
    var threads = EV.model.chatThreads();

    if (threads.length) {
      body.appendChild(EV.el('div', { class: 'sec-h' }, ['Conversations', EV.el('span', { class: 'rule' })]));
      var list = EV.el('div', { class: 'stack tight' });
      threads.forEach(function (t) {
        var last = t.messages[t.messages.length - 1];
        var row = EV.el('button', { class: 'prow' + (t.unread ? ' urgent' : ''), type: 'button' });
        row.appendChild(EV.el('span', { class: 'grow' }, [
          EV.el('span', { class: 'nm', text: t.label }),
          EV.el('span', { class: 'sub trunc', text: last ? (last.fromId === me.id ? 'You: ' : '') + last.text : '' })
        ]));
        var rt = EV.el('span', { class: 'rt' });
        if (t.unread) rt.appendChild(EV.el('span', { class: 'tag bad', text: String(t.unread) }));
        rt.appendChild(EV.el('span', { class: 'los', text: last ? EV.hhmm(last.at) : '' }));
        row.appendChild(rt);
        row.addEventListener('click', function () { sh.close(); UI.openChat(t.kind, t.id, t.label); });
        list.appendChild(row);
      });
      body.appendChild(list);
    }

    var posts = EV.model.posts().filter(function (p) { return p.id !== me.id; });
    if (posts.length) {
      body.appendChild(EV.el('div', { class: 'sec-h' }, ['Posts', EV.el('span', { class: 'rule' })]));
      var pc = EV.el('div', { class: 'chips' });
      posts.forEach(function (p) {
        var bs = EV.model.bedState(p.id);
        var c = EV.el('button', { class: 'chip', type: 'button' }, [
          (p.code ? p.code + ' · ' : '') + p.name
        ]);
        if (bs.total) {
          c.appendChild(EV.el('span', {
            class: 'tag ' + (bs.full ? 'bad' : 'ok'),
            text: bs.full ? 'full' : bs.free + ' free'
          }));
        }
        c.addEventListener('click', function () {
          sh.close();
          UI.openChat('post', p.id, p.code || p.name);
        });
        pc.appendChild(c);
      });
      body.appendChild(pc);
    }

    var ambs = EV.model.ambulances();
    if (ambs.length) {
      body.appendChild(EV.el('div', { class: 'sec-h' }, ['Ambulances', EV.el('span', { class: 'rule' })]));
      var ac = EV.el('div', { class: 'chips' });
      ambs.forEach(function (a) {
        var st = EV.model.AMB_STATUS.filter(function (x) { return x.v === a.status; })[0] || {};
        var c = EV.el('button', { class: 'chip', type: 'button' }, [a.callsign]);
        c.appendChild(EV.el('span', { class: 'tag ' + (st.c || ''), text: st.l || a.status }));
        c.addEventListener('click', function () {
          sh.close();
          UI.openChat('ambulance', a.id, a.callsign);
        });
        ac.appendChild(c);
      });
      body.appendChild(ac);
    }

    sh.setBody(body);
  }

  /* ---- a conversation ------------------------------------------------------ */
  UI.openChat = function (kind, id, label) {
    if (!EV.model.isBound()) { EV.toast('Join a post before messaging', 'warn'); return; }
    var me = EV.model.myChatEndpoint();
    if (kind === 'post' && id === me.id) { EV.toast('That is this post', 'warn'); return; }
    var key = kind + ':' + id;
    var open = EV.settings.chatOpen || [];
    if (open.indexOf(key) === -1) open.push(key);
    /* Three panels is as many as fits above the dock on a phone. */
    while (open.length > 3) open.shift();
    EV.settings.chatOpen = open;
    EV.save();
    UI.renderChat();
    setTimeout(function () {
      var p = panels[key];
      if (p && p.input) p.input.focus();
    }, 50);
  };

  function closePanel(key) {
    var open = (EV.settings.chatOpen || []).filter(function (k) { return k !== key; });
    EV.settings.chatOpen = open;
    EV.save();
    delete panels[key];
    UI.renderChat();
  }

  function panel(t) {
    var me = EV.model.myChatEndpoint();
    var el = EV.el('div', { class: 'chatpanel' });

    var head = EV.el('div', { class: 'ch-h' });
    head.appendChild(EV.el('span', {
      class: 'dot ' + (t.kind === 'ambulance' ? 'amb' : 'post')
    }));
    head.appendChild(EV.el('span', { class: 'nm grow trunc', text: t.label }));

    /* The status line is why you opened the window. */
    var sub = '';
    if (t.kind === 'post') {
      var bs = EV.model.bedState(t.id);
      sub = bs.total ? (bs.full ? 'Beds full' : bs.free + ' of ' + bs.usable + ' beds free') : '';
    } else {
      var a = EV.store.get('ambulance', t.id);
      if (a) {
        var st = EV.model.AMB_STATUS.filter(function (x) { return x.v === a.status; })[0] || {};
        sub = (st.l || a.status) + (a.destination ? ' → ' + a.destination : '');
      }
    }
    if (sub) head.appendChild(EV.el('span', { class: 'sub', text: sub }));

    var x = EV.el('button', { class: 'iconbtn sm', type: 'button', 'aria-label': 'Close' });
    x.innerHTML = UI.icon('close', 15);
    x.addEventListener('click', function () { closePanel(t.key); });
    head.appendChild(x);
    el.appendChild(head);

    var log = EV.el('div', { class: 'ch-log' });
    if (!t.messages.length) {
      log.appendChild(EV.el('div', {
        class: 'muted tiny center', style: { padding: '16px 8px' },
        text: 'No messages yet. Ask about beds, an ambulance, or a transfer.'
      }));
    }
    t.messages.forEach(function (m) {
      var mine = m.fromId === me.id;
      var b = EV.el('div', { class: 'bubble' + (mine ? ' mine' : '') + (m.urgent ? ' urgent' : '') });
      if (!mine && m.by) b.appendChild(EV.el('div', { class: 'who', text: m.by }));
      b.appendChild(EV.el('div', { class: 'txt', text: m.text }));
      /* Timestamp at the bottom right of the bubble. */
      var meta = EV.el('div', { class: 'meta' });
      if (m.urgent) meta.appendChild(EV.el('span', { class: 'u', text: 'URGENT' }));
      meta.appendChild(EV.el('span', { class: 'at', text: EV.hhmm(m.at) }));
      b.appendChild(meta);
      log.appendChild(b);
    });
    el.appendChild(log);

    /* Mark read once it is actually on screen. */
    if (t.unread) {
      var newest = t.messages.length ? t.messages[t.messages.length - 1].at : EV.now();
      setTimeout(function () { EV.model.markChatSeen(t.key, newest); }, 400);
    }

    var quick = EV.el('div', { class: 'ch-quick' });
    var QUICK = t.kind === 'ambulance'
      ? ['Are you available?', 'What is your location?', 'ETA to us?', 'Patient ready for transport']
      : ['Do you have a bed free?', 'Sending a patient over', 'Can you take a transfer?', 'All quiet here'];
    QUICK.forEach(function (q) {
      var c = EV.el('button', { class: 'chip sm', type: 'button' }, [q]);
      c.addEventListener('click', function () { send(q, false); });
      quick.appendChild(c);
    });
    el.appendChild(quick);

    var foot = EV.el('form', { class: 'ch-f' });
    var input = EV.el('input', {
      type: 'text', placeholder: 'Message ' + t.label + '…',
      'aria-label': 'Message ' + t.label, autocomplete: 'off', maxlength: 500
    });
    var urgentBtn = EV.el('button', {
      class: 'iconbtn sm', type: 'button', title: 'Mark urgent', 'aria-pressed': 'false'
    });
    urgentBtn.innerHTML = UI.icon('alert', 16);
    var urgent = false;
    urgentBtn.addEventListener('click', function () {
      urgent = !urgent;
      urgentBtn.classList.toggle('on', urgent);
      urgentBtn.setAttribute('aria-pressed', urgent ? 'true' : 'false');
    });
    var go = EV.el('button', { class: 'btn pri sm', type: 'submit', text: 'Send' });
    foot.appendChild(input);
    foot.appendChild(urgentBtn);
    foot.appendChild(go);
    foot.addEventListener('submit', function (e) {
      e.preventDefault();
      send(input.value, urgent);
      input.value = '';
      urgent = false;
      urgentBtn.classList.remove('on');
    });
    el.appendChild(foot);

    function send(text, isUrgent) {
      if (!String(text || '').trim()) return;
      EV.model.sendChat(t.kind, t.id, t.label, text, isUrgent).then(function () {
        EV.model.markChatSeen(t.key, EV.now());
        UI.renderChat();
        setTimeout(function () {
          var pp = panels[t.key];
          if (pp && pp.log) pp.log.scrollTop = pp.log.scrollHeight;
        }, 20);
      });
    }

    panels[t.key] = { el: el, log: log, input: input };
    setTimeout(function () { log.scrollTop = log.scrollHeight; }, 10);
    return el;
  }

  /* Used by the board's "Chat with this post" buttons. */
  UI.chatButton = function (kind, id, label, cls) {
    var threads = EV.model.chatThreads();
    var t = threads.filter(function (x) { return x.kind === kind && x.id === id; })[0];
    var b = UI.btn(t && t.unread ? 'Chat (' + t.unread + ')' : 'Chat',
      'sm ' + (cls || (t && t.unread ? 'bad' : 'ghost')),
      function (e) {
        if (e && e.stopPropagation) e.stopPropagation();
        UI.openChat(kind, id, label);
      });
    b.title = 'Message ' + label;
    return b;
  };

})(window.EV = window.EV || {});
