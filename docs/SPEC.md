# Mini Emergency & Critical Care Event EMR · Build Spec v1

The single contract every module implements. Read this before writing any file in `src/js/`.

## Non-negotiables

- **Vanilla JS. No build tooling, no npm packages, no runtime fetches to third parties.**
  Chrome 80+ / Safari 14+. Written as IIFE modules that hang off one global `EV`.
  `'use strict'` at the top of every file. No ES modules, no `import`/`export`.
- **ES2017-safe syntax**: `const`/`let`, arrow functions, template literals, `async`/`await`,
  destructuring, spread, `Object.assign`, `Array.prototype.includes` are all fine.
  Do **not** use optional chaining `?.`, nullish `??`, `Object.fromEntries`, `Array.flat`,
  `String.replaceAll`, class fields, or top-level await.
- **UI language is English.** Clinical terms, drug names and score names in English.
  Indonesian only where it is a proper noun from the formulary (`Kassa Steril`, `Spuit 3cc`).
- **Offline-first.** Every write lands in IndexedDB first and is usable with no network.
- **Field ergonomics beat completeness.** Large tap targets (min 44px), no modal traps,
  nothing requires more than two taps from the dashboard.

## File order (concatenated in this order by `build/build_dist.py`)

```
00-core.js       EV, util, dom, bus, ids, time, toast
01-store.js      EV.store    IndexedDB + outbox + sync client
02-model.js      EV.model    schema, validation, derived state
03-formulary.js  EV.formulary default catalogue
04-calc.js       EV.calc     calculators
05-resus.js      EV.resus    code board + algorithms
06-ref.js        EV.ref      clinical reference
07-pdf.js        EV.pdf      PDF writer
08-xlsx.js       EV.xlsx     XLSX writer
09-analytics.js  EV.analytics aggregation + SVG charts
10-ui.js         EV.ui       shell, router, shared components
11-ui-dash.js    dashboard
12-ui-patient.js intake / chart / CPPT / transport
13-ui-settings.js settings (passcode, posts, beds, ambulances, formulary, Drive)
14-ui-analytics.js analytics screen
15-boot.js       wiring
```

---

## 1. `EV` core surface (provided by `00-core.js`)

Assume these exist. Do not redefine them.

```js
EV.VERSION          // '1.0.0'
EV.uid(prefix)      // 'pt_k3f9a2b1c' — collision-safe, sortable by creation
EV.now()            // epoch ms
EV.iso(ms)          // '2026-10-24T07:14:03+07:00'  (local offset preserved)
EV.hhmm(ms)         // '07:14'
EV.dmy(ms)          // '24 Oct 2026'
EV.dur(ms)          // '1h 04m'
EV.has(v)           // not null/undefined/'' and not NaN
EV.num(v)           // Number or undefined — blank is NEVER 0
EV.r(v, d)          // round to d decimals
EV.clamp(v, lo, hi)
EV.esc(s)           // HTML-escape
EV.el(tag, attrs, children)  // element factory; attrs.class, attrs.on = {click: fn}
EV.h(html)          // parse HTML string -> DocumentFragment
EV.qs(sel, root)  EV.qsa(sel, root)
EV.on(event, fn)  EV.emit(event, payload)   // app-wide bus
EV.toast(msg, kind)  // kind: 'ok' | 'warn' | 'bad' | undefined
EV.confirm(msg)     // -> Promise<boolean>, non-blocking sheet
EV.deviceId()       // stable per-browser id
EV.settings         // live object, persisted; see §9
EV.save()           // persist EV.settings
```

CSS custom properties available to every module (defined in `src/app.css`):

```
--ground --surface --surface-2 --sunk --line --line-soft
--ink --ink-2 --ink-3 --ink-4
--brand (#1C2E7A Siloam navy)  --brand-ink  --brand-wash
--accent (#F5B335 Siloam amber) --accent-ink --accent-wash
--ok --warn --bad --info  (+ --*-wash)
--a1..--a5  acuity colours (1 red → 5 blue-grey)
--font-ui ("IBM Plex Sans") --font-mono ("IBM Plex Mono") --radius
```

Theme: light default, dark via `@media (prefers-color-scheme: dark)` guarded with
`:root:not([data-theme="light"])`, plus `:root[data-theme="dark"]`.

---

## 2. Data model (owned by `02-model.js`)

Every record carries `id`, `updatedAt` (epoch ms), `rev` (int, incremented on write),
`deviceId` (author of last write), and `_t` (type tag). LWW merge on `updatedAt`, ties
broken by `deviceId` string compare.

```js
Event = { _t:'event', id, name, venue, medicOn, startDate, endDate, audience,
          pkg, organiser, notes, mrnPrefix, active }

Post  = { _t:'post', id, eventId, code, name,
          kind: 'mini-icu'|'medical-tent'|'first-aid'|'roaming'|'command'|'ice-bath',
          location, staff:[{name, role}], active, sort }

Bed   = { _t:'bed', id, postId, label,
          kind: 'resus'|'acute'|'observation'|'ice-bath'|'wheelchair'|'stretcher',
          status: 'free'|'occupied'|'cleaning'|'offline',
          patientId|null, sort }

Ambulance = { _t:'ambulance', id, eventId, callsign, plate, crew:[{name,role}],
              kind:'als'|'bls'|'motor', 
              status:'available'|'dispatched'|'on-scene'|'transporting'|'at-hospital'|'returning'|'oos',
              patientId|null, destination, active }

Patient = {
  _t:'patient', id, eventId, postId, bedId|null, mrn,
  name, age, ageUnit:'y'|'mo', sex:'M'|'F'|'', bib, nationality, phone,
  contactName, contactPhone, weight,
  arrivalAt, arrivalMode:'walk-in'|'wheelchair'|'stretcher'|'carried'|'ambulance'|'referred',
  fromLocation,
  acuity: 1|2|3|4|5, triageAt, triageBy,
  chiefComplaint, complaintCat,          // complaintCat from EV.model.COMPLAINT_CATS
  allergies, homeMeds, pmh,
  vitals:  [{ t, hr, sbp, dbp, rr, spo2, temp, gcs, pain, bgl, weight, by }],
  exam, assessment, icd10,
  orders:  [{ t, kind:'med'|'supply'|'procedure'|'fluid'|'lab'|'imaging',
              itemId, name, dose, unit, route, rate, qty, by, note, given, givenAt }],
  cppt:    [{ t, by, role, phase:'post'|'transport'|'handover', s, o, a, p, locked }],
  disposition: ''|'return-to-event'|'discharge-home'|'refer-hospital'|'transport'|
               'refused'|'dead-on-scene'|'observation',
  dispositionAt, dispositionBy, dispositionNote,
  destination, transportId|null,
  transport: { ambulanceId, destination, departAt, arriveAt, handoverTo, escort, note },
  status: 'active'|'closed',
  closedAt, createdAt, pdfDriveId, pdfSyncedAt
}

FormularyItem = {
  _t:'formulary', id, name, generic, cls,
  kind: 'med'|'supply'|'equipment',
  cat,                       // see EV.formulary.CATS
  dose, strength, form,      // '30mg', 'Ampoule'
  routes: ['IV','IM','PO','INH','SC','PR','TOP','NEB'],
  defaultRoute, unit,        // 'mg' | 'mL' | 'pcs'
  par, stock,                // par level & current stock per post (see §3)
  high Alert: bool, controlled: bool,
  notes, active, sort, custom: bool
}
```

### Derived (`EV.model.derive(patient)`)

```js
{ ageYears, isPaed, lastVitals, map, shockIndex, news2, redFlags:[...],
  dwellMs, los, acuityLabel, dispoLabel, isOpen, mlOfOxygen... }
```

`EV.model.ACUITY = [{v:1,l:'Resuscitation',c:'--a1'}, …{v:5,l:'Non-urgent'}]`

### MRN

`EV.model.mrn(event, post, seq)` → `JRF-P03-0042`
(`event.mrnPrefix` ·  post `code` · zero-padded per-post sequence)

---

## 3. `EV.store` — persistence and sync (owned by `01-store.js`)

```js
await EV.store.open()                       // opens IndexedDB 'event-emr'
await EV.store.put(doc)                     // stamps updatedAt/rev/deviceId, queues outbox, emits 'change'
await EV.store.get(type, id)
await EV.store.all(type, filter)            // filter is a predicate or {field: value}
await EV.store.del(type, id)                // tombstone: {_deleted:true}, still synced
await EV.store.bulk(docs)                   // merge from server, LWW, no outbox
EV.store.syncState                          // {online, lastPull, lastPush, pending, error}
await EV.store.sync()                       // push outbox then pull delta
EV.store.startAutoSync(ms)                  // default 15000, backs off on failure
```

Emits `EV.emit('change', {type, id, doc})` and `EV.emit('sync', syncState)`.

**Wire format** (`POST /api/sync`):
```json
{ "eventId": "...", "deviceId": "...", "since": 0,
  "changes": [ { "_t":"patient", "id":"...", "updatedAt":171.., "rev":3, ... } ] }
```
→ `{ "now": 171.., "changes": [...], "devices": 7 }`

---

## 4. `EV.formulary` (owned by `03-formulary.js`)

```js
EV.formulary.CATS = [{id,l,hue}…]           // 'resus','cardio','analgesia','gi','resp',
                                            // 'allergy','fluid','airway','wound','ortho',
                                            // 'consumable','monitor','equipment','other'
EV.formulary.DEFAULTS                       // Array<FormularyItem> — the shipped catalogue
EV.formulary.load()                         // merges DEFAULTS with user edits from store
EV.formulary.search(q)                      // typo-tolerant, matches name/generic/alias
EV.formulary.byId(id)
EV.formulary.packs                          // {'mini-icu':[ids], 'intermediate':[ids], 'basic':[ids]}
```

Built from the three real standby manifests (`docs/FORMULARY-SOURCE.md`). Items must keep
the Indonesian product names the team actually says (`Kassa Steril`, `Spuit 5cc`, `Vascon`)
and carry the English generic in `generic` for search (`Vascon` → `Norepinephrine`).

---

## 5. `EV.calc` (owned by `04-calc.js`)

Same shape as EDGE Calc so the two stay mentally compatible.

```js
EV.calc.def({ id, n, c, v, t:[aliases], i:[fields], out(v, P){return [rows]}, tests:[], ref })
EV.calc.score({ id, n, c, v, t, i, bands, tests, ref })
EV.calc.list(cat)        EV.calc.byId(id)      EV.calc.search(q)
EV.calc.run(id, inputs, patient) -> { rows, score, risk, flags }
EV.calc.selfTest()       -> { pass, fail, total, failures:[] }
```

Field helpers `EV.calc.N/S/B/YN/H` mirror EDGE Calc's `N/S/B/YN/H`.
`ctx:true` on a field binds it to the open patient's canvas (weight, vitals, age).

**Required set** — the calculators an event medic actually reaches for:

| group | calculators |
|---|---|
| triage/early warning | NEWS2, qSOFA, Shock Index + Age SI, MAP, GCS, Paediatric PEWS |
| heat & exertional | Heat illness severity, Exertional heat stroke cooling target, Exercise-associated hyponatraemia, Rhabdomyolysis risk (CK/urine), Sweat-rate / fluid deficit, WBGT activity guidance |
| cardiac | HEART, Canadian Syncope Risk, QTc, Cardioversion/defib energy, Wells PE, PERC |
| trauma | ATLS shock class, Ottawa ankle/foot/knee, Canadian C-spine, NEXUS, Canadian CT Head, TBSA + Parkland, RTS, compartment ΔP |
| airway/drugs | RSI panel, weight engine (IBW/AdjBW/LBW/BSA/BMI), infusion dose↔mL/h, paediatric resus doses, anaphylaxis adrenaline dosing, max local anaesthetic |
| metabolic | Anion gap + corrections, Holliday-Segar maintenance, dehydration %, hypoglycaemia D40/D10 dosing |
| misc | Tetanus prophylaxis, pain score ladder, Parkland, Szpilman drowning, Hypothermia Swiss stage |

Every calculator carries at least one golden `tests` case. Blank input is never 0.
Drug concentrations default to the Indonesian vial strengths in the formulary.

---

## 6. `EV.resus` (owned by `05-resus.js`)

```js
EV.resus.ALGOS      // tree: id, title, hue, nodes:[{k,h,li:[],next:[{l,to}],log:[],dose:[]}]
EV.resus.code       // code-blue board controller
  .start(patientId) .stop() .state   // {running, t0, cycles, lastEpi, lastRhythm, events:[]}
  .mark(kind, label, meta)           // kind: 'cpr'|'shock'|'drug'|'rhythm'|'rosc'|'airway'|'note'
  .toCppt()                          // -> a CPPT entry object ready for EV.store.put
EV.resus.render(root, ctx)
```

Algorithms required: **Cardiac arrest (shockable / non-shockable)**, **Post-ROSC**,
**Bradycardia**, **Tachycardia (narrow/wide)**, **Anaphylaxis**, **Severe asthma**,
**Exertional heat stroke**, **Hypoglycaemia**, **Seizure / status**, **Opioid overdose**,
**Primary survey (ATLS ABCDE)**, **Massive haemorrhage / TXA**, **Paediatric arrest**,
**Drowning**. Every drug line shows mg **and** mL at formulary concentration, and every
node has a one-tap "log to chart" that writes an order/CPPT line.

---

## 7. `EV.pdf` (owned by `07-pdf.js`)

Pure-JS PDF 1.4 writer. **No libraries.**

```js
const doc = EV.pdf.doc({ size:'A4', margin:36 });
doc.font('H'|'HB'|'HO', size)   // Helvetica / -Bold / -Oblique, WinAnsiEncoding
doc.text(str, x, y, opts)       // opts: {size, font, color, align, width, leading} -> returns y after
doc.wrap(str, x, y, w, opts)    // word-wrapped paragraph -> returns y after
doc.line(x1,y1,x2,y2,opts)  doc.rect(x,y,w,h,opts)  // opts {color, fill, width, dash}
doc.image(name, x, y, w, h)     // registered JPEG, /DCTDecode
doc.table(x, y, cols, rows, opts) // cols:[{w,l,align}] -> returns y after; splits pages
doc.page()                      // new page; runs the registered header/footer
doc.onPage(fn)                  // header/footer callback per page
doc.bytes()                     // Uint8Array
doc.blob()                      // Blob('application/pdf')
doc.dataUri()                   // 'data:application/pdf;base64,...'
EV.pdf.registerJpeg(name, base64, w, h)
EV.pdf.patientRecord(patient, ctx) // -> doc   (the full chart)
EV.pdf.cppt(patient, ctx)          // -> doc   (progress notes / monitoring form)
EV.pdf.transportForm(patient, ctx) // -> doc   (ambulance handover)
EV.pdf.postSummary(post, patients, ctx)
```

Text must be WinAnsi-escaped (`(`, `)`, `\` escaped; non-Latin-1 transliterated, never dropped
silently — fall back to `?` and keep the layout). Must handle a 40-page chart without
quadratic string concatenation.

Header on every page: Siloam logo (registered JPEG `siloam`), the title
**"Mini Emergency & Critical Care Event EMR"**, event name, MRN, page x of y.

## 8. `EV.xlsx` (owned by `08-xlsx.js`)

Pure-JS XLSX (OOXML) writer. **No libraries.** ZIP with stored (method 0) entries + CRC32.

```js
EV.xlsx.build([{ name:'Patients', cols:[{w}], rows:[[cell,…]], freeze:1, autofilter:true }])
  // cell: primitive, or {v, t:'s'|'n'|'d'|'b', s:'head'|'num'|'date'|'wrap'|'bad'|'warn'}
  -> Uint8Array
EV.xlsx.blob(sheets)   EV.xlsx.dataUri(sheets)
EV.xlsx.recap(ctx)     // -> the multi-sheet recap: Patients, Vitals, Medications,
                       //    Supplies, CPPT, Transfers, Posts & Beds, Analytics, Formulary
```

Must open cleanly in Excel, Numbers and Google Sheets. Dates as real serial numbers with a
`numFmt`, not strings. Column widths set. Header row frozen and bold.

## 9. `EV.settings`

```js
{ eventId, postId, deviceLabel, theme:'auto'|'light'|'dark',
  sync:{ enabled, endpoint:'/api/sync', intervalMs },
  drive:{ enabled, endpoint:'/api/drive', folderName, autoUpload, uploadOn:'close'|'edit' },
  ui:{ density:'comfortable'|'compact', fontScale },
  passcodeHash                 // settings lock, default locks to 89370
}
```

**Passcode gate**: bed/post/ambulance configuration and the formulary editor sit behind
`89370`. Store only a hash (`EV.core.fnv` over the digits + a fixed salt), never the digits.
Unlock lasts for the session or 15 minutes idle, whichever is shorter.

## 10. Netlify functions

`netlify/functions/sync.js` and `netlify/functions/drive.js`, CommonJS, **zero npm
dependencies** — Node 18 `fetch`, `crypto`, and `@netlify/blobs` (provided by the platform).

- `sync.js` — per-device blobs, no write contention. Keys:
  `<eventId>/meta/<deviceId>.json` (tiny: `{lastWrite}`) and
  `<eventId>/dev/<deviceId>.json` (`{records:{"<type>:<id>": doc}}`).
  Pull = read meta blobs, fetch only device blobs with `lastWrite > since`, merge LWW,
  return records newer than `since`. Push = merge into the caller's own device blob only.
- `drive.js` — Google **service account**. Sign a JWT with `crypto.createSign('RSA-SHA256')`,
  exchange at `https://oauth2.googleapis.com/token`, then Drive v3 REST with
  `supportsAllDrives=true`. Env: `GOOGLE_SERVICE_ACCOUNT_JSON`, `GDRIVE_FOLDER_ID`.
  Actions: `upload` (multipart create, or update-in-place when `fileId` given — so an edited
  record overwrites its own PDF and keeps the link), `folder` (find-or-create a subfolder),
  `list`, `ping`. Never log the key. Reject requests whose `filename` escapes the folder.

Both return `{ ok:true, ... }` or `{ ok:false, error:'…' }` with a correct status code,
and set `Access-Control-Allow-Origin` only for same-origin + an explicit allowlist.

## 11. Module buttons inside input fields

Every relevant field carries a small inline affordance (28×28, right-aligned inside the
control) that opens the matching module against the field's value:

| field | button | opens |
|---|---|---|
| Weight / Age | `fx` | `EV.calc` weight engine + paediatric dosing |
| Vitals row | `!` | NEWS2 / PEWS / shock index, live |
| Chief complaint | `ref` | `EV.ref` topic search seeded with the complaint |
| Assessment / ICD | `ref` | reference topic + ICD-10 pick |
| Any order row | `Rx` | formulary picker with dose calculator for the patient's weight |
| Patient header | `code` | `EV.resus` code board bound to this patient |
| Pain score | `fx` | analgesia ladder |

The button must never steal focus from the field or lose typed-but-unsaved text.
