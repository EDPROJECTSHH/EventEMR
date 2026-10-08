/* ==========================================================================
   07-pdf.js — EV.pdf. A from-scratch PDF 1.4 writer plus the four clinical
   templates a receiving hospital actually gets.

   Everything is assembled as an array of Uint8Array chunks and every xref
   offset is taken from the real serialised byte length, never from a JS
   string length. Text is WinAnsi-encoded with the genuine Helvetica AFM
   advance widths so wrap() and align right/center line up on paper.

   Deliberate deviation from the literal spec wording: the header/footer
   callbacks registered with onPage() run once, at bytes()/blob()/dataUri()
   time, instead of inside page(). That is the only way "Page x of y" can know
   y. The visible result is identical — decor on every page — but a callback
   must not call page() itself.
   ========================================================================== */
(function (EV) {
  'use strict';

  var P = EV.pdf = EV.pdf || {};

  var TITLE = 'Mini Emergency & Critical Care Event EMR';
  var LEGAL = 'This printout is not a legal medical record unless signed by the attending clinician.';

  /* ======================================================================
     1. Font metrics — real Helvetica AFM advance widths, 1000 units/em.
        Helvetica and Helvetica-Oblique share one table; Bold has its own.
     ====================================================================== */

  function parseW(lo, hi) {
    var a = new Array(256), i, L = lo.split(' '), H = hi.split(' ');
    for (i = 0; i < 256; i++) a[i] = 0;
    for (i = 0; i < L.length; i++) a[32 + i] = +L[i];
    for (i = 0; i < H.length; i++) a[128 + i] = +H[i];
    return a;
  }

  var W_REG = parseW(
    '278 278 355 556 556 889 667 191 333 333 389 584 278 333 278 278 ' +
    '556 556 556 556 556 556 556 556 556 556 278 278 584 584 584 556 1015 ' +
    '667 667 722 722 667 611 778 722 278 500 667 556 833 722 778 667 778 722 ' +
    '667 611 722 667 944 667 667 611 278 278 278 469 556 333 ' +
    '556 556 500 556 556 278 556 556 222 222 500 222 833 556 556 556 556 333 ' +
    '500 278 556 500 722 500 500 500 334 260 334 584',
    '556 0 222 556 333 1000 556 556 333 1000 667 333 1000 0 611 0 ' +
    '0 222 222 333 333 350 556 1000 333 1000 500 333 944 0 500 667 ' +
    '278 333 556 556 556 556 260 556 333 737 370 556 584 333 737 333 ' +
    '400 584 333 333 333 556 537 278 333 333 365 556 834 834 834 611 ' +
    '667 667 667 667 667 667 1000 722 667 667 667 667 278 278 278 278 ' +
    '722 722 778 778 778 778 778 584 778 722 722 722 722 667 667 611 ' +
    '556 556 556 556 556 556 889 500 556 556 556 556 278 278 278 278 ' +
    '556 556 556 556 556 556 556 584 611 556 556 556 556 500 556 500'
  );

  var W_BOLD = parseW(
    '278 333 474 556 556 889 722 238 333 333 389 584 278 333 278 278 ' +
    '556 556 556 556 556 556 556 556 556 556 333 333 584 584 584 611 975 ' +
    '722 722 722 722 667 611 778 722 278 556 722 611 833 722 778 667 778 722 ' +
    '667 611 722 667 944 667 667 611 333 278 333 584 556 333 ' +
    '556 611 556 611 556 333 611 611 278 278 556 278 889 611 611 611 611 389 ' +
    '556 333 611 556 778 556 556 500 389 280 389 584',
    '556 0 278 556 500 1000 556 556 333 1000 667 333 1000 0 611 0 ' +
    '0 278 278 500 500 350 556 1000 333 1000 556 333 944 0 500 667 ' +
    '278 333 556 556 556 556 280 556 333 737 370 556 584 333 737 333 ' +
    '400 584 333 333 333 611 556 278 333 333 365 556 834 834 834 611 ' +
    '722 722 722 722 722 722 1000 722 667 667 667 667 278 278 278 278 ' +
    '722 722 778 778 778 778 778 584 778 722 722 722 722 667 667 611 ' +
    '556 556 556 556 556 556 889 556 556 556 556 556 278 278 278 278 ' +
    '611 611 611 611 611 611 611 584 611 611 611 611 611 556 611 556'
  );

  var FONTS = {
    H: { base: 'Helvetica', w: W_REG },
    HB: { base: 'Helvetica-Bold', w: W_BOLD },
    HO: { base: 'Helvetica-Oblique', w: W_REG }
  };
  var FONT_ORDER = ['H', 'HB', 'HO'];

  /* ======================================================================
     2. WinAnsi encoding. Characters outside Latin-1 are transliterated to a
        close ASCII equivalent and only fall back to '?' — never dropped.
     ====================================================================== */

  /* Unicode -> WinAnsi byte for the 0x80..0x9F block, which is NOT Latin-1. */
  var WINX = {
    0x20AC: 128, 0x201A: 130, 0x0192: 131, 0x201E: 132, 0x2026: 133, 0x2020: 134,
    0x2021: 135, 0x02C6: 136, 0x2030: 137, 0x0160: 138, 0x2039: 139, 0x0152: 140,
    0x017D: 142, 0x2018: 145, 0x2019: 146, 0x201C: 147, 0x201D: 148, 0x2022: 149,
    0x2013: 150, 0x2014: 151, 0x02DC: 152, 0x2122: 153, 0x0161: 154, 0x203A: 155,
    0x0153: 156, 0x017E: 158, 0x0178: 159
  };

  /* Everything else we actually emit: subscripts from SpO2, maths, arrows,
     the Greek letters that show up in Delta-P and alpha/beta blockers. */
  var TRANS = {
    0x2070: '0', 0x2071: 'i', 0x00B9: '1', 0x00B2: '2', 0x00B3: '3', 0x2074: '4',
    0x2075: '5', 0x2076: '6', 0x2077: '7', 0x2078: '8', 0x2079: '9',
    0x2080: '0', 0x2081: '1', 0x2082: '2', 0x2083: '3', 0x2084: '4', 0x2085: '5',
    0x2086: '6', 0x2087: '7', 0x2088: '8', 0x2089: '9',
    0x2010: '-', 0x2011: '-', 0x2012: '-', 0x2015: '-', 0x2212: '-',
    0x2044: '/', 0x2215: '/', 0x2236: ':',
    0x2264: '<=', 0x2265: '>=', 0x2260: '!=', 0x2248: '~', 0x221E: 'inf',
    0x221A: 'sqrt', 0x2211: 'sum', 0x2206: 'D', 0x0394: 'D', 0x2202: 'd',
    0x2190: '<-', 0x2192: '->', 0x2191: 'up', 0x2193: 'down', 0x2194: '<->',
    0x21D2: '=>', 0x2026: '...',
    0x03B1: 'alpha', 0x03B2: 'beta', 0x03B3: 'gamma', 0x03B4: 'delta',
    0x03BC: 'µ', 0x03C3: 'sigma', 0x03A9: 'ohm', 0x03C0: 'pi',
    0x2032: "'", 0x2033: '"', 0x2039: '<', 0x203A: '>',
    0x2713: 'v', 0x2714: 'v', 0x2717: 'x', 0x2718: 'x', 0x25A0: '#', 0x25CB: 'o',
    0x25B2: '^', 0x25BC: 'v', 0x2605: '*', 0x2606: '*', 0x00A0: ' ',
    0x200B: '', 0x200C: '', 0x200D: '', 0xFEFF: ''
  };

  /* Transliterate to a WinAnsi-only string. No PDF escaping yet. The printable
     ASCII fast path matters: this runs once per measured word per layout pass. */
  var PLAIN = /^[\x20-\x7E]*$/;
  function win(s) {
    s = s == null ? '' : String(s);
    if (PLAIN.test(s)) return s;
    var out = [], i, c, t;
    for (i = 0; i < s.length; i++) {
      c = s.charCodeAt(i);
      if (c === 9 || c === 10 || c === 13) { out.push(' '); continue; }
      if ((c >= 32 && c <= 126) || (c >= 160 && c <= 255)) {
        out.push(String.fromCharCode(c));
      } else if (WINX[c] !== undefined) {
        out.push(String.fromCharCode(WINX[c]));
      } else if (TRANS[c] !== undefined) {
        t = TRANS[c];
        if (t) out.push(win(t));
      } else {
        out.push('?');
      }
    }
    return out.join('');
  }
  P.win = win;

  /* WinAnsi + PDF literal-string escaping of ( ) and backslash. */
  P.esc = function (s) {
    var w = win(s), out = [], i, ch;
    if (!/[()\\]/.test(w)) return w;
    for (i = 0; i < w.length; i++) {
      ch = w.charAt(i);
      if (ch === '(' || ch === ')' || ch === '\\') out.push('\\');
      out.push(ch);
    }
    return out.join('');
  };

  /* Advance width of a string in points. */
  P.width = function (s, font, size) {
    var T = (FONTS[font] || FONTS.H).w, w = win(s), total = 0, i, adv;
    for (i = 0; i < w.length; i++) {
      adv = T[w.charCodeAt(i)];
      total += adv ? adv : 556;
    }
    return total * (EV.has(size) ? EV.num(size) : 1) / 1000;
  };

  /* Greedy word wrap. Breaks a single over-long token by characters rather
     than letting it bleed past the column. */
  P.wrapLines = function (s, w, font, size) {
    font = font || 'H';
    size = EV.has(size) ? EV.num(size) : 9;
    var out = [], paras = String(s == null ? '' : s).split(/\r?\n/), pi, i;
    for (pi = 0; pi < paras.length; pi++) {
      var words = paras[pi].split(/[ \t]+/).filter(function (x) { return x.length > 0; });
      if (!words.length) { out.push(''); continue; }
      var line = '';
      for (i = 0; i < words.length; i++) {
        var word = words[i];
        while (P.width(word, font, size) > w) {
          var cut = 1;
          while (cut < word.length && P.width(word.slice(0, cut + 1), font, size) <= w) cut++;
          if (cut >= word.length) break;
          if (line) { out.push(line); line = ''; }
          out.push(word.slice(0, cut));
          word = word.slice(cut);
        }
        var test = line ? line + ' ' + word : word;
        if (!line || P.width(test, font, size) <= w) line = test;
        else { out.push(line); line = word; }
      }
      out.push(line);
    }
    return out;
  };

  /* ======================================================================
     3. Bytes, colours, numbers
     ====================================================================== */

  function bin(s) {
    var n = s.length, b = new Uint8Array(n), i;
    for (i = 0; i < n; i++) b[i] = s.charCodeAt(i) & 0xFF;
    return b;
  }

  function num(v) {
    if (!EV.has(v) || !isFinite(v)) v = 0;
    var r = Math.round(v * 100) / 100;
    return String(r === 0 ? 0 : r);
  }

  function pad(v, n) {
    var s = String(v);
    while (s.length < n) s = '0' + s;
    return s;
  }

  var COLORS = {
    ink: '#111418', ink2: '#464c55', ink3: '#767d87', ink4: '#9aa1ab',
    line: '#c9ced6', hair: '#e5e8ee', zebra: '#f5f6f9', sunk: '#eef0f4',
    brand: '#1C2E7A', brandwash: '#eceffa', accent: '#F5B335', accentink: '#6d4600',
    ok: '#1a6b3c', okwash: '#eaf4ee', warn: '#8a5a00', warnwash: '#fdf4e3',
    bad: '#b3261e', badwash: '#fdecea', info: '#1b5e8a', white: '#ffffff',
    a1: '#b3261e', a2: '#d2691e', a3: '#8a5a00', a4: '#1a6b3c', a5: '#4b5a6b', a0: '#767d87'
  };

  /* A colour name that is not in the table used to resolve to black. For text
     that is merely wrong; for a fill it paints a black box over the row and
     the data underneath becomes unreadable. Unknown fills are now skipped
     entirely and unknown text falls back to ink, so a typo degrades to plain
     rather than to a redaction. */
  P.unknownColors = [];
  function knownColor(c) {
    if (c == null || c === false) return false;
    if (Array.isArray(c)) return true;
    if (COLORS[c]) return true;
    return typeof c === 'string' && c.charAt(0) === '#' && (c.length === 4 || c.length === 7);
  }
  function rgb(c) {
    if (c == null) return [0, 0, 0];
    if (Array.isArray(c)) return c;
    if (!knownColor(c)) {
      if (P.unknownColors.indexOf(String(c)) === -1) P.unknownColors.push(String(c));
      c = 'ink';
    }
    var s = COLORS[c] || String(c);
    if (s.charAt(0) !== '#') return [0, 0, 0];
    if (s.length === 4) s = '#' + s.charAt(1) + s.charAt(1) + s.charAt(2) + s.charAt(2) + s.charAt(3) + s.charAt(3);
    return [
      parseInt(s.substr(1, 2), 16) / 255,
      parseInt(s.substr(3, 2), 16) / 255,
      parseInt(s.substr(5, 2), 16) / 255
    ];
  }

  function fillOp(c) { var r = rgb(c); return num(r[0]) + ' ' + num(r[1]) + ' ' + num(r[2]) + ' rg'; }
  function strokeOp(c) { var r = rgb(c); return num(r[0]) + ' ' + num(r[1]) + ' ' + num(r[2]) + ' RG'; }

  /* ======================================================================
     4. JPEG registry
     ====================================================================== */

  P.images = P.images || {};

  /* Read the real dimensions and component count out of the SOF marker so a
     mis-stated w/h in the call cannot skew the embedded /Width /Height. */
  function jpegInfo(b) {
    var i = 2, n = b.length, m, L;
    if (n < 4 || b[0] !== 0xFF || b[1] !== 0xD8) return null;
    while (i < n - 9) {
      if (b[i] !== 0xFF) { i++; continue; }
      m = b[i + 1];
      if (m === 0xFF) { i++; continue; }
      if (m === 0xD8 || m === 0x01 || (m >= 0xD0 && m <= 0xD7)) { i += 2; continue; }
      if (m === 0xD9 || m === 0xDA) break;
      L = (b[i + 2] << 8) | b[i + 3];
      if (m >= 0xC0 && m <= 0xCF && m !== 0xC4 && m !== 0xC8 && m !== 0xCC) {
        return { h: (b[i + 5] << 8) | b[i + 6], w: (b[i + 7] << 8) | b[i + 8], nc: b[i + 9] };
      }
      if (L < 2) break;
      i += 2 + L;
    }
    return null;
  }

  /* Returns the record, or null when the input is not a decodable JPEG. A bad
     logo must never take every patient PDF down with it, so this never throws
     and an unregistered name simply makes image() a no-op. */
  P.registerJpeg = function (name, base64, w, h) {
    var bytes;
    try { bytes = EV.b64ToBytes(base64); } catch (e) { return null; }
    if (!bytes || bytes.length < 4 || bytes[0] !== 0xFF || bytes[1] !== 0xD8) return null;
    var info = jpegInfo(bytes);
    var rec = {
      name: String(name),
      bytes: bytes,
      parsed: !!info,
      w: (info && info.w) || EV.num(w) || 1,
      h: (info && info.h) || EV.num(h) || 1,
      nc: (info && info.nc) || 3
    };
    P.images[rec.name] = rec;
    return rec;
  };

  function xname(n) { return 'Im' + String(n).replace(/[^A-Za-z0-9]/g, ''); }

  /* ======================================================================
     5. The document
     ====================================================================== */

  var SIZES = { A4: [595.28, 841.89], A5: [419.53, 595.28], LETTER: [612, 792], LEGAL: [612, 1008] };

  function pdfDate(ms) {
    var dt = new Date(EV.has(ms) ? ms : EV.now());
    var off = -dt.getTimezoneOffset(), sg = off < 0 ? '-' : '+';
    off = Math.abs(off);
    return 'D:' + dt.getFullYear() + pad(dt.getMonth() + 1, 2) + pad(dt.getDate(), 2) +
      pad(dt.getHours(), 2) + pad(dt.getMinutes(), 2) + pad(dt.getSeconds(), 2) +
      sg + pad(Math.floor(off / 60), 2) + "'" + pad(off % 60, 2) + "'";
  }

  function hexId(seed) {
    var s = (EV.fnv ? EV.fnv(String(seed)) : 0x9e3779b9) >>> 0, out = [], i;
    if (!s) s = 0x9e3779b9;
    for (i = 0; i < 4; i++) {
      s = (s * 1664525 + 1013904223) >>> 0;
      out.push(pad(s.toString(16), 8));
    }
    return out.join('').slice(0, 32).toUpperCase();
  }

  P.doc = function (opt) {
    opt = opt || {};
    var sz = SIZES[String(opt.size || 'A4').toUpperCase()] || SIZES.A4;
    var W = sz[0], H = sz[1];
    var margin = EV.has(opt.margin) ? EV.num(opt.margin) : 36;

    var pages = [], decor = [], used = Object.create(null), decorDone = false;
    var st = { font: 'H', size: 9, fill: 'ink' };
    var d = {};
    var cur = null;

    function newPage() { var pg = { ops: [] }; pages.push(pg); cur = pg; return pg; }
    function op(s) { cur.ops.push(s); }
    function Y(y) { return num(H - y); }

    newPage();

    d.W = W; d.H = H; d.margin = margin;
    d.top = margin; d.bot = H - margin; d.y = margin;
    d.meta = { title: opt.title || TITLE, author: opt.author || 'Siloam Hospitals Event Medical Standby',
      subject: opt.subject || '', creator: opt.creator || TITLE, at: EV.has(opt.at) ? opt.at : EV.now() };

    d.pageCount = function () { return pages.length; };
    d.pageIndex = function () { return pages.indexOf(cur); };

    d.font = function (key, size) {
      if (FONTS[key]) st.font = key;
      if (EV.has(size)) st.size = EV.num(size);
      return d;
    };
    d.color = function (c) { st.fill = c; return d; };

    d.text = function (s, x, y, o) {
      o = o || {};
      var f = FONTS[o.font] ? o.font : st.font;
      var size = EV.has(o.size) ? EV.num(o.size) : st.size;
      var lead = EV.has(o.leading) ? EV.num(o.leading) : size * 1.3;
      var str = s == null ? '' : String(s);
      var tx = x;
      if (o.align && EV.has(o.width)) {
        var wd = P.width(str, f, size);
        if (o.align === 'right') tx = x + EV.num(o.width) - wd;
        else if (o.align === 'center') tx = x + (EV.num(o.width) - wd) / 2;
      }
      if (str !== '') {
        op(fillOp(o.color || st.fill) + ' BT /' + f + ' ' + num(size) + ' Tf 1 0 0 1 ' +
          num(tx) + ' ' + Y(y) + ' Tm (' + P.esc(str) + ') Tj ET');
      }
      return y + lead;
    };

    /* Draw `s` inside `maxW`: shrink toward `min`, then clip with an ellipsis.
       A label that overflows its column silently overprints the next one, and
       a clipped heading hides the one word that mattered. */
    d.fit = function (s, x, y, maxW, o) {
      o = o || {};
      var f = FONTS[o.font] ? o.font : st.font;
      var size = EV.has(o.size) ? EV.num(o.size) : st.size;
      var min = EV.has(o.min) ? EV.num(o.min) : Math.max(4.6, size * 0.72);
      var str = s == null ? '' : String(s);
      if (!str) return y;
      maxW = EV.num(maxW) || 0;
      if (maxW <= 0) return d.text(str, x, y, o);
      while (size > min && P.width(str, f, size) > maxW) size -= 0.2;
      if (P.width(str, f, size) > maxW) {
        var ell = '…';
        while (str.length > 1 && P.width(str + ell, f, size) > maxW) str = str.slice(0, -1);
        str += ell;
      }
      var opts = {};
      for (var k in o) opts[k] = o[k];
      opts.size = size;
      opts.width = maxW;
      return d.text(str, x, y, opts);
    };

    d.wrap = function (s, x, y, w, o) {
      o = o || {};
      var f = FONTS[o.font] ? o.font : st.font;
      var size = EV.has(o.size) ? EV.num(o.size) : st.size;
      var lead = EV.has(o.leading) ? EV.num(o.leading) : size * 1.28;
      var lines = P.wrapLines(s, w, f, size), i;
      for (i = 0; i < lines.length; i++) {
        if (o.flow && y + lead > d.bot) { d.page(); y = d.y; }
        d.text(lines[i], x, y, { font: f, size: size, color: o.color, align: o.align, width: w });
        y += lead;
      }
      d.y = y;
      return y;
    };

    d.line = function (x1, y1, x2, y2, o) {
      o = o || {};
      var s = strokeOp(o.color || 'line') + ' ' + num(EV.has(o.width) ? o.width : 0.5) + ' w ';
      if (o.dash) s += '[' + o.dash + '] 0 d ';
      s += num(x1) + ' ' + Y(y1) + ' m ' + num(x2) + ' ' + Y(y2) + ' l S';
      if (o.dash) s += ' [] 0 d';
      op(s);
      return y2;
    };

    d.rect = function (x, y, w, h, o) {
      o = o || {};
      var a = [];
      if (o.fill) a.push(fillOp(o.fill));
      if (o.color) { a.push(strokeOp(o.color)); a.push(num(EV.has(o.width) ? o.width : 0.6) + ' w'); }
      if (o.dash) a.push('[' + o.dash + '] 0 d');
      a.push(num(x) + ' ' + Y(y + h) + ' ' + num(w) + ' ' + num(h) + ' re');
      a.push(o.fill && o.color ? 'B' : o.fill ? 'f' : 'S');
      if (o.dash) a.push('[] 0 d');
      op(a.join(' '));
      return y + h;
    };

    d.image = function (name, x, y, w, h) {
      var img = P.images[name];
      if (!img) return y;
      used[name] = true;
      if (!EV.has(w) && !EV.has(h)) { w = img.w; h = img.h; }
      else if (!EV.has(w)) w = EV.num(h) * (img.w / img.h);
      else if (!EV.has(h)) h = EV.num(w) * (img.h / img.w);
      w = EV.num(w); h = EV.num(h);
      op('q ' + num(w) + ' 0 0 ' + num(h) + ' ' + num(x) + ' ' + Y(y + h) +
        ' cm /' + xname(name) + ' Do Q');
      return y + h;
    };

    d.page = function () { newPage(); d.y = d.top; return d; };
    d.onPage = function (fn) { if (typeof fn === 'function') decor.push(fn); return d; };
    d.need = function (h) { if (d.y + EV.num(h || 0) > d.bot) d.page(); return d.y; };
    d.space = function () { return d.bot - d.y; };

    /* --- table: repeats its header across page breaks, never writes a row
           that would start below the bottom margin. ------------------------ */
    d.table = function (x, y, cols, rows, o) {
      o = o || {};
      var size = EV.has(o.size) ? EV.num(o.size) : 8;
      var hsize = EV.has(o.headSize) ? EV.num(o.headSize) : size;
      var padc = EV.has(o.pad) ? EV.num(o.pad) : 3;
      var lead = size * 1.22;
      var showHead = o.head !== false;
      var bot = EV.has(o.bottom) ? EV.num(o.bottom) : d.bot;
      var tw = 0, i, j, k;
      for (i = 0; i < cols.length; i++) tw += EV.num(cols[i].w) || 0;

      function cellText(c) {
        if (c == null) return '';
        if (typeof c === 'object') return c.t == null ? '' : String(c.t);
        return String(c);
      }
      function cellFont(c, fnt) { return (c && typeof c === 'object' && c.bold) ? 'HB' : fnt; }
      function linesFor(c, col, sz, fnt) {
        return P.wrapLines(cellText(c), (EV.num(col.w) || 0) - padc * 2, cellFont(c, fnt), sz);
      }
      function heightOf(cells, sz, fnt) {
        var n = 1;
        for (k = 0; k < cols.length; k++) n = Math.max(n, linesFor(cells ? cells[k] : '', cols[k], sz, fnt).length);
        return n * (sz * 1.22) + padc * 2;
      }
      function drawRow(cells, yy, h, sz, fnt, fill, defColor) {
        if (knownColor(fill)) d.rect(x, yy, tw, h, { fill: fill });
        var cx = x, kk;
        for (kk = 0; kk < cols.length; kk++) {
          var col = cols[kk], c = cells ? cells[kk] : '';
          var obj = (c !== null && typeof c === 'object');
          var f = cellFont(c, fnt);
          var cl = (obj && c.color) ? c.color : defColor;
          var al = (obj && c.align) || col.align || 'left';
          var ls = linesFor(c, col, sz, fnt), li;
          for (li = 0; li < ls.length; li++) {
            d.text(ls[li], cx + padc, yy + padc + (sz * 1.22) * li + sz * 0.85,
              { font: f, size: sz, color: cl, align: al, width: (EV.num(col.w) || 0) - padc * 2 });
          }
          if (o.vlines && kk > 0) d.line(cx, yy, cx, yy + h, { color: 'hair', width: 0.4 });
          cx += EV.num(col.w) || 0;
        }
        d.line(x, yy + h, x + tw, yy + h, { color: o.rule || 'hair', width: 0.4 });
      }
      function header() {
        if (!showHead) return;
        var hc = [], kk;
        for (kk = 0; kk < cols.length; kk++) hc.push({ t: cols[kk].l == null ? '' : cols[kk].l, bold: true });
        var hh = heightOf(hc, hsize, 'HB');
        drawRow(hc, y, hh, hsize, 'HB', o.headFill || 'brand', o.headColor || 'white');
        y += hh;
      }

      if (showHead && y + heightOf([], hsize, 'HB') + lead + padc * 2 > bot) { d.page(); y = d.y; }
      header();
      for (i = 0; i < rows.length; i++) {
        var h = heightOf(rows[i], size, 'H');
        if (y + h > bot) { d.page(); y = d.y; header(); }
        /* NB: never read `.fill` off a row — rows are arrays and
           Array.prototype.fill is a truthy native function, which rgb() would
           resolve to black and paint over the whole row. */
        drawRow(rows[i], y, h, size, 'H',
          (rows[i] && rows[i].rowFill) || (o.zebra && (i % 2 === 1) ? 'zebra' : null),
          o.color || 'ink');
        y += h;
      }
      if (!rows.length) {
        var eh = lead + padc * 2;
        if (y + eh > bot) { d.page(); y = d.y; header(); }
        drawRow([{ t: o.empty || 'None recorded', color: 'ink3' }], y, eh, size, 'HO', null, 'ink3');
        y += eh;
      }
      d.y = y;
      return y;
    };

    /* --- decor ------------------------------------------------------------ */
    function runDecor() {
      if (decorDone) return;
      decorDone = true;
      if (!decor.length) return;
      var keep = cur, keepY = d.y, keepFont = st.font, keepSize = st.size, keepFill = st.fill;
      var n = pages.length, i, j;
      for (i = 0; i < n; i++) {
        cur = pages[i];
        for (j = 0; j < decor.length; j++) {
          decor[j]({ doc: d, page: i + 1, pages: n, index: i, first: i === 0, last: i === n - 1 });
        }
      }
      cur = keep; d.y = keepY; st.font = keepFont; st.size = keepSize; st.fill = keepFill;
    }

    /* --- serialise -------------------------------------------------------- */
    d.bytes = function () {
      runDecor();

      var imgNames = Object.keys(used).filter(function (k) { return !!P.images[k]; }).sort();
      var FIRST_IMG = 7;                         /* 1 cat 2 pages 3-5 fonts 6 info */
      var pageBase = FIRST_IMG + imgNames.length;
      var nPages = pages.length;
      var maxObj = pageBase + nPages * 2 - 1;
      var size = maxObj + 1;

      var chunks = [], len = 0, offsets = new Array(size), i, j;

      function raw(b) { chunks.push(b); len += b.length; }
      function put(s) { raw(bin(s)); }
      function obj(n, body) {
        offsets[n] = len;
        put(n + ' 0 obj\n' + body + '\nendobj\n');
      }
      function objStream(n, dict, bytes) {
        offsets[n] = len;
        put(n + ' 0 obj\n<< ' + dict + ' /Length ' + bytes.length + ' >>\nstream\n');
        raw(bytes);
        put('\nendstream\nendobj\n');
      }

      /* header, with the binary comment that marks the file as non-ASCII */
      put('%PDF-1.4\n');
      raw(new Uint8Array([0x25, 0xE2, 0xE3, 0xCF, 0xD3, 0x0A]));

      obj(1, '<< /Type /Catalog /Pages 2 0 R >>');

      var kids = [];
      for (i = 0; i < nPages; i++) kids.push((pageBase + i * 2) + ' 0 R');
      obj(2, '<< /Type /Pages /Count ' + nPages + ' /Kids [' + kids.join(' ') + '] >>');

      for (i = 0; i < FONT_ORDER.length; i++) {
        obj(3 + i, '<< /Type /Font /Subtype /Type1 /BaseFont /' +
          FONTS[FONT_ORDER[i]].base + ' /Encoding /WinAnsiEncoding >>');
      }

      var m = d.meta;
      obj(6, '<< /Title (' + P.esc(m.title) + ') /Author (' + P.esc(m.author) +
        ') /Subject (' + P.esc(m.subject) + ') /Creator (' + P.esc(m.creator) +
        ') /Producer (' + P.esc('EV.pdf ' + (EV.VERSION || '1')) +
        ') /CreationDate (' + pdfDate(m.at) + ') /ModDate (' + pdfDate(m.at) + ') >>');

      for (i = 0; i < imgNames.length; i++) {
        var im = P.images[imgNames[i]];
        var cs = im.nc === 1 ? '/DeviceGray' : im.nc === 4 ? '/DeviceCMYK' : '/DeviceRGB';
        var dict = '/Type /XObject /Subtype /Image /Width ' + im.w + ' /Height ' + im.h +
          ' /ColorSpace ' + cs + ' /BitsPerComponent 8 /Filter /DCTDecode';
        if (im.nc === 4) dict += ' /Decode [1 0 1 0 1 0 1 0]';
        objStream(FIRST_IMG + i, dict, im.bytes);
      }

      var fontRes = [];
      for (i = 0; i < FONT_ORDER.length; i++) fontRes.push('/' + FONT_ORDER[i] + ' ' + (3 + i) + ' 0 R');
      var xo = [];
      for (i = 0; i < imgNames.length; i++) xo.push('/' + xname(imgNames[i]) + ' ' + (FIRST_IMG + i) + ' 0 R');
      var res = '<< /Font << ' + fontRes.join(' ') + ' >>' +
        (xo.length ? ' /XObject << ' + xo.join(' ') + ' >>' : '') +
        ' /ProcSet [/PDF /Text /ImageC] >>';

      for (i = 0; i < nPages; i++) {
        var pn = pageBase + i * 2, cn = pn + 1;
        obj(pn, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + num(W) + ' ' + num(H) + '] /Resources ' +
          res + ' /Contents ' + cn + ' 0 R >>');
        objStream(cn, '', bin(pages[i].ops.join('\n')));
      }

      /* xref — 20 bytes per entry, exactly. */
      var xrefAt = len;
      put('xref\n0 ' + size + '\n');
      put('0000000000 65535 f \n');
      for (i = 1; i <= maxObj; i++) put(pad(offsets[i] || 0, 10) + ' 00000 n \n');

      var id = hexId(String(m.title) + '|' + m.at + '|' + nPages + '|' + len);
      put('trailer\n<< /Size ' + size + ' /Root 1 0 R /Info 6 0 R /ID [<' + id + '> <' + id + '>] >>\n' +
        'startxref\n' + xrefAt + '\n%%EOF\n');

      var all = new Uint8Array(len), at = 0;
      for (i = 0; i < chunks.length; i++) { all.set(chunks[i], at); at += chunks[i].length; }
      return all;
    };

    d.blob = function () { return new Blob([d.bytes()], { type: 'application/pdf' }); };
    d.dataUri = function () { return 'data:application/pdf;base64,' + EV.bytesToB64(d.bytes()); };
    d.base64 = function () { return EV.bytesToB64(d.bytes()); };

    return d;
  };

  /* ======================================================================
     6. Template building blocks
     ====================================================================== */

  var DASH = '—';

  function S(v, dash) {
    if (!EV.has(v)) return dash == null ? DASH : dash;
    var s = String(v).trim();
    return s === '' ? (dash == null ? DASH : dash) : s;
  }
  function N(v, dec) { return EV.has(EV.num(v)) ? String(EV.r(EV.num(v), dec == null ? 0 : dec)) : DASH; }
  function tm(ms) { return EV.has(ms) ? EV.hhmm(ms) : DASH; }
  function dtm(ms) { return EV.has(ms) ? EV.dmy(ms) + ' ' + EV.hhmm(ms) : DASH; }

  function dv(p) {
    try { return (EV.model && EV.model.derive) ? EV.model.derive(p) : {}; }
    catch (e) { return {}; }
  }
  function acu(v) {
    if (EV.model && EV.model.acuity) return EV.model.acuity(v);
    var A = EV.model && EV.model.ACUITY;
    if (A) { for (var i = 0; i < A.length; i++) if (A[i].v === +v) return A[i]; }
    return { v: 0, l: 'Not triaged', s: DASH, c: 'a0' };
  }
  function lookup(list, v, fallback) {
    if (list) { for (var i = 0; i < list.length; i++) if (list[i].v === v) return list[i].l; }
    return S(v, fallback == null ? DASH : fallback);
  }
  function dispoLabel(v) { return lookup(EV.model && EV.model.DISPOSITION, v, 'Open / not yet dispositioned'); }
  function arrivalLabel(v) { return lookup(EV.model && EV.model.ARRIVAL, v); }
  function ageStr(p) {
    var a = EV.num(p.age);
    if (!EV.has(a)) return DASH;
    return String(EV.r(a, 1)) + (p.ageUnit === 'mo' ? ' mo' : ' y');
  }
  function sexStr(p) { return p.sex === 'M' ? 'Male' : p.sex === 'F' ? 'Female' : DASH; }
  function crewStr(c) {
    if (!c || !c.length) return DASH;
    return c.map(function (x) { return S(x.name, '?') + (x.role ? ' (' + x.role + ')' : ''); }).join(', ');
  }

  /* Register the header/footer every page of every template carries. */
  function decorate(d, ctx, kind, p) {
    ctx = ctx || {};
    var ev = ctx.event || {}, L = d.margin, R = d.W - d.margin, tw = R - L;
    var app = ctx.app || TITLE;
    var gen = EV.has(ctx.generatedAt) ? ctx.generatedAt : EV.now();
    var who = p ? (S(p.name, 'Unnamed patient') + '   MRN ' + S(p.mrn, 'not assigned')) : (ctx.subjectLine || '');
    var evLine = S(ev.name, 'Event not set') +
      (ev.venue ? '  ·  ' + ev.venue : '') +
      (ctx.post && ctx.post.name ? '  ·  ' + ctx.post.name : '');

    d.meta.subject = kind + ' · ' + S(ev.name, '');
    d.meta.at = gen;

    d.onPage(function (pg) {
      var tx = L, img = P.images[ctx.logoName || 'siloam'];
      if (img) {
        var hh = 24, ww = EV.r(hh * (img.w / img.h), 2);
        if (ww > 112) { ww = 112; hh = EV.r(ww * (img.h / img.w), 2); }
        d.image(ctx.logoName || 'siloam', L, 20, ww, hh);
        tx = L + ww + 9;
      }
      d.text(app, tx, 28, { font: 'HB', size: 9, color: 'brand' });
      d.text(kind, tx, 39, { font: 'HB', size: 7.5, color: 'accentink' });
      d.text(evLine, tx, 49, { font: 'H', size: 7.2, color: 'ink3' });

      if (who) d.text(who, L, 28, { font: 'HB', size: 8.2, color: 'ink', align: 'right', width: tw });
      d.text('Page ' + pg.page + ' of ' + pg.pages, L, 39,
        { font: 'H', size: 7.5, color: 'ink2', align: 'right', width: tw });
      if (ctx.version) {
        d.text('EMR v' + ctx.version, L, 49, { font: 'H', size: 7, color: 'ink4', align: 'right', width: tw });
      }

      d.line(L, 58, R, 58, { color: 'brand', width: 1.1 });
      d.line(L, 60.6, R, 60.6, { color: 'accent', width: 0.8 });

      d.line(L, d.H - 44, R, d.H - 44, { color: 'hair', width: 0.6 });
      d.text('Generated ' + dtm(gen) + (EV.deviceId ? '  ·  device ' + String(EV.deviceId()).slice(0, 10) : ''),
        L, d.H - 34, { font: 'H', size: 6.8, color: 'ink3' });
      d.text(LEGAL, L, d.H - 25, { font: 'HO', size: 6.8, color: 'ink3' });
      d.text(S(ev.name, ''), L, d.H - 25, { font: 'H', size: 6.8, color: 'ink4', align: 'right', width: tw });
    });

    d.top = 72;
    d.bot = d.H - 52;
    d.y = d.top;
    return d;
  }

  /* `keep` is the space the heading needs together with the block it
     introduces, so a section bar is never orphaned at the foot of a page. */
  function sect(d, label, tint, keep) {
    var L = d.margin, tw = d.W - 2 * L;
    var y = d.need(EV.num(keep) || 26);
    d.rect(L, y, tw, 13.5, { fill: tint || 'brand' });
    d.text(String(label).toUpperCase(), L + 5, y + 9.6, { font: 'HB', size: 8, color: 'white' });
    d.y = y + 19;
    return d.y;
  }

  /* Label-over-value grid. Values wrap, so a long allergy or address does not
     collide with the next column. */
  function kv(d, items, ncol) {
    ncol = ncol || 4;
    var L = d.margin, tw = d.W - 2 * L, cw = tw / ncol, i = 0, j, k;
    function spanOf(it) { return EV.clamp(EV.num(it && it[4]) || 1, 1, ncol); }
    while (i < items.length) {
      /* Pack a row by span, not by item count: a span-2 cell must not push
         the last cell of its row off the right margin. */
      var row = [], wide = 0;
      while (i < items.length && wide + spanOf(items[i]) <= ncol) {
        wide += spanOf(items[i]); row.push(items[i]); i++;
      }
      if (!row.length) { row.push(items[i]); i++; }
      var lines = [], hh = 0;
      for (j = 0; j < row.length; j++) {
        var it = row[j] || [];
        var ls = P.wrapLines(S(it[1]), cw * spanOf(it) - 8, it[2] === 'b' ? 'HB' : 'H', 8.6);
        lines.push(ls);
        hh = Math.max(hh, 8 + ls.length * 10.4 + 5);
      }
      var y = d.need(hh), x = L;
      for (j = 0; j < row.length; j++) {
        var itm = row[j] || [];
        d.fit(String(itm[0] == null ? '' : itm[0]).toUpperCase(), x, y + 5.5,
          cw * spanOf(itm) - 8, { font: 'H', size: 6.2, min: 4.8, color: 'ink3' });
        for (k = 0; k < lines[j].length; k++) {
          d.text(lines[j][k], x, y + 16 + k * 10.4,
            { font: itm[2] === 'b' ? 'HB' : 'H', size: 8.6, color: itm[3] || 'ink' });
        }
        x += cw * spanOf(itm);
      }
      d.line(L, y + hh - 2, L + tw, y + hh - 2, { color: 'hair', width: 0.4 });
      d.y = y + hh;
    }
    return d.y;
  }

  function para(d, label, text, opts) {
    opts = opts || {};
    var L = d.margin, tw = d.W - 2 * L;
    d.need(24);
    if (label) {
      d.text(String(label).toUpperCase(), L, d.y + 6, { font: 'HB', size: 6.6, color: 'ink3' });
      d.y += 10;
    }
    d.wrap(S(text, opts.empty || 'Not recorded'), L, d.y + 7, tw,
      { size: opts.size || 8.8, color: EV.has(text) && String(text).trim() ? 'ink' : 'ink3',
        font: opts.font || 'H', leading: 11.2, flow: true });
    d.y += 5;
    return d.y;
  }

  /* Acuity / triage strip: the first thing a receiving nurse looks for. */
  function acuityStrip(d, p, D) {
    var L = d.margin, tw = d.W - 2 * L;
    var a = acu(p.acuity);
    var y = d.need(40);
    d.rect(L, y, tw, 34, { fill: 'sunk', color: 'line', width: 0.5 });
    var CW = 84;                       /* the colour block */
    d.rect(L, y, CW, 34, { fill: a.c });
    d.text(a.s || ('T' + a.v), L + 8, y + 17, { font: 'HB', size: 15, color: 'white' });
    d.fit(String(a.l).toUpperCase() + (a.colour ? '  ·  ' + a.colour.toUpperCase() : ''),
      L + 8, y + 28, CW - 16, { font: 'HB', size: 6.4, min: 4.6, color: 'white' });

    var cx = L + CW + 10, cw = (tw - CW - 18) / 4;
    var cells = [
      ['Triaged', tm(p.triageAt) + (p.triageBy ? '  ' + p.triageBy : '')],
      ['Arrived', tm(p.arrivalAt) + '  ·  ' + arrivalLabel(p.arrivalMode)],
      ['Length of stay', S(D.los)],
      ['NEWS2', D.news2 && EV.has(D.news2.score)
        ? String(D.news2.score) + ' (' + S(D.news2.band, 'low') + ', ' + (7 - (D.news2.missing || 0)) + ' of 7 recorded)'
        : 'Incomplete observations']
    ];
    for (var i = 0; i < cells.length; i++) {
      d.text(cells[i][0].toUpperCase(), cx + i * cw, y + 12, { font: 'H', size: 6, color: 'ink3' });
      var ls = P.wrapLines(cells[i][1], cw - 6, 'HB', 7.8);
      for (var k = 0; k < Math.min(2, ls.length); k++) {
        d.text(ls[k], cx + i * cw, y + 22 + k * 9, { font: 'HB', size: 7.8, color: 'ink' });
      }
    }
    d.y = y + 40;
    return d.y;
  }

  function flagStrip(d, D) {
    var f = (D && D.redFlags) || [];
    if (!f.length) return d.y;
    var L = d.margin, tw = d.W - 2 * L;
    var txt = f.map(function (x) { return x.l; }).join('   ·   ');
    var ls = P.wrapLines(txt, tw - 70, 'HB', 8.4);
    var hh = 10 + ls.length * 11;
    var y = d.need(hh + 5);
    d.rect(L, y, tw, hh, { fill: 'warnwash', color: 'warn', width: 0.8 });
    d.text('RED FLAGS', L + 7, y + 13, { font: 'HB', size: 7.4, color: 'warn' });
    for (var i = 0; i < ls.length; i++) {
      d.text(ls[i], L + 62, y + 13 + i * 11, { font: 'HB', size: 8.4, color: 'bad' });
    }
    d.y = y + hh + 5;
    return d.y;
  }

  function allergyBox(d, p) {
    var raw = String(p.allergies == null ? '' : p.allergies).trim();
    var none = !raw || /^(none|nil|no known|nka|none known|tidak ada|-)\.?$/i.test(raw);
    var L = d.margin, tw = d.W - 2 * L;
    var body = none ? (raw ? raw : 'No known allergies reported') : raw;
    var ls = P.wrapLines(body, tw - 78, 'HB', none ? 9.5 : 11.5);
    var hh = 12 + ls.length * (none ? 12 : 14);
    var y = d.need(hh + 6);
    d.rect(L, y, tw, hh, { fill: none ? 'okwash' : 'badwash', color: none ? 'ok' : 'bad', width: none ? 0.8 : 1.4 });
    d.text('ALLERGIES', L + 8, y + 15, { font: 'HB', size: 8.6, color: none ? 'ok' : 'bad' });
    for (var i = 0; i < ls.length; i++) {
      d.text(ls[i], L + 74, y + 15 + i * (none ? 12 : 14),
        { font: 'HB', size: none ? 9.5 : 11.5, color: none ? 'ink2' : 'bad' });
    }
    d.y = y + hh + 6;
    return d.y;
  }

  /* Abnormal-value marking. Returns a plain string when normal and a styled
     cell when out of range, so the table shows it in red with an asterisk. */
  function ab(v, lo, hi, dec) {
    var n = EV.num(v);
    if (!EV.has(n)) return DASH;
    var s = String(EV.r(n, dec == null ? 0 : dec));
    if (n < lo || n > hi) return { t: s + '*', bold: true, color: 'bad', align: 'right' };
    return { t: s, align: 'right' };
  }

  var VIT_COLS = [
    { w: 40, l: 'Time' }, { w: 28, l: 'HR', align: 'right' }, { w: 46, l: 'BP', align: 'right' },
    { w: 30, l: 'MAP', align: 'right' }, { w: 26, l: 'RR', align: 'right' },
    { w: 34, l: 'SpO2', align: 'right' }, { w: 34, l: 'Temp', align: 'right' },
    { w: 26, l: 'GCS', align: 'right' }, { w: 32, l: 'AVPU' }, { w: 26, l: 'Pain', align: 'right' },
    { w: 32, l: 'BGL', align: 'right' }, { w: 28, l: 'Wt', align: 'right' }, { w: 141, l: 'Recorded by' }
  ];

  function vitalRows(p) {
    var v = EV.sortBy((p.vitals || []), 't'), out = [], i;
    for (i = 0; i < v.length; i++) {
      var s = v[i];
      var bp = (EV.has(EV.num(s.sbp)) || EV.has(EV.num(s.dbp)))
        ? N(s.sbp) + '/' + N(s.dbp) : DASH;
      var sbp = EV.num(s.sbp);
      var bpCell = (EV.has(sbp) && (sbp < 90 || sbp > 180))
        ? { t: bp + '*', bold: true, color: 'bad', align: 'right' } : { t: bp, align: 'right' };
      var mp = EV.model && EV.model.map ? EV.model.map(s.sbp, s.dbp) : undefined;
      out.push([
        tm(s.t), ab(s.hr, 50, 110), bpCell, ab(mp, 65, 110), ab(s.rr, 10, 22),
        ab(s.spo2, 94, 100), ab(s.temp, 35.5, 37.9, 1), ab(s.gcs, 15, 15),
        S(s.avpu, ''), ab(s.pain, 0, 6), ab(s.bgl, 70, 200), N(s.weight, 1),
        S(s.by, '') + (s.o2 ? '  (O2 ' + s.o2 + ')' : '')
      ]);
    }
    return out;
  }

  function vitalsSection(d, p) {
    sect(d, 'Vital signs — one row per observation set (* = outside normal range)');
    d.table(d.margin, d.y, VIT_COLS, vitalRows(p),
      { size: 7.4, headSize: 6.8, zebra: true, vlines: true, empty: 'No observations recorded' });
    d.y += 6;
    return d.y;
  }

  function orderRows(p, kinds, fml) {
    var o = EV.sortBy((p.orders || []), 't'), out = [], i;
    function fname(it) {
      if (!it.itemId || !fml) return S(it.name);
      for (var k = 0; k < fml.length; k++) {
        if (fml[k].id === it.itemId) {
          return S(it.name, fml[k].name) + (fml[k].generic && fml[k].generic !== fml[k].name ? ' (' + fml[k].generic + ')' : '');
        }
      }
      return S(it.name);
    }
    for (i = 0; i < o.length; i++) {
      if (kinds.indexOf(o[i].kind) < 0) continue;
      out.push(o[i]);
    }
    return out.map(function (it) { return { it: it, name: fname(it) }; });
  }

  function medsSection(d, p, ctx) {
    var rows = orderRows(p, ['med', 'fluid'], ctx.formulary).map(function (r) {
      var it = r.it;
      var dose = S(it.dose, '') + (it.unit ? ' ' + it.unit : '');
      if (it.rate) dose += (dose.trim() ? '  @ ' : '') + it.rate;
      return [
        tm(it.givenAt || it.t),
        { t: r.name, bold: true },
        S(dose, DASH),
        S(it.route),
        it.given ? { t: 'Given', color: 'ok', bold: true } : { t: 'Not given', color: 'warn', bold: true },
        S(it.by),
        S(it.note, '')
      ];
    });
    sect(d, 'Medications and fluids given');
    d.table(d.margin, d.y, [
      { w: 42, l: 'Time' }, { w: 138, l: 'Drug / fluid' }, { w: 68, l: 'Dose' },
      { w: 42, l: 'Route' }, { w: 40, l: 'Status' }, { w: 90, l: 'Given by' }, { w: 103, l: 'Note' }
    ], rows, { size: 7.6, headSize: 6.8, zebra: true, vlines: true, empty: 'No medication administered' });
    d.y += 6;
    return d.y;
  }

  function proceduresSection(d, p, ctx) {
    var rows = orderRows(p, ['procedure', 'supply', 'lab', 'imaging'], ctx.formulary).map(function (r) {
      var it = r.it;
      return [
        tm(it.givenAt || it.t), { t: r.name, bold: true },
        EV.has(EV.num(it.qty)) ? String(EV.num(it.qty)) + (it.unit ? ' ' + it.unit : '') : DASH,
        S(it.kind), S(it.by), S(it.note, '')
      ];
    });
    sect(d, 'Procedures, supplies and investigations');
    d.table(d.margin, d.y, [
      { w: 42, l: 'Time' }, { w: 166, l: 'Item / procedure' }, { w: 48, l: 'Qty', align: 'right' },
      { w: 56, l: 'Type' }, { w: 90, l: 'By' }, { w: 121, l: 'Note' }
    ], rows, { size: 7.6, headSize: 6.8, zebra: true, vlines: true, empty: 'No procedures recorded' });
    d.y += 6;
    return d.y;
  }

  var PHASE = { post: 'At post', transport: 'In transport', handover: 'Handover' };

  /* CPPT in full — SOAP, every entry, nothing truncated. */
  function cpptSection(d, p, heading) {
    var L = d.margin, tw = d.W - 2 * L;
    sect(d, heading || 'CPPT — integrated progress notes (SOAP)');
    var notes = EV.sortBy((p.cppt || []), 't'), i, j;
    if (!notes.length) {
      d.text('No progress notes recorded.', L, d.y + 9, { font: 'HO', size: 8.4, color: 'ink3' });
      d.y += 18;
      return d.y;
    }
    var LB = [['s', 'S — Subjective'], ['o', 'O — Objective'], ['a', 'A — Assessment'], ['p', 'P — Plan']];
    for (i = 0; i < notes.length; i++) {
      var nt = notes[i];
      d.need(46);
      var y0 = d.y;
      d.rect(L, y0, tw, 14, { fill: 'brandwash' });
      d.text(dtm(nt.t), L + 5, y0 + 10, { font: 'HB', size: 8, color: 'brand' });
      d.text(S(nt.by, 'Unsigned') + (nt.role ? '  ·  ' + nt.role : '') +
        '  ·  ' + (PHASE[nt.phase] || S(nt.phase, 'At post')) +
        (nt.locked ? '  ·  locked' : ''),
        L + 5, y0 + 10, { font: 'H', size: 7.4, color: 'ink2', align: 'right', width: tw - 10 });
      d.y = y0 + 18;
      var any = false;
      for (j = 0; j < LB.length; j++) {
        var val = nt[LB[j][0]];
        if (!EV.has(val) || !String(val).trim()) continue;
        any = true;
        d.need(22);
        d.text(LB[j][1], L + 5, d.y + 7, { font: 'HB', size: 6.8, color: 'ink3' });
        d.wrap(String(val), L + 68, d.y + 7, tw - 73,
          { size: 8.5, leading: 10.8, color: 'ink', flow: true });
        d.y += 4;
      }
      if (!any) {
        d.text('(entry left blank)', L + 68, d.y + 7, { font: 'HO', size: 8, color: 'ink3' });
        d.y += 14;
      }
      d.line(L, d.y, L + tw, d.y, { color: 'hair', width: 0.4 });
      d.y += 7;
    }
    return d.y;
  }

  function dispositionSection(d, p, ctx) {
    var D = dv(p);
    sect(d, 'Disposition');
    kv(d, [
      ['Disposition', dispoLabel(p.disposition), 'b'],
      ['Decided at', dtm(p.dispositionAt)],
      ['Decided by', S(p.dispositionBy)],
      ['Destination', S(p.destination)],
      ['Status', p.status === 'closed' ? 'Closed ' + dtm(p.closedAt) : 'Open', 'b',
        p.status === 'closed' ? 'ink' : 'warn'],
      ['Door to disposition', EV.has(D.doorToDispo) ? String(EV.r(D.doorToDispo, 0)) + ' min' : DASH],
      ['Triage delay', EV.has(D.triageDelay) ? String(EV.r(D.triageDelay, 0)) + ' min' : DASH],
      ['Total length of stay', S(D.los)]
    ], 4);
    para(d, 'Disposition note', p.dispositionNote, { empty: 'No note recorded' });
    return d.y;
  }

  function transportSection(d, p, ctx) {
    var t = p.transport || {}, amb = ctx.ambulance || {};
    sect(d, 'Transport and handover');
    kv(d, [
      ['Ambulance callsign', S(amb.callsign, t.ambulanceId ? 'ID ' + t.ambulanceId : DASH), 'b'],
      ['Plate', S(amb.plate)],
      ['Capability', S(amb.kind ? String(amb.kind).toUpperCase() : '')],
      ['Crew', crewStr(amb.crew), null, null, 1],
      ['Destination', S(t.destination, S(p.destination)), 'b', null, 2],
      ['Departed', dtm(t.departAt)],
      ['Arrived', dtm(t.arriveAt)],
      ['Travel time', EV.has(EV.mins(t.departAt, t.arriveAt))
        ? String(EV.r(EV.mins(t.departAt, t.arriveAt), 0)) + ' min' : DASH],
      ['Escort', S(t.escort)],
      ['Handover to', S(t.handoverTo), 'b', null, 2]
    ], 4);
    para(d, 'Transport note', t.note, { empty: 'No transport note recorded' });
    return d.y;
  }

  function signatures(d, rows) {
    var L = d.margin, tw = d.W - 2 * L, gap = 22;
    var cw = (tw - gap * (rows.length - 1)) / rows.length;
    var y = d.need(92);
    for (var i = 0; i < rows.length; i++) {
      var x = L + i * (cw + gap);
      d.text(String(rows[i][0]).toUpperCase(), x, y + 8, { font: 'HB', size: 6.8, color: 'ink3' });
      if (rows[i][1]) d.text(rows[i][1], x, y + 19, { font: 'H', size: 7.6, color: 'ink2' });
      d.line(x, y + 46, x + cw, y + 46, { color: 'ink2', width: 0.7 });
      d.text('Name, signature and stamp', x, y + 55, { font: 'H', size: 6.4, color: 'ink3' });
      d.line(x, y + 70, x + cw * 0.62, y + 70, { color: 'line', width: 0.6 });
      d.text('Date / time', x, y + 78, { font: 'H', size: 6.4, color: 'ink3' });
    }
    d.y = y + 86;
    return d.y;
  }

  function identification(d, p, ctx) {
    var D = dv(p), post = ctx.post || {}, bed = ctx.bed || {}, ev = ctx.event || {};
    sect(d, 'Patient identification');
    kv(d, [
      ['Name', S(p.name, 'Unnamed patient'), 'b', null, 2],
      ['MRN', S(p.mrn, 'not assigned'), 'b'],
      ['ID / ticket', S(p.bib)],
      ['Age', ageStr(p), 'b'],
      ['Sex', sexStr(p)],
      ['Weight', EV.has(EV.num(p.weight)) ? N(p.weight, 1) + ' kg' : (EV.has(D.weight) ? N(D.weight, 1) + ' kg (from vitals)' : DASH)],
      ['Nationality', S(p.nationality)],
      ['Phone', S(p.phone)],
      ['Emergency contact', S(p.contactName) + (p.contactPhone ? '  ·  ' + p.contactPhone : '')],
      ['Post', S(post.name, S(post.code))],
      ['Bed / space', S(bed.label) + (bed.kind ? '  (' + bed.kind + ')' : '')],
      ['Event', S(ev.name), null, null, 2],
      ['Found at / from', S(p.fromLocation)],
      ['Record created', dtm(p.createdAt)]
    ], 4);
    return d.y;
  }

  /* ======================================================================
     7. Templates
     ====================================================================== */

  P.patientRecord = function (patient, ctx) {
    var p = patient || {}, D = dv(p);
    ctx = ctx || {};
    var d = P.doc({ size: ctx.size || 'A4', margin: 36, at: ctx.generatedAt });
    d.meta.title = 'Patient record ' + S(p.mrn, '') + ' ' + S(p.name, '');
    decorate(d, ctx, 'Patient clinical record', p);

    identification(d, p, ctx);
    acuityStrip(d, p, D);
    flagStrip(d, D);
    allergyBox(d, p);

    sect(d, 'Presentation');
    kv(d, [
      ['Chief complaint', S(p.chiefComplaint, 'Not recorded'), 'b', null, 3],
      ['Category', EV.model && EV.model.catLabel ? EV.model.catLabel(p.complaintCat) : S(p.complaintCat)]
    ], 4);
    para(d, 'Past medical history', p.pmh);
    para(d, 'Home medications', p.homeMeds);

    vitalsSection(d, p);

    sect(d, 'Assessment');
    para(d, 'Examination findings', p.exam);
    para(d, 'Clinical assessment / working diagnosis', p.assessment);
    kv(d, [['ICD-10', S(p.icd10), 'b', null, 2],
      ['Shock index', EV.has(D.shockIndex) ? String(D.shockIndex) : DASH],
      ['MAP', EV.has(D.map) ? String(D.map) + ' mmHg' : DASH]], 4);

    medsSection(d, p, ctx);
    proceduresSection(d, p, ctx);
    cpptSection(d, p);
    dispositionSection(d, p, ctx);
    if (p.transport || p.transportId || p.disposition === 'transport' || p.disposition === 'refer-hospital') {
      transportSection(d, p, ctx);
    }

    sect(d, 'Clinician attestation', null, 190);
    d.wrap('I confirm that the record above is a true account of the assessment, treatment and ' +
      'disposition of this patient at the event medical post named in the header.',
      d.margin, d.y + 8, d.W - 2 * d.margin, { size: 8.2, color: 'ink2', leading: 10.6, flow: true });
    d.y += 4;
    signatures(d, [
      ['Resident medical officer (RMO) on duty', S(p.dispositionBy, S(p.triageBy, ''))],
      ['Receiving clinician / hospital', S(p.transport && p.transport.handoverTo, '')]
    ]);
    return d;
  };

  P.cppt = function (patient, ctx) {
    var p = patient || {}, D = dv(p);
    ctx = ctx || {};
    var d = P.doc({ size: ctx.size || 'A4', margin: 36, at: ctx.generatedAt });
    d.meta.title = 'CPPT ' + S(p.mrn, '') + ' ' + S(p.name, '');
    decorate(d, ctx, 'CPPT — integrated progress notes and monitoring', p);

    sect(d, 'Patient');
    kv(d, [
      ['Name', S(p.name, 'Unnamed patient'), 'b', null, 2],
      ['MRN', S(p.mrn, 'not assigned'), 'b'],
      ['Age / sex', ageStr(p) + '  ·  ' + sexStr(p)],
      ['Acuity', acu(p.acuity).s + ' — ' + acu(p.acuity).l, 'b', acu(p.acuity).c],
      ['Chief complaint', S(p.chiefComplaint), null, null, 2],
      ['Length of stay', S(D.los)]
    ], 4);
    allergyBox(d, p);
    cpptSection(d, p, 'Progress notes — full text, chronological');
    vitalsSection(d, p);
    medsSection(d, p, ctx);

    signatures(d, [
      ['Notes written / countersigned by', ''],
      ['Reviewed by (RMO / specialist)', '']
    ]);
    return d;
  };

  P.transportForm = function (patient, ctx) {
    var p = patient || {}, D = dv(p);
    ctx = ctx || {};
    var t = p.transport || {};
    var d = P.doc({ size: ctx.size || 'A4', margin: 36, at: ctx.generatedAt });
    d.meta.title = 'Ambulance transfer and handover ' + S(p.mrn, '');
    decorate(d, ctx, 'Ambulance transfer and handover form', p);

    identification(d, p, ctx);
    acuityStrip(d, p, D);
    flagStrip(d, D);
    allergyBox(d, p);

    sect(d, 'Reason for transfer');
    kv(d, [
      ['Working diagnosis', S(p.assessment, S(p.chiefComplaint)), 'b', null, 3],
      ['ICD-10', S(p.icd10)]
    ], 4);
    para(d, 'Clinical summary handed over', p.exam);

    transportSection(d, p, ctx);

    sect(d, 'Observations at departure and en route');
    d.table(d.margin, d.y, VIT_COLS, vitalRows(p).slice(-8),
      { size: 7.4, headSize: 6.8, zebra: true, vlines: true, empty: 'No observations recorded' });
    d.y += 6;

    medsSection(d, p, ctx);
    proceduresSection(d, p, ctx);

    sect(d, 'Handover checklist');
    var L = d.margin, tw = d.W - 2 * L;
    var items = ['Identity band and MRN verified', 'Allergies communicated',
      'IV access patent, site checked', 'Oxygen / airway device in place and documented',
      'Monitoring attached for transfer', 'Medication record handed over',
      'Valuables and personal effects handed over', 'Family / emergency contact informed',
      'Copy of this form given to receiving clinician'];
    var cw = tw / 2;
    for (var i = 0; i < items.length; i++) {
      if (i % 2 === 0) d.need(15);
      var x = L + (i % 2) * cw, yy = d.y + 9;
      d.rect(x, yy - 7, 8.5, 8.5, { color: 'ink2', width: 0.7 });
      d.text(items[i], x + 13, yy, { font: 'H', size: 8, color: 'ink' });
      if (i % 2 === 1 || i === items.length - 1) d.y += 14;
    }
    d.y += 6;

    sect(d, 'Signatures', null, 190);
    signatures(d, [
      ['Sending clinician (RMO, event medical post)', S(p.dispositionBy, '')],
      ['Receiving clinician (hospital emergency department)', S(t.handoverTo, '')]
    ]);
    signatures(d, [
      ['Ambulance crew / escort', S(t.escort, '')],
      ['Patient or accompanying relative', S(p.contactName, '')]
    ]);
    return d;
  };

  P.postSummary = function (post, patients, ctx) {
    ctx = ctx || {};
    post = post || {};
    var list = EV.sortBy(patients || [], 'arrivalAt');
    var d = P.doc({ size: ctx.size || 'A4', margin: 36, at: ctx.generatedAt });
    d.meta.title = 'Post summary ' + S(post.name, S(post.code, ''));
    var c2 = Object.assign({}, ctx, { post: post, subjectLine: S(post.name, S(post.code, 'Post')) + '  ·  ' + list.length + ' patients' });
    decorate(d, c2, 'Post activity summary', null);

    var ev = ctx.event || {};
    sect(d, 'Post');
    kv(d, [
      ['Post', S(post.name, S(post.code)), 'b', null, 2],
      ['Code', S(post.code)],
      ['Type', S(post.kind)],
      ['Location', S(post.location), null, null, 2],
      ['Event', S(ev.name)],
      ['Event dates', (EV.has(ev.startDate) ? EV.dmy(ev.startDate) : DASH) + ' — ' +
        (EV.has(ev.endDate) ? EV.dmy(ev.endDate) : DASH)],
      ['Staff on duty', crewStr(post.staff), null, null, 4]
    ], 4);

    /* counts */
    var byAcuity = [0, 0, 0, 0, 0, 0], byDispo = Object.create(null), open = 0, i, j;
    var losList = [], meds = Object.create(null);
    for (i = 0; i < list.length; i++) {
      var p = list[i], D = dv(p);
      byAcuity[EV.clamp(+p.acuity || 0, 0, 5)]++;
      var dl = dispoLabel(p.disposition);
      byDispo[dl] = (byDispo[dl] || 0) + 1;
      if (p.status !== 'closed') open++;
      if (EV.has(D.dwellMs)) losList.push(D.dwellMs / 60000);
      var ords = p.orders || [];
      for (j = 0; j < ords.length; j++) {
        if (ords[j].kind !== 'med' || !ords[j].given) continue;
        var nm = S(ords[j].name, 'Unnamed drug');
        meds[nm] = (meds[nm] || 0) + 1;
      }
    }

    sect(d, 'Activity');
    kv(d, [
      ['Patients seen', String(list.length), 'b'],
      ['Still open', String(open), 'b', open ? 'warn' : 'ink'],
      ['Median length of stay', losList.length ? String(EV.r(EV.median(losList), 0)) + ' min' : DASH],
      ['Longest stay', losList.length ? String(EV.r(Math.max.apply(null, losList), 0)) + ' min' : DASH]
    ], 4);

    var acuRows = [];
    for (i = 1; i <= 5; i++) {
      var a = acu(i);
      acuRows.push([{ t: a.s, bold: true, color: a.c }, a.l,
        { t: String(byAcuity[i]), align: 'right', bold: true },
        { t: EV.pct(byAcuity[i], list.length) + '%', align: 'right' }]);
    }
    if (byAcuity[0]) acuRows.push([{ t: DASH }, 'Not triaged', { t: String(byAcuity[0]), align: 'right', bold: true },
      { t: EV.pct(byAcuity[0], list.length) + '%', align: 'right' }]);
    sect(d, 'Acuity mix');
    d.table(d.margin, d.y, [{ w: 50, l: 'Code' }, { w: 253, l: 'Acuity' },
      { w: 110, l: 'Patients', align: 'right' }, { w: 110, l: 'Share', align: 'right' }],
      acuRows, { size: 8, headSize: 7, zebra: true, vlines: true });
    d.y += 6;

    var dkeys = Object.keys(byDispo).sort();
    sect(d, 'Disposition');
    d.table(d.margin, d.y, [{ w: 303, l: 'Disposition' }, { w: 110, l: 'Patients', align: 'right' },
      { w: 110, l: 'Share', align: 'right' }],
      dkeys.map(function (k) {
        return [k, { t: String(byDispo[k]), align: 'right', bold: true },
          { t: EV.pct(byDispo[k], list.length) + '%', align: 'right' }];
      }), { size: 8, headSize: 7, zebra: true, vlines: true, empty: 'No dispositions recorded' });
    d.y += 6;

    sect(d, 'Patients');
    d.table(d.margin, d.y, [
      { w: 74, l: 'MRN' }, { w: 108, l: 'Name' }, { w: 40, l: 'Age/Sex' },
      { w: 36, l: 'Arrived' }, { w: 24, l: 'Acu', align: 'right' },
      { w: 112, l: 'Chief complaint' }, { w: 96, l: 'Disposition' }, { w: 33, l: 'LOS', align: 'right' }
    ], list.map(function (p) {
      var D = dv(p), a = acu(p.acuity);
      return [S(p.mrn, ''), { t: S(p.name, 'Unnamed'), bold: true }, ageStr(p) + ' ' + S(p.sex, ''),
        tm(p.arrivalAt), { t: a.s, align: 'right', bold: true, color: a.c },
        S(p.chiefComplaint, ''), dispoLabel(p.disposition),
        { t: S(D.los, ''), align: 'right' }];
    }), { size: 7.2, headSize: 6.6, zebra: true, vlines: true, empty: 'No patients at this post' });
    d.y += 6;

    var mkeys = EV.sortBy(Object.keys(meds), function (k) { return -meds[k]; });
    sect(d, 'Medication usage');
    d.table(d.margin, d.y, [{ w: 363, l: 'Drug' }, { w: 160, l: 'Administrations', align: 'right' }],
      mkeys.map(function (k) { return [k, { t: String(meds[k]), align: 'right', bold: true }]; }),
      { size: 8, headSize: 7, zebra: true, vlines: true, empty: 'No medication administered' });
    d.y += 8;

    signatures(d, [['Post lead / RMO', ''], ['Event medical director', '']]);
    return d;
  };

  /* ======================================================================
     8. Self test — parses its own output back.
     ====================================================================== */

  P.selfTest = function () {
    var fails = [], n = 0;
    function eq(name, got, want) {
      n++;
      var g = JSON.stringify(got), w = JSON.stringify(want);
      if (g !== w) fails.push({ name: name, expected: w, got: g });
    }
    function ok(name, cond, note) {
      n++;
      if (!cond) fails.push({ name: name, expected: 'true', got: String(note == null ? cond : note) });
    }
    function str(b) {
      var out = [], CH = 0x8000, i;
      for (i = 0; i < b.length; i += CH) {
        out.push(String.fromCharCode.apply(null, b.subarray(i, Math.min(i + CH, b.length))));
      }
      return out.join('');
    }
    /* Reads the xref back and proves every entry points at "<n> 0 obj". */
    function verify(s) {
      var bad = [], i;
      if (s.slice(0, 8) !== '%PDF-1.4') bad.push('header:' + s.slice(0, 8));
      if (!/%%EOF\s*$/.test(s)) bad.push('eof');
      var m = /startxref\s+(\d+)\s+%%EOF/.exec(s);
      if (!m) return bad.concat(['no-startxref']);
      var xs = +m[1];
      if (s.substr(xs, 4) !== 'xref') return bad.concat(['startxref@' + xs + ':' + s.substr(xs, 8)]);
      var hm = /^xref\n0 (\d+)\n/.exec(s.slice(xs, xs + 40));
      if (!hm) return bad.concat(['subsection']);
      var size = +hm[1], tbl = xs + hm[0].length;
      if (s.substr(tbl, 20) !== '0000000000 65535 f \n') bad.push('free-entry');
      for (i = 1; i < size; i++) {
        var e = s.substr(tbl + i * 20, 20);
        if (e.length !== 20 || e.charAt(10) !== ' ' || e.charAt(16) !== ' ' ||
          e.charAt(17) !== 'n' || e.slice(18) !== ' \n') { bad.push(i + ':entry[' + e + ']'); continue; }
        var off = parseInt(e.slice(0, 10), 10);
        if (s.substr(off, String(i).length + 6) !== i + ' 0 obj') bad.push(i + '@' + off);
      }
      var tm2 = /\/Size (\d+)/.exec(s);
      if (!tm2 || +tm2[1] !== size) bad.push('trailer-size');
      var re = /\/Length (\d+) >>\nstream\n/g, mm;
      while ((mm = re.exec(s)) !== null) {
        var start = mm.index + mm[0].length, L = +mm[1];
        if (s.substr(start + L, 10) !== '\nendstream') bad.push('length:' + L);
      }
      return bad;
    }

    try {
      /* --- metrics ------------------------------------------------------ */
      eq('width space = 278', P.width(' ', 'H', 1000), 278);
      eq("width 'A' = 667", P.width('A', 'H', 1000), 667);
      eq("width 'i' = 222", P.width('i', 'H', 1000), 222);
      eq('width bold A = 722', P.width('A', 'HB', 1000), 722);
      eq('oblique shares the regular table', P.width('AiA', 'HO', 1000), 667 + 222 + 667);
      eq('width is additive', P.width('A i', 'H', 1000), 667 + 278 + 222);
      eq('width scales with size', P.width('A', 'H', 10), 6.67);
      eq('digits are 556', P.width('0', 'H', 1000), 556);

      /* --- encoding ----------------------------------------------------- */
      eq('escape parens', P.esc('a(b)c'), 'a\\(b\\)c');
      eq('escape backslash', P.esc('a\\b'), 'a\\\\b');
      eq('subscript two becomes 2', P.esc('SpO₂ 92%'), 'SpO2 92%');
      eq('em dash maps to WinAnsi 151', P.esc('a—b').charCodeAt(1), 151);
      eq('degree stays Latin-1 176', P.esc('38.5°C').charCodeAt(4), 176);
      eq('CJK falls back to ?, never dropped', P.esc('a日b'), 'a?b');
      eq('no character is silently dropped', P.esc('日本語').length, 3);
      eq('newline becomes a space in a literal', P.esc('a\nb'), 'a b');
      eq('less-or-equal transliterates', P.esc('≤ 5'), '<= 5');
      eq('curly quote maps to 146', P.esc('’').charCodeAt(0), 146);

      /* --- wrap --------------------------------------------------------- */
      var long = 'The patient collapsed at kilometre thirty two with hot dry skin, ' +
        'confusion and a core temperature of forty one point two degrees celsius ' +
        'after running in direct sun with no fluid intake for ninety minutes.';
      var lines = P.wrapLines(long, 180, 'H', 9), wmax = 0, i;
      for (i = 0; i < lines.length; i++) wmax = Math.max(wmax, P.width(lines[i], 'H', 9));
      ok('wrap never exceeds its width', wmax <= 180, 'widest line ' + EV.r(wmax, 2));
      ok('wrap split into several lines', lines.length >= 5, lines.length);
      eq('wrap loses no words', lines.join(' ').replace(/\s+/g, ' ').trim(), long);
      var hard = P.wrapLines('Acetylsalicylicacidhydrochloridemonohydrate', 40, 'H', 9);
      ok('wrap hard-breaks an over-long token',
        hard.length > 1 && P.width(hard[0], 'H', 9) <= 40, hard.join('|'));
      eq('wrap keeps blank lines between paragraphs', P.wrapLines('a\n\nb', 100, 'H', 9).length, 3);
      var bw = P.wrapLines(long, 120, 'HB', 8), bmax = 0;
      for (i = 0; i < bw.length; i++) bmax = Math.max(bmax, P.width(bw[i], 'HB', 8));
      ok('wrap respects the bold table too', bmax <= 120, 'widest ' + EV.r(bmax, 2));

      /* --- a three page document ---------------------------------------- */
      var doc = P.doc({ size: 'A4', margin: 36, at: 1760000000000 });
      doc.onPage(function (pg) {
        doc.text('Page ' + pg.page + ' of ' + pg.pages, 36, 24, { size: 8, color: 'ink3' });
      });
      doc.text('one', 36, 100);
      doc.page(); doc.text('two (bracketed) \\ slash', 36, 100);
      doc.page(); doc.text('three', 36, 100);
      eq('three pages reported', doc.pageCount(), 3);
      var s3 = str(doc.bytes());
      eq('/Pages /Count says 3', (/\/Type \/Pages \/Count (\d+)/.exec(s3) || [])[1], '3');
      eq('three page objects', (s3.match(/\/Type \/Page\b/g) || []).length, 3);
      eq('three page decorations', (s3.match(/\(Page \d of 3\) Tj/g) || []).length, 3);
      eq('three page doc is structurally sound', verify(s3), []);
      eq('WinAnsiEncoding on every base-14 font', (s3.match(/\/WinAnsiEncoding/g) || []).length, 3);
      ok('Helvetica-Bold is embedded by name', s3.indexOf('/BaseFont /Helvetica-Bold') > -1);
      ok('Helvetica-Oblique is embedded by name', s3.indexOf('/BaseFont /Helvetica-Oblique') > -1);
      ok('bytes() is stable across calls', doc.bytes().length === s3.length, 'length drift');

      /* --- table paging and header repeat ------------------------------- */
      var td = P.doc({ margin: 36, at: 1760000000000 });
      td.top = 72; td.bot = td.H - 52; td.y = td.top;
      var rows = [];
      for (i = 0; i < 95; i++) rows.push(['r' + i, 'value ' + i]);
      td.table(36, td.y, [{ w: 100, l: 'KEYCOL' }, { w: 200, l: 'VALCOL' }], rows, { size: 8, zebra: true });
      ok('a long table spills onto more pages', td.pageCount() >= 3, td.pageCount());
      var ts = str(td.bytes());
      eq('header row repeats once per page',
        (ts.match(/\(KEYCOL\) Tj/g) || []).length, td.pageCount());
      eq('long table document is sound', verify(ts), []);
      /* Array.prototype.fill is truthy: a row must never be painted black. */
      ok('zebra rows are tinted, never filled black',
        (ts.match(/^0 0 0 rg [\d.]+ [\d.]+ [\d.]+ [\d.]+ re f$/gm) || []).length === 0,
        (ts.match(/^0 0 0 rg [\d.]+ [\d.]+ [\d.]+ [\d.]+ re f$/gm) || []).length + ' black rows');
      ok('zebra rows use the light tint',
        ts.indexOf('0.96 0.96 0.98 rg') > -1);

      /* --- templates ---------------------------------------------------- */
      var vit = [], t0 = 1760000000000;
      for (i = 0; i < 26; i++) {
        vit.push({ t: t0 + i * 300000, hr: 60 + i * 3, sbp: 120 - i, dbp: 78, rr: 16 + (i % 9),
          spo2: i === 5 ? 88 : 97, temp: 36.8 + (i % 4) * 0.4, gcs: i === 7 ? 13 : 15,
          pain: i % 10, bgl: i === 3 ? 58 : 104, weight: 62, avpu: 'A', o2: '', by: 'Ns. Dewi' });
      }
      var pt = {
        _t: 'patient', id: 'pt_test', mrn: 'JRF-P03-0042', name: 'Ahmad Pratama Wijaya',
        age: 34, ageUnit: 'y', sex: 'M', bib: 'A-10234', nationality: 'Indonesia',
        phone: '+62 811 2233 44', contactName: 'Siti Wijaya', contactPhone: '+62 812 9988 77',
        weight: 62, arrivalAt: t0, arrivalMode: 'stretcher', fromLocation: 'KM 32, Jalan Sudirman',
        acuity: 2, triageAt: t0 + 60000, triageBy: 'Ns. Dewi',
        chiefComplaint: 'Collapse with confusion and hot dry skin at KM 32 — suspected exertional heat stroke',
        complaintCat: 'heat',
        allergies: 'Penicillin — urticaria and facial swelling; NSAIDs — bronchospasm',
        homeMeds: 'Amlodipine 5 mg once daily', pmh: 'Hypertension, no prior heat illness',
        vitals: vit,
        exam: 'GCS 13 (E3 V4 M6) on arrival, core temperature 41.2 °C per rectal probe, skin hot and dry, ' +
          'tachycardic at 148, no focal neurology, chest clear, abdomen soft.',
        assessment: 'Exertional heat stroke with mild rhabdomyolysis risk. Cooled with ice-bath immersion ' +
          'to a target core of 38.5 °C within 22 minutes.',
        icd10: 'T67.0',
        orders: [
          { id: 'o1', t: t0 + 120000, kind: 'med', itemId: '', name: 'Ringer Lactate', dose: '1000', unit: 'mL', route: 'IV', rate: '500 mL/h', qty: 1, by: 'dr. Rizky', note: 'Cold fluids', given: true, givenAt: t0 + 120000 },
          { id: 'o2', t: t0 + 300000, kind: 'med', itemId: '', name: 'Ondansetron', dose: '4', unit: 'mg', route: 'IV', qty: 1, by: 'dr. Rizky', note: '', given: true, givenAt: t0 + 300000 },
          { id: 'o3', t: t0 + 360000, kind: 'procedure', itemId: '', name: 'Ice-bath immersion', qty: 1, unit: 'session', by: 'Ns. Dewi', note: '22 min to 38.5 C', given: true, givenAt: t0 + 360000 },
          { id: 'o4', t: t0 + 400000, kind: 'supply', itemId: '', name: 'Kassa Steril', qty: 4, unit: 'pcs', by: 'Ns. Dewi', note: '', given: true, givenAt: t0 + 400000 }
        ],
        cppt: [
          { id: 'c1', t: t0 + 180000, by: 'dr. Rizky', role: 'RMO / Doctor', phase: 'post',
            s: 'Runner found collapsed and confused at KM 32 by the roaming team.',
            o: 'GCS 13, core 41.2 C, HR 148, BP 102/64, SpO2 97% on room air.',
            a: 'Exertional heat stroke.',
            p: 'Immediate ice-bath immersion, cold IV Ringer Lactate, continuous core monitoring, ' +
              'notify command post and prepare ambulance transfer to Siloam Hospitals Kebon Jeruk.', locked: true },
          { id: 'c2', t: t0 + 1500000, by: 'Ns. Dewi', role: 'Nurse (Perawat)', phase: 'post',
            s: 'Patient now orientated, asking for water.', o: 'Core 38.4 C, GCS 15, HR 104.',
            a: 'Responding to cooling.', p: 'Out of ice bath, dry and reassess every 5 minutes.', locked: false },
          { id: 'c3', t: t0 + 2100000, by: 'dr. Rizky', role: 'RMO / Doctor', phase: 'handover',
            s: '', o: 'Stable for transfer.', a: 'Post heat stroke, needs CK and renal panel.',
            p: 'Transfer by ALS ambulance with escort.', locked: true }
        ],
        disposition: 'transport', dispositionAt: t0 + 2400000, dispositionBy: 'dr. Rizky',
        dispositionNote: 'Transferred for CK, renal function and observation.',
        destination: 'Siloam Hospitals Kebon Jeruk', transportId: 'amb_1',
        transport: { ambulanceId: 'amb_1', destination: 'Siloam Hospitals Kebon Jeruk',
          departAt: t0 + 2460000, arriveAt: t0 + 3300000, handoverTo: 'dr. Lina (ED)',
          escort: 'Ns. Dewi', note: 'Stable en route, core 38.1 C on arrival.' },
        status: 'closed', closedAt: t0 + 3300000, createdAt: t0
      };
      var ctx = {
        event: { _t: 'event', id: 'ev1', name: 'Jakarta Marathon 2026', venue: 'Gelora Bung Karno',
          startDate: t0, endDate: t0 + 86400000, mrnPrefix: 'JRF' },
        post: { _t: 'post', id: 'po3', code: 'P03', name: 'Medical Tent 3 (KM 32)',
          kind: 'mini-icu', location: 'KM 32 Jalan Sudirman',
          staff: [{ name: 'dr. Rizky', role: 'RMO / Doctor' }, { name: 'Ns. Dewi', role: 'Nurse (Perawat)' }] },
        bed: { _t: 'bed', id: 'bd1', label: 'Resus 1', kind: 'resus' },
        ambulance: { _t: 'ambulance', id: 'amb_1', callsign: 'SILOAM-1', plate: 'B 1234 XYZ',
          kind: 'als', crew: [{ name: 'Pak Joko', role: 'Driver' }, { name: 'Ns. Bayu', role: 'Paramedic' }] },
        formulary: [], logoName: 'siloam', generatedAt: t0 + 3600000,
        app: TITLE, version: '1.0.0'
      };

      var rec = P.patientRecord(pt, ctx);
      var rs = str(rec.bytes());
      ok('patientRecord spans several pages', rec.pageCount() >= 2, rec.pageCount());
      eq('patientRecord is structurally sound', verify(rs), []);
      ok('allergies reach the page', rs.indexOf('Penicillin') > -1);
      ok('the MRN reaches the page', rs.indexOf('JRF-P03-0042') > -1);
      ok('the title reaches the page', rs.indexOf('Critical Care Event EMR') > -1);
      ok('the legal footer is present', rs.indexOf('not a legal medical record unless signed') > -1);
      ok('every page is numbered', (rs.match(/\(Page \d+ of \d+\) Tj/g) || []).length === rec.pageCount(),
        (rs.match(/\(Page \d+ of \d+\) Tj/g) || []).length + ' vs ' + rec.pageCount());
      ok('the vitals header repeats across the break',
        (rs.match(/\(SpO2\) Tj/g) || []).length >= 2, (rs.match(/\(SpO2\) Tj/g) || []).length);
      ok('an abnormal value is starred', rs.indexOf('(88*) Tj') > -1);
      ok('the full CPPT plan text is present', rs.indexOf('notify command post') > -1);
      /* kv() must pack rows by span: nothing may be drawn past the right margin. */
      var xs2 = rs.match(/1 0 0 1 ([\d.]+) [\d.]+ Tm/g) || [], maxX = 0;
      for (i = 0; i < xs2.length; i++) {
        maxX = Math.max(maxX, parseFloat(/1 0 0 1 ([\d.]+)/.exec(xs2[i])[1]));
      }
      ok('no text starts past the right margin', maxX <= 595.28 - 36, 'max x ' + maxX);
      ok('the attestation heading is not orphaned from its signature lines',
        (function () {
          var pgs = rs.split('/Type /Page\b'), k;
          for (k = 0; k < pgs.length; k++) {
            if (pgs[k].indexOf('CLINICIAN ATTESTATION') > -1) {
              return pgs[k].indexOf('RESIDENT MEDICAL OFFICER') > -1;
            }
          }
          return rs.indexOf('CLINICIAN ATTESTATION') > -1;
        })());
      ok('the signature block is present', rs.indexOf('RECEIVING CLINICIAN') > -1,
        'labels are drawn uppercase by signatures()');

      var cp = P.cppt(pt, ctx), cs = str(cp.bytes());
      eq('cppt is structurally sound', verify(cs), []);
      ok('cppt carries the progress notes', cs.indexOf('Responding to cooling') > -1);

      var tf = P.transportForm(pt, ctx), fs = str(tf.bytes());
      eq('transportForm is structurally sound', verify(fs), []);
      ok('transportForm names the ambulance', fs.indexOf('SILOAM-1') > -1);
      ok('transportForm names the receiving clinician', fs.indexOf('dr. Lina') > -1);

      var ps = P.postSummary(ctx.post, [pt, Object.assign({}, pt, { id: 'p2', mrn: 'JRF-P03-0043', name: 'Dewi Lestari', acuity: 4, disposition: 'return-to-event' })], ctx);
      var pss = str(ps.bytes());
      eq('postSummary is structurally sound', verify(pss), []);
      ok('postSummary lists both patients', pss.indexOf('JRF-P03-0043') > -1);
      ok('postSummary tallies medications', pss.indexOf('Ondansetron') > -1);

      /* --- images ------------------------------------------------------- */
      /* A self-contained 1x1 baseline JPEG so the DCTDecode path — the
         riskiest part of the image code — is always exercised, even in an
         unbuilt bundle where EV.LOGO_JPEG does not exist yet. */
      var tiny = '/9j/wAALCAACAAIBAREA/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAA' +
        'AgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkK' +
        'FhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWG' +
        'h4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl' +
        '5ufo6erx8vP09fb3+Pn6/9sAQwAEBAQEBAQGBAQGCQYGBgkMCQkJCQwPDAwMDAwPEg8PDw8P' +
        'DxISEhISEhISFRUVFRUVGRkZGRkcHBwcHBwcHBwc/90ABAAB/9oACAEBAAA/ACv/2Q=='
      var reg = P.registerJpeg('__t_jpg', tiny, 99, 99);
      eq('registerJpeg reads the real size out of the SOF marker, not the args',
        [reg.w, reg.h], [2, 2]);
      eq('registerJpeg reads the component count', reg.nc, 1);
      ok('registerJpeg flags that it parsed the SOF', reg.parsed === true, reg.parsed);
      ok('registerJpeg refuses a non-JPEG instead of throwing',
        P.registerJpeg('__t_bad', 'AAAAAAAA', 1, 1) === null);
      ok('registerJpeg survives malformed base64',
        P.registerJpeg('__t_bad2', 'not!valid!base64!!!', 1, 1) === null);
      var id2 = P.doc({ margin: 36 });
      id2.image('__t_jpg', 36, 36, 60, 60);
      var is = str(id2.bytes());
      ok('image emits a DCTDecode XObject', is.indexOf('/Filter /DCTDecode') > -1);
      ok('a grayscale JPEG is embedded as /DeviceGray', is.indexOf('/ColorSpace /DeviceGray') > -1);
      ok('image is 8 bits per component', is.indexOf('/BitsPerComponent 8') > -1);
      ok('image is drawn with a cm matrix', /60 0 0 60 36 [\d.]+ cm \/Im/.test(is));
      eq('image document is structurally sound', verify(is), []);
      ok('an unregistered image is a no-op, not a crash',
        str(P.doc({ margin: 36 }).bytes()).indexOf('/XObject') < 0);
      delete P.images.__t_jpg;

      /* When the build has injected the real Siloam logo, prove that one
         embeds too — same path, real bytes. */
      if (typeof EV.LOGO_JPEG === 'string' && EV.LOGO_JPEG.length > 64) {
        var lg = P.registerJpeg('__t_logo', EV.LOGO_JPEG, 0, 0);
        ok('the shipped logo JPEG parses', lg.w > 0 && lg.h > 0, lg.w + 'x' + lg.h);
        var ld = P.doc({ margin: 36 });
        ld.image('__t_logo', 36, 36, 80, null);
        eq('a document carrying the real logo is sound', verify(str(ld.bytes())), []);
        delete P.images.__t_logo;
      }

      /* --- blank is never zero ------------------------------------------ */
      var blank = { name: 'No Name', vitals: [{ t: t0, hr: '', sbp: '', spo2: '' }], orders: [], cppt: [] };
      var bs = str(P.patientRecord(blank, { event: {}, generatedAt: t0 }).bytes());
      eq('blank record is structurally sound', verify(bs), []);
      ok('blank numeric vitals do not print as 0', bs.indexOf('(0) Tj') < 0);
    } catch (e) {
      n++;
      fails.push({ name: 'selfTest threw', expected: 'no throw', got: (e && e.message) || String(e) });
    }
    return { pass: n - fails.length, fail: fails.length, total: n, failures: fails };
  };

})(window.EV = window.EV || {});
