#!/usr/bin/env python3
"""
Build the Indonesian user guide as a PDF.

There is no PDF library on this machine, so the file is written by hand: a
PDF 1.4 with an xref table of real byte offsets, base-14 Helvetica for text
(WinAnsi) and the screenshots embedded as /DCTDecode JPEG, which is the one
image format a PDF can carry without re-encoding.

Screens were captured at 420x760 — a phone in portrait — because the people
reading this will be holding one.
"""

import io, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)

PW, PH = 595.28, 841.89          # A4 portrait
M = 44.0                          # margin

INK      = (0.059, 0.086, 0.137)
INK2     = (0.212, 0.259, 0.353)
INK3     = (0.396, 0.447, 0.549)
ACCENT   = (0.102, 0.129, 0.396)
GOLD     = (0.961, 0.702, 0.208)
WASH     = (0.925, 0.937, 0.969)
LINE     = (0.820, 0.851, 0.902)
WARNBG   = (0.992, 0.945, 0.851)
WARNINK  = (0.541, 0.361, 0.000)

HELV = {32:278,33:278,34:355,35:556,36:556,37:889,38:667,39:191,40:333,41:333,42:389,
 43:584,44:278,45:333,46:278,47:278,58:278,59:278,60:584,61:584,62:584,63:556,64:1015,
 65:667,66:667,67:722,68:722,69:667,70:611,71:778,72:722,73:278,74:500,75:667,76:556,
 77:833,78:722,79:778,80:667,81:778,82:722,83:667,84:611,85:722,86:667,87:944,88:667,
 89:667,90:611,91:278,92:278,93:278,94:469,95:556,96:333,97:556,98:556,99:500,100:556,
 101:556,102:278,103:556,104:556,105:222,106:222,107:500,108:222,109:833,110:556,111:556,
 112:556,113:556,114:333,115:500,116:278,117:556,118:500,119:722,120:500,121:500,122:500,
 123:334,124:260,125:334,126:584,149:350,151:1000,145:222,146:222,147:333,148:333}
BOLD = {32:278,33:333,34:474,35:556,36:556,37:889,38:722,39:238,40:333,41:333,42:389,
 43:584,44:278,45:333,46:278,47:278,58:333,59:333,60:584,61:584,62:584,63:611,64:975,
 65:722,66:722,67:722,68:722,69:667,70:611,71:778,72:722,73:278,74:556,75:722,76:611,
 77:833,78:722,79:778,80:667,81:778,82:722,83:667,84:611,85:722,86:667,87:944,88:667,
 89:667,90:611,91:333,92:278,93:333,94:584,95:556,96:333,97:556,98:611,99:556,100:611,
 101:556,102:333,103:611,104:611,105:278,106:278,107:556,108:278,109:889,110:611,111:611,
 112:611,113:611,114:389,115:556,116:333,117:611,118:556,119:778,120:556,121:556,122:500,
 123:389,124:280,125:389,126:584,149:350,151:1000,145:278,146:278,147:500,148:500}
for d in (HELV, BOLD):
    for c in range(48, 58):
        d[c] = 556

SPECIAL = {'—': 151, '–': 150, '•': 149, '’': 146, '‘': 145,
           '“': 147, '”': 148, '→': 45, '°': 176, '·': 149}


def enc(s):
    out = []
    for ch in s:
        o = ord(ch)
        if ch in SPECIAL:
            o = SPECIAL[ch]
        elif o > 255:
            o = 63
        out.append(o)
    return bytes(out)


def width(s, size, bold=False):
    t = BOLD if bold else HELV
    return sum(t.get(c, 556) for c in enc(s)) * size / 1000.0


def esc(b):
    return b.replace(b'\\', b'\\\\').replace(b'(', b'\\(').replace(b')', b'\\)')


def wrap(s, size, maxw, bold=False):
    words, lines, cur = s.split(' '), [], ''
    for w in words:
        t = (cur + ' ' + w).strip()
        if width(t, size, bold) <= maxw or not cur:
            cur = t
        else:
            lines.append(cur); cur = w
    if cur:
        lines.append(cur)
    return lines


class Page:
    def __init__(self):
        self.ops = []
        self.imgs = []

    def rect(self, x, y, w, h, col, radius=0):
        r, g, b = col
        self.ops.append(b'%.3f %.3f %.3f rg' % (r, g, b))
        self.ops.append(b'%.2f %.2f %.2f %.2f re f' % (x, y, w, h))

    def line(self, x1, y1, x2, y2, col, lw=0.8):
        r, g, b = col
        self.ops.append(b'%.3f %.3f %.3f RG %.2f w' % (r, g, b, lw))
        self.ops.append(b'%.2f %.2f m %.2f %.2f l S' % (x1, y1, x2, y2))

    def text(self, x, y, s, size, col=INK, bold=False):
        r, g, b = col
        f = b'/F2' if bold else b'/F1'
        self.ops.append(b'BT %s %.2f Tf %.3f %.3f %.3f rg %.2f %.2f Td (%s) Tj ET'
                        % (f, size, r, g, b, x, y, esc(enc(s))))

    def img(self, name, x, y, w, h):
        self.imgs.append(name)
        self.ops.append(b'q %.2f 0 0 %.2f %.2f %.2f cm /%s Do Q' % (w, h, x, y, name.encode()))

    def stream(self):
        return b'\n'.join(self.ops)


def jpeg_size(path):
    d = open(path, 'rb').read()
    i = 2
    while i < len(d):
        if d[i] != 0xFF:
            i += 1; continue
        m = d[i + 1]
        if m in (0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF):
            h = (d[i + 5] << 8) | d[i + 6]
            w = (d[i + 7] << 8) | d[i + 8]
            return w, h
        if m in (0xD8, 0xD9):
            i += 2; continue
        seg = (d[i + 2] << 8) | d[i + 3]
        i += 2 + seg
    raise ValueError('no SOF in ' + path)


def build(pages, images, out_path):
    objs = []                      # list of bytes bodies

    def add(body):
        objs.append(body)
        return len(objs)           # 1-based id

    font1 = add(b'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>')
    font2 = add(b'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>')

    img_ids = {}
    for name, path in images.items():
        w, h = jpeg_size(path)
        data = open(path, 'rb').read()
        body = (b'<< /Type /XObject /Subtype /Image /Width %d /Height %d '
                b'/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode '
                b'/Length %d >>\nstream\n' % (w, h, len(data))) + data + b'\nendstream'
        img_ids[name] = add(body)

    pages_id = len(objs) + 1 + 2 * len(pages) + 1   # placeholder, fixed below
    page_ids, content_ids = [], []
    for p in pages:
        s = p.stream()
        cid = add(b'<< /Length %d >>\nstream\n' % len(s) + s + b'\nendstream')
        content_ids.append(cid)
        res_imgs = b' '.join(b'/%s %d 0 R' % (n.encode(), img_ids[n]) for n in set(p.imgs))
        body = (b'<< /Type /Page /Parent %d 0 R /MediaBox [0 0 %.2f %.2f] '
                b'/Resources << /Font << /F1 %d 0 R /F2 %d 0 R >> /XObject << %s >> >> '
                b'/Contents %d 0 R >>'
                % (0, PW, PH, font1, font2, res_imgs, cid))
        page_ids.append(add(body))

    kids = b' '.join(b'%d 0 R' % i for i in page_ids)
    pages_obj = add(b'<< /Type /Pages /Kids [%s] /Count %d >>' % (kids, len(page_ids)))
    for pid in page_ids:
        objs[pid - 1] = objs[pid - 1].replace(b'/Parent 0 0 R', b'/Parent %d 0 R' % pages_obj)
    cat = add(b'<< /Type /Catalog /Pages %d 0 R >>' % pages_obj)
    info = add(b'<< /Title (Panduan Penggunaan EMR Event - Petugas Pos Medis) '
               b'/Author (Siloam Hospitals) /Producer (Event EMR) >>')

    buf = io.BytesIO()
    buf.write(b'%PDF-1.4\n%\xe2\xe3\xcf\xd3\n')
    offsets = [0] * (len(objs) + 1)
    for i, body in enumerate(objs, start=1):
        offsets[i] = buf.tell()
        buf.write(b'%d 0 obj\n' % i + body + b'\nendobj\n')
    xref = buf.tell()
    buf.write(b'xref\n0 %d\n' % (len(objs) + 1))
    buf.write(b'0000000000 65535 f \n')
    for i in range(1, len(objs) + 1):
        buf.write(b'%010d 00000 n \n' % offsets[i])
    buf.write(b'trailer\n<< /Size %d /Root %d 0 R /Info %d 0 R >>\nstartxref\n%d\n%%%%EOF\n'
              % (len(objs) + 1, cat, info, xref))
    open(out_path, 'wb').write(buf.getvalue())
    return len(buf.getvalue())
