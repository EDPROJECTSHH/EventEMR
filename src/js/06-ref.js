/* ==========================================================================
   06-ref.js — EV.ref, the clinical reference.

   177 topics curated out of the team's EM Companion corpus for mass-gathering
   medicine, plus a set of hand-written field cards for the things a textbook
   covers badly at an event: heat exhaustion versus heat stroke at a glance,
   exertional hyponatraemia, blisters, a dental avulsion, a START triage card.

   The index is built lazily on the first search so opening the board costs
   nothing; a 2 MB file parsed at boot is two seconds a medical post does not
   have.
   ========================================================================== */
(function (EV) {
  'use strict';

  var R = EV.ref = {};

  R.topics = [];
  R.meta = null;
  R.ready = null;
  var BY_ID = Object.create(null);
  var IX = null;             // [{id, t, blob, trig}]
  var loaded = false;

  /* ---- loading ------------------------------------------------------------
     The artifact build inlines the data as window.__EV_REF__; the Netlify
     build fetches it so the browser caches it between shifts. */
  R.load = function (url) {
    if (R.ready) return R.ready;
    if (window.__EV_REF__) {
      R.ready = Promise.resolve(install(window.__EV_REF__));
      return R.ready;
    }
    R.ready = fetch(url || 'data/ref-topics.json')
      .then(function (r) {
        if (!r.ok) throw new Error('reference HTTP ' + r.status);
        return r.json();
      })
      .then(install)
      .catch(function (e) {
        EV.logError('ref.load', e);
        /* A missing reference must never take the EMR down — the quick cards
           are hand-written and still work. */
        R.ready = null;
        loaded = false;
        throw e;
      });
    return R.ready;
  };

  function install(data) {
    R.meta = (data && data.meta) || {};
    R.topics = (data && data.topics) || [];
    BY_ID = Object.create(null);
    for (var i = 0; i < R.topics.length; i++) BY_ID[R.topics[i].id] = R.topics[i];
    IX = null;
    loaded = true;
    EV.emit('ref-ready', R.topics.length);
    return R;
  }
  R.install = install;          // used by the self-test fixture
  R.isLoaded = function () { return loaded; };

  R.byId = function (id) { return BY_ID[id]; };

  /* ---- sections -----------------------------------------------------------
     Pearls first, deliberately: it is the highest-yield twenty seconds in any
     chapter and the only part most people read mid-shift. */
  var SEC_ORDER = [
    ['pearls', 'Pearls & pitfalls'],
    ['treatment', 'Treatment'],
    ['diagnosis', 'Diagnosis'],
    ['basics', 'Basics'],
    ['followup', 'Follow-up'],
    ['codes', 'Codes']
  ];

  R.sections = function (id) {
    var t = BY_ID[id];
    if (!t || !t.s) return [];
    var out = [];
    for (var i = 0; i < SEC_ORDER.length; i++) {
      var k = SEC_ORDER[i][0];
      if (t.s[k] && t.s[k].length) out.push({ k: k, l: SEC_ORDER[i][1], nodes: t.s[k] });
    }
    return out;
  };

  /* ---- rendering ----------------------------------------------------------
     Everything is escaped. The source is a book, not user input, but it is
     still data arriving from a file and this is a medical record app. */
  R.toHtml = function (nodes) {
    if (!nodes || !nodes.length) return '<p class="muted">Nothing in this section.</p>';
    var out = [], i;
    for (i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      var t = EV.esc(n.t || '');
      if (!t) continue;
      if (n.k === 'h2') {
        out.push('<div style="font-size:10.5px;font-weight:700;letter-spacing:.1em;' +
          'text-transform:uppercase;color:var(--ink-3);margin:14px 0 5px">' + t + '</div>');
      } else if (n.k === 'h3') {
        out.push('<div style="font-weight:650;margin:10px 0 3px">' + t + '</div>');
      } else {
        /* Four levels of clinical nesting carry real meaning in this book
           (Ruptured: > Systemic: > Hypotension), so indent rather than flatten. */
        var lvl = Math.min(Math.max(+n.lvl || 1, 1), 4);
        out.push('<div style="padding-left:' + ((lvl - 1) * 14) + 'px;position:relative;' +
          'margin:2px 0 2px 12px"><span style="position:absolute;left:-11px;top:.62em;' +
          'width:4px;height:4px;border-radius:1px;background:var(--ink-4);display:block">' +
          '</span>' + t + '</div>');
      }
    }
    return out.join('');
  };

  /* ---- search -------------------------------------------------------------
     One flat blob per topic, built once. 177 topics is small enough that a
     linear scan with an early substring test beats any cleverer structure,
     and it stays honest about partial words. */
  function buildIndex() {
    IX = [];
    for (var i = 0; i < R.topics.length; i++) {
      var t = R.topics[i];
      var parts = [t.t];
      var alias = ALIAS[t.id];
      if (alias) parts.push(alias.join(' '));
      if (t.s) {
        for (var k in t.s) {
          var nodes = t.s[k];
          for (var j = 0; j < nodes.length; j++) parts.push(nodes[j].t || '');
        }
      }
      var blob = EV.norm(parts.join(' \n '));
      IX.push({
        id: t.id, t: t.t, title: EV.norm(t.t),
        alias: alias ? EV.norm(alias.join(' ')) : '',
        blob: blob, trig: null
      });
    }
    return IX;
  }

  R.search = function (q, opts) {
    opts = opts || {};
    var nq = EV.norm(q);
    if (!nq || !loaded) return [];
    if (!IX) buildIndex();

    var terms = nq.split(' ').filter(function (s) { return s.length > 1; });
    if (!terms.length) terms = [nq];

    var out = [];
    for (var i = 0; i < IX.length; i++) {
      var e = IX[i], score = 0, matchedAll = true;
      for (var ti = 0; ti < terms.length; ti++) {
        var term = terms[ti], s = 0;
        if (e.title === term) s = 1000;
        else if (e.title.indexOf(term) === 0) s = 500;
        else if (e.alias && e.alias.indexOf(term) !== -1) s = 420;
        else if ((' ' + e.title).indexOf(' ' + term) !== -1) s = 300;
        else if (e.title.indexOf(term) !== -1) s = 200;
        else {
          var at = e.blob.indexOf(term);
          if (at !== -1) {
            /* Count occurrences, cheaply and with a cap — a term that shows up
               thirty times is about that topic. */
            var n = 0, from = at;
            while (from !== -1 && n < 12) { n++; from = e.blob.indexOf(term, from + term.length); }
            s = 20 + n * 6;
          } else if (term.length >= 5) {
            if (!e.trig) e.trig = EV.trigrams(e.title);
            var d = EV.dice(EV.trigrams(term), e.trig);
            if (d > 0.45) s = Math.round(d * 180);
          }
        }
        if (!s) { matchedAll = false; break; }
        score += s;
      }
      if (!matchedAll) continue;
      out.push({ id: e.id, t: e.t, score: score, hits: hitsFor(e.id, terms[0]) });
    }
    out.sort(function (a, b) { return b.score - a.score || a.t.length - b.t.length; });
    return opts.limit ? out.slice(0, opts.limit) : out;
  };

  /* The one line of context that tells someone whether this is the right
     chapter before they open it. */
  function hitsFor(id, term) {
    var t = BY_ID[id];
    if (!t || !t.s) return [];
    for (var si = 0; si < SEC_ORDER.length; si++) {
      var k = SEC_ORDER[si][0];
      var nodes = t.s[k];
      if (!nodes) continue;
      for (var i = 0; i < nodes.length; i++) {
        var txt = nodes[i].t || '';
        if (EV.norm(txt).indexOf(term) !== -1) {
          return [{ sec: k, t: txt.length > 150 ? txt.slice(0, 150) + '…' : txt }];
        }
      }
    }
    return [];
  }

  /* ---- complaint seeding --------------------------------------------------
     What the "ref" button beside Chief Complaint actually calls. These are the
     phrases an event medic types, in both languages, mapped to the chapters
     that answer them. Order matters: the first id is the best starting point. */
  var SEED = [
    [['collapse', 'collapsed', 'pingsan', 'faint', 'fainted', 'syncope', 'blackout'],
      ['syncope', 'hyperthermia', 'hyponatremia', 'cardiac-arrest', 'hypoglycemia']],
    [['cramp', 'kram', 'spasm', 'muscle cramp'],
      ['hyperthermia', 'hyponatremia', 'rhabdomyolysis']],
    [['heat', 'heat stroke', 'heatstroke', 'heat exhaustion', 'overheat', 'hyperthermia', 'kepanasan'],
      ['hyperthermia', 'rhabdomyolysis', 'hyponatremia', 'altered-mental-status']],
    [['dehydration', 'dehidrasi', 'thirsty', 'volume depletion'],
      ['hyperthermia', 'vomiting-adult', 'diarrhea-adult', 'hyponatremia']],
    [['chest pain', 'nyeri dada', 'angina', 'chest tightness', 'chest discomfort'],
      ['chest-pain', 'acute-coronary-syndrome-myocardial-infarction', 'pulmonary-embolism', 'pneumothorax']],
    [['sob', 'short of breath', 'shortness of breath', 'breathless', 'sesak', 'dyspnoea', 'dyspnea'],
      ['dyspnea', 'asthma-adult', 'pulmonary-embolism', 'anaphylaxis', 'pneumothorax']],
    [['wheeze', 'asthma', 'asma', 'bengek'],
      ['asthma-adult', 'wheezing', 'anaphylaxis']],
    [['sprain', 'twisted', 'rolled ankle', 'ankle', 'keseleo', 'terkilir'],
      ['ankle-sprain', 'ankle-fracture-dislocation', 'foot-fracture']],
    [['knee', 'lutut'], ['knee-injuries-acl-pcl-mcl-meniscus', 'patellar-injuries', 'tibial-plateau-fracture']],
    [['shoulder', 'bahu', 'dislocated shoulder'], ['shoulder-dislocation', 'clavicle-fracture', 'acromioclavicular-joint-injury']],
    [['wrist', 'hand', 'finger', 'tangan', 'jari'], ['carpal-fractures', 'scaphoid-fracture', 'metacarpal-injuries', 'phalangeal-injuries-hand']],
    [['laceration', 'cut', 'luka', 'wound', 'robek', 'gash'], ['laceration-management', 'tendon-laceration', 'tetanus']],
    [['abrasion', 'graze', 'road rash', 'lecet', 'blister', 'chafing'], ['laceration-management', 'burns', 'cellulitis']],
    [['head injury', 'head knock', 'cedera kepala', 'concussion', 'hit head'],
      ['head-trauma-blunt', 'subdural-hematoma', 'epidural-hematoma', 'spine-injury-cervical-adult']],
    [['seizure', 'kejang', 'fit', 'convulsion'], ['seizure-adult', 'seizure-pediatric', 'hyponatremia', 'hypoglycemia']],
    [['allergy', 'alergi', 'rash', 'hives', 'urticaria', 'anaphylaxis', 'anafilaksis', 'swelling lips'],
      ['anaphylaxis', 'urticaria', 'angioedema', 'contact-dermatitis']],
    [['sting', 'bee', 'wasp', 'tawon', 'lebah', 'bite', 'gigitan', 'snake', 'ular'],
      ['sting-bee', 'anaphylaxis', 'snake-envenomation', 'bite-animal', 'sting-scorpion']],
    [['hypoglyc', 'low sugar', 'gula darah rendah', 'diabetes', 'diabetic'],
      ['hypoglycemia', 'diabetic-ketoacidosis', 'altered-mental-status']],
    [['palpitation', 'berdebar', 'fast heart', 'racing heart', 'svt'],
      ['supraventricular-tachycardia', 'atrial-fibrillation', 'tachydysrhythmias', 'syncope']],
    [['abdominal pain', 'nyeri perut', 'sakit perut', 'stomach ache', 'cramps stomach'],
      ['abdominal-pain', 'gastroenteritis', 'appendicitis', 'renal-calculus']],
    [['nausea', 'vomit', 'mual', 'muntah', 'throwing up'], ['vomiting-adult', 'gastroenteritis', 'hyponatremia']],
    [['diarrhoea', 'diarrhea', 'diare', 'loose stool'], ['diarrhea-adult', 'gastroenteritis']],
    [['headache', 'sakit kepala', 'nyeri kepala', 'migraine'], ['headache', 'headache-migraine', 'hyponatremia', 'subarachnoid-hemorrhage']],
    [['dizzy', 'pusing', 'vertigo', 'lightheaded'], ['dizziness', 'vertigo', 'syncope', 'hypoglycemia']],
    [['eye', 'mata', 'foreign body eye', 'red eye'], ['corneal-abrasion', 'corneal-foreign-body', 'red-eye', 'ultraviolet-keratitis']],
    [['nosebleed', 'epistaxis', 'mimisan'], ['epistaxis', 'nasal-fractures']],
    [['tooth', 'dental', 'gigi', 'knocked out tooth'], ['dental-trauma', 'toothache']],
    [['fever', 'demam', 'pyrexia'], ['fever-adult', 'sepsis', 'hyperthermia', 'dengue-fever', 'influenza']],
    [['drunk', 'mabuk', 'intoxicated', 'alcohol'], ['alcohol-poisoning', 'withdrawal-alcohol', 'altered-mental-status']],
    [['overdose', 'drugs', 'narkoba', 'opioid', 'heroin'], ['opiate-poisoning', 'poisoning-toxidromes', 'sympathomimetic-poisoning', 'mdma-poisoning']],
    [['anxiety', 'panic', 'cemas', 'panik', 'hyperventilat'], ['panic-attack', 'hyperventilation-syndrome', 'agitation']],
    [['agitated', 'aggressive', 'gaduh', 'violent'], ['agitation', 'violence-management-of', 'psychosis-acute']],
    [['back pain', 'sakit punggung', 'nyeri punggung'], ['back-pain', 'sciatica-herniated-disc', 'spine-injury-lumbar']],
    [['burn', 'luka bakar', 'scald'], ['burns', 'smoke-inhalation']],
    [['drown', 'tenggelam', 'near drowning'], ['drowning', 'cardiac-arrest']],
    [['arrest', 'cpr', 'not breathing', 'no pulse', 'henti jantung'],
      ['cardiac-arrest', 'ventricular-fibrillation', 'resuscitation-pediatric']],
    [['pregnant', 'hamil', 'labour', 'labor'], ['pregnancy-uncomplicated', 'delivery-uncomplicated', 'vaginal-bleeding-in-pregnancy']],
    [['chest trauma', 'rib', 'tulang rusuk'], ['rib-fracture', 'chest-trauma-blunt', 'pneumothorax', 'flail-chest']]
  ];

  /* Reverse index for the search blob, so "pingsan" also finds Syncope. */
  var ALIAS = Object.create(null);
  (function () {
    for (var i = 0; i < SEED.length; i++) {
      var terms = SEED[i][0], ids = SEED[i][1];
      for (var j = 0; j < ids.length; j++) {
        (ALIAS[ids[j]] = ALIAS[ids[j]] || []).push.apply(ALIAS[ids[j]], terms);
      }
    }
  })();

  R.seed = function (complaint) {
    var s = EV.norm(complaint);
    var picked = [], seen = Object.create(null), i, j;

    if (s) {
      /* Longest matching phrase wins, so "chest pain" does not lose to "pain". */
      var matches = [];
      for (i = 0; i < SEED.length; i++) {
        for (j = 0; j < SEED[i][0].length; j++) {
          var term = SEED[i][0][j];
          if (s.indexOf(term) !== -1) matches.push({ len: term.length, ids: SEED[i][1] });
        }
      }
      matches.sort(function (a, b) { return b.len - a.len; });
      for (i = 0; i < matches.length; i++) {
        for (j = 0; j < matches[i].ids.length; j++) {
          var id = matches[i].ids[j];
          if (seen[id]) continue;
          seen[id] = 1;
          var t = BY_ID[id];
          if (t) picked.push({ id: id, t: t.t, score: 1000 - picked.length, hits: [] });
        }
      }
    }

    /* Nothing matched the phrase book — fall back to a free-text search, then
       to the topics an event post opens most. */
    if (!picked.length && s) picked = R.search(s, { limit: 10 });
    if (!picked.length) {
      var common = ['hyperthermia', 'hyponatremia', 'ankle-sprain', 'laceration-management',
        'syncope', 'anaphylaxis', 'asthma-adult', 'chest-pain', 'head-trauma-blunt',
        'hypoglycemia', 'cardiac-arrest', 'abdominal-pain'];
      for (i = 0; i < common.length; i++) {
        var ct = BY_ID[common[i]];
        if (ct) picked.push({ id: ct.id, t: ct.t, score: 0, hits: [] });
      }
    }
    return picked;
  };

  /* ---- field cards --------------------------------------------------------
     The things the book does not answer well for a mass-gathering post. Each
     is one screen, written to be read standing up. */
  R.QUICK = [
    {
      id: 'heat-spectrum', t: 'Heat exhaustion vs heat stroke', cat: 'heat', hue: '#c2410c',
      li: [
        'The dividing line is CNS status, not temperature. Confused, agitated, ataxic, seizing or unconscious = heat stroke until proven otherwise.',
        'Heat exhaustion: core usually < 40 °C, mentating normally, sweating, weak, nauseated, headache. Recovers with shade, horizontal, oral or IV fluid.',
        'Exertional heat stroke: core ≥ 40 °C with altered mental status. This is a time-critical emergency — every minute above 40 °C adds mortality.',
        'Measure a RECTAL temperature. Tympanic, temporal and oral all read falsely low in a hot, sweating, vasoconstricted runner and have sent people home to die.',
        'COOL FIRST, TRANSPORT SECOND. Cold-water immersion is the fastest method: 1 °C every 3–5 min. Do not delay cooling to load an ambulance.',
        'Target: stop cooling at a core of 38.6 °C to avoid overshoot into hypothermia.',
        'Ice bath practicalities: water as cold as available, stir it, keep the head supported, one person on the airway, monitor rectal temp continuously.',
        'No ice bath? Strip, wet the skin continuously, fan hard, ice packs to neck, axillae and groin. Less effective — escalate transport.',
        'Antipyretics do not work. The hypothalamic set point is normal; paracetamol only loads an already-stressed liver.',
        'Check glucose and sodium in every collapsed athlete. Heat stroke, hypoglycaemia and hyponatraemia look identical from the finish line.'
      ]
    },
    {
      id: 'eah', t: 'Exercise-associated hyponatraemia', cat: 'heat', hue: '#0369a1',
      li: [
        'The one that kills slow finishers who drank steadily all race. Suspect it in any collapsed endurance athlete, especially a smaller runner over 4 hours.',
        'Clues: gained or held weight during the race, nausea and vomiting, headache, confusion, puffiness, and a NORMAL or low core temperature.',
        'Never give a hypotonic fluid to a collapsed endurance athlete before you know the sodium. Free water here is the poison, not the treatment.',
        'If you cannot measure sodium: an athlete who is alert, orientated and not vomiting can rest and be observed, taking salty food, no free water.',
        'Encephalopathy (confusion, seizure, vomiting, depressed consciousness) with suspected EAH: 3% hypertonic saline 100 mL IV over 10 min, repeat up to twice at 10-minute intervals for ongoing symptoms.',
        'Do not stock 3%? 100 mL of 3% can be approximated in an emergency only by someone who has done the arithmetic in advance and documented it — otherwise transport urgently.',
        'Overcorrection is not the risk in acute exercise-associated hyponatraemia; the hyponatraemia is hours old, not days.',
        'Weigh the athlete if a pre-race weight exists. Weight gain plus symptoms is EAH until disproven.'
      ]
    },
    {
      id: 'collapse-algo', t: 'The collapsed athlete — first 60 seconds', cat: 'heat', hue: '#c1121f',
      li: [
        'Collapse AFTER the finish line, conscious, improving when laid flat with legs up: almost always exercise-associated postural collapse. Benign.',
        'Collapse DURING the event, or any collapse with altered mental status: treat as an emergency until proven otherwise.',
        'Four things in the first minute: pulse, mental status, RECTAL temperature, glucose. Add sodium if you have it.',
        'No pulse: start CPR and get the AED on. Sudden cardiac arrest in an athlete is usually shockable and usually survivable at an event.',
        'Hot and confused → heat stroke → cool now.',
        'Cool or normal temperature and confused → sodium or glucose → EAH or hypoglycaemia.',
        'Normal everything, feels faint, improves lying down → postural collapse → horizontal, legs raised, oral fluid, observe 20 minutes.',
        'Record the time of collapse. Downtime and time-to-cooling are the two numbers the receiving hospital will ask for.'
      ]
    },
    {
      id: 'blister', t: 'Blisters & chafing', cat: 'wound', hue: '#a16207',
      li: [
        'Intact and not painful: leave it. The roof is the best dressing there is.',
        'Intact, tense and painful, and the athlete is continuing: clean with alcohol, pierce at the edge with a sterile needle, express the fluid, LEAVE the roof in place.',
        'De-roofed: clean, non-adherent dressing, then tape. Treat as an open wound.',
        'Dress to allow continuing: hydrocolloid or a blister plaster, then Hipafix or micropore over it, no wrinkles. A wrinkle becomes the next blister.',
        'Chafing: clean, dry, barrier ointment. Groin and nipple chafing in a wet runner is the usual presentation and the usual reason they stop.',
        'Red streaking, spreading erythema, pus or fever: this is cellulitis now, not a blister. Antibiotics and review.',
        'Always ask about diabetes and peripheral neuropathy before dismissing a foot lesion.'
      ]
    },
    {
      id: 'dental', t: 'Avulsed tooth — the 30-minute window', cat: 'eent', hue: '#15803d',
      li: [
        'A permanent tooth replanted within 30 minutes has a good chance of surviving. After 60 minutes dry, the chance is poor.',
        'Hold the tooth by the CROWN only. Never touch or scrub the root — you are removing the ligament cells that reattach it.',
        'Visibly dirty: rinse gently for a few seconds in saline or milk. Do not scrub, do not use antiseptic, do not let it dry.',
        'Best option: replant it immediately in the socket and have the patient bite gently on gauze.',
        'If you cannot replant: store in cold milk. Saline is second best. The patient\'s own saliva (inside the cheek, if fully conscious) is third. Plain water is the worst — it lyses the cells.',
        'Never replant a primary (baby) tooth — it damages the permanent tooth underneath.',
        'Refer to a dentist the same day. Check tetanus status.',
        'Account for every fragment. A tooth that is not found may be in the airway — if the story fits, that is a chest X-ray.'
      ]
    },
    {
      id: 'start-triage', t: 'START mass-casualty triage', cat: 'triage', hue: '#c1121f',
      li: [
        'Use it when casualties outnumber the people who can treat them. Thirty seconds per patient, no treatment except the two below.',
        'Step 1 — anyone who can WALK to a designated point is GREEN (minor). This clears most of the scene instantly.',
        'Step 2 — Respirations. Not breathing: open the airway. Still not breathing = BLACK (expectant). Breathing only after the airway is opened = RED (immediate).',
        'Respiratory rate over 30 = RED.',
        'Step 3 — Perfusion. Radial pulse absent, or capillary refill over 2 seconds = RED. Control catastrophic haemorrhage — this and the airway are the only two interventions you make.',
        'Step 4 — Mental status. Cannot follow a simple command = RED. Follows commands = YELLOW (delayed).',
        'Re-triage at every stage. START is a snapshot, and people move between categories.',
        'The hardest discipline is walking away from a BLACK. Doing so is what makes the REDs survivable.'
      ]
    },
    {
      id: 'referral', t: 'Hospital referral checklist', cat: 'triage', hue: '#1c2e7a',
      li: [
        'Call the receiving ED before the ambulance moves. An expected patient gets a resus bay; a surprise gets a queue.',
        'Give them: age, sex, the one-line problem, observations with times, what you have given, and your ETA.',
        'Send the printed chart PDF with the patient, and say out loud that the record is in it.',
        'Named handover: who you handed to, at what time. Write it in the CPPT before you leave the department.',
        'Check before departure: IV secured and running, airway plan if consciousness is dropping, oxygen on board with enough to last, monitor on, suction reachable.',
        'Take a phone number for the patient and for next of kin. You will need it when the organiser asks.',
        'Record the odometer time of departure and arrival — turnaround is the number that tells the command post whether it still has an ambulance.',
        'If the patient refuses transport: document capacity, the risks you explained in their own words, and get a signature if you can.'
      ]
    },
    {
      id: 'rtp-head', t: 'Head knock — return to play', cat: 'neuro', hue: '#4338ca',
      li: [
        'If a concussion is suspected, the athlete is out for the day. No exceptions, no "he says he is fine". There is no same-day return.',
        'Immediate removal for any of: loss of consciousness, seizure, tonic posturing, ataxia, confusion, amnesia, or a blank vacant stare.',
        'Red flags for immediate transport: GCS below 15, worsening headache, repeated vomiting, unequal pupils, weakness or numbness, neck pain, seizure, increasing agitation.',
        'Suspect a cervical spine injury in every significant head impact. Collar and immobilise before you move them.',
        'Anticoagulated, or over 65, or a high-energy mechanism: low threshold for CT and transport.',
        'Symptoms often evolve over the first few hours. Nobody goes home alone.',
        'Give the athlete and whoever is with them written advice on what to come back for, and record that you did.',
        'Graduated return to play starts the next day at the earliest and is a medical decision, not a coach\'s.'
      ]
    },
    {
      id: 'anaph-field', t: 'Anaphylaxis at a post', cat: 'allergy', hue: '#be123c',
      li: [
        'Adrenaline IM into the anterolateral THIGH. Not subcutaneous, not deltoid, not waiting for a line.',
        'Adult 0.5 mg = 0.5 mL of 1 mg/mL. Child 0.01 mg/kg to a maximum of 0.5 mg.',
        'Repeat every 5 minutes if there is no improvement. Most deaths follow delayed or too-small doses, not too many.',
        'Lie them FLAT with legs raised. Sitting a hypotensive anaphylaxis patient up, or letting them stand to walk to the ambulance, has killed people.',
        'Then: high-flow oxygen, large-bore IV, a fluid bolus of 20 mL/kg crystalloid for hypotension.',
        'Wheeze on top: nebulised salbutamol. It does not replace the adrenaline.',
        'Antihistamines and steroids treat the skin and perhaps the late phase. They do nothing for the airway or the blood pressure — never give them first.',
        'Everyone who has had adrenaline goes to hospital. Biphasic reactions happen hours later.',
        'Record the time of the sting, bite or food, and keep the trigger if you have it.'
      ]
    },
    {
      id: 'kit-check', t: 'Opening a post — 5-minute kit check', cat: 'triage', hue: '#4b5c6b',
      li: [
        'Oxygen: cylinder contents, regulator fits, masks and nasal cannulae present.',
        'Defibrillator: self-test passed, pads in date and sealed, spare set, battery charged.',
        'Airway: bag-valve-mask of the right sizes, OPAs, LMA, suction working with a probe attached.',
        'Drugs: adrenaline, salbutamol, glucose, naloxone and your antiemetic found without looking. Check the controlled drug count and sign it.',
        'IV: cannulae, giving sets, fluid hung and ready, tourniquet and tape to hand.',
        'Immobilisation: collar, stretcher, splints, and a blanket.',
        'Ice bath filled and a rectal thermometer ready if this is an endurance event in the heat.',
        'Comms: radio on the right channel, a charged phone, and the number for the receiving ED written where everyone can see it.',
        'This app: the right post selected on every device, and the user name set so notes sign themselves.'
      ]
    }
  ];

  R.quickById = function (id) {
    for (var i = 0; i < R.QUICK.length; i++) if (R.QUICK[i].id === id) return R.QUICK[i];
    return null;
  };

  /* ---- self test ----------------------------------------------------------
     Runs against a small inline fixture so it is honest even before the 2 MB
     file has arrived. */
  R.selfTest = function () {
    var fails = [], n = 0;
    function eq(name, got, want) {
      n++;
      var g = JSON.stringify(got), w = JSON.stringify(want);
      if (g !== w) fails.push({ name: name, expected: w, got: g });
    }

    var realTopics = R.topics, realById = BY_ID, realIx = IX, realLoaded = loaded;

    install({
      meta: { n: 4 },
      topics: [
        {
          id: 'hyperthermia', t: 'Hyperthermia', pg: 1,
          s: {
            pearls: [{ k: 'p', lvl: 1, t: 'Cool first, transport second. Rectal temperature only.' }],
            treatment: [{ k: 'h2', t: 'INITIAL STABILIZATION' }, { k: 'p', lvl: 1, t: 'Cold water immersion is the fastest cooling method.' }]
          }
        },
        {
          id: 'ankle-sprain', t: 'Ankle Sprain', pg: 2,
          s: { pearls: [{ k: 'p', lvl: 1, t: 'Apply the Ottawa ankle rules before imaging.' }] }
        },
        {
          id: 'anaphylaxis', t: 'Anaphylaxis', pg: 3,
          s: { treatment: [{ k: 'p', lvl: 1, t: 'Intramuscular epinephrine into the anterolateral thigh.' }] }
        },
        {
          id: 'syncope', t: 'Syncope', pg: 4,
          s: { pearls: [{ k: 'p', lvl: 1, t: 'Exertional syncope is never benign.' }] }
        }
      ]
    });

    eq('fixture installed', R.topics.length, 4);
    eq('byId works', !!R.byId('hyperthermia'), true);
    eq('byId on nonsense', R.byId('nope'), undefined);

    eq('title search ranks first', R.search('ankle')[0].id, 'ankle-sprain');
    eq('body search finds it', R.search('immersion')[0].id, 'hyperthermia');
    eq('multi-term requires both', R.search('cold immersion').length, 1);
    eq('multi-term excludes', R.search('ankle immersion').length, 0);
    eq('blank query returns nothing', R.search('').length, 0);
    eq('nonsense returns nothing', R.search('zzzqqq').length, 0);
    eq('case insensitive', R.search('ANKLE')[0].id, 'ankle-sprain');
    eq('search returns a context hit', R.search('immersion')[0].hits.length > 0, true);

    /* The alias path: Indonesian and colloquial terms must reach the chapter. */
    eq('pingsan finds syncope', R.search('pingsan')[0].id, 'syncope');
    eq('alergi finds anaphylaxis', R.search('alergi')[0].id, 'anaphylaxis');
    eq('keseleo finds ankle', R.search('keseleo')[0].id, 'ankle-sprain');

    /* Seeding from a typed complaint — the field button's real job. */
    eq('seed heat', R.seed('heat exhaustion at km 32')[0].id, 'hyperthermia');
    eq('seed longest phrase wins', R.seed('twisted ankle on the kerb')[0].id, 'ankle-sprain');
    eq('seed collapse', R.seed('collapsed at the finish')[0].id, 'syncope');
    eq('seed falls back when unmatched', R.seed('zzz nothing').length > 0, true);
    eq('seed on blank still returns something', R.seed('').length > 0, true);
    eq('seed skips topics not in this corpus',
      R.seed('heat stroke').every(function (x) { return !!R.byId(x.id); }), true);

    eq('sections put pearls first', R.sections('hyperthermia')[0].k, 'pearls');
    eq('sections skip empties', R.sections('ankle-sprain').length, 1);
    eq('sections on nonsense', R.sections('nope'), []);

    var html = R.toHtml([{ k: 'p', lvl: 1, t: 'a <b>bold</b> & "quoted"' }]);
    eq('toHtml escapes markup', html.indexOf('<b>') === -1, true);
    eq('toHtml escapes ampersand', html.indexOf('&amp;') !== -1, true);
    eq('toHtml on empty', R.toHtml([]).indexOf('Nothing') !== -1, true);

    eq('quick cards present', R.QUICK.length >= 8, true);
    eq('every quick card has content', R.QUICK.every(function (c) {
      return c.id && c.t && c.li && c.li.length >= 5;
    }), true);
    eq('quickById', R.quickById('eah').t.indexOf('hyponatraemia') !== -1, true);

    /* Restore whatever the app actually had. */
    R.topics = realTopics; BY_ID = realById; IX = realIx; loaded = realLoaded;

    return { pass: n - fails.length, fail: fails.length, total: n, failures: fails };
  };

})(window.EV = window.EV || {});
