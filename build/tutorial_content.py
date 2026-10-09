#!/usr/bin/env python3
"""Compose the Indonesian guide and render it to PDF."""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from make_tutorial_pdf import (Page, build, wrap, width, jpeg_size,
                               PW, PH, M, INK, INK2, INK3, ACCENT, GOLD,
                               WASH, LINE, WARNBG, WARNINK)

SHOTS = os.environ.get('SHOTS_DIR')
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LOGO = os.path.join(ROOT, 'src', 'assets', 'siloam-pdf.jpg')

CW = PW - 2 * M                      # content width
pages, images = [], {}
_n = [0]


def use(fname, key=None):
    key = key or ('I' + str(len(images)))
    images[key] = os.path.join(SHOTS, fname)
    return key


def footer(p, show=True):
    if not show:
        return
    p.line(M, 46, PW - M, 46, LINE, 0.6)
    p.text(M, 32, 'Panduan EMR Event  •  Petugas Pos Medis', 8, INK3)
    s = str(len(pages) + 1)
    p.text(PW - M - width(s, 8, True), 32, s, 8, INK3, True)


def shell(eyebrow, title, lines, tip=None, warn=None):
    p = Page()
    y = PH - M - 6
    p.rect(M, y + 4, 34, 3.2, GOLD)
    y -= 14
    p.text(M, y, eyebrow.upper(), 8.5, GOLD if eyebrow.startswith('LANGKAH') else INK3, True)
    y -= 24
    for ln in wrap(title, 19, CW, True):
        p.text(M, y, ln, 19, ACCENT, True)
        y -= 23
    y -= 2
    for para in lines:
        for ln in wrap(para, 10.6, CW):
            p.text(M, y, ln, 10.6, INK2)
            y -= 14.6
        y -= 4
    box = tip or warn
    if box:
        bg, ink, label = (WARNBG, WARNINK, 'PENTING') if warn else (WASH, ACCENT, 'TIPS')
        bl = wrap(box, 10, CW - 24)
        bh = 20 + len(bl) * 13.6
        y -= 4
        p.rect(M, y - bh + 12, CW, bh, bg)
        yy = y - 2
        p.text(M + 12, yy, label, 8, ink, True)
        yy -= 14
        for ln in bl:
            p.text(M + 12, yy, ln, 10, ink)
            yy -= 13.6
        y = y - bh - 2
    return p, y


def step(eyebrow, title, lines, shot, tip=None, warn=None):
    p, y = shell(eyebrow, title, lines, tip, warn)
    key = use(shot)
    iw, ih = jpeg_size(images[key])
    top = y - 10
    bottom = 62
    h = top - bottom
    w = h * iw / float(ih)
    if w > CW:
        w = CW; h = w * ih / float(iw)
    x = (PW - w) / 2.0
    p.rect(x - 3, top - h - 3, w + 6, h + 6, LINE)
    p.img(key, x, top - h, w, h)
    footer(p)
    pages.append(p)


def textpage(eyebrow, title, blocks):
    p, y = shell(eyebrow, title, [])
    for b in blocks:
        kind, txt = b
        if kind == 'h':
            y -= 6
            p.text(M, y, txt, 12.5, ACCENT, True)
            y -= 18
        elif kind == 'p':
            for ln in wrap(txt, 10.6, CW):
                p.text(M, y, ln, 10.6, INK2); y -= 14.6
            y -= 6
        elif kind == 'b':
            p.text(M + 4, y, '•', 10.6, GOLD, True)
            for i, ln in enumerate(wrap(txt, 10.6, CW - 20)):
                p.text(M + 18, y, ln, 10.6, INK2); y -= 14.6
            y -= 3
    footer(p)
    pages.append(p)


# ---------------------------------------------------------------- cover ----
c = Page()
c.rect(0, PH - 150, PW, 150, ACCENT)
lk = use(os.path.basename(LOGO), 'LOGO')
images['LOGO'] = LOGO
lw, lh = jpeg_size(LOGO)
sw = 132.0
c.rect(M - 6, PH - 118, sw + 12, sw * lh / lw + 12, (1, 1, 1))
c.img('LOGO', M, PH - 112, sw, sw * lh / lw)
c.rect(0, PH - 158, PW, 8, GOLD)
y = PH - 250
c.text(M, y, 'Panduan Penggunaan', 17, INK3)
y -= 42
for ln in wrap('EMR Event Siloam', 38, CW, True):
    c.text(M, y, ln, 38, ACCENT, True); y -= 42
y -= 6
c.rect(M, y, 70, 3.5, GOLD)
y -= 34
for ln in wrap('Untuk petugas pos medis', 17, CW, True):
    c.text(M, y, ln, 17, INK2, True); y -= 22
y -= 12
for ln in wrap('Panduan langkah demi langkah, dari membuka aplikasi sampai pasien '
               'selesai ditangani. Semua gambar diambil dari tampilan di HP.', 11.5, CW):
    c.text(M, y, ln, 11.5, INK3); y -= 16
y -= 26
c.rect(M, y - 6, CW, 1, LINE)
y -= 26
c.text(M, y, 'Alamat aplikasi', 9, INK3, True)
c.text(M, y - 16, 'eventemr.pages.dev', 13, ACCENT, True)
c.text(M + 260, y, 'Versi panduan', 9, INK3, True)
c.text(M + 260, y - 16, '9 Oktober 2026', 13, ACCENT, True)
pages.append(c)

# ------------------------------------------------------------- sebelum ----
textpage('Persiapan', 'Sebelum Anda mulai', [
    ('h', 'Yang perlu disiapkan'),
    ('b', 'HP atau tablet dengan browser (Chrome atau Safari). Tidak perlu memasang aplikasi apa pun.'),
    ('b', 'Alamat aplikasi: eventemr.pages.dev'),
    ('b', 'Kode Pos: 4 angka yang diberikan oleh Command Center. Tanpa kode ini Anda tidak bisa masuk ke pos.'),
    ('h', 'Tiga hal yang perlu Anda tahu'),
    ('b', 'Satu perangkat terkunci pada satu pos selama event berlangsung. Ini supaya catatan tidak pernah tertukar antar pos.'),
    ('b', 'Aplikasi tetap bisa dipakai walaupun sinyal hilang. Data tersimpan di perangkat, lalu terkirim sendiri begitu sinyal kembali.'),
    ('b', 'Semua pos bisa melihat kondisi pos lain, tetapi hanya pos Anda yang bisa Anda isi.'),
    ('h', 'Tanda status di pojok kanan atas'),
    ('b', 'Local only: perangkat belum tersambung ke event. Ini normal saat Anda baru '
          'membuka aplikasi dan belum bergabung.'),
    ('b', 'Synced beserta jamnya: semua data Anda sudah terkirim dan terlihat oleh pos lain.'),
    ('b', 'Angka pending: ada catatan yang menunggu sinyal. Tidak perlu diulang, '
          'akan terkirim sendiri.'),
    ('h', 'Arti warna triase'),
    ('b', 'T1 Merah: mengancam nyawa, tangani sekarang juga.'),
    ('b', 'T2 Oranye: serius, harus ditangani dalam hitungan menit.'),
    ('b', 'T3 Hijau: ringan, aman untuk menunggu.'),
])

# --------------------------------------------------------------- steps ----
step('Langkah 1', 'Buka aplikasi dan pilih event',
     ['Buka eventemr.pages.dev di browser HP Anda. Layar pertama menampilkan '
      'daftar event yang sedang berjalan.',
      'Cari nama event Anda, lalu ketuk tombol Join this event pada kartu event tersebut.'],
     '01-landing.jpg',
     tip='Pastikan nama event sudah benar sebelum melanjutkan. Kalau ada lebih dari satu '
         'event berjalan, tanyakan Command Center event mana yang Anda ikuti.')

step('Langkah 2', 'Pilih pos tempat Anda bertugas',
     ['Pada menu Input EMR data as, pilih pos tempat Anda bertugas, misalnya '
      'P01 Pos Medis Utama.',
      'Semua pasien yang Anda daftarkan akan tercatat atas nama pos ini.'],
     '03-pos-terpilih.jpg',
     warn='Pilihan pos bersifat permanen untuk event ini. Kalau Anda salah pilih, '
          'hanya Command Center yang bisa memindahkannya.')

step('Langkah 3', 'Masukkan Kode Pos',
     ['Masukkan 4 angka Kode Pos yang diberikan Command Center, lalu ketuk Join.',
      'Kode ini memastikan hanya tim yang benar yang bisa mengisi data pos Anda.'],
     '04-kode-pos.jpg',
     tip='Kode ditolak? Minta Command Center membacakan ulang. Setiap pos punya kode '
         'yang berbeda, termasuk tim ambulans.')

step('Langkah 4', 'Tulis nama tim Anda',
     ['Isi nama dan peran petugas yang memakai perangkat ini, lalu ketuk Launch EMR.',
      'Nama ini akan tercantum pada setiap tanda vital, obat, dan catatan yang Anda buat.'],
     '05-tim-anda.jpg',
     tip='Ketuk Add someone kalau ada lebih dari satu petugas di perangkat yang sama.')

step('Langkah 5', 'Kenali papan utama',
     ['Inilah layar kerja Anda sehari-hari. Bagian atas menampilkan ringkasan: jumlah '
      'pasien terbuka, komposisi triase, dan bed yang masih kosong.',
      'Bagian Needs attention now menampilkan pasien yang paling perlu dilihat lebih dulu.'],
     '06-papan-atas.jpg',
     tip='Tombol New patient berwarna gelap di kanan bawah selalu ada di layar, '
         'jadi Anda bisa mendaftarkan pasien kapan saja.')

step('Langkah 6', 'Daftarkan pasien baru',
     ['Ketuk New patient. Isi nama, usia, dan jenis kelamin, lalu pilih triase '
      'T1, T2, atau T3.',
      'Tulis keluhan utama dengan bahasa pasien sendiri. Kategori akan terisi otomatis.',
      'Ketuk Register & open chart untuk langsung membuka rekam pasien.'],
     '08-pasien-baru.jpg',
     tip='Nomor rekam medis dibuat otomatis, misalnya SR26-P01-0003. Anda tidak perlu '
         'menulisnya sendiri.')

step('Langkah 7', 'Catat tanda vital',
     ['Pada rekam pasien, ketuk Vitals lalu Record vitals.',
      'Isi angka yang Anda ukur. Kolom yang tidak diukur boleh dikosongkan, '
      'jangan diisi angka karangan.'],
     '10-input-vital.jpg',
     tip='Skor NEWS2 dihitung otomatis di bawah. Aplikasi juga memberi tahu berapa '
         'parameter yang sudah terisi, misalnya 7 dari 7.')

step('Langkah 8', 'Catat obat, cairan, dan tindakan',
     ['Ketuk Order, lalu pilih jenisnya: Medication, Fluid, Supply, atau Procedure.',
      'Isi nama item, dosis, satuan, dan rute pemberian. Nama Anda terisi otomatis '
      'pada kolom Given by.'],
     '12-order-obat.jpg',
     tip='Tombol Rx membuka daftar obat standar, dan tombol fx membuka kalkulator dosis. '
         'Keduanya ada di dalam kolom isian.')

step('Langkah 9', 'Tulis catatan CPPT',
     ['Ketuk Note untuk menulis catatan perkembangan dengan format SOAP.',
      'Bagian O terisi otomatis dari tanda vital terakhir. Anda tinggal mengisi '
      'A (penilaian) dan P (rencana).',
      'Ketuk Save & sign supaya catatan tertandatangani atas nama Anda.'],
     '13-cppt-soap.jpg',
     tip='CPPT inilah yang dibaca rumah sakit penerima. Tulis minimal satu catatan saat '
         'pasien datang dan satu lagi saat serah terima.')

step('Langkah 10', 'Tentukan hasil akhir pasien',
     ['Gulir ke bagian Outcome, lalu pilih salah satu dari tiga pilihan:',
      'Discharge bila pasien boleh kembali ke event. Closer observation at bila pasien '
      'perlu dipindah ke pos lain untuk observasi. Refer to hospital bila pasien '
      'perlu dirujuk.',
      'Di bawahnya ada bagian Documents untuk mencetak berkas pasien.'],
     '14-outcome-dokumen.jpg',
     warn='Setelah Anda memilih hasil akhir, rekam pasien akan dikunci. Pastikan tanda '
          'vital dan catatan sudah lengkap sebelum menutup.')

step('Langkah 11', 'Merujuk pasien ke rumah sakit',
     ['Ketuk Refer to hospital. Pilih ambulans, tulis rumah sakit tujuan, siapa yang '
      'mengantar, dan kepada siapa pasien diserahterimakan.',
      'Isi Handover note dengan hal yang perlu diketahui tim penerima pada menit pertama.'],
     '15-rujuk-rs.jpg',
     tip='Sebelum berangkat, ketuk Transport form PDF atau Full chart PDF untuk dicetak '
         'atau dikirim ke rumah sakit penerima.')

# ------------------------------------------------------------ features ----
textpage('Fitur', 'Fitur yang membantu pekerjaan Anda', [
    ('p', 'Selain mencatat pasien, EMR ini punya beberapa fitur yang sangat berguna '
          'saat event sedang ramai. Halaman berikutnya menjelaskan satu per satu.'),
    ('h', 'Chat antar pos dan ambulans'),
    ('p', 'Kirim pesan langsung ke pos lain, ke Mini ICU, atau ke tim ambulans tanpa '
          'perlu HT. Jumlah bed kosong pos tujuan terlihat sebelum Anda mengirim pesan.'),
    ('h', 'Pantauan bed setiap pos'),
    ('p', 'Lihat bed mana yang terisi dan siapa pasiennya di seluruh pos, sehingga Anda '
          'tahu ke mana pasien bisa dipindahkan.'),
    ('h', 'Analitik event'),
    ('p', 'Angka ringkas tentang jumlah pasien, lama tinggal, okupansi bed, dan laju '
          'kedatangan per jam. Bisa diunduh sebagai Excel.'),
    ('h', 'Cetak PDF untuk rujukan'),
    ('p', 'Berkas pasien, catatan CPPT, dan formulir transport bisa dicetak menjadi PDF '
          'untuk dibawa bersama pasien ke rumah sakit.'),
])

step('Fitur', 'Chat antar pos dan ambulans',
     ['Ketuk ikon pesan di kanan bawah layar. Pilih pos atau ambulans yang ingin dihubungi.',
      'Jumlah bed kosong tampil di sebelah nama pos, jadi Anda sudah tahu kondisi mereka '
      'sebelum bertanya.',
      'Tersedia juga balasan cepat seperti Do you have a bed free?'],
     '17-chat-antar-pos.jpg',
     tip='Gunakan chat untuk memberi tahu pos tujuan sebelum memindahkan pasien, supaya '
         'mereka sempat menyiapkan bed.')

step('Fitur', 'Memantau bed setiap pos',
     ['Gulir ke bawah pada papan utama sampai bagian Posts & beds.',
      'Setiap pos menampilkan bed-nya: yang terisi menunjukkan nama pasien, yang kosong '
      'ditandai Free.',
      'Pos Anda sendiri diberi tanda YOU.'],
     '07-bed-okupansi.jpg',
     tip='Kalau semua bed di satu pos penuh, akan muncul keterangan bahwa pos tersebut '
         'sudah penuh sehingga pasien perlu diarahkan ke pos lain.')

step('Fitur', 'Analitik event',
     ['Ketuk ikon grafik di bar atas untuk membuka Analytics.',
      'Halaman ini menampilkan total pasien, pasien yang masih terbuka, jumlah yang '
      'dirujuk, median lama tinggal, dan okupansi bed seluruh event.',
      'Ketuk Excel recap untuk mengunduh rekap, atau Print untuk mencetak.'],
     '18-analitik.jpg',
     tip='Bagian Open patients that need a decision membantu memastikan tidak ada pasien '
         'yang terlupakan sebelum event ditutup.')

step('Fitur', 'Daftar dan pencarian pasien',
     ['Ketuk ikon orang di bar atas untuk melihat seluruh pasien.',
      'Gunakan kolom pencarian untuk mencari berdasarkan nama atau nomor rekam medis, '
      'dan saring berdasarkan Open, Closed, atau pos tertentu.'],
     '20-daftar-pasien.jpg',
     tip='Warna di sisi kiri setiap baris menunjukkan triase, sehingga pasien T1 langsung '
         'terlihat dari daftar.')

# ------------------------------------------------------------- penutup ----
textpage('Penutup', 'Hal penting dan solusi cepat', [
    ('h', 'Lima hal yang perlu diingat'),
    ('b', 'Catat tanda vital sesegera mungkin. Skor NEWS2 dan peringatan merah baru '
          'muncul setelah ada tanda vital.'),
    ('b', 'Kolom yang tidak diukur dikosongkan saja. Kosong berarti belum diukur, '
          'bukan berarti normal.'),
    ('b', 'Tulis CPPT saat pasien datang dan saat serah terima. Itulah yang dibaca '
          'rumah sakit penerima.'),
    ('b', 'Beri tahu pos tujuan lewat chat sebelum memindahkan pasien.'),
    ('b', 'Tentukan hasil akhir sebelum pasien pergi, supaya rekam tidak menggantung.'),
    ('h', 'Kalau terjadi masalah'),
    ('b', 'Tidak ada event yang muncul di layar awal: periksa koneksi internet, lalu '
          'muat ulang halaman. Kalau tetap kosong, hubungi Command Center.'),
    ('b', 'Kode Pos ditolak: minta Command Center membacakan ulang kodenya. '
          'Setiap pos punya kode berbeda.'),
    ('b', 'Sinyal hilang saat bekerja: lanjutkan saja. Data tersimpan di perangkat dan '
          'terkirim otomatis saat sinyal kembali. Status di kanan atas menunjukkan kondisinya.'),
    ('b', 'Salah pilih pos: hubungi Command Center. Hanya mereka yang bisa memindahkan '
          'perangkat ke pos lain.'),
    ('h', 'Butuh bantuan saat event'),
    ('p', 'Hubungi Command Center lewat chat di dalam aplikasi. Mereka melihat kondisi '
          'seluruh pos dan dapat membantu mengatur perpindahan pasien.'),
])

only = os.environ.get('ONLY_PAGE')
if only:
    pages = [pages[int(only) - 1]]
out = os.environ.get('OUT_PDF') or os.path.join(ROOT, 'docs', 'Panduan-EMR-Event-Pos-Medis.pdf')
os.makedirs(os.path.dirname(out), exist_ok=True)
size = build(pages, images, out)
print('pages: %d' % len(pages))
print('images: %d' % len(images))
print('written: %s (%d KB)' % (out, size // 1024))
