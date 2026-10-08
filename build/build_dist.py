#!/usr/bin/env python3
"""
src/ -> dist/

Two builds from one source, the way the sibling companion projects do it:

  dist/index.html    the Netlify app. app.js and the 2 MB reference are
                     separate files so the browser caches them and the first
                     paint is fast on venue wifi.
  dist/artifact.html one self-contained file, body-only, for publishing as an
                     Artifact. The reference is trimmed and inlined because an
                     Artifact cannot fetch a sibling JSON.

No dependencies. Python 3.8+.
"""

import base64
import io
import json
import os
import re
import shutil
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'src')
DIST = os.path.join(ROOT, 'dist')

# Files are concatenated in filename order; the numeric prefix IS the
# dependency order. 00 defines EV, 16 boots it.
JS_DIR = os.path.join(SRC, 'js')

# Sections kept in the artifact build. Pearls is first because it is the
# highest-yield twenty seconds in any chapter; basics/followup/codes are the
# ones a field medic never opens mid-shift.
ARTIFACT_SECTIONS = ('pearls', 'diagnosis', 'treatment')


def read(path):
    with io.open(path, encoding='utf-8') as f:
        return f.read()


def write(path, text):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with io.open(path, 'w', encoding='utf-8') as f:
        f.write(text)


def b64(path):
    with open(path, 'rb') as f:
        return base64.b64encode(f.read()).decode('ascii')


def jpeg_size(path):
    """Width/height from a baseline JPEG's SOF marker — the PDF writer needs
    the real pixel dimensions to scale the logo."""
    import struct
    d = open(path, 'rb').read()
    i = 2
    while i < len(d) - 9:
        if d[i] != 0xFF:
            i += 1
            continue
        m = d[i + 1]
        if m in (0xC0, 0xC1, 0xC2, 0xC3):
            h, w = struct.unpack('>HH', d[i + 5:i + 9])
            return w, h
        if m == 0xD8 or m == 0xD9 or 0xD0 <= m <= 0xD7:
            i += 2
            continue
        ln = struct.unpack('>H', d[i + 2:i + 4])[0]
        i += 2 + ln
    return 420, 170


def js_sources():
    names = sorted(n for n in os.listdir(JS_DIR) if n.endswith('.js'))
    missing = []
    for n in names:
        p = os.path.join(JS_DIR, n)
        if os.path.getsize(p) < 40:
            missing.append(n)
    return names, missing


def check_forbidden(name, text):
    """The target is Chrome 80 / Safari 14 on borrowed field tablets. These
    constructs parse-fail there and take the whole bundle with them."""
    problems = []
    # Strip strings, template literals, regex-ish and comments before scanning,
    # so a '?.' inside a help string is not reported.
    stripped = re.sub(r'/\*.*?\*/', ' ', text, flags=re.S)
    stripped = re.sub(r'(^|[^:])//[^\n]*', r'\1', stripped)
    stripped = re.sub(r'"(?:[^"\\\n]|\\.)*"', '""', stripped)
    stripped = re.sub(r"'(?:[^'\\\n]|\\.)*'", "''", stripped)
    stripped = re.sub(r'`(?:[^`\\]|\\.)*`', '``', stripped, flags=re.S)

    for pat, label in (
        (r'\?\.', 'optional chaining ?.'),
        (r'\?\?', 'nullish coalescing ??'),
        (r'Object\.fromEntries', 'Object.fromEntries'),
        (r'\.flatMap\(', 'Array.flatMap'),
        (r'\.flat\(', 'Array.flat'),
        (r'\.replaceAll\(', 'String.replaceAll'),
        (r'\bimport\s+[\w{*]', 'ES module import'),
        (r'^\s*export\s', 'ES module export'),
        (r'\bstructuredClone\(', 'structuredClone'),
    ):
        for m in re.finditer(pat, stripped, flags=re.M):
            line = stripped[:m.start()].count('\n') + 1
            problems.append('%s:%d  %s' % (name, line, label))
    return problems


def build():
    t0 = time.time()
    stamp = time.strftime('%Y-%m-%d %H:%M')

    names, empty = js_sources()
    if empty:
        print('  !! empty or stub modules: %s' % ', '.join(empty))

    parts = []
    problems = []
    for n in names:
        text = read(os.path.join(JS_DIR, n))
        problems += check_forbidden(n, text)
        parts.append('/* ===== %s ===== */\n%s' % (n, text))

    if problems:
        print('  !! unsupported syntax for the Chrome 80 target:')
        for p in problems[:40]:
            print('     ' + p)
        if len(problems) > 40:
            print('     ... and %d more' % (len(problems) - 40))

    js = '\n'.join(parts).replace('__BUILD_STAMP__', stamp)

    css = read(os.path.join(SRC, 'app.css'))
    shell = read(os.path.join(SRC, 'shell.html'))

    logo_png = os.path.join(SRC, 'assets', 'siloam.png')
    logo_jpg = os.path.join(SRC, 'assets', 'siloam-pdf.jpg')
    logo_uri = 'data:image/png;base64,' + b64(logo_png)
    jw, jh = jpeg_size(logo_jpg)

    # The logo preamble is prepended to the bundle so both builds carry the
    # same asset with no extra request.
    preamble = (
        '/* Siloam Hospitals mark, embedded. PNG for the UI, baseline JPEG for\n'
        '   /DCTDecode in the PDF writer. */\n'
        'window.EV = window.EV || {};\n'
        'EV.LOGO = %s;\n'
        'EV.LOGO_JPEG = %s;\n'
        'EV.LOGO_JPEG_W = %d; EV.LOGO_JPEG_H = %d;\n'
    ) % (json.dumps(logo_uri), json.dumps(b64(logo_jpg)), jw, jh)

    os.makedirs(DIST, exist_ok=True)

    # ---------------- Netlify build ----------------
    app_js = preamble + js
    write(os.path.join(DIST, 'app.js'), app_js)

    page = shell.replace('/*__CSS__*/', css)
    page = page.replace('<script>/*__JS__*/</script>', '<script src="app.js" defer></script>')
    page = page.replace('__LOGO__', logo_uri)
    write(os.path.join(DIST, 'index.html'), page)

    # the reference, served separately and cached
    ref_src = os.path.join(SRC, 'data', 'ref-topics.json')
    ref = None
    if os.path.exists(ref_src):
        os.makedirs(os.path.join(DIST, 'data'), exist_ok=True)
        shutil.copyfile(ref_src, os.path.join(DIST, 'data', 'ref-topics.json'))
        with io.open(ref_src, encoding='utf-8') as f:
            ref = json.load(f)

    # assets + sw + manifest
    os.makedirs(os.path.join(DIST, 'assets'), exist_ok=True)
    for a in os.listdir(os.path.join(SRC, 'assets')):
        shutil.copyfile(os.path.join(SRC, 'assets', a), os.path.join(DIST, 'assets', a))
    for extra in ('sw.js', 'manifest.webmanifest'):
        p = os.path.join(SRC, extra)
        if os.path.exists(p):
            shutil.copyfile(p, os.path.join(DIST, extra))

    # ---------------- Artifact build ----------------
    # Body-only, everything inlined, reference trimmed to the three sections a
    # medic opens mid-shift.
    inline_ref = ''
    if ref:
        trimmed = {'meta': dict(ref.get('meta', {}), trimmed=list(ARTIFACT_SECTIONS)), 'topics': []}
        for t in ref['topics']:
            s = {k: v for k, v in t.get('s', {}).items() if k in ARTIFACT_SECTIONS}
            trimmed['topics'].append({'id': t['id'], 't': t['t'], 'pg': t.get('pg'), 's': s})
        inline_ref = 'window.__EV_REF__ = %s;\n' % json.dumps(
            trimmed, separators=(',', ':'), ensure_ascii=False)

    body = shell.split('<body>', 1)[1].rsplit('</body>', 1)[0]
    body = body.replace('__LOGO__', logo_uri)
    body = body.replace(
        '<script>/*__JS__*/</script>',
        '<script>\n' + inline_ref + preamble + js + '\n</script>')
    # The artifact build is body-only, so it inherits the host's charset. The
    # claude.ai wrapper supplies UTF-8, but the same file opened straight off
    # disk would be read as Latin-1 and every degree sign, en dash and
    # subscript in the clinical text would arrive as mojibake. A charset meta
    # costs nothing and makes the file correct on its own.
    artifact = (
        '<meta charset="utf-8">\n'
        '<title>Mini Emergency &amp; Critical Care Event EMR</title>\n'
        '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?'
        'family=IBM+Plex+Mono:wght@400;500;600;700&amp;'
        'family=Plus+Jakarta+Sans:wght@400;500;600;700;800&amp;display=swap">\n'
        '<style>\n'
        'html,body{height:100%}\n'
        '#app{position:fixed;inset:0}\n'
        + css +
        '\n</style>\n'
        + body
    )
    write(os.path.join(DIST, 'artifact.html'), artifact)

    def kb(p):
        return '%.0f KB' % (os.path.getsize(p) / 1024.0)

    print('built in %.2fs  (%s)' % (time.time() - t0, stamp))
    print('  dist/app.js        %s   %d modules' % (kb(os.path.join(DIST, 'app.js')), len(names)))
    print('  dist/index.html    %s' % kb(os.path.join(DIST, 'index.html')))
    print('  dist/artifact.html %s' % kb(os.path.join(DIST, 'artifact.html')))
    if ref:
        print('  dist/data/ref-topics.json %s  (%d topics)'
              % (kb(os.path.join(DIST, 'data', 'ref-topics.json')), len(ref['topics'])))
    if problems:
        print('  STATUS: syntax problems above must be fixed')
        return 1
    if empty:
        print('  STATUS: some modules are still stubs')
        return 2
    return 0


if __name__ == '__main__':
    sys.exit(build())
