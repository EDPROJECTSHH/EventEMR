/* ==========================================================================
   08-xlsx.js — EV.xlsx. A from-scratch OOXML (.xlsx) writer with its own ZIP
   container. No libraries, no compression: every entry is STORE (method 0)
   with a real CRC-32 over the real bytes.

   Two rules run through this file.

   1. Every size in the ZIP is a UTF-8 BYTE length, never a JS string length.
      The data is full of Indonesian names, en dashes and degree signs, so a
      character count would silently produce an archive Excel refuses.
   2. A blank numeric field emits no cell at all. A patient with no recorded
      respiratory rate must not pivot as a zero.
   ========================================================================== */
(function (EV) {
  'use strict';

  var X = EV.xlsx = {};

  X.MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

  /* ======================================================================
     1. CRC-32 — precomputed table, computed over bytes only.
     ====================================================================== */

  var CRC_TABLE = (function () {
    var t = new Int32Array(256), c, n, k;
    for (n = 0; n < 256; n++) {
      c = n;
      for (k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c;
    }
    return t;
  })();

  /* bytes -> unsigned 32-bit CRC. '' -> 0, 'a' -> 0xE8B7BE43. */
  function crc32(bytes) {
    var c = -1, i, n = bytes.length;
    for (i = 0; i < n; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ -1) >>> 0;
  }
  X.crc32 = crc32;

  /* ======================================================================
     2. ZIP container — local headers, central directory, EOCD.
     ====================================================================== */

  function bytesOf(v) {
    if (v == null) return new Uint8Array(0);
    if (typeof v === 'string') return EV.utf8(v);
    return v;
  }

  /* MS-DOS packed time/date. Anything before 1980 is not representable. */
  function dosStamp(ms) {
    var d = new Date(EV.has(ms) ? ms : Date.now());
    var y = d.getFullYear();
    if (y < 1980) return { time: 0, date: (1 << 5) | 1 };
    return {
      time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
      date: ((y - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()
    };
  }

  /* files: [{name, bytes|string}] -> Uint8Array. Stored, UTF-8 flagged. */
  X.zip = function (files, when) {
    var list = files || [], n = list.length, i;
    var st = dosStamp(when);
    var locals = [], centrals = [], total = 0, cdSize = 0;
    var offsets = [];

    for (i = 0; i < n; i++) {
      var nameB = EV.utf8(String(list[i].name));
      var data = bytesOf(list[i].bytes);
      var crc = crc32(data);
      var size = data.length;                      /* BYTE length, always */

      var lh = new Uint8Array(30 + nameB.length);
      var lv = new DataView(lh.buffer);
      lv.setUint32(0, 0x04034b50, true);           /* local file header sig */
      lv.setUint16(4, 20, true);                   /* version needed: 2.0 */
      lv.setUint16(6, 0x0800, true);               /* bit 11 = UTF-8 names */
      lv.setUint16(8, 0, true);                    /* method 0 = STORE */
      lv.setUint16(10, st.time, true);
      lv.setUint16(12, st.date, true);
      lv.setUint32(14, crc, true);
      lv.setUint32(18, size, true);                /* compressed = stored */
      lv.setUint32(22, size, true);                /* uncompressed */
      lv.setUint16(26, nameB.length, true);
      lv.setUint16(28, 0, true);                   /* no extra field */
      lh.set(nameB, 30);

      offsets.push(total);
      locals.push(lh, data);
      total += lh.length + size;

      var ch = new Uint8Array(46 + nameB.length);
      var cv = new DataView(ch.buffer);
      cv.setUint32(0, 0x02014b50, true);           /* central dir sig */
      cv.setUint16(4, 20, true);                   /* version made by */
      cv.setUint16(6, 20, true);                   /* version needed */
      cv.setUint16(8, 0x0800, true);
      cv.setUint16(10, 0, true);
      cv.setUint16(12, st.time, true);
      cv.setUint16(14, st.date, true);
      cv.setUint32(16, crc, true);
      cv.setUint32(20, size, true);
      cv.setUint32(24, size, true);
      cv.setUint16(28, nameB.length, true);
      cv.setUint16(30, 0, true);                   /* extra len */
      cv.setUint16(32, 0, true);                   /* comment len */
      cv.setUint16(34, 0, true);                   /* disk start */
      cv.setUint16(36, 0, true);                   /* internal attrs */
      cv.setUint32(38, 0, true);                   /* external attrs */
      cv.setUint32(42, offsets[i], true);          /* -> local header */
      ch.set(nameB, 46);
      centrals.push(ch);
      cdSize += ch.length;
    }

    var eocd = new Uint8Array(22);
    var ev = new DataView(eocd.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(4, 0, true);
    ev.setUint16(6, 0, true);
    ev.setUint16(8, n, true);
    ev.setUint16(10, n, true);
    ev.setUint32(12, cdSize, true);
    ev.setUint32(16, total, true);                 /* cd offset */
    ev.setUint16(20, 0, true);

    var out = new Uint8Array(total + cdSize + 22), at = 0, k;
    for (k = 0; k < locals.length; k++) { out.set(locals[k], at); at += locals[k].length; }
    for (k = 0; k < centrals.length; k++) { out.set(centrals[k], at); at += centrals[k].length; }
    out.set(eocd, at);
    return out;
  };

  /* ======================================================================
     3. XML text — escape, and strip the control characters Excel rejects.
     ====================================================================== */

  var XESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' };
  /* XML 1.0 allows only tab, LF and CR below 0x20. Lone surrogates and the
     noncharacters are invalid too and make Excel declare the file corrupt. */
  var XBAD = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x84\x86-\x9F￾￿]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?:[^\uD800-\uDBFF]|^)[\uDC00-\uDFFF]/g;

  function xe(s) {
    if (s == null) return '';
    var t = String(s).replace(XBAD, function (m) {
      /* The trailing-surrogate branch may have swallowed a legal leading
         character; keep it and drop only the orphan. */
      return m.length === 2 && m.charCodeAt(0) < 0xD800 ? m.charAt(0) : '';
    });
    return t.replace(/[&<>"']/g, function (c) { return XESC[c]; });
  }
  X.xe = xe;

  function attr(s) { return xe(s); }

  /* ======================================================================
     4. Dates — real Excel serials, not strings.

     Serial = days since 1899-12-30 in the workbook's 1900 system, taken off
     the LOCAL wall clock because the paper log and the Excel recap have to
     show the same minute. 1899-12-30 is the conventional epoch: it absorbs
     Lotus's phantom 1900-02-29 so every date from 1900-03-01 onward agrees
     with Excel exactly.
     ====================================================================== */

  var EPOCH_DAYS = 25569;      /* 1970-01-01 as a serial */

  X.serial = function (ms) {
    var v = ms instanceof Date ? ms.getTime() : EV.num(ms);
    if (!EV.has(v) || !isFinite(v)) return undefined;
    var d = new Date(v);
    var days = Math.round(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000);
    var frac = (d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds() +
      d.getMilliseconds() / 1000) / 86400;
    return days + EPOCH_DAYS + frac;
  };

  /* UTC stamp for docProps — the only place in the bundle that is not local. */
  function isoUtc(ms) {
    var d = new Date(EV.has(ms) ? ms : Date.now());
    function p(n) { return (n < 10 ? '0' : '') + n; }
    return d.getUTCFullYear() + '-' + p(d.getUTCMonth() + 1) + '-' + p(d.getUTCDate()) +
      'T' + p(d.getUTCHours()) + ':' + p(d.getUTCMinutes()) + ':' + p(d.getUTCSeconds()) + 'Z';
  }

  /* ======================================================================
     5. Cells, columns, styles.
     ====================================================================== */

  /* Style name -> cellXfs index. Order must match styles.xml below. */
  var STYLE = {
    '': 0, head: 1, num: 2, date: 3, wrap: 4, bad: 5, warn: 6, ok: 7,
    day: 8, time: 9, dec: 10, bold: 11, sub: 12
  };
  X.STYLES = STYLE;

  function colRef(n) {
    var s = '';
    while (n > 0) { var m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = (n - m - 1) / 26; }
    return s || 'A';
  }
  X.colRef = colRef;

  /* Decimal text Excel will parse. Exponent notation is not safe in <v>. */
  function numStr(v) {
    if (!isFinite(v)) return null;
    if (v % 1 === 0 && Math.abs(v) < 1e15) return String(v);
    var s = String(v);
    if (s.indexOf('e') !== -1 || s.indexOf('E') !== -1) {
      s = v.toFixed(10).replace(/0+$/, '').replace(/\.$/, '');
    }
    return s;
  }

  /* primitive | Date | {v,t,s} -> {t,v,s} or null when the cell is blank. */
  function norm(c) {
    if (c === null || c === undefined || c === '') return null;
    var v = c, t, st;
    if (typeof c === 'object' && !(c instanceof Date)) { v = c.v; t = c.t; st = c.s; }
    if (v instanceof Date) t = t || 'd';
    if (v === null || v === undefined || v === '') return null;

    if (t === 'd') {
      var sv = X.serial(v);
      if (!EV.has(sv)) return null;
      return { t: 'n', v: numStr(sv), s: STYLE[st] === undefined ? STYLE.date : STYLE[st] };
    }
    if (t === 'b' || typeof v === 'boolean') {
      return { t: 'b', v: v ? 1 : 0, s: STYLE[st] || 0 };
    }
    if (t === 'n' || (typeof v === 'number' && t !== 's')) {
      var nv = EV.num(v);
      if (!EV.has(nv) || !isFinite(nv)) return null;
      var ns = numStr(nv);
      if (ns === null) return null;
      return { t: 'n', v: ns, s: STYLE[st] === undefined ? STYLE.num : STYLE[st] };
    }
    return { t: 's', v: String(v), s: STYLE[st] || 0 };
  }

  function cellXml(ref, c) {
    var s = c.s ? ' s="' + c.s + '"' : '';
    if (c.t === 'n') return '<c r="' + ref + '"' + s + '><v>' + c.v + '</v></c>';
    if (c.t === 'b') return '<c r="' + ref + '"' + s + ' t="b"><v>' + c.v + '</v></c>';
    return '<c r="' + ref + '"' + s + ' t="inlineStr"><is><t xml:space="preserve">' +
      xe(c.v) + '</t></is></c>';
  }

  /* ======================================================================
     6. Sheet names — strip what Excel forbids, cap 31, dedupe.
     ====================================================================== */

  X.sheetName = function (name, used) {
    var s = String(name == null ? '' : name)
      .replace(/[:\\\/\?\*\[\]]/g, '')
      .replace(/^'+|'+$/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!s) s = 'Sheet';
    if (s.length > 31) s = s.slice(0, 31).replace(/\s+$/, '');
    if (used) {
      var base = s, i = 2;
      while (used[s.toLowerCase()]) {
        var suf = '~' + i;
        i++;
        s = base.slice(0, 31 - suf.length).replace(/\s+$/, '') + suf;
      }
      used[s.toLowerCase()] = 1;
    }
    return s;
  };

  /* ======================================================================
     7. Worksheet XML.

     sheet = { name, head:[str], cols:[{w}|number], rows:[[cell]],
               freeze:1, autofilter:true }
     ====================================================================== */

  X.sheetXml = function (sheet, isFirst) {
    sheet = sheet || {};
    var head = sheet.head && sheet.head.length ? sheet.head : null;
    var body = sheet.rows || [];
    var out = [];
    var rows = [];
    var i, j;

    if (head) {
      var hr = [];
      for (j = 0; j < head.length; j++) hr.push({ v: head[j], t: 's', s: 'head' });
      rows.push(hr);
    }
    for (i = 0; i < body.length; i++) rows.push(body[i]);

    var maxCol = head ? head.length : 0;
    for (i = 0; i < body.length; i++) if (body[i] && body[i].length > maxCol) maxCol = body[i].length;
    if (!maxCol) maxCol = 1;
    var lastRow = rows.length || 1;
    var dim = 'A1:' + colRef(maxCol) + lastRow;

    var freeze = sheet.freeze === undefined ? (head ? 1 : 0) : sheet.freeze;

    out.push('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>');
    out.push('<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">');
    out.push('<dimension ref="' + dim + '"/>');
    out.push('<sheetViews><sheetView' + (isFirst ? ' tabSelected="1"' : '') + ' workbookViewId="0">');
    if (freeze > 0) {
      out.push('<pane ySplit="' + freeze + '" topLeftCell="A' + (freeze + 1) +
        '" activePane="bottomLeft" state="frozen"/>');
      out.push('<selection pane="bottomLeft" activeCell="A' + (freeze + 1) +
        '" sqref="A' + (freeze + 1) + '"/>');
    }
    out.push('</sheetView></sheetViews>');
    out.push('<sheetFormatPr defaultRowHeight="15"/>');

    var cols = sheet.cols || [];
    if (cols.length) {
      out.push('<cols>');
      for (j = 0; j < maxCol; j++) {
        var cd = cols[j];
        var w = typeof cd === 'number' ? cd : (cd && EV.num(cd.w));
        if (!EV.has(w) || !(w > 0)) w = 12;
        out.push('<col min="' + (j + 1) + '" max="' + (j + 1) + '" width="' +
          EV.r(Math.min(w, 120), 2) + '" customWidth="1"/>');
      }
      out.push('</cols>');
    }

    out.push('<sheetData>');
    for (i = 0; i < rows.length; i++) {
      var r = rows[i] || [];
      var rn = i + 1;
      var cells = [];
      for (j = 0; j < r.length; j++) {
        var c = norm(r[j]);
        if (c) cells.push(cellXml(colRef(j + 1) + rn, c));
      }
      if (!cells.length) { out.push('<row r="' + rn + '"/>'); continue; }
      var ht = (head && i === 0) ? ' ht="26" customHeight="1"' : '';
      out.push('<row r="' + rn + '"' + ht + '>' + cells.join('') + '</row>');
    }
    out.push('</sheetData>');

    if (sheet.autofilter !== false && head) {
      out.push('<autoFilter ref="A1:' + colRef(maxCol) + lastRow + '"/>');
    }
    out.push('<pageMargins left="0.4" right="0.4" top="0.5" bottom="0.5" header="0.3" footer="0.3"/>');
    out.push('</worksheet>');
    return out.join('');
  };

  /* ======================================================================
     8. Static parts.
     ====================================================================== */

  function stylesXml() {
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<numFmts count="4">' +
      '<numFmt numFmtId="164" formatCode="dd/mm/yyyy hh:mm"/>' +
      '<numFmt numFmtId="165" formatCode="dd mmm yyyy"/>' +
      '<numFmt numFmtId="166" formatCode="hh:mm"/>' +
      '<numFmt numFmtId="167" formatCode="0.0"/>' +
      '</numFmts>' +
      '<fonts count="5">' +
      '<font><sz val="11"/><color theme="1"/><name val="Calibri"/><family val="2"/></font>' +
      '<font><b/><sz val="11"/><color theme="1"/><name val="Calibri"/><family val="2"/></font>' +
      '<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/><family val="2"/></font>' +
      '<font><i/><sz val="10"/><color rgb="FF64737B"/><name val="Calibri"/><family val="2"/></font>' +
      '<font><sz val="11"/><color rgb="FF8A1220"/><name val="Calibri"/><family val="2"/></font>' +
      '</fonts>' +
      '<fills count="6">' +
      '<fill><patternFill patternType="none"/></fill>' +
      '<fill><patternFill patternType="gray125"/></fill>' +
      '<fill><patternFill patternType="solid"><fgColor rgb="FF1C2E7A"/><bgColor indexed="64"/></patternFill></fill>' +
      '<fill><patternFill patternType="solid"><fgColor rgb="FFFDE2E4"/><bgColor indexed="64"/></patternFill></fill>' +
      '<fill><patternFill patternType="solid"><fgColor rgb="FFFFF2D6"/><bgColor indexed="64"/></patternFill></fill>' +
      '<fill><patternFill patternType="solid"><fgColor rgb="FFE2F4E8"/><bgColor indexed="64"/></patternFill></fill>' +
      '</fills>' +
      '<borders count="2">' +
      '<border><left/><right/><top/><bottom/><diagonal/></border>' +
      '<border><left/><right/><top/><bottom style="thin"><color rgb="FF101C4A"/></bottom><diagonal/></border>' +
      '</borders>' +
      '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
      '<cellXfs count="13">' +
      /* 0 default */
      '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
      /* 1 head */
      '<xf numFmtId="0" fontId="2" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center" wrapText="1"/></xf>' +
      /* 2 num */
      '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="right"/></xf>' +
      /* 3 date */
      '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
      /* 4 wrap */
      '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>' +
      /* 5 bad */
      '<xf numFmtId="0" fontId="4" fillId="3" borderId="0" xfId="0" applyFont="1" applyFill="1"/>' +
      /* 6 warn */
      '<xf numFmtId="0" fontId="0" fillId="4" borderId="0" xfId="0" applyFill="1"/>' +
      /* 7 ok */
      '<xf numFmtId="0" fontId="0" fillId="5" borderId="0" xfId="0" applyFill="1"/>' +
      /* 8 day */
      '<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
      /* 9 time */
      '<xf numFmtId="166" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
      /* 10 dec */
      '<xf numFmtId="167" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="right"/></xf>' +
      /* 11 bold */
      '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
      /* 12 sub */
      '<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
      '</cellXfs>' +
      '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
      '<dxfs count="0"/>' +
      '<tableStyles count="0" defaultTableStyle="TableStyleMedium9" defaultPivotStyle="PivotStyleLight16"/>' +
      '</styleSheet>';
  }

  function contentTypes(nSheets) {
    var a = ['<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
      '<Default Extension="xml" ContentType="application/xml"/>',
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>',
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'];
    for (var i = 1; i <= nSheets; i++) {
      a.push('<Override PartName="/xl/worksheets/sheet' + i +
        '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>');
    }
    a.push('<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>');
    a.push('<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>');
    a.push('</Types>');
    return a.join('');
  }

  function rootRels() {
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
      '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>' +
      '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>' +
      '</Relationships>';
  }

  function workbookXml(names) {
    var a = ['<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"',
      ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">',
      '<workbookPr date1904="false"/>',
      '<bookViews><workbookView xWindow="0" yWindow="0" windowWidth="24000" windowHeight="14000" activeTab="0"/></bookViews>',
      '<sheets>'];
    for (var i = 0; i < names.length; i++) {
      a.push('<sheet name="' + attr(names[i]) + '" sheetId="' + (i + 1) +
        '" r:id="rId' + (i + 1) + '"/>');
    }
    a.push('</sheets>');
    a.push('<calcPr calcId="124519" fullCalcOnLoad="1"/>');
    a.push('</workbook>');
    return a.join('');
  }

  function workbookRels(n) {
    var a = ['<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'];
    for (var i = 1; i <= n; i++) {
      a.push('<Relationship Id="rId' + i +
        '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' +
        i + '.xml"/>');
    }
    a.push('<Relationship Id="rId' + (n + 1) +
      '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>');
    a.push('</Relationships>');
    return a.join('');
  }

  function coreXml(meta) {
    var t = isoUtc(meta.when);
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"' +
      ' xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/"' +
      ' xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
      '<dc:title>' + xe(meta.title) + '</dc:title>' +
      '<dc:subject>' + xe(meta.subject) + '</dc:subject>' +
      '<dc:creator>' + xe(meta.creator) + '</dc:creator>' +
      '<cp:lastModifiedBy>' + xe(meta.creator) + '</cp:lastModifiedBy>' +
      '<dcterms:created xsi:type="dcterms:W3CDTF">' + t + '</dcterms:created>' +
      '<dcterms:modified xsi:type="dcterms:W3CDTF">' + t + '</dcterms:modified>' +
      '</cp:coreProperties>';
  }

  function appXml(names, meta) {
    var a = ['<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
      '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"',
      ' xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">',
      '<Application>' + xe(meta.creator) + '</Application>',
      '<DocSecurity>0</DocSecurity><ScaleCrop>false</ScaleCrop>',
      '<HeadingPairs><vt:vector size="2" baseType="variant">',
      '<vt:variant><vt:lpstr>Worksheets</vt:lpstr></vt:variant>',
      '<vt:variant><vt:i4>' + names.length + '</vt:i4></vt:variant>',
      '</vt:vector></HeadingPairs>',
      '<TitlesOfParts><vt:vector size="' + names.length + '" baseType="lpstr">'];
    for (var i = 0; i < names.length; i++) a.push('<vt:lpstr>' + xe(names[i]) + '</vt:lpstr>');
    a.push('</vt:vector></TitlesOfParts>');
    a.push('<Company>' + xe(meta.company) + '</Company>');
    a.push('<LinksUpToDate>false</LinksUpToDate><SharedDoc>false</SharedDoc>');
    a.push('<HyperlinksChanged>false</HyperlinksChanged><AppVersion>16.0300</AppVersion>');
    a.push('</Properties>');
    return a.join('');
  }

  /* ======================================================================
     9. build / blob / dataUri
     ====================================================================== */

  X.build = function (sheets, meta) {
    var list = (sheets || []).filter(function (s) { return !!s; });
    if (!list.length) list = [{ name: 'Sheet1', head: ['Nothing to export'], rows: [] }];
    meta = Object.assign({
      title: 'Event EMR recap',
      subject: '',
      creator: 'Mini Emergency & Critical Care Event EMR',
      company: 'Siloam Hospitals',
      when: EV.now()
    }, meta || {});

    var used = Object.create(null), names = [], files = [], i;
    for (i = 0; i < list.length; i++) names.push(X.sheetName(list[i].name || ('Sheet' + (i + 1)), used));

    files.push({ name: '[Content_Types].xml', bytes: contentTypes(list.length) });
    files.push({ name: '_rels/.rels', bytes: rootRels() });
    files.push({ name: 'docProps/core.xml', bytes: coreXml(meta) });
    files.push({ name: 'docProps/app.xml', bytes: appXml(names, meta) });
    files.push({ name: 'xl/workbook.xml', bytes: workbookXml(names) });
    files.push({ name: 'xl/_rels/workbook.xml.rels', bytes: workbookRels(list.length) });
    files.push({ name: 'xl/styles.xml', bytes: stylesXml() });
    for (i = 0; i < list.length; i++) {
      files.push({
        name: 'xl/worksheets/sheet' + (i + 1) + '.xml',
        bytes: X.sheetXml(list[i], i === 0)
      });
    }
    return X.zip(files, meta.when);
  };

  X.blob = function (sheets, meta) {
    return new Blob([X.build(sheets, meta)], { type: X.MIME });
  };
  X.dataUri = function (sheets, meta) {
    return 'data:' + X.MIME + ';base64,' + EV.bytesToB64(X.build(sheets, meta));
  };

  /* ======================================================================
     10. The recap.
     ====================================================================== */

  var M = function () { return EV.model || {}; };

  function label(list, v) {
    var a = list || [];
    for (var i = 0; i < a.length; i++) if (a[i].v === v) return a[i].l;
    return v ? String(v) : '';
  }
  function arr(v) { return Array.isArray(v) ? v : []; }
  function byId(list) {
    var m = Object.create(null), a = arr(list);
    for (var i = 0; i < a.length; i++) if (a[i] && a[i].id) m[a[i].id] = a[i];
    return m;
  }
  function n(v) {
    var x = EV.num(v);
    return EV.has(x) && isFinite(x) ? { v: x, t: 'n' } : '';
  }
  function dec(v) {
    var x = EV.num(v);
    return EV.has(x) && isFinite(x) ? { v: x, t: 'n', s: 'dec' } : '';
  }
  function dt(ms) { return EV.has(ms) ? { v: ms, t: 'd' } : ''; }
  function minsBetween(a, b) {
    if (!EV.has(a) || !EV.has(b)) return '';
    return { v: EV.r((b - a) / 60000, 1), t: 'n', s: 'dec' };
  }
  function txt(s) { return s == null || s === '' ? '' : String(s); }
  function wrap(s) { return s == null || s === '' ? '' : { v: String(s), t: 's', s: 'wrap' }; }
  function people(arr) {
    return (arr || []).map(function (x) {
      if (!x) return '';
      return x.name + (x.role ? ' (' + x.role + ')' : '');
    }).filter(function (s) { return !!s; }).join('; ');
  }
  function safeDerive(p) {
    try { return M().derive ? M().derive(p) : {}; }
    catch (e) { EV.logError('xlsx.derive', e); return {}; }
  }

  /* ---- Patients --------------------------------------------------------- */

  function sheetPatients(ctx, idx) {
    var head = ['MRN', 'Name', 'Age', 'Age unit', 'Age (years)', 'Sex', 'ID / ticket', 'Nationality',
      'Phone', 'Emergency contact', 'Contact phone', 'Weight (kg)',
      'Post', 'Bed', 'Acuity', 'Acuity label',
      'Arrival mode', 'From', 'Arrival', 'Triage', 'Triage delay (min)', 'Triaged by',
      'Chief complaint', 'Complaint category', 'Allergies', 'Past history', 'Home meds',
      'Assessment', 'ICD-10', 'NEWS2', 'NEWS2 band', 'Red flags', 'Vital sets',
      'Meds given', 'Supply lines', 'CPPT notes',
      'Disposition', 'Disposition time', 'Disposition by', 'Destination',
      'Ambulance', 'Door to disposition (min)', 'LOS (min)', 'LOS', 'Status',
      'Closed', 'Created', 'Disposition note'];
    var cols = [15, 24, 7, 9, 11, 6, 8, 12, 14, 20, 14, 11, 18, 12, 8, 16,
      14, 18, 17, 17, 16, 16, 30, 22, 20, 20, 20, 28, 12, 8, 14, 26, 10,
      11, 12, 11, 20, 17, 16, 24, 12, 20, 11, 10, 9, 17, 17, 30];
    var rows = [];
    var pts = EV.sortBy(arr(ctx.patients), 'arrivalAt');

    for (var i = 0; i < pts.length; i++) {
      var p = pts[i];
      var d = safeDerive(p);
      var post = idx.posts[p.postId];
      var bed = idx.beds[p.bedId];
      var tr = p.transport || {};
      var amb = idx.ambulances[tr.ambulanceId];
      var orders = p.orders || [];
      var meds = 0, sup = 0;
      for (var k = 0; k < orders.length; k++) {
        if (orders[k].kind === 'med' || orders[k].kind === 'fluid') meds++;
        else sup++;
      }
      var flags = (d.redFlags || []).map(function (f) { return f.l; }).join('; ');
      var n2 = d.news2 || {};
      var dispo = M().dispo ? M().dispo(p.disposition) : { l: p.disposition || '' };

      rows.push([
        txt(p.mrn), txt(p.name), n(p.age), txt(p.ageUnit === 'mo' ? 'months' : p.age ? 'years' : ''),
        dec(d.ageYears), txt(p.sex), txt(p.bib), txt(p.nationality),
        txt(p.phone), txt(p.contactName), txt(p.contactPhone), dec(p.weight),
        txt(post ? ((post.code ? post.code + ' · ' : '') + post.name) : ''),
        txt(bed ? bed.label : ''),
        n(p.acuity), txt(p.acuity ? d.acuityLabel || '' : 'Not triaged'),
        txt(label(M().ARRIVAL, p.arrivalMode)), txt(p.fromLocation),
        dt(p.arrivalAt), dt(p.triageAt), minsBetween(p.arrivalAt, p.triageAt), txt(p.triageBy),
        txt(p.chiefComplaint), txt(M().catLabel ? M().catLabel(p.complaintCat) : p.complaintCat),
        txt(p.allergies), txt(p.pmh), txt(p.homeMeds),
        txt(p.assessment), txt(p.icd10),
        n(n2.score), txt(n2.band ? n2.label || n2.band : ''),
        flags ? { v: flags, t: 's', s: d.worstFlag >= 2 ? 'bad' : d.worstFlag ? 'warn' : '' } : '',
        n((p.vitals || []).length), n(meds), n(sup), n((p.cppt || []).length),
        txt(dispo.l), dt(p.dispositionAt), txt(p.dispositionBy),
        txt(p.destination || tr.destination),
        txt(amb ? amb.callsign : ''),
        minsBetween(p.arrivalAt, p.dispositionAt),
        EV.has(d.dwellMs) ? { v: EV.r(d.dwellMs / 60000, 1), t: 'n', s: 'dec' } : '',
        txt(d.los), txt(p.status === 'closed' ? 'Closed' : 'Open'),
        dt(p.closedAt), dt(p.createdAt), wrap(p.dispositionNote)
      ]);
    }
    return { name: 'Patients', head: head, cols: cols, rows: rows, freeze: 1, autofilter: true };
  }

  /* ---- Vitals ----------------------------------------------------------- */

  function sheetVitals(ctx, idx) {
    var head = ['MRN', 'Patient', 'Post', 'Acuity', 'Time', 'Minutes from arrival',
      'HR', 'SBP', 'DBP', 'MAP', 'RR', 'SpO2 (%)', 'On oxygen', 'Temp (C)',
      'GCS', 'Pain', 'BGL', 'Weight (kg)', 'Shock index', 'NEWS2', 'NEWS2 band', 'Recorded by'];
    var cols = [15, 22, 18, 7, 17, 18, 7, 7, 7, 7, 7, 10, 10, 9, 7, 7, 8, 11, 11, 8, 14, 18];
    var rows = [];
    var pts = EV.sortBy(arr(ctx.patients), 'arrivalAt');
    var m = M();
    for (var i = 0; i < pts.length; i++) {
      var p = pts[i], post = idx.posts[p.postId];
      var vs = EV.sortBy(p.vitals || [], 't');
      for (var j = 0; j < vs.length; j++) {
        var v = vs[j];
        var n2 = m.news2 ? m.news2(v) : {};
        var sp = EV.num(v.spo2), sbp = EV.num(v.sbp);
        rows.push([
          txt(p.mrn), txt(p.name), txt(post ? post.name : ''), n(p.acuity),
          dt(v.t), minsBetween(p.arrivalAt, v.t),
          n(v.hr),
          EV.has(sbp) ? { v: sbp, t: 'n', s: sbp < 90 ? 'bad' : '' } : '',
          n(v.dbp),
          n(m.map ? m.map(v.sbp, v.dbp) : undefined),
          n(v.rr),
          EV.has(sp) ? { v: sp, t: 'n', s: sp < 92 ? 'bad' : sp < 95 ? 'warn' : '' } : '',
          v.o2 === undefined || v.o2 === null ? '' : { v: !!v.o2, t: 'b' },
          dec(v.temp), n(v.gcs), n(v.pain), n(v.bgl), dec(v.weight),
          dec(m.shockIndex ? m.shockIndex(v.hr, v.sbp) : undefined),
          EV.has(n2.score) ? {
            v: n2.score, t: 'n',
            s: n2.band === 'high' ? 'bad' : n2.band === 'medium' ? 'warn' : ''
          } : '',
          txt(n2.band ? n2.label || n2.band : ''), txt(v.by)
        ]);
      }
    }
    return { name: 'Vitals', head: head, cols: cols, rows: rows, freeze: 1, autofilter: true };
  }

  /* ---- Medications / Supplies ------------------------------------------ */

  var MED_KINDS = ['med', 'fluid'];

  function orderRows(ctx, idx, wantMeds) {
    var rows = [];
    var pts = EV.sortBy(arr(ctx.patients), 'arrivalAt');
    for (var i = 0; i < pts.length; i++) {
      var p = pts[i];
      var post = idx.posts[p.postId];
      var d = safeDerive(p);
      var os = EV.sortBy(p.orders || [], 't');
      for (var j = 0; j < os.length; j++) {
        var o = os[j];
        var isMed = MED_KINDS.indexOf(o.kind) !== -1;
        if (isMed !== wantMeds) continue;
        var item = idx.formulary[o.itemId];
        if (wantMeds) {
          rows.push([
            txt(p.mrn), txt(p.name), n(p.age), dec(d.weight), n(p.acuity),
            txt(post ? post.name : ''), dt(o.t), minsBetween(p.arrivalAt, o.t),
            txt(o.name || (item && item.name)), txt(item ? item.generic : ''),
            txt(o.kind), dec(o.dose), txt(o.unit || (item && item.unit)),
            txt(o.route), txt(o.rate), dec(o.qty),
            { v: !!o.given, t: 'b' }, dt(o.givenAt), txt(o.by),
            item && item.highAlert ? { v: 'High alert', t: 's', s: 'bad' } : '',
            item && item.controlled ? { v: 'Controlled', t: 's', s: 'warn' } : '',
            txt(item ? item.cat : ''), wrap(o.note)
          ]);
        } else {
          rows.push([
            txt(p.mrn), txt(p.name), txt(post ? post.name : ''), dt(o.t),
            txt(o.kind), txt(o.name || (item && item.name)),
            dec(o.qty), txt(o.unit || (item && item.unit)),
            txt(item ? item.cat : ''), n(item ? item.par : undefined),
            txt(o.route), { v: !!o.given, t: 'b' }, txt(o.by), wrap(o.note)
          ]);
        }
      }
    }
    return rows;
  }

  function sheetMeds(ctx, idx) {
    return {
      name: 'Medications',
      head: ['MRN', 'Patient', 'Age', 'Weight (kg)', 'Acuity', 'Post', 'Ordered',
        'Minutes from arrival', 'Item', 'Generic', 'Kind', 'Dose', 'Unit', 'Route',
        'Rate', 'Qty', 'Given', 'Given at', 'By', 'High alert', 'Controlled',
        'Category', 'Note'],
      cols: [15, 22, 7, 11, 7, 16, 17, 18, 24, 22, 8, 9, 8, 8, 12, 7, 8, 17, 16, 11, 11, 13, 32],
      rows: orderRows(ctx, idx, true), freeze: 1, autofilter: true
    };
  }

  function sheetSupplies(ctx, idx) {
    return {
      name: 'Supplies',
      head: ['MRN', 'Patient', 'Post', 'Time', 'Kind', 'Item', 'Qty', 'Unit',
        'Category', 'Par', 'Route', 'Logged', 'By', 'Note'],
      cols: [15, 22, 16, 17, 11, 28, 7, 8, 13, 7, 8, 9, 16, 32],
      rows: orderRows(ctx, idx, false), freeze: 1, autofilter: true
    };
  }

  /* ---- CPPT ------------------------------------------------------------- */

  function sheetCppt(ctx, idx) {
    var rows = [];
    var pts = EV.sortBy(arr(ctx.patients), 'arrivalAt');
    for (var i = 0; i < pts.length; i++) {
      var p = pts[i], post = idx.posts[p.postId];
      var cs = EV.sortBy(p.cppt || [], 't');
      for (var j = 0; j < cs.length; j++) {
        var c = cs[j];
        rows.push([
          txt(p.mrn), txt(p.name), txt(post ? post.name : ''), n(p.acuity),
          dt(c.t), minsBetween(p.arrivalAt, c.t), txt(c.phase), txt(c.by), txt(c.role),
          wrap(c.s), wrap(c.o), wrap(c.a), wrap(c.p),
          { v: !!c.locked, t: 'b' }
        ]);
      }
    }
    return {
      name: 'CPPT',
      head: ['MRN', 'Patient', 'Post', 'Acuity', 'Time', 'Minutes from arrival',
        'Phase', 'By', 'Role', 'Subjective', 'Objective', 'Assessment', 'Plan', 'Locked'],
      cols: [15, 22, 16, 7, 17, 18, 11, 16, 16, 42, 42, 42, 42, 8],
      rows: rows, freeze: 1, autofilter: true
    };
  }

  /* ---- Transfers -------------------------------------------------------- */

  var TRANSFER_DISPO = ['transport', 'refer-hospital'];

  function sheetTransfers(ctx, idx) {
    var rows = [];
    var pts = EV.sortBy(arr(ctx.patients), 'arrivalAt');
    for (var i = 0; i < pts.length; i++) {
      var p = pts[i];
      var tr = p.transport || {};
      var hasTransport = !!(tr.ambulanceId || tr.departAt || tr.destination || tr.handoverTo);
      if (!hasTransport && TRANSFER_DISPO.indexOf(p.disposition) === -1) continue;
      var post = idx.posts[p.postId];
      var amb = idx.ambulances[tr.ambulanceId];
      var d = safeDerive(p);
      var dispo = M().dispo ? M().dispo(p.disposition) : { l: p.disposition || '' };
      rows.push([
        txt(p.mrn), txt(p.name), n(p.age), txt(p.sex), n(p.acuity),
        txt(p.acuity ? d.acuityLabel || '' : ''), txt(post ? post.name : ''),
        txt(p.chiefComplaint), txt(dispo.l),
        txt(tr.destination || p.destination),
        txt(amb ? amb.callsign : ''), txt(amb ? amb.plate : ''),
        txt(amb ? amb.kind : ''), txt(amb ? people(amb.crew) : ''),
        dt(p.arrivalAt), dt(p.dispositionAt), dt(tr.departAt), dt(tr.arriveAt),
        minsBetween(p.arrivalAt, tr.departAt),
        minsBetween(tr.departAt, tr.arriveAt),
        txt(tr.handoverTo), txt(tr.escort), wrap(tr.note || p.dispositionNote)
      ]);
    }
    return {
      name: 'Transfers',
      head: ['MRN', 'Patient', 'Age', 'Sex', 'Acuity', 'Acuity label', 'From post',
        'Chief complaint', 'Disposition', 'Destination', 'Callsign', 'Plate',
        'Ambulance type', 'Crew', 'Arrival', 'Disposition time', 'Departed',
        'Arrived', 'Door to depart (min)', 'Transit (min)', 'Handover to',
        'Escort', 'Note'],
      cols: [15, 22, 7, 6, 7, 16, 16, 28, 20, 26, 12, 12, 13, 26, 17, 17, 17, 17,
        18, 13, 20, 18, 32],
      rows: rows, freeze: 1, autofilter: true
    };
  }

  /* ---- Posts & Beds -----------------------------------------------------
     One sheet, one row per resource, with a Type column so the filter does
     the work: Post, Bed, Ambulance. Nothing from the board is left out. */

  function sheetPostsBeds(ctx, idx) {
    var rows = [];
    var posts = EV.sortBy(arr(ctx.posts), 'sort');
    var beds = arr(ctx.beds);
    var ambs = arr(ctx.ambulances);
    var m = M();
    var seen = Object.create(null), i, j;

    function patCell(id) {
      var p = idx.patients[id];
      return p ? [txt(p.mrn), txt(p.name)] : ['', ''];
    }

    for (i = 0; i < posts.length; i++) {
      var po = posts[i];
      var mine = [];
      for (j = 0; j < beds.length; j++) if (beds[j].postId === po.id) mine.push(beds[j]);
      mine = EV.sortBy(mine, 'sort');
      var load = 0, free = 0;
      for (j = 0; j < mine.length; j++) {
        if (mine[j].status === 'occupied') load++;
        if (mine[j].status === 'free') free++;
      }
      var census = 0;
      for (j = 0; j < (ctx.patients || []).length; j++) {
        if (ctx.patients[j].postId === po.id) census++;
      }
      rows.push(['Post', txt(po.code), txt(po.name),
        txt(label(m.POST_KINDS, po.kind)), txt(po.location),
        txt(po.name), txt(label(m.POST_KINDS, po.kind)),
        txt(po.active === false ? 'Inactive' : 'Active'),
        '', '', n(mine.length), n(load), n(free), n(census),
        txt(people(po.staff)), wrap(po.notes)]);

      for (j = 0; j < mine.length; j++) {
        var b = mine[j];
        seen[b.id] = 1;
        var who = patCell(b.patientId);
        rows.push(['Bed', txt(po.code), txt(po.name),
          txt(label(m.POST_KINDS, po.kind)), txt(po.location),
          txt(b.label), txt(label(m.BED_KINDS, b.kind)),
          {
            v: label(m.BED_STATUS, b.status), t: 's',
            s: b.status === 'occupied' ? 'bad' : b.status === 'free' ? 'ok'
              : b.status === 'cleaning' ? 'warn' : ''
          },
          who[0], who[1], '', '', '', '', '', '']);
      }
    }
    /* Beds whose post was deleted still belong in the recap. */
    for (j = 0; j < beds.length; j++) {
      if (seen[beds[j].id]) continue;
      var ob = beds[j], ow = patCell(ob.patientId);
      rows.push(['Bed', '', '(no post)', '', '', txt(ob.label),
        txt(label(m.BED_KINDS, ob.kind)), txt(label(m.BED_STATUS, ob.status)),
        ow[0], ow[1], '', '', '', '', '', '']);
    }
    for (i = 0; i < ambs.length; i++) {
      var a = ambs[i], aw = patCell(a.patientId);
      rows.push(['Ambulance', '', '(fleet)', '', txt(a.destination),
        txt(a.callsign), txt(a.kind),
        {
          v: label(m.AMB_STATUS, a.status), t: 's',
          s: a.status === 'available' ? 'ok' : a.status === 'oos' ? '' : 'warn'
        },
        aw[0], aw[1], '', '', '', '', txt(people(a.crew)), txt(a.plate)]);
    }

    return {
      name: 'Posts & Beds',
      head: ['Type', 'Post code', 'Post', 'Post kind', 'Location', 'Resource',
        'Resource kind', 'Status', 'Patient MRN', 'Patient', 'Beds', 'Occupied',
        'Free', 'Patients seen', 'Staff / crew', 'Notes'],
      cols: [11, 11, 22, 16, 22, 22, 18, 16, 15, 22, 7, 10, 7, 13, 40, 30],
      rows: rows, freeze: 1, autofilter: true
    };
  }

  /* ---- Analytics -------------------------------------------------------- */

  function sheetAnalytics(ctx) {
    var a = ctx.analytics || null;
    var rows = [];
    var ev = ctx.event || {};
    function put(section, metric, value, detail) {
      rows.push([txt(section), txt(metric), value === '' || value == null ? '' : value, txt(detail)]);
    }
    function mins(ms) {
      return EV.has(ms) ? { v: EV.r(ms / 60000, 1), t: 'n', s: 'dec' } : '';
    }

    put('Event', 'Event', txt(ev.name), txt(ev.venue));
    put('Event', 'Dates', dt(ev.startDate), EV.has(ev.endDate) ? EV.dmy(ev.endDate) : '');
    put('Event', 'Medic on duty', txt(ev.medicOn), txt(ev.organiser));
    put('Event', 'Audience', n(ev.audience), txt(ev.pkg));
    put('Event', 'Generated', dt(ctx.generatedAt || EV.now()), txt(ctx.version || EV.VERSION));

    var pts = arr(ctx.patients);
    var t = (a && a.totals) || null;
    if (t) {
      put('Totals', 'Patients seen', n(t.patients));
      put('Totals', 'Still open', n(t.open));
      put('Totals', 'Transported', n(t.transported),
        EV.has(t.patients) && t.patients ? EV.pct(t.transported || 0, t.patients) + '% of all' : '');
      put('Totals', 'Returned to event', n(t.returnedToEvent),
        EV.has(t.patients) && t.patients ? EV.pct(t.returnedToEvent || 0, t.patients) + '% of all' : '');
      if (EV.has(t.paediatric)) put('Totals', 'Paediatric', n(t.paediatric));
    } else {
      /* No analytics module on this device — still give the director numbers. */
      var open = 0, moved = 0, back = 0, i;
      for (i = 0; i < pts.length; i++) {
        if (pts[i].status !== 'closed') open++;
        if (TRANSFER_DISPO.indexOf(pts[i].disposition) !== -1) moved++;
        if (pts[i].disposition === 'return-to-event') back++;
      }
      put('Totals', 'Patients seen', n(pts.length), 'counted from the record');
      put('Totals', 'Still open', n(open));
      put('Totals', 'Transported or referred', n(moved));
      put('Totals', 'Returned to event', n(back));
    }

    if (a && a.los) {
      put('Length of stay', 'Median', mins(a.los.median), 'minutes');
      put('Length of stay', 'p90', mins(a.los.p90), 'minutes');
      if (EV.has(a.los.max)) put('Length of stay', 'Longest', mins(a.los.max), 'minutes');
    } else {
      var los = [];
      for (var j = 0; j < pts.length; j++) {
        var d = safeDerive(pts[j]);
        if (EV.has(d.dwellMs)) los.push(d.dwellMs);
      }
      if (los.length) {
        put('Length of stay', 'Median', mins(EV.median(los)), 'minutes');
        put('Length of stay', 'p90', mins(EV.quantile(los, 0.9)), 'minutes');
      }
    }

    if (a && a.timeliness) {
      put('Timeliness', 'Arrival to triage', mins(a.timeliness.medianTriageDelay), 'median minutes');
      put('Timeliness', 'Door to doctor', mins(a.timeliness.medianDoorToDoctor), 'median minutes');
      put('Timeliness', 'Door to transport', mins(a.timeliness.medianDoorToTransport), 'median minutes');
    }
    if (a && a.beds) {
      put('Capacity', 'Beds occupied', n(a.beds.occupied), 'of ' + (a.beds.total || 0));
      put('Capacity', 'Occupancy', EV.has(a.beds.occupancyPct) ? { v: a.beds.occupancyPct, t: 'n', s: a.beds.occupancyPct >= 90 ? 'bad' : a.beds.occupancyPct >= 75 ? 'warn' : 'ok' } : '', 'percent');
    }
    if (a && a.capacity && EV.has(a.capacity.projectedTotal)) {
      put('Capacity', 'Projected total', n(a.capacity.projectedTotal), 'at this rate');
    }

    function series(section, list, lab, val, detail) {
      for (var i = 0; i < (list || []).length; i++) {
        var x = list[i];
        put(section, lab(x), n(val(x)), detail ? detail(x) : '');
      }
    }
    if (a) {
      series('Acuity', a.acuity, function (x) { return 'P' + x.v + ' ' + (x.l || ''); },
        function (x) { return x.n; });
      series('Disposition', a.disposition, function (x) { return x.l || x.v; },
        function (x) { return x.n; });
      series('Complaint', a.complaints, function (x) { return x.l || x.cat; },
        function (x) { return x.n; });
      series('Arrivals per hour', (a.rate && a.rate.perHour) || [],
        function (x) { return EV.hhmm(x.t); }, function (x) { return x.n; });
      for (var k = 0; k < (a.byPost || []).length; k++) {
        var r = a.byPost[k];
        put('By post', (r.code ? r.code + ' · ' : '') + (r.name || ''), n(r.n),
          'open ' + (r.open || 0) +
          (EV.has(r.medianLos) ? ', median ' + EV.durShort(r.medianLos) : '') +
          (EV.has(r.transferRate) ? ', transfer ' + EV.r(r.transferRate, 0) + '%' : ''));
      }
      for (var q = 0; q < (a.transport || []).length; q++) {
        var tv = a.transport[q];
        put('Ambulances', txt(tv.callsign), n(tv.trips),
          (EV.has(tv.medianTurnaround) ? 'median turnaround ' + EV.durShort(tv.medianTurnaround) : '') +
          ((tv.destinations || []).length ? ' · ' + tv.destinations.map(function (x) {
            return x.d + ' (' + x.n + ')';
          }).join(', ') : ''));
      }
      for (var f = 0; f < (a.redFlags || []).length; f++) {
        var fl = a.redFlags[f];
        rows.push(['Open red flags', txt((fl.mrn ? fl.mrn + ' · ' : '') + (fl.name || '')),
          { v: fl.severity >= 2 ? 'Critical' : 'Watch', t: 's', s: fl.severity >= 2 ? 'bad' : 'warn' },
          wrap(fl.why)]);
      }
    }

    put('Provenance', 'Devices reporting',
      n(EV.store && EV.store.syncState ? EV.store.syncState.devices : undefined),
      'counts are this device’s copy of the record');
    put('Provenance', 'Last sync',
      EV.store && EV.store.syncState && EV.store.syncState.lastPull
        ? dt(EV.store.syncState.lastPull) : '', '');

    return {
      name: 'Analytics',
      head: ['Section', 'Metric', 'Value', 'Detail'],
      cols: [20, 38, 16, 54],
      rows: rows, freeze: 1, autofilter: true
    };
  }

  /* ---- Formulary (par vs used) ------------------------------------------ */

  function sheetFormulary(ctx, idx) {
    var items = arr(ctx.formulary);
    var usage = Object.create(null);
    var pts = arr(ctx.patients), i, j;

    function key(o, item) {
      if (o.itemId) return 'id:' + o.itemId;
      if (item && item.id) return 'id:' + item.id;
      return 'nm:' + EV.norm(o.name);
    }
    for (i = 0; i < pts.length; i++) {
      var os = pts[i].orders || [];
      for (j = 0; j < os.length; j++) {
        var o = os[j];
        var item = idx.formulary[o.itemId];
        var k = key(o, item);
        var u = usage[k];
        if (!u) u = usage[k] = { lines: 0, qty: 0, dose: 0, pts: Object.create(null), name: o.name || (item && item.name) || '' };
        u.lines++;
        var q = EV.num(o.qty);
        if (EV.has(q)) u.qty += q;
        var dv = EV.num(o.dose);
        if (EV.has(dv)) u.dose += dv;
        u.pts[pts[i].id] = 1;
      }
    }

    var rows = [];
    var listed = Object.create(null);
    var sorted = EV.sortBy(items, function (x) { return (x.cat || 'zz') + '|' + (x.sort || 0); });

    for (i = 0; i < sorted.length; i++) {
      var it = sorted[i];
      var u2 = usage['id:' + it.id];
      if (u2) listed['id:' + it.id] = 1;
      var par = EV.num(it.par);
      var used = u2 ? (u2.qty || u2.lines) : 0;
      var pct = EV.has(par) && par > 0 ? EV.r((used / par) * 100, 0) : undefined;
      var nPts = 0;
      if (u2) for (var pk in u2.pts) nPts++;
      rows.push([
        txt(it.name), txt(it.generic), txt(it.kind), txt(it.cat), txt(it.cls),
        txt(it.strength), txt(it.form), txt(it.dose),
        txt((it.routes || []).join('/')), txt(it.defaultRoute), txt(it.unit),
        n(par), n(it.stock),
        u2 ? n(used) : '', u2 ? n(u2.lines) : '', u2 ? n(nPts) : '',
        u2 && EV.has(u2.dose) && u2.dose ? dec(u2.dose) : '',
        EV.has(pct) ? {
          v: pct, t: 'n',
          s: pct >= 100 ? 'bad' : pct >= 80 ? 'warn' : pct > 0 ? 'ok' : 'num'
        } : '',
        EV.has(par) && EV.has(it.stock) ? n(EV.num(it.stock) - used) : '',
        { v: !!it.highAlert, t: 'b' }, { v: !!it.controlled, t: 'b' },
        { v: it.active !== false, t: 'b' }, { v: !!it.custom, t: 'b' },
        wrap(it.notes)
      ]);
    }
    /* Anything given that is not in the catalogue — the ad-hoc lines a medic
       typed at 2 a.m. They must not vanish from the stock reconciliation. */
    for (var uk in usage) {
      if (listed[uk]) continue;
      if (uk.indexOf('id:') === 0 && idx.formulary[uk.slice(3)]) continue;
      var u3 = usage[uk], np = 0;
      for (var pk2 in u3.pts) np++;
      rows.push([txt(u3.name || '(unnamed)'), '', 'ad-hoc', 'other', '', '', '', '',
        '', '', '', '', '', n(u3.qty || u3.lines), n(u3.lines), n(np),
        u3.dose ? dec(u3.dose) : '', '', '',
        { v: false, t: 'b' }, { v: false, t: 'b' }, { v: true, t: 'b' }, { v: true, t: 'b' },
        { v: 'Given but not in the catalogue', t: 's', s: 'warn' }]);
    }

    return {
      name: 'Formulary',
      head: ['Item', 'Generic', 'Kind', 'Category', 'Class', 'Strength', 'Form',
        'Dose', 'Routes', 'Default route', 'Unit', 'Par', 'Stock', 'Used',
        'Lines', 'Patients', 'Total dose', '% of par', 'Remaining',
        'High alert', 'Controlled', 'Active', 'Custom', 'Notes'],
      cols: [26, 22, 11, 13, 16, 13, 13, 13, 18, 13, 7, 7, 8, 8, 8, 10, 11, 10,
        11, 11, 11, 8, 8, 34],
      rows: rows, freeze: 1, autofilter: true
    };
  }

  /* ---- recap ------------------------------------------------------------ */

  X.recap = function (ctx) {
    /* Shallow copy, then coerce. The recap is the last thing that runs at the
       end of a long standby, so it must never be the thing that throws: every
       collection is forced to an array whatever the caller hands over.
       If a caller ever hands over something that is not an array for the
       formulary, fall back to the loaded catalogue rather than silently
       losing the whole stock reconciliation. */
    ctx = Object.assign({}, ctx || {});
    ctx.posts = arr(ctx.posts);
    ctx.beds = arr(ctx.beds);
    ctx.ambulances = arr(ctx.ambulances);
    ctx.patients = arr(ctx.patients);
    if (!Array.isArray(ctx.formulary)) {
      ctx.formulary = arr(EV.formulary && (EV.formulary.items || EV.formulary.DEFAULTS));
    }
    if (ctx.analytics && typeof ctx.analytics.then === 'function') ctx.analytics = null;
    if (ctx.event && typeof ctx.event.then === 'function') ctx.event = null;

    var idx = {
      posts: byId(ctx.posts),
      beds: byId(ctx.beds),
      ambulances: byId(ctx.ambulances),
      patients: byId(ctx.patients),
      formulary: byId(ctx.formulary)
    };
    var ev = ctx.event || {};
    var sheets = [
      sheetPatients(ctx, idx),
      sheetVitals(ctx, idx),
      sheetMeds(ctx, idx),
      sheetSupplies(ctx, idx),
      sheetCppt(ctx, idx),
      sheetTransfers(ctx, idx),
      sheetPostsBeds(ctx, idx),
      sheetAnalytics(ctx),
      sheetFormulary(ctx, idx)
    ];
    return X.build(sheets, {
      title: (ev.name ? ev.name + ' — ' : '') + 'Event EMR recap',
      subject: ctx.app || 'Mini Emergency & Critical Care Event EMR',
      creator: 'Mini Emergency & Critical Care Event EMR ' + (ctx.version || EV.VERSION),
      company: 'Siloam Hospitals',
      when: ctx.generatedAt || EV.now()
    });
  };

  X.recapBlob = function (ctx) { return new Blob([X.recap(ctx)], { type: X.MIME }); };

  /* ======================================================================
     11. selfTest — exercises the real writer, not a mock.
     ====================================================================== */

  X.selfTest = function () {
    var fails = [], pass = 0;

    function show(v) {
      if (v === null) return 'null';
      if (v === undefined) return 'undefined';
      return typeof v === 'object' ? JSON.stringify(v) : String(v);
    }
    function ok(name, got, expected) {
      var g = show(got), e = show(expected);
      if (g === e) pass++;
      else fails.push({ name: name, expected: e, got: g });
    }

    /* ---- CRC-32 against the published vectors ---- */
    ok('crc32 empty', crc32(EV.utf8('')), 0);
    ok('crc32 "a"', crc32(EV.utf8('a')), 0xE8B7BE43);
    ok('crc32 "123456789"', crc32(EV.utf8('123456789')), 0xCBF43926);
    ok('crc32 is unsigned', crc32(EV.utf8('a')) > 0, true);

    /* ---- UTF-8 byte lengths, not string lengths ---- */
    var multi = 'Rizky Nurhaliza – Pos 3 · 38,5 °C';
    var mb = EV.utf8(multi);
    ok('multi-byte string is longer in bytes', mb.length > multi.length, true);

    var zname = 'xl/pos–3.xml';
    var z1 = X.zip([{ name: zname, bytes: multi }]);
    var dv1 = new DataView(z1.buffer, z1.byteOffset, z1.byteLength);
    ok('local header signature', dv1.getUint32(0, true), 0x04034b50);
    ok('UTF-8 flag bit 11 set', dv1.getUint16(6, true) & 0x0800, 0x0800);
    ok('method is STORE', dv1.getUint16(8, true), 0);
    ok('uncompressed size = UTF-8 byte length', dv1.getUint32(22, true), mb.length);
    ok('compressed size = UTF-8 byte length', dv1.getUint32(18, true), mb.length);
    ok('stored crc matches bytes', dv1.getUint32(14, true), crc32(mb));
    ok('name length is byte length', dv1.getUint16(26, true), EV.utf8(zname).length);
    ok('name byte length exceeds char length', EV.utf8(zname).length > zname.length, true);

    /* ---- ZIP structure: every central-directory offset is a local header ---- */
    function walk(bytes) {
      var dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      var eocd = -1, i;
      for (i = bytes.length - 22; i >= 0; i--) {
        if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
      }
      if (eocd < 0) return { eocd: -1 };
      var count = dv.getUint16(eocd + 10, true);
      var cdSize = dv.getUint32(eocd + 12, true);
      var cdAt = dv.getUint32(eocd + 16, true);
      var at = cdAt, bad = 0, names = [], k;
      for (i = 0; i < count; i++) {
        if (dv.getUint32(at, true) !== 0x02014b50) { bad++; break; }
        var fnLen = dv.getUint16(at + 28, true);
        var exLen = dv.getUint16(at + 30, true);
        var cmLen = dv.getUint16(at + 32, true);
        var lo = dv.getUint32(at + 42, true);
        if (lo + 4 > bytes.length || dv.getUint32(lo, true) !== 0x04034b50) bad++;
        var nm = '';
        for (k = 0; k < fnLen; k++) nm += String.fromCharCode(bytes[at + 46 + k]);
        names.push(nm);
        at += 46 + fnLen + exLen + cmLen;
      }
      return {
        eocd: eocd, count: count, bad: bad, names: names,
        cdSizeOk: at - cdAt === cdSize, cdEndsAtEocd: cdAt + cdSize === eocd
      };
    }

    var w1 = walk(z1);
    ok('single-entry EOCD found', w1.eocd >= 0, true);
    ok('single-entry count', w1.count, 1);
    ok('single-entry offsets valid', w1.bad, 0);
    ok('single-entry cd size', w1.cdSizeOk, true);
    ok('single-entry cd abuts EOCD', w1.cdEndsAtEocd, true);

    /* ---- XML escaping and control-character stripping ---- */
    ok('xml escape', xe('a<b&c>"d"e'), 'a&lt;b&amp;c&gt;&quot;d&quot;e');
    ok('xml escape apostrophe', xe("x'y"), 'x&apos;y');
    ok('xml keeps newline and tab', xe('a\nb\tc'), 'a\nb\tc');
    ok('xml strips vertical tab', xe('ab'), 'ab');
    ok('xml keeps en dash', xe('a–b'), 'a–b');
    ok('xml null input', xe(null), '');

    /* ---- sheet names ---- */
    ok('sheet name strips forbidden', X.sheetName('A:B\\C/D?E*F[G]H'), 'ABCDEFGH');
    ok('sheet name caps at 31', X.sheetName('Patients and everything else we recorded today').length, 31);
    ok('sheet name blank fallback', X.sheetName('[]'), 'Sheet');
    var used = Object.create(null);
    ok('sheet name first', X.sheetName('Patients', used), 'Patients');
    ok('sheet name dedupe', X.sheetName('Patients', used), 'Patients~2');
    ok('sheet name dedupe again', X.sheetName('Patients', used), 'Patients~3');

    /* ---- column references ---- */
    ok('colRef 1', colRef(1), 'A');
    ok('colRef 26', colRef(26), 'Z');
    ok('colRef 27', colRef(27), 'AA');
    ok('colRef 52', colRef(52), 'AZ');
    ok('colRef 702', colRef(702), 'ZZ');
    ok('colRef 703', colRef(703), 'AAA');

    /* ---- date serials ----
       Computed, never looked up. Two documented Excel anchors plus the
       day-of-year difference pin 2026-10-24 independently. */
    var s1900 = X.serial(new Date(1900, 0, 1).getTime());
    ok('serial 1900-01-01', s1900, 2);
    ok('serial 2000-01-01 anchor', X.serial(new Date(2000, 0, 1).getTime()), 36526);
    ok('serial 2024-01-01 anchor', X.serial(new Date(2024, 0, 1).getTime()), 45292);
    var s2026 = X.serial(new Date(2026, 9, 24).getTime());
    var s2026Jan = X.serial(new Date(2026, 0, 1).getTime());
    ok('2026-10-24 is day 297 of 2026', s2026 - s2026Jan, 296);
    ok('serial 2026-10-24 (computed)', s2026, 46319);
    ok('serial carries the time of day', EV.r(X.serial(new Date(2026, 9, 24, 12, 0, 0).getTime()) - s2026, 6), 0.5);
    ok('serial of blank', X.serial(''), undefined);
    ok('serial of a Date object', X.serial(new Date(2026, 9, 24)), s2026);

    /* ---- cell typing in real worksheet XML ---- */
    var xml = X.sheetXml({
      name: 'T', head: ['A', 'B', 'C', 'D', 'E', 'F'],
      cols: [10, 10, 10, 10, 10, 10],
      rows: [[42, '', true, { v: new Date(2026, 9, 24), t: 'd' }, 0, { v: '', t: 'n' }],
      [{ v: 'note', t: 's', s: 'wrap' }, -3.5, false, 'plain', null, undefined]]
    }, true);
    ok('number stays a number', xml.indexOf('<v>42</v>') !== -1, true);
    ok('blank string emits no cell', /<c r="B2"/.test(xml), false);
    ok('blank numeric emits no cell', /<c r="F2"/.test(xml), false);
    ok('recorded zero is kept', xml.indexOf('<c r="E2" s="2"><v>0</v></c>') !== -1, true);
    ok('boolean uses t="b"', xml.indexOf('<c r="C2" t="b"><v>1</v></c>') !== -1, true);
    ok('false boolean kept', xml.indexOf('<c r="C3" t="b"><v>0</v></c>') !== -1, true);
    ok('date is a serial with the date style',
      xml.indexOf('<c r="D2" s="' + STYLE.date + '"><v>46319</v></c>') !== -1, true);
    ok('strings are inline', xml.indexOf('t="inlineStr"') !== -1, true);
    ok('no sharedStrings reference', xml.indexOf('t="s"') === -1, true);
    ok('header uses the head style', xml.indexOf('<c r="A1" s="' + STYLE.head + '"') !== -1, true);
    ok('header row is frozen', xml.indexOf('state="frozen"') !== -1, true);
    ok('autofilter spans the used range', xml.indexOf('<autoFilter ref="A1:F3"/>') !== -1, true);
    ok('dimension spans the used range', xml.indexOf('<dimension ref="A1:F3"/>') !== -1, true);
    ok('column widths written', xml.indexOf('<col min="1" max="1" width="10"') !== -1, true);
    ok('wrap style applied', xml.indexOf('<c r="A3" s="' + STYLE.wrap + '"') !== -1, true);
    ok('negative number', xml.indexOf('<v>-3.5</v>') !== -1, true);
    ok('escaped text in XML', X.sheetXml({ head: ['a&b'], rows: [] }, false).indexOf('a&amp;b') !== -1, true);

    /* ---- a whole workbook from a realistic context ---- */
    var t0 = new Date(2026, 9, 24, 7, 14, 0).getTime();
    var ctx = {
      event: {
        _t: 'event', id: 'ev1', name: 'Jakarta Running Festival 2026',
        venue: 'GBK', medicOn: 'dr. Sari', startDate: t0, endDate: t0 + 36e5,
        audience: 12000, pkg: 'Mini ICU', mrnPrefix: 'JRF'
      },
      posts: [{ _t: 'post', id: 'po1', eventId: 'ev1', code: 'P03', name: 'KM 21 – Medical Tent', kind: 'medical-tent', location: 'Jl. Asia Afrika', staff: [{ name: 'Ns. Dewi', role: 'Nurse (Perawat)' }], active: true, sort: 10 }],
      beds: [{ _t: 'bed', id: 'bd1', postId: 'po1', label: 'Brankar 1', kind: 'stretcher', status: 'occupied', patientId: 'pt1', sort: 10 }],
      ambulances: [{ _t: 'ambulance', id: 'am1', eventId: 'ev1', callsign: 'SILOAM-1', plate: 'B 1234 XY', crew: [{ name: 'Budi', role: 'Driver' }], kind: 'als', status: 'transporting', patientId: 'pt1', destination: 'RS Siloam Kebon Jeruk', active: true }],
      formulary: [
        { _t: 'formulary', id: 'vascon', name: 'Vascon', generic: 'Norepinephrine', kind: 'med', cat: 'resus', cls: 'Vasopressor', dose: '4mg/4mL', strength: '4 mg', form: 'Ampoule', routes: ['IV'], defaultRoute: 'IV', unit: 'mg', par: 2, stock: 2, highAlert: true, controlled: false, active: true, sort: 10, notes: '' },
        { _t: 'formulary', id: 'kassa-steril', name: 'Kassa Steril', generic: 'Sterile gauze', kind: 'supply', cat: 'wound', cls: '', dose: '', strength: '', form: 'Sachet', routes: ['TOP'], defaultRoute: 'TOP', unit: 'pcs', par: 50, stock: 50, highAlert: false, controlled: false, active: true, sort: 20, notes: '' }
      ],
      patients: [{
        _t: 'patient', id: 'pt1', eventId: 'ev1', postId: 'po1', bedId: 'bd1',
        mrn: 'JRF-P03-0042', name: 'Rizky Nurhaliza', age: 34, ageUnit: 'y', sex: 'F',
        bib: '10421', nationality: 'Indonesia', phone: '0812', contactName: 'Andi',
        contactPhone: '0813', weight: 56.5,
        arrivalAt: t0, arrivalMode: 'carried', fromLocation: 'KM 21',
        acuity: 2, triageAt: t0 + 120000, triageBy: 'Ns. Dewi',
        chiefComplaint: 'Collapse in heat – core 40.1 °C',
        complaintCat: 'heat', allergies: 'None', homeMeds: '', pmh: '',
        vitals: [{ t: t0 + 180000, hr: 138, sbp: 88, dbp: 54, rr: 28, spo2: 94, temp: 40.1, gcs: 13, pain: 4, by: 'Ns. Dewi', o2: true }],
        exam: '', assessment: 'Exertional heat stroke', icd10: 'T67.0',
        orders: [
          { id: 'o1', t: t0 + 240000, kind: 'med', itemId: 'vascon', name: 'Vascon', dose: 0.08, unit: 'mcg/kg/min', route: 'IV', rate: '5 mL/h', qty: 1, by: 'dr. Sari', note: 'via syringe pump', given: true, givenAt: t0 + 250000 },
          { id: 'o2', t: t0 + 300000, kind: 'supply', itemId: 'kassa-steril', name: 'Kassa Steril', dose: '', unit: 'pcs', route: 'TOP', qty: 4, by: 'Ns. Dewi', note: '', given: true, givenAt: t0 + 300000 },
          { id: 'o3', t: t0 + 360000, kind: 'supply', itemId: '', name: 'Ice slurry bag', dose: '', unit: 'pcs', route: '', qty: 2, by: 'Ns. Dewi', note: 'borrowed from catering', given: true, givenAt: t0 + 360000 }
        ],
        cppt: [{ id: 'c1', t: t0 + 400000, by: 'dr. Sari', role: 'RMO / Doctor', phase: 'post', s: 'Collapsed at KM 21', o: 'Core 40.1 °C, GCS 13', a: 'Exertional heat stroke', p: 'Cold water immersion; transport', locked: true }],
        disposition: 'transport', dispositionAt: t0 + 900000, dispositionBy: 'dr. Sari',
        dispositionNote: 'Cooled to 38.6 °C before departure',
        destination: 'RS Siloam Kebon Jeruk', transportId: 'am1',
        transport: { ambulanceId: 'am1', destination: 'RS Siloam Kebon Jeruk', departAt: t0 + 960000, arriveAt: t0 + 1680000, handoverTo: 'dr. Putra (ED)', escort: 'dr. Sari', note: '' },
        status: 'closed', closedAt: t0 + 1680000, createdAt: t0
      }],
      analytics: {
        totals: { patients: 1, open: 0, transported: 1, returnedToEvent: 0 },
        los: { median: 1680000, p90: 1680000 },
        beds: { occupied: 1, total: 1, occupancyPct: 100 },
        acuity: [{ v: 2, l: 'Emergent', n: 1 }],
        disposition: [{ l: 'Transported by ambulance', n: 1 }],
        complaints: [{ cat: 'heat', l: 'Heat illness', n: 1 }],
        byPost: [{ code: 'P03', name: 'KM 21', n: 1, open: 0, medianLos: 1680000, transferRate: 100 }],
        transport: [{ callsign: 'SILOAM-1', trips: 1, medianTurnaround: 720000, destinations: [{ d: 'RS Siloam Kebon Jeruk', n: 1 }] }],
        timeliness: { medianTriageDelay: 120000, medianDoorToDoctor: 240000, medianDoorToTransport: 960000 },
        rate: { perHour: [{ t: t0, n: 1 }] },
        redFlags: [{ patientId: 'pt1', mrn: 'JRF-P03-0042', name: 'Rizky Nurhaliza', why: 'Core 40.1 °C', severity: 2 }]
      },
      generatedAt: t0 + 2e6, version: EV.VERSION
    };

    var book = X.recap(ctx);
    var w2 = walk(book);
    ok('recap is bytes', book instanceof Uint8Array, true);
    ok('recap EOCD found', w2.eocd >= 0, true);
    ok('recap every cd offset hits a local header', w2.bad, 0);
    ok('recap cd size consistent', w2.cdSizeOk, true);
    ok('recap cd abuts EOCD', w2.cdEndsAtEocd, true);
    ok('recap part count', w2.count, 16);
    ok('recap entry count matches names', w2.count === w2.names.length, true);
    ok('recap has [Content_Types].xml', w2.names.indexOf('[Content_Types].xml'), 0);
    ok('recap has root rels', w2.names.indexOf('_rels/.rels') !== -1, true);
    ok('recap has workbook rels', w2.names.indexOf('xl/_rels/workbook.xml.rels') !== -1, true);
    ok('recap has styles', w2.names.indexOf('xl/styles.xml') !== -1, true);
    ok('recap has core props', w2.names.indexOf('docProps/core.xml') !== -1, true);
    ok('recap has app props', w2.names.indexOf('docProps/app.xml') !== -1, true);
    ok('recap has nine worksheets', w2.names.indexOf('xl/worksheets/sheet9.xml') !== -1, true);
    ok('recap has no tenth worksheet', w2.names.indexOf('xl/worksheets/sheet10.xml'), -1);
    ok('recap has no sharedStrings part', w2.names.indexOf('xl/sharedStrings.xml'), -1);

    /* The workbook part names the nine sheets the spec asks for. */
    var wbNames = ['Patients', 'Vitals', 'Medications', 'Supplies', 'CPPT',
      'Transfers', 'Posts & Beds', 'Analytics', 'Formulary'];
    var wb = workbookXml(wbNames.map(function (s) { return X.sheetName(s); }));
    for (var si = 0; si < wbNames.length; si++) {
      ok('workbook lists ' + wbNames[si],
        wb.indexOf('name="' + xe(wbNames[si]) + '"') !== -1, true);
    }
    ok('ampersand sheet name is escaped', wb.indexOf('Posts &amp; Beds') !== -1, true);

    /* Real content made it into the right sheets. */
    var idx2 = {
      posts: byId(ctx.posts), beds: byId(ctx.beds), ambulances: byId(ctx.ambulances),
      patients: byId(ctx.patients), formulary: byId(ctx.formulary)
    };
    var pS = sheetPatients(ctx, idx2);
    ok('patients sheet has one row', pS.rows.length, 1);
    ok('patients header and first row widths line up', pS.head.length, pS.cols.length);
    ok('patients row width matches header', pS.rows[0].length, pS.head.length);
    var vS = sheetVitals(ctx, idx2);
    ok('vitals sheet has one row', vS.rows.length, 1);
    ok('vitals row width matches header', vS.rows[0].length, vS.head.length);
    var mS = sheetMeds(ctx, idx2);
    ok('medications sheet has one row', mS.rows.length, 1);
    ok('medications row width matches header', mS.rows[0].length, mS.head.length);
    var sS = sheetSupplies(ctx, idx2);
    ok('supplies sheet has two rows', sS.rows.length, 2);
    ok('supplies row width matches header', sS.rows[0].length, sS.head.length);
    var cS = sheetCppt(ctx, idx2);
    ok('cppt sheet has one row', cS.rows.length, 1);
    ok('cppt row width matches header', cS.rows[0].length, cS.head.length);
    var tS = sheetTransfers(ctx, idx2);
    ok('transfers sheet has one row', tS.rows.length, 1);
    ok('transfers row width matches header', tS.rows[0].length, tS.head.length);
    var bS = sheetPostsBeds(ctx, idx2);
    ok('posts & beds has post, bed and ambulance rows', bS.rows.length, 3);
    ok('posts & beds row width matches header', bS.rows[0].length, bS.head.length);
    var aS = sheetAnalytics(ctx);
    ok('analytics sheet has rows', aS.rows.length > 10, true);
    ok('analytics row width matches header', aS.rows[0].length, aS.head.length);
    var fS = sheetFormulary(ctx, idx2);
    ok('formulary lists catalogue plus the ad-hoc line', fS.rows.length, 3);
    ok('formulary row width matches header', fS.rows[0].length, fS.head.length);

    /* Par vs used: 4 of 50 gauze = 8%, and the ad-hoc item is flagged. */
    var gauze = null, adhoc = null;
    for (var fi = 0; fi < fS.rows.length; fi++) {
      if (fS.rows[fi][0] === 'Kassa Steril') gauze = fS.rows[fi];
      if (fS.rows[fi][0] === 'Ice slurry bag') adhoc = fS.rows[fi];
    }
    ok('gauze row found', !!gauze, true);
    ok('gauze used', gauze ? gauze[13].v : null, 4);
    ok('gauze % of par', gauze ? gauze[17].v : null, 8);
    ok('ad-hoc item captured', !!adhoc, true);
    ok('ad-hoc qty', adhoc ? adhoc[13].v : null, 2);

    /* A blank numeric field must not become a zero anywhere. */
    var blankCtx = {
      patients: [{
        _t: 'patient', id: 'pt0', mrn: 'JRF-P03-0001', name: 'Tanpa Data',
        age: '', weight: '', acuity: 0, arrivalAt: t0, vitals: [{ t: t0, hr: '', sbp: '', spo2: '' }],
        orders: [], cppt: [], status: 'active'
      }]
    };
    var bx = X.sheetXml(sheetPatients(blankCtx, {
      posts: {}, beds: {}, ambulances: {}, patients: {}, formulary: {}
    }), true);
    ok('blank age is absent, not zero', /<c r="C2"/.test(bx), false);
    var bv = X.sheetXml(sheetVitals(blankCtx, {
      posts: {}, beds: {}, ambulances: {}, patients: {}, formulary: {}
    }), true);
    ok('blank HR is absent, not zero', /<c r="G2"/.test(bv), false);

    /* A caller that hands over junk — a Promise for the formulary, a string
       where a list belongs — must still get a workbook, not an exception. */
    var junk = null, junkErr = '';
    try {
      junk = walk(X.recap({
        patients: 'not a list', posts: null, beds: undefined,
        ambulances: 7, formulary: Promise.resolve([]), analytics: Promise.resolve({})
      }));
    } catch (e) { junkErr = e.message; }
    ok('junk context does not throw', junkErr, '');
    ok('junk context still valid', junk ? junk.bad : -1, 0);
    ok('junk context still has nine sheets',
      junk ? junk.names.indexOf('xl/worksheets/sheet9.xml') !== -1 : false, true);

    /* An empty context must still produce a readable workbook. */
    var empty = walk(X.recap({}));
    ok('empty recap is valid', empty.bad, 0);
    ok('empty recap still has nine sheets',
      empty.names.indexOf('xl/worksheets/sheet9.xml') !== -1, true);

    return { pass: pass, fail: fails.length, total: pass + fails.length, failures: fails };
  };

})(window.EV = window.EV || {});
