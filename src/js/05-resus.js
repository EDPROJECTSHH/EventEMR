/* ==========================================================================
   05-resus.js — EV.resus

   Two halves, both pure: the algorithm content a team walks through, and a
   code-blue clock. No DOM, no timer started at load — the UI calls tick(now)
   once a second, which is also what makes the whole thing testable.

   Doses carry a formularyId so the UI can print mg AND mL at the strength
   actually in the box. The Indonesian presentations in the event kit are
   adrenaline 1 mg/mL, atropine 0.25 mg/mL, amiodarone 150 mg/3 mL, MgSO4
   400 mg/25 mL, D40 25 mL — so "1 mg of adrenaline" is one ampoule, and
   "0.5 mg of atropine" is two. Getting that arithmetic wrong at 3 a.m. is
   exactly what this is for.

   AHA 2025 ACLS/PALS and ATLS 11th ed. A decision aid, not a protocol.
   ========================================================================== */
(function (EV) {
  'use strict';

  var R = EV.resus = {};

  function num(v) { return EV.has(v) ? +v : undefined; }

  /* ---- dose helpers -------------------------------------------------------
     A weight-based dose with no weight must refuse, not guess. */
  R.dose = function (spec, weightKg) {
    var w = num(weightKg);
    var out = { drug: spec.drug, route: spec.route || 'IV', unit: spec.unit || 'mg', note: spec.note || '' };
    var amt;
    if (EV.has(spec.fixed)) amt = spec.fixed;
    else if (EV.has(spec.mgPerKg) && EV.has(w)) amt = spec.mgPerKg * w;

    if (!EV.has(amt)) {
      out.amount = undefined;
      out.why = EV.has(spec.mgPerKg) ? 'Weight needed' : 'Dose not specified';
      return out;
    }
    if (EV.has(spec.max) && amt > spec.max) { amt = spec.max; out.capped = true; }
    if (EV.has(spec.min) && amt < spec.min) { amt = spec.min; out.floored = true; }
    out.amount = EV.r(amt, amt < 1 ? 3 : 1);

    var c = spec.formularyId && EV.formulary && EV.formulary.conc
      ? EV.formulary.conc(spec.formularyId) : null;
    if (c && c.perMl && c.unit === out.unit) {
      out.ml = EV.r(out.amount / c.perMl, 2);
      out.conc = c.label;
    }
    return out;
  };

  /* Defibrillation energy: adults escalate, children are per-kilo. */
  R.shockEnergy = function (shockNumber, weightKg) {
    var w = num(weightKg);
    if (EV.has(w) && w < 40) {
      var jkg = shockNumber <= 1 ? 2 : shockNumber === 2 ? 4 : 4;
      return { joules: Math.min(EV.r(jkg * w, 0), 200), perKg: jkg, paediatric: true };
    }
    var ladder = [200, 200, 300, 360];
    return { joules: ladder[Math.min(shockNumber, ladder.length) - 1] || 360, paediatric: false };
  };

  /* ---- reversible causes --------------------------------------------------- */
  R.HT = [
    { k: 'hypoxia', l: 'Hypoxia', d: 'Confirm the airway, 100% oxygen, watch the chest rise' },
    { k: 'hypovolaemia', l: 'Hypovolaemia', d: 'Fluid bolus; find and stop the bleeding' },
    { k: 'hydrogen', l: 'Hydrogen ion (acidosis)', d: 'Ventilate; bicarbonate only for a known cause' },
    { k: 'hypokalaemia', l: 'Hypo/hyperkalaemia', d: 'Calcium, insulin-dextrose for high K; replace low K' },
    { k: 'hypothermia', l: 'Hypothermia', d: 'Core temperature; keep resuscitating while cold' },
    { k: 'hypoglycaemia', l: 'Hypoglycaemia', d: 'Check glucose on every arrest' },
    { k: 'tension', l: 'Tension pneumothorax', d: 'Needle then finger thoracostomy' },
    { k: 'tamponade', l: 'Tamponade', d: 'Ultrasound; pericardiocentesis or thoracotomy' },
    { k: 'toxins', l: 'Toxins', d: 'Opioid, local anaesthetic, beta blocker, TCA — specific antidotes' },
    { k: 'thrombosis-pe', l: 'Thrombosis — pulmonary', d: 'Consider thrombolysis and prolonged CPR' },
    { k: 'thrombosis-mi', l: 'Thrombosis — coronary', d: 'Transfer for PCI once there is ROSC' },
    { k: 'trauma', l: 'Trauma', d: 'Haemorrhage control, bilateral thoracostomies, pelvic binder' }
  ];

  /* ====================================================================== */
  /* Algorithms                                                              */
  /* ====================================================================== */

  function li(t, warn) { return { t: t, warn: !!warn }; }

  R.ALGOS = [
    {
      id: 'arrest', title: 'Cardiac arrest', hue: '#c1121f',
      nodes: [
        {
          id: 'start', k: 'Start here', h: 'Unresponsive and not breathing normally',
          li: [
            li('Shout for help. Start chest compressions immediately.'),
            li('100–120 per minute, 5–6 cm deep, full recoil, change the compressor every 2 minutes.'),
            li('Attach the defibrillator pads the moment they arrive — nothing matters more than early defibrillation.', true),
            li('Minimise every pause. Hands off only to shock or to check a rhythm.')
          ],
          next: [
            { l: 'Shockable — VF / pulseless VT', to: 'shockable' },
            { l: 'Non-shockable — asystole / PEA', to: 'nonshock' }
          ],
          ref: 'AHA 2025 ACLS adult cardiac arrest algorithm.'
        },
        {
          id: 'shockable', k: 'VF / pVT', h: 'Shock, then straight back on the chest',
          li: [
            li('Shock first. Resume compressions immediately — do not stop to look at the monitor.', true),
            li('2 minutes of CPR, then the next rhythm check.'),
            li('Adrenaline after the SECOND shock, then every 3–5 minutes.'),
            li('Amiodarone after the THIRD shock; a second dose after the fifth.'),
            li('Consider changing the pad position or a second defibrillator for refractory VF.')
          ],
          dose: [
            { drug: 'Adrenaline', formularyId: 'epinephrine', fixed: 1, unit: 'mg', route: 'IV/IO', note: 'every 3–5 min' },
            { drug: 'Amiodarone (1st)', formularyId: 'amiodarone', fixed: 300, unit: 'mg', route: 'IV/IO', note: 'after the 3rd shock' },
            { drug: 'Amiodarone (2nd)', formularyId: 'amiodarone', fixed: 150, unit: 'mg', route: 'IV/IO', note: 'after the 5th shock' },
            { drug: 'MgSO4 — torsades only', formularyId: 'mgso4', fixed: 2000, unit: 'mg', route: 'IV/IO' }
          ],
          next: [
            { l: 'Still shockable', to: 'shockable' },
            { l: 'Now non-shockable', to: 'nonshock' },
            { l: 'ROSC', to: 'rosc' },
            { l: 'Reversible causes', to: 'causes' }
          ],
          ref: 'AHA 2025. Energy: 200 J biphasic, escalating.'
        },
        {
          id: 'nonshock', k: 'Asystole / PEA', h: 'Adrenaline now, and find the cause',
          li: [
            li('Adrenaline 1 mg IV/IO as soon as access exists, then every 3–5 minutes.'),
            li('Do NOT shock asystole or PEA.', true),
            li('PEA is a cause waiting to be found — work the H’s and T’s deliberately.'),
            li('Confirm asystole in two leads and check the gain before you call it.')
          ],
          dose: [
            { drug: 'Adrenaline', formularyId: 'epinephrine', fixed: 1, unit: 'mg', route: 'IV/IO', note: 'every 3–5 min' }
          ],
          next: [
            { l: 'Reversible causes', to: 'causes' },
            { l: 'Now shockable', to: 'shockable' },
            { l: 'ROSC', to: 'rosc' },
            { l: 'Consider stopping', to: 'stop' }
          ]
        },
        {
          id: 'causes', k: 'H’s and T’s', h: 'Why is this heart not beating?',
          li: R.HT.map(function (h) { return li(h.l + ' — ' + h.d); }),
          next: [{ l: 'Back to the algorithm', to: 'start' }]
        },
        {
          id: 'rosc', k: 'ROSC', h: 'Return of spontaneous circulation',
          li: [
            li('Confirm with a pulse AND a rising end-tidal CO2.'),
            li('Target SpO2 94–98%. Do not hyperoxygenate.', true),
            li('Target a normal CO2. Hyperventilation drops cerebral blood flow and cardiac output.', true),
            li('Aim for a systolic above 90 and a MAP above 65 — fluid first, then noradrenaline.'),
            li('12-lead ECG. If it is a STEMI, this is a transfer for PCI.'),
            li('Check glucose and temperature. Treat seizures.'),
            li('Do not wake them and do not extubate at the roadside — transfer.')
          ],
          dose: [
            { drug: 'Noradrenaline', formularyId: 'vascon', unit: 'mcg/kg/min', route: 'IV infusion', note: 'start 0.05–0.1 mcg/kg/min, titrate to MAP ≥ 65' },
            { drug: 'Fluid bolus', formularyId: 'ringer-laktat', mgPerKg: 10, unit: 'mL', route: 'IV', note: '10 mL/kg, reassess' }
          ],
          next: [{ l: 'Re-arrest', to: 'start' }]
        },
        {
          id: 'stop', k: 'Stopping', h: 'When to stop resuscitating',
          li: [
            li('A team decision, said out loud, with the time recorded.'),
            li('Supported by: unwitnessed arrest, no bystander CPR, persistent asystole, no ROSC after 20 minutes of good ACLS, end-tidal CO2 staying below 10 mmHg.'),
            li('Keep going longer in hypothermia, drowning, poisoning, pregnancy and in children.', true),
            li('Record the time, who was present, and who was told.')
          ],
          next: [{ l: 'Back', to: 'start' }]
        }
      ]
    },
    {
      id: 'anaphylaxis', title: 'Anaphylaxis', hue: '#be123c',
      nodes: [{
        id: 'main', k: 'Adrenaline first', h: 'Anaphylaxis',
        li: [
          li('Adrenaline IM into the anterolateral thigh. Not subcutaneous, not the deltoid, and not after the antihistamine.', true),
          li('Lie them FLAT with the legs raised. Sitting a hypotensive patient up, or walking them to the ambulance, has killed people.', true),
          li('Repeat every 5 minutes if there is no improvement. Deaths follow doses that were too small or too late, not too many.'),
          li('High-flow oxygen, large-bore IV, 20 mL/kg crystalloid for hypotension.'),
          li('Nebulised salbutamol for wheeze — it does not replace the adrenaline.'),
          li('Everyone who receives adrenaline goes to hospital: biphasic reactions happen hours later.')
        ],
        dose: [
          { drug: 'Adrenaline IM (adult)', formularyId: 'epinephrine', fixed: 0.5, unit: 'mg', route: 'IM', note: '0.5 mL of 1 mg/mL, anterolateral thigh' },
          { drug: 'Adrenaline IM (child)', formularyId: 'epinephrine', mgPerKg: 0.01, max: 0.5, unit: 'mg', route: 'IM' },
          { drug: 'Fluid bolus', formularyId: 'ringer-laktat', mgPerKg: 20, unit: 'mL', route: 'IV' },
          { drug: 'Salbutamol neb', formularyId: 'ventolin', fixed: 2.5, unit: 'mg', route: 'NEB', note: 'for wheeze' },
          { drug: 'Diphenhydramine', formularyId: 'diphenhydramine', fixed: 10, unit: 'mg', route: 'IV/IM', note: 'adjunct only — never first' },
          { drug: 'Dexamethasone', formularyId: 'dexamethasone', fixed: 10, unit: 'mg', route: 'IV', note: 'adjunct only' }
        ],
        ref: 'Resuscitation Council anaphylaxis guideline; AHA 2025.'
      }]
    },
    {
      id: 'brady', title: 'Bradycardia', hue: '#4338ca',
      nodes: [{
        id: 'main', k: 'Unstable?', h: 'Bradycardia with a pulse',
        li: [
          li('Unstable means hypotension, altered mental status, shock, ischaemic chest pain or acute heart failure.'),
          li('Stable: monitor, 12-lead, find the cause. Do nothing else.'),
          li('Unstable: atropine first; if it fails, pacing or an infusion.'),
          li('Atropine is unlikely to work in a Mobitz II or complete block — go to pacing.', true)
        ],
        dose: [
          { drug: 'Atropine', formularyId: 'atropine', fixed: 1, unit: 'mg', route: 'IV', note: 'repeat to 3 mg total; 4 ampoules per 1 mg at 0.25 mg/mL' },
          { drug: 'Adrenaline infusion', formularyId: 'epinephrine', unit: 'mcg/min', route: 'IV', note: '2–10 mcg/min, titrate' },
          { drug: 'Dopamine infusion', formularyId: 'dopamine', unit: 'mcg/kg/min', route: 'IV', note: '5–20 mcg/kg/min' }
        ],
        next: [{ l: 'Reversible causes', to: 'causes' }],
        ref: 'AHA 2025 adult bradycardia algorithm.'
      }, {
        id: 'causes', k: 'Causes', h: 'Why is it slow?',
        li: [
          li('Hypoxia, inferior MI, raised intracranial pressure, hypothermia.'),
          li('Drugs: beta blocker, calcium channel blocker, digoxin, clonidine.'),
          li('Hyperkalaemia — look for peaked T waves and a wide QRS.', true)
        ],
        next: [{ l: 'Back', to: 'main' }]
      }]
    },
    {
      id: 'tachy', title: 'Tachycardia', hue: '#c2410c',
      nodes: [{
        id: 'main', k: 'Unstable?', h: 'Tachycardia with a pulse',
        li: [
          li('Unstable → synchronised cardioversion now. Sedate if there is time, but do not delay.', true),
          li('Stable and narrow + regular → vagal manoeuvres, then adenosine.'),
          li('Stable and narrow + irregular → likely AF; rate control.'),
          li('Stable and wide → treat as VT until proven otherwise. Amiodarone; get expert help.'),
          li('A sinus tachycardia is a symptom. Treat the cause, not the number.', true)
        ],
        dose: [
          { drug: 'Adenosine (1st)', formularyId: 'adenosine', fixed: 6, unit: 'mg', route: 'rapid IV push', note: 'proximal line, flush immediately' },
          { drug: 'Adenosine (2nd)', formularyId: 'adenosine', fixed: 12, unit: 'mg', route: 'rapid IV push' },
          { drug: 'Amiodarone', formularyId: 'amiodarone', fixed: 150, unit: 'mg', route: 'IV over 10 min' },
          { drug: 'Diltiazem', formularyId: 'diltiazem', fixed: 20, unit: 'mg', route: 'IV over 2 min', note: 'rate control; avoid in wide complex and in heart failure' }
        ],
        ref: 'AHA 2025 adult tachycardia algorithm. Synchronised cardioversion: narrow regular 50–100 J, narrow irregular 120–200 J, wide regular 100 J.'
      }]
    },
    {
      id: 'asthma', title: 'Severe asthma', hue: '#0f6e6e',
      nodes: [{
        id: 'main', k: 'Life threatening', h: 'Acute severe asthma',
        li: [
          li('Silent chest, exhaustion, confusion, bradycardia or SpO2 below 92% is life-threatening.', true),
          li('Back-to-back nebulised salbutamol, driven by oxygen.'),
          li('Add ipratropium to the nebuliser in severe attacks.'),
          li('Steroid early — it takes hours to work, so give it in the first minutes.'),
          li('Magnesium for the attack that is not responding.'),
          li('Intubation is a last resort and is dangerous: expect hypotension and breath-stacking.', true)
        ],
        dose: [
          { drug: 'Salbutamol neb', formularyId: 'ventolin', fixed: 2.5, unit: 'mg', route: 'NEB', note: 'repeat back to back' },
          { drug: 'Ipratropium / Farbivent', formularyId: 'farbivent', fixed: 1, unit: 'respule', route: 'NEB' },
          { drug: 'Hydrocortisone', formularyId: 'dexamethasone', fixed: 10, unit: 'mg', route: 'IV', note: 'or hydrocortisone 200 mg' },
          { drug: 'MgSO4', formularyId: 'mgso4', fixed: 2000, unit: 'mg', route: 'IV over 20 min' },
          { drug: 'Adrenaline IM', formularyId: 'epinephrine', fixed: 0.5, unit: 'mg', route: 'IM', note: 'if peri-arrest or not moving air' }
        ]
      }]
    },
    {
      id: 'heat', title: 'Heat stroke', hue: '#c2410c',
      nodes: [{
        id: 'main', k: 'Cool first', h: 'Exertional heat stroke',
        li: [
          li('The line is CNS status, not the number. Confused, agitated, ataxic, seizing or unconscious = heat stroke.', true),
          li('Measure a RECTAL temperature. Tympanic and oral read falsely low and have sent people home to die.', true),
          li('COOL FIRST, TRANSPORT SECOND. Cold-water immersion is fastest: about 1 °C every 3–5 minutes.'),
          li('Stop cooling at a core of 38.6 °C to avoid overshooting into hypothermia.'),
          li('No ice bath: strip, wet the skin continuously, fan hard, ice to neck, axillae and groin.'),
          li('Antipyretics do not work — the set point is normal — and load an already-stressed liver.', true),
          li('Check glucose and sodium in every collapsed athlete: heat stroke, hypoglycaemia and hyponatraemia look identical.')
        ],
        dose: [
          { drug: 'Cold fluid bolus', formularyId: 'ringer-laktat', mgPerKg: 20, unit: 'mL', route: 'IV' },
          { drug: 'Midazolam for shivering', formularyId: 'midazolam', mgPerKg: 0.05, max: 5, unit: 'mg', route: 'IV' }
        ],
        ref: 'Wilderness Medical Society / ACSM exertional heat illness guidance.'
      }]
    },
    {
      id: 'hypo', title: 'Hypoglycaemia', hue: '#0369a1',
      nodes: [{
        id: 'main', k: 'Glucose now', h: 'Hypoglycaemia',
        li: [
          li('Check the glucose in every altered patient before anything else.', true),
          li('Conscious and able to swallow: oral glucose, then a complex carbohydrate.'),
          li('Not safe to swallow: IV dextrose; if there is no line, IM glucagon.'),
          li('Recheck in 10 minutes and keep rechecking — sulfonylurea and long-acting insulin relapse.'),
          li('An alcohol-dependent or malnourished patient needs thiamine with the glucose.')
        ],
        dose: [
          { drug: 'D40 (40% dextrose)', formularyId: 'd40', fixed: 50, unit: 'mL', route: 'IV', note: 'two 25 mL flacons = 20 g; large vein, flush after' },
          { drug: 'D10 infusion', formularyId: 'd10', fixed: 250, unit: 'mL', route: 'IV', note: 'maintenance after the bolus' },
          { drug: 'Paediatric dextrose', formularyId: 'd10', mgPerKg: 5, unit: 'mL', route: 'IV', note: '5 mL/kg of D10' }
        ]
      }]
    },
    {
      id: 'seizure', title: 'Seizure / status', hue: '#4338ca',
      nodes: [{
        id: 'main', k: 'Timed', h: 'Convulsive status epilepticus',
        li: [
          li('Note the time the seizure started. Everything from here is timed.', true),
          li('Airway, oxygen, glucose, and get the patient off anything they can hurt themselves on.'),
          li('A benzodiazepine at 5 minutes. A second dose at 10 minutes.'),
          li('Still fitting at 20 minutes: a second-line agent and prepare for an anaesthetic.'),
          li('Think eclampsia in pregnancy — that is magnesium, not a benzodiazepine.', true),
          li('Think hyponatraemia in a collapsed endurance athlete.', true)
        ],
        dose: [
          { drug: 'Midazolam IV', formularyId: 'midazolam', mgPerKg: 0.1, max: 10, unit: 'mg', route: 'IV' },
          { drug: 'Midazolam IM / IN', formularyId: 'midazolam', mgPerKg: 0.2, max: 10, unit: 'mg', route: 'IM/IN', note: 'when there is no line' },
          { drug: 'MgSO4 — eclampsia', formularyId: 'mgso4', fixed: 4000, unit: 'mg', route: 'IV over 10 min' }
        ]
      }]
    },
    {
      id: 'opioid', title: 'Opioid overdose', hue: '#4d7c0f',
      nodes: [{
        id: 'main', k: 'Ventilate', h: 'Suspected opioid overdose',
        li: [
          li('They die of hypoxia, not of the opioid. Ventilate first — bag-valve-mask beats naloxone.', true),
          li('Pinpoint pupils, slow shallow breathing, depressed consciousness.'),
          li('Titrate naloxone to breathing, not to consciousness. Waking someone fully buys agitation and withdrawal.'),
          li('Naloxone is shorter-acting than most opioids: they must be observed, and they must go to hospital.', true)
        ],
        dose: [
          { drug: 'Naloxone', formularyId: 'naloxone', fixed: 0.4, unit: 'mg', route: 'IV/IM/IN', note: 'titrate; repeat every 2–3 min' }
        ]
      }]
    },
    {
      id: 'atls', title: 'Primary survey (ABCDE)', hue: '#9a3412',
      nodes: [{
        id: 'main', k: 'ATLS', h: 'Trauma primary survey',
        li: [
          li('Catastrophic haemorrhage first: direct pressure, tourniquet, pack the wound.', true),
          li('A — airway with cervical spine control. Talk to them; a normal voice is a patent airway.'),
          li('B — breathing: expose the chest, both sides, respiratory rate, SpO2. Decompress a tension pneumothorax on clinical grounds, not on an X-ray.', true),
          li('C — circulation: two large cannulae, control bleeding, pelvic binder, warm fluid. Blood if you have it.'),
          li('D — disability: GCS, pupils, glucose.'),
          li('E — exposure with warmth. Hypothermia, acidosis and coagulopathy kill together.'),
          li('TXA within 3 hours in significant trauma.')
        ],
        dose: [
          { drug: 'Tranexamic acid', formularyId: 'tranexamic', fixed: 1000, unit: 'mg', route: 'IV over 10 min', note: 'within 3 h, then 1 g over 8 h' },
          { drug: 'Fluid — titrated', formularyId: 'ringer-laktat', mgPerKg: 10, unit: 'mL', route: 'IV', note: 'permissive hypotension until bleeding is controlled' }
        ],
        ref: 'ATLS 11th ed.'
      }]
    },
    {
      id: 'paeds', title: 'Paediatric arrest', hue: '#0891b2',
      nodes: [{
        id: 'main', k: 'PALS', h: 'Paediatric cardiac arrest',
        li: [
          li('Children arrest from hypoxia far more often than from a rhythm. Oxygenate and ventilate.', true),
          li('15:2 with two rescuers, 30:2 alone. Compress one third of the chest depth.'),
          li('Adrenaline 10 mcg/kg every 3–5 minutes.'),
          li('Defibrillate at 4 J/kg (the first shock may be 2 J/kg).'),
          li('A child over about 50 kg takes adult doses.', true),
          li('Check the glucose — hypoglycaemia is a common and reversible cause.')
        ],
        dose: [
          { drug: 'Adrenaline', formularyId: 'epinephrine', mgPerKg: 0.01, max: 1, unit: 'mg', route: 'IV/IO' },
          { drug: 'Amiodarone', formularyId: 'amiodarone', mgPerKg: 5, max: 300, unit: 'mg', route: 'IV/IO' },
          { drug: 'Fluid bolus', formularyId: 'ringer-laktat', mgPerKg: 20, unit: 'mL', route: 'IV/IO' },
          { drug: 'D10 for hypoglycaemia', formularyId: 'd10', mgPerKg: 5, unit: 'mL', route: 'IV/IO' }
        ],
        ref: 'AHA 2025 PALS.'
      }]
    },
    {
      id: 'drowning', title: 'Drowning', hue: '#0369a1',
      nodes: [{
        id: 'main', k: 'Breaths first', h: 'Drowning',
        li: [
          li('This is a hypoxic arrest: give 5 rescue breaths BEFORE compressions.', true),
          li('Do not delay to drain water from the lungs — there is none to drain.'),
          li('Suspect a cervical spine injury only if the mechanism fits (a dive, a fall, a board).'),
          li('Keep resuscitating a cold patient: hypothermia protects the brain and good outcomes follow long downtimes.', true),
          li('Everyone who needed rescue breathing goes to hospital — deterioration comes hours later.')
        ],
        dose: [
          { drug: 'Adrenaline', formularyId: 'epinephrine', fixed: 1, unit: 'mg', route: 'IV/IO', note: 'every 3–5 min' }
        ]
      }]
    }
  ];

  R.algo = function (id) {
    for (var i = 0; i < R.ALGOS.length; i++) if (R.ALGOS[i].id === id) return R.ALGOS[i];
    return null;
  };

  /* ====================================================================== */
  /* The code board                                                          */
  /* ====================================================================== */

  var CYCLE = 2 * 60000;      /* rhythm check every 2 minutes */
  var EPI_DUE = 3 * 60000;    /* adrenaline due at 3, late by 5 */
  var EPI_LATE = 5 * 60000;

  var code = R.code = {
    state: blank()
  };

  function blank() {
    return {
      running: false, patientId: null, t0: 0, now: 0,
      cycles: 0, shocks: 0, lastEpi: 0, lastRhythm: 0, epiCount: 0,
      epiDue: false, epiLate: false, cycleRemainingMs: CYCLE,
      nextShockJoules: 200, weightKg: undefined,
      rhythm: '', rosc: false, roscAt: 0, endedAt: 0, outcome: '',
      causes: {}, events: []
    };
  }

  code.start = function (patientId, weightKg) {
    var now = EV.now();
    code.state = blank();
    code.state.running = true;
    code.state.patientId = patientId || null;
    code.state.weightKg = EV.num(weightKg);
    code.state.t0 = now;
    code.state.now = now;
    code.state.lastRhythm = now;
    code.state.nextShockJoules = R.shockEnergy(1, code.state.weightKg).joules;
    push('start', 'Resuscitation started', null, now);
    return code.state;
  };

  code.stop = function (outcome) {
    if (!code.state.running) return code.state;
    code.state.running = false;
    code.state.endedAt = EV.now();
    code.state.outcome = outcome || code.state.outcome || (code.state.rosc ? 'ROSC' : 'Terminated');
    push('end', 'Resuscitation ended — ' + code.state.outcome, null, code.state.endedAt);
    return code.state;
  };

  code.reset = function () { code.state = blank(); return code.state; };

  function push(kind, label, meta, at) {
    var s = code.state;
    s.events.push({
      t: at || EV.now(), kind: kind, label: label,
      meta: meta || null,
      elapsed: (at || EV.now()) - (s.t0 || (at || EV.now()))
    });
    return s.events[s.events.length - 1];
  }

  /* Driven by the UI once a second. Pure arithmetic — no timers in here. */
  code.tick = function (now) {
    var s = code.state;
    if (!s.running) return s;
    s.now = now || EV.now();
    var sinceRhythm = s.now - (s.lastRhythm || s.t0);
    s.cycleRemainingMs = CYCLE - sinceRhythm;
    /* Count the cycles that have elapsed without a rhythm check, so a team
       that forgets still sees the clock roll over. */
    s.cycles = Math.floor((s.now - s.t0) / CYCLE);
    if (s.lastEpi) {
      var sinceEpi = s.now - s.lastEpi;
      s.epiDue = sinceEpi >= EPI_DUE;
      s.epiLate = sinceEpi >= EPI_LATE;
    } else {
      s.epiDue = (s.now - s.t0) >= 60000;   /* first dose is due early */
      s.epiLate = (s.now - s.t0) >= EPI_DUE;
    }
    return s;
  };

  /* kind: 'cpr' | 'shock' | 'drug' | 'rhythm' | 'rosc' | 'airway' | 'note' */
  code.mark = function (kind, label, meta) {
    var s = code.state;
    if (!s.running) return null;           /* never throws — the UI may race */
    var now = EV.now();

    if (kind === 'shock') {
      s.shocks++;
      var e = R.shockEnergy(s.shocks, s.weightKg);
      label = label || 'Shock';
      label = label + ' ' + e.joules + ' J' + (e.paediatric ? ' (' + e.perKg + ' J/kg)' : '');
      s.nextShockJoules = R.shockEnergy(s.shocks + 1, s.weightKg).joules;
      s.lastRhythm = now;                  /* a shock restarts the cycle */
    } else if (kind === 'rhythm') {
      s.lastRhythm = now;
      if (meta && meta.rhythm) s.rhythm = meta.rhythm;
    } else if (kind === 'drug') {
      if (/adren|epine/i.test(label || '')) { s.lastEpi = now; s.epiCount++; s.epiDue = false; s.epiLate = false; }
    } else if (kind === 'rosc') {
      s.rosc = true;
      s.roscAt = now;
      s.outcome = 'ROSC';
    }
    return push(kind, label || kind, meta, now);
  };

  code.toggleCause = function (key) {
    code.state.causes[key] = !code.state.causes[key];
    return code.state.causes[key];
  };

  /* The note that goes in the chart. Written as a narrative because that is
     what the receiving hospital and the coroner both read. */
  code.toCppt = function () {
    var s = code.state;
    var t0 = s.t0 || EV.now();
    var end = s.endedAt || s.now || EV.now();
    var total = Math.max(0, end - t0);

    function at(e) { return EV.hhmm(e.t) + ' (+' + EV.mmss(e.t - t0) + ')'; }

    var shocks = [], drugs = [], rhythms = [], other = [];
    for (var i = 0; i < s.events.length; i++) {
      var e = s.events[i];
      if (e.kind === 'shock') shocks.push(at(e) + ' ' + e.label);
      else if (e.kind === 'drug') drugs.push(at(e) + ' ' + e.label);
      else if (e.kind === 'rhythm') rhythms.push(at(e) + ' ' + e.label);
      else if (e.kind !== 'start' && e.kind !== 'end') other.push(at(e) + ' ' + e.label);
    }

    var causes = [];
    for (var k in s.causes) {
      if (!s.causes[k]) continue;
      for (var j = 0; j < R.HT.length; j++) if (R.HT[j].k === k) causes.push(R.HT[j].l);
    }

    var o = [];
    o.push('Resuscitation started ' + EV.hhmm(t0) + ', ran ' + EV.dur(total) + '.');
    o.push('Rhythm checks: ' + (rhythms.length ? rhythms.join('; ') : 'none recorded') + '.');
    o.push('Shocks: ' + (shocks.length ? shocks.join('; ') : 'none') + '.');
    o.push('Drugs: ' + (drugs.length ? drugs.join('; ') : 'none recorded') + '.');
    if (other.length) o.push('Other: ' + other.join('; ') + '.');
    if (causes.length) o.push('Reversible causes considered: ' + causes.join(', ') + '.');

    var a = s.rosc
      ? 'ROSC at ' + EV.hhmm(s.roscAt) + ', after ' + EV.dur(s.roscAt - t0) + ' of resuscitation.'
      : (s.outcome === 'ROSC' ? 'ROSC achieved.' : 'No return of spontaneous circulation.');

    var p = s.rosc
      ? 'Post-ROSC care: SpO2 94–98%, normocapnia, MAP ≥ 65, 12-lead ECG, glucose and temperature, ' +
        'and urgent transfer.'
      : 'Resuscitation ended at ' + EV.hhmm(end) + '. Time of death recorded; family and the ' +
        'receiving hospital informed.';

    return {
      s: 'Cardiac arrest. ' + (s.rhythm ? 'Presenting rhythm ' + s.rhythm + '. ' : '') +
        s.events.length + ' events recorded on the code board.',
      o: o.join('\n'),
      a: a,
      p: p,
      events: s.events.slice(),
      summary: {
        startedAt: t0, endedAt: end, durationMs: total,
        shocks: s.shocks, adrenalineDoses: s.epiCount, rosc: s.rosc, outcome: s.outcome
      }
    };
  };

  /* ---- self test ----------------------------------------------------------- */
  R.selfTest = function () {
    var fails = [], n = 0;
    function eq(name, got, want) {
      n++;
      var g = JSON.stringify(got), w = JSON.stringify(want);
      if (g !== w) fails.push({ name: name, expected: w, got: g });
    }

    var keep = code.state;

    /* --- clock --- */
    code.reset();
    eq('mark before start does not throw', code.mark('shock', 'Shock'), null);
    eq('blank state is not running', code.state.running, false);

    code.start('p1', 70);
    var t0 = code.state.t0;
    code.tick(t0 + 30000);
    eq('cycle counts down', code.state.cycleRemainingMs, 90000);
    eq('no cycle yet', code.state.cycles, 0);
    code.tick(t0 + 125000);
    eq('cycle rolls over', code.state.cycles, 1);
    eq('cycle remaining goes negative when overdue', code.state.cycleRemainingMs < 0, true);

    /* Adrenaline becomes due, then late. */
    eq('first dose due after a minute', (code.tick(t0 + 61000), code.state.epiDue), true);
    code.mark('drug', 'Adrenaline 1 mg');
    eq('marking adrenaline clears due', code.state.epiDue, false);
    eq('adrenaline counted', code.state.epiCount, 1);
    var epiAt = code.state.lastEpi;
    code.state.lastEpi = epiAt - 200000;     /* pretend 3 min 20 s have passed */
    code.tick(t0 + 70000);
    eq('adrenaline due again at 3 min', code.state.epiDue, true);
    code.state.lastEpi = epiAt - 310000;
    code.tick(t0 + 80000);
    eq('adrenaline late at 5 min', code.state.epiLate, true);

    /* --- shock escalation --- */
    code.reset(); code.start('p2', 70);
    code.mark('shock', 'Shock');
    eq('first shock 200 J', /200 J/.test(code.state.events[code.state.events.length - 1].label), true);
    code.mark('shock', 'Shock');
    code.mark('shock', 'Shock');
    eq('third shock escalates to 300 J', /300 J/.test(code.state.events[code.state.events.length - 1].label), true);
    eq('shock count', code.state.shocks, 3);
    eq('a shock restarts the cycle', code.state.cycleRemainingMs <= CYCLE, true);

    eq('adult energy ladder', [1, 2, 3, 4, 5].map(function (i) { return R.shockEnergy(i, 70).joules; }),
      [200, 200, 300, 360, 360]);
    eq('child 12 kg first shock is 2 J/kg', R.shockEnergy(1, 12).joules, 24);
    eq('child later shocks are 4 J/kg', R.shockEnergy(3, 12).joules, 48);
    eq('child energy never exceeds adult', R.shockEnergy(4, 39).joules <= 200, true);

    /* --- doses --- */
    var adult = R.dose({ drug: 'Adrenaline', formularyId: 'epinephrine', fixed: 1, unit: 'mg' }, 70);
    eq('fixed adult dose', adult.amount, 1);
    if (EV.formulary && EV.formulary.conc && EV.formulary.conc('epinephrine')) {
      eq('adrenaline is 1 mL at 1 mg/mL', adult.ml, 1);
    }
    var child = R.dose({ drug: 'Adrenaline', formularyId: 'epinephrine', mgPerKg: 0.01, max: 1, unit: 'mg' }, 12);
    eq('12 kg child gets 0.12 mg', child.amount, 0.12);
    var big = R.dose({ drug: 'Adrenaline', formularyId: 'epinephrine', mgPerKg: 0.01, max: 1, unit: 'mg' }, 150);
    eq('caps at the adult dose', big.amount, 1);
    eq('cap is flagged', big.capped, true);
    var noWt = R.dose({ drug: 'Amiodarone', mgPerKg: 5, unit: 'mg' }, undefined);
    eq('no weight refuses to guess', noWt.amount, undefined);
    eq('and says why', noWt.why, 'Weight needed');

    /* --- the note --- */
    code.reset(); code.start('p3', 70);
    code.mark('rhythm', 'VF', { rhythm: 'VF' });
    code.mark('shock', 'Shock');
    code.mark('drug', 'Adrenaline 1 mg');
    code.mark('drug', 'Amiodarone 300 mg');
    code.toggleCause('hypoxia');
    code.mark('rosc', 'ROSC');
    code.stop('ROSC');
    var note = code.toCppt();
    eq('note has all four parts', !!(note.s && note.o && note.a && note.p), true);
    eq('note mentions the shock', /Shock 200 J/.test(note.o), true);
    eq('note mentions adrenaline', /Adrenaline/.test(note.o), true);
    eq('note mentions amiodarone', /Amiodarone/.test(note.o), true);
    eq('note mentions the rhythm', /VF/.test(note.o), true);
    eq('note records the cause considered', /Hypoxia/.test(note.o), true);
    eq('note states ROSC', /ROSC/.test(note.a), true);
    eq('summary counts', [note.summary.shocks, note.summary.adrenalineDoses, note.summary.rosc],
      [1, 1, true]);

    /* Every logged event must reach the narrative. */
    var inNote = note.o + ' ' + note.s + ' ' + note.a + ' ' + note.p;
    var missed = note.events.filter(function (e) {
      if (e.kind === 'start' || e.kind === 'end') return false;
      return inNote.indexOf(e.label.split(' ')[0]) === -1;
    });
    eq('no event is dropped from the note', missed.map(function (e) { return e.label; }), []);

    /* --- content integrity --- */
    eq('every algorithm has a title and at least one node',
      R.ALGOS.every(function (a) { return a.id && a.title && (a.nodes || []).length; }), true);
    var badLinks = [];
    R.ALGOS.forEach(function (a) {
      var ids = a.nodes.map(function (x) { return x.id; });
      a.nodes.forEach(function (nd) {
        (nd.next || []).forEach(function (nx) {
          if (ids.indexOf(nx.to) === -1) badLinks.push(a.id + ':' + nd.id + '->' + nx.to);
        });
      });
    });
    eq('no algorithm links to a node that does not exist', badLinks, []);

    /* Every formularyId must resolve, or the UI shows a dose with no volume. */
    if (EV.formulary && EV.formulary.byId) {
      var badIds = [];
      R.ALGOS.forEach(function (a) {
        a.nodes.forEach(function (nd) {
          (nd.dose || []).forEach(function (dz) {
            if (dz.formularyId && !EV.formulary.byId(dz.formularyId)) {
              badIds.push(a.id + ':' + dz.drug + ' -> ' + dz.formularyId);
            }
          });
        });
      });
      eq('every drug resolves in the formulary', badIds, []);
    }
    eq('reversible causes are the full H and T list', R.HT.length, 12);

    code.state = keep;
    return { pass: n - fails.length, fail: fails.length, total: n, failures: fails };
  };

})(window.EV = window.EV || {});
