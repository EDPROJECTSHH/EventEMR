# Mini Emergency & Critical Care Event EMR

A field mini-EMR for hospital medical standby at mass-gathering events — concerts,
corporate days, tournaments and runs. It runs the whole encounter: arrival at the tent, treatment on a
bed, progress notes, and handover to the ambulance and the receiving hospital.

Built for the way these events actually go: **ten to twenty posts, borrowed tablets, no
reliable signal, and nobody with a spare hand.** Every write lands on the device first and
syncs when there is a network. Patient PDFs and a live Excel recap are pushed to one
Google Drive folder with no Google login on any field device.

```bash
python3 build/build_dist.py     # src/ -> dist/  (no npm, no bundler, ~0.3 s)
```

| File | Use |
|---|---|
| `dist/index.html` + `dist/app.js` | the Netlify app — this is what the posts open |
| `dist/artifact.html` | one self-contained file, for publishing as an Artifact |
| `dist/data/ref-topics.json` | the clinical reference, cached by the service worker |
| `netlify/functions/` | `sync` (shared live board) and `drive` (PDF + recap upload) |
| `docs/DEPLOY.md` | Netlify + Google service account, start to finish |

---

## How a device joins

The landing page is the only screen that works before a device belongs
somewhere. From it you either **create the event** (admin passcode; name,
venue, and a start and end with both a date and a time) or **join one that is
already running**:

1. **Input EMR data as…** — choose the post. The screen says plainly that this
   is permanent.
2. **Your team** — name everyone and their role: Doctor, Nurse, Paramedic,
   Driver, Physiotherapist, Logistic, or Other with a free-text title. These
   names sign the vitals, orders and notes made on this device.
3. **Launch EMR.**

From then on the device is that post. Every record number, bed and note is
attributed to it, so a tablet that could be re-pointed mid-shift would quietly
misfile records — only a super admin can move it.

**Who can change what.** Every post sees the whole event; knowing another post
is full is the point of the board. Editing is confined to your own post. The
exception is the **Command Center**: a post designated as such in
Settings → Posts & beds (itself passcode-gated), where someone who signs in as
**super admin** can edit any post's records, change the configuration, run the
formulary and conclude the event. Both conditions must hold — the passcode on a
tablet at an ordinary post grants nothing.

## What it does

**The board.** One screen the command post leaves open: open patients and their triage
mix, free beds per post, ambulances, and anybody who needs someone to walk over right now
— pulled to the top regardless of which tent they are in. Red flags fire on SpO₂ < 92,
SBP < 90, GCS < 15, core ≥ 40 °C, NEWS2 ≥ 7, a T1–T2 with no vitals for 15 minutes, and a
paediatric drug given with no weight recorded.

**Three triage levels**, by colour, the way a tent calls them out: **T1 Red —
Immediate**, **T2 Orange — Urgent**, **T3 Green — Non-urgent**. Bed cards sort
by triage, so the sickest patient at a post is always the top-left tile. A post
whose beds are all taken shows **"Bed full, Please Refer to Another Post."** on
every other post's board, with a note when a bed is merely being cleaned.

**Registration in four fields.** Name, triage, complaint, where they came from. Everything
else is filled in once the patient is on a bed. Nothing in the chart has a Save button —
every control commits on change, because a half-finished form nobody saved is the failure
mode that actually happens at an event.

**MRNs that survive being offline.** `JRF-ICU-0007` — event prefix, post code, per-post
sequence. Two posts with no signal cannot collide.

**CPPT progress notes** in S/O/A/P, with one tap to pull the latest vitals into the
Objective field, and a phase marker for on-site, in the ambulance, and at handover.

**Three outcomes, each with the question a clinician would ask anyway.**
*Discharged* confirms, takes the instructions and discharge medication you gave,
and locks the record (still editable for an addendum). *Closer observation at…*
lists the other posts with their live bed occupancy, takes a reason, and moves
the record — closing it here and reopening it there with the whole chart and a
handover note intact; if the destination is full it offers the wheelchair
outside, and the patient appears there as *Wheelchair 1, 2, 3…*, treatable, but
not counted as capacity. *Refer to hospital* takes the ambulance, destination
and handover.

**Messages between posts.** Radio traffic at an event is four questions: have
you got a bed, have you got an ambulance, where is it, can you take this
patient. Each post and each ambulance has a thread, reachable from its card on
the board and from a dock beside **New patient**; unread conversations open
themselves, every bubble carries its time at the bottom right, and a transfer
announces itself to the receiving post automatically.

**Concluding.** Once the scheduled end has passed and every bed is empty, a
super admin sees **Conclude event**: send every record to Drive, then lock the
event read-only on every post. For two hours it can be reopened with the admin
passcode. After that it closes for good and the local copies are deleted —
Drive keeps the record.

**Documents.** Patient record, CPPT, ambulance transport form and post summary, generated
as real PDFs from scratch — no library. The Excel recap is nine sheets (Patients, Vitals,
Medications, Supplies, CPPT, Transfers, Posts & Beds, Analytics, Formulary) with real
numbers and real date serials, so it pivots. Re-uploading overwrites the same Drive file,
so the link you gave the hospital keeps resolving to the current chart.

**Analytics.** Intake rate against the hour, triage mix, transfer versus discharge,
presenting complaint, per-post volume and median stay, medications administered, supplies
against par, ambulance turnaround, and a projection of the final total at the current rate.

---

## The three companion modules

Requirement 8 of the brief: the capabilities of EDGE Calc, EM Companion and Resus
Companion, reachable from small buttons sitting *inside* the fields they belong to. They
never steal the caret — a nurse half-way through typing a name who taps one comes back to
the same cursor position.

| Field | Button | Opens |
|---|---|---|
| Weight / Age | `fx` | weight engine (IBW · AdjBW · LBW · BSA · BMI), paediatric dosing |
| Chief complaint, Assessment | `ref` | the clinical reference, seeded from what is typed |
| Any order row | `Rx` | the formulary, with mL at the real vial strength |
| Dose | `fx` | the infusion calculator for this patient's weight |
| Objective (CPPT) | `↧` | pulls the latest vitals in as a formatted line |
| Patient header | `CODE` | the resuscitation board, bound to this patient |

**Calculators** — 34, chosen for what an event medic actually reaches for, including the
ones a hospital calculator set does not carry: heat illness severity and cooling targets,
exertional heat stroke, exercise-associated hyponatraemia, sweat-rate and fluid deficit
from pre/post-race weight, rhabdomyolysis, WBGT activity guidance. Plus NEWS2, qSOFA,
shock index, GCS, PEWS, HEART, Canadian Syncope, QTc, Wells/PERC, ATLS shock class,
Ottawa ankle/knee, Canadian C-spine, NEXUS, Canadian CT Head, TBSA/Parkland, RSI,
anaphylaxis dosing and maximum local anaesthetic.

**Clinical reference** — 177 topics curated for mass-gathering medicine, Pearls first,
searchable in English and Indonesian (`pingsan` → Syncope, `keseleo` → Ankle Sprain), plus
ten hand-written field cards for what a textbook covers badly at an event: heat exhaustion
versus heat stroke at a glance, exertional hyponatraemia, blisters, an avulsed tooth,
START mass-casualty triage, a hospital referral checklist, return-to-play after a head
knock, and a five-minute kit check.

**Resuscitation** — ACLS/ATLS algorithm walker and a code board: elapsed time, CPR cycle,
adrenaline interval, shock counter with energy escalation, H's and T's, and a one-tap
"write the resuscitation note into the chart" that produces a readable narrative from the
event log.

---

## The formulary is real

`src/js/03-formulary.js` is built from your three standby manifests — the Jakarta Running
Festival Mini ICU kit and the two Intermediate packages — merged and deduped into 110
items. Product names stay as the team says them in the tent (`Kassa Steril`, `Spuit 5cc`,
`Vascon`, `Meylon (Bicnat)`); the English generic drives search, so `norepi` finds Vascon
and `bicnat` finds Meylon.

Every injectable carries a parsed concentration so the app can show **mg and mL at the
strength actually in the box**. Where a manifest was ambiguous the app says so rather than
guessing — `Furosemide 1 mg/cc` is flagged because the standard Indonesian ampoule is
20 mg/2 mL, and `Fentanyl 100mc/2cc` is read as micrograms, because reading it as
milligrams would be a thousand-fold error.

Everything is editable in **Settings → Formulary**, behind the passcode. Shipped items are
deactivated rather than deleted, so the default catalogue can always be restored.

---

## Configuration is locked

Posts, beds, ambulances and the formulary sit behind the passcode **89370** (changeable;
stored only as a hash). Device-local preferences — which post this tablet is, text size,
density — are not locked, because locking those just means a nurse cannot fix her own
screen.

This is a *workflow* lock that stops a volunteer reshaping the bed board mid-event. It is
not authentication. See the security notes in `docs/DEPLOY.md` before handing the URL out.

---

## Layout

```
src/app.css            design tokens and every component; light only, by request
src/shell.html         page shell for both builds
src/js/00-core.js      EV: util, DOM, bus, time, toast, settings
src/js/01-store.js     IndexedDB + outbox + LWW sync client
src/js/02-model.js     record shapes, NEWS2, derived state, red flags, validation
src/js/03-formulary.js the catalogue, from your three manifests
src/js/04-calc.js      the calculators
src/js/05-resus.js     ACLS/ATLS algorithms + the code board
src/js/06-ref.js       clinical reference + field cards
src/js/07-pdf.js       PDF 1.4 writer and the four document templates
src/js/08-xlsx.js      XLSX writer and the nine-sheet recap
src/js/09-analytics.js aggregation + inline-SVG charts
src/js/10-15          the UI: shell, board, chart, settings, modules, analytics
src/js/17-19          landing and join flow, inter-post chat, event conclusion
src/js/20-boot.js      wiring
build/build_dist.py    src -> dist, plus a Chrome-80 syntax check
docs/SPEC.md           the module contract
docs/DEPLOY.md         Netlify + Google Drive
docs/FORMULARY-SOURCE.md  your three manifests, verbatim
```

No npm, no bundler, no runtime dependency on anything but Google Fonts. Target is
Chrome 80 / Safari 14 — the build fails loudly on syntax newer than that, because the
device that matters is the borrowed tablet, not the laptop it was written on.

## Self-tests

Every module exposes `selfTest()`. They run at startup and report in
**Settings → Data & diagnostics**; a failure raises a toast rather than letting a wrong
dose through quietly. There is no Node on the build machine, so they run in the browser.

Current: **974 assertions, all passing** — including byte-level verification that every
PDF xref offset resolves, CRC-32 against known vectors, UTF-8 byte lengths in the ZIP,
Excel date serials, every calculator's golden cases, and that a blank field never scores
as zero.

---

This is a clinical record and a decision aid. It does not replace clinical judgement,
local protocol, or a current drug reference. Doses and reference thresholds must be
checked against the hospital formulary before use; calculators whose source values were
transcribed rather than computed are marked **verify** in the UI.
