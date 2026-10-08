/* 03-formulary.js — EV.formulary
 * Default drug / supply / equipment catalogue for the Mini Emergency & Critical Care Event EMR.
 * Built from the three real Siloam standby manifests (docs/FORMULARY-SOURCE.md):
 *   A. 2026 Jakarta Running Festival ...... package "Advanced (Mini ICU)"
 *   B. International Junior Golf Champ. ... package "Intermediate"
 *   C. Golden Jubilee PKK 50th ............ package "Intermediate"
 * Items appearing in more than one manifest are ONE item here; `par` is the largest
 * quantity any single manifest carried (summed first when a manifest listed the same
 * item on two rows, e.g. Gloves Handscoon and Elastic Bandage in manifest A).
 * Product names stay as the team says them in the tent ("Kassa Steril", "Spuit 5cc",
 * "Vascon"); the English generic lives in `generic` and drives search.
 */
(function (EV) {
  'use strict';

  var F = {};
  EV.formulary = F;

  /* ------------------------------------------------------------------ *
   * Categories                                                          *
   * ------------------------------------------------------------------ */

  F.CATS = [
    { id: 'resus',      l: 'Resuscitation',   hue: 356 },
    { id: 'cardio',     l: 'Cardiovascular',  hue: 12 },
    { id: 'analgesia',  l: 'Analgesia',       hue: 272 },
    { id: 'gi',         l: 'GI',              hue: 32 },
    { id: 'resp',       l: 'Respiratory',     hue: 188 },
    { id: 'allergy',    l: 'Allergy / Steroid', hue: 316 },
    { id: 'fluid',      l: 'Fluids',          hue: 206 },
    { id: 'airway',     l: 'Airway / RSI',    hue: 166 },
    { id: 'wound',      l: 'Wound care',      hue: 96 },
    { id: 'ortho',      l: 'Ortho / Splint',  hue: 48 },
    { id: 'consumable', l: 'Consumables',     hue: 222 },
    { id: 'monitor',    l: 'Monitoring',      hue: 262 },
    { id: 'equipment',  l: 'Equipment',       hue: 238 },
    { id: 'other',      l: 'Other',           hue: 210 }
  ];

  var CAT_BY_ID = {};
  (function () {
    for (var i = 0; i < F.CATS.length; i++) CAT_BY_ID[F.CATS[i].id] = F.CATS[i];
  })();

  F.cat = function (id) { return CAT_BY_ID[id]; };
  F.catLabel = function (id) { return CAT_BY_ID[id] ? CAT_BY_ID[id].l : 'Other'; };
  F.catHue = function (id) { return CAT_BY_ID[id] ? CAT_BY_ID[id].hue : 210; };

  F.KINDS = ['med', 'supply', 'equipment'];
  F.ROUTES = ['IV', 'IM', 'SC', 'PO', 'SL', 'IN', 'INH', 'NEB', 'PR', 'TOP', 'ETT', 'IO', 'NA'];

  /* ------------------------------------------------------------------ *
   * Strength parsing -> { amt, ml, unit, perMl }                        *
   * ------------------------------------------------------------------ */

  function normUnit(u) {
    u = String(u == null ? '' : u).toLowerCase();
    if (u === 'mc' || u === 'mcg' || u === 'ug' || u === 'microgram' || u === 'mikrogram') return 'mcg';
    if (u === 'mg') return 'mg';
    if (u === 'g' || u === 'gr' || u === 'gram') return 'g';
    if (u === 'iu' || u === 'u' || u === 'unit' || u === 'units') return 'IU';
    if (u === 'meq') return 'mEq';
    if (u === 'mmol') return 'mmol';
    if (u === 'ml' || u === 'cc') return 'mL';
    return '';
  }
  F.normUnit = normUnit;

  // Percent w/v -> mg per mL. 0.9% = 9 mg/mL, 40% = 400 mg/mL, 8.4% = 84 mg/mL.
  function pctToMgPerMl(p) { return p * 10; }

  var RX_PCT_VOL = /(\d+(?:\.\d+)?)\s*%\s*(?:x\s*)?(\d+(?:\.\d+)?)\s*(?:ml|cc)\b/;
  var RX_PCT = /(\d+(?:\.\d+)?)\s*%/;
  var RX_AMT_UNIT_VOL = /(\d+(?:\.\d+)?)\s*(mcg|mc|mg|gr|g|iu|unit|meq|mmol)\s*\/\s*(\d+(?:\.\d+)?)?\s*(?:ml|cc)\b/;
  var RX_AMT_VOL = /(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)?\s*(?:ml|cc)\b/;
  var RX_AMT_UNIT = /(\d+(?:\.\d+)?)\s*(mcg|mc|mg|gr|g|iu|unit|meq|mmol)\b/;
  var RX_VOL = /(\d+(?:\.\d+)?)\s*(?:ml|cc)\b/;

  /**
   * Parse a strength string into { amt, ml, unit, perMl }.
   * `amt` is the labelled amount in `unit`, `ml` the volume it sits in,
   * `perMl` the amount of `unit` per millilitre (null when not derivable).
   * Returns null when nothing numeric could be read.
   */
  function parseStrength(raw) {
    var s = String(raw == null ? '' : raw).toLowerCase().replace(/\s+/g, ' ').trim();
    if (!s || s === '-') return null;
    var m, amt = null, ml = null, unit = '';

    m = s.match(RX_PCT_VOL);
    if (m) {
      var pv = parseFloat(m[1]);
      ml = parseFloat(m[2]);
      unit = 'mg';
      amt = Math.round(pctToMgPerMl(pv) * ml * 10000) / 10000;
      return { amt: amt, ml: ml, unit: unit, perMl: pctToMgPerMl(pv) };
    }

    m = s.match(RX_AMT_UNIT_VOL);
    if (m) {
      amt = parseFloat(m[1]);
      unit = normUnit(m[2]);
      ml = m[3] ? parseFloat(m[3]) : 1;
      if (unit === 'g') { amt = amt * 1000; unit = 'mg'; }
      return { amt: amt, ml: ml, unit: unit, perMl: ml > 0 ? amt / ml : null };
    }

    m = s.match(RX_AMT_VOL);
    if (m) {
      amt = parseFloat(m[1]);
      ml = m[2] ? parseFloat(m[2]) : 1;
      unit = 'mg';                       // manifest shorthand "250/5ml" is milligrams
      return { amt: amt, ml: ml, unit: unit, perMl: ml > 0 ? amt / ml : null };
    }

    m = s.match(RX_PCT);
    if (m) {
      var p = parseFloat(m[1]);
      return { amt: null, ml: null, unit: 'mg', perMl: pctToMgPerMl(p) };
    }

    m = s.match(RX_AMT_UNIT);
    if (m) {
      amt = parseFloat(m[1]);
      unit = normUnit(m[2]);
      if (unit === 'g') { amt = amt * 1000; unit = 'mg'; }
      if (unit === 'mL') return { amt: null, ml: amt, unit: 'mL', perMl: null };
      return { amt: amt, ml: null, unit: unit, perMl: null };
    }

    m = s.match(RX_VOL);
    if (m) return { amt: null, ml: parseFloat(m[1]), unit: 'mL', perMl: null };

    return null;
  }
  F.parseStrength = parseStrength;

  /* ------------------------------------------------------------------ *
   * The catalogue, as compact rows                                      *
   *                                                                     *
   *  0 id            stable kebab slug                                  *
   *  1 name          what the team says out loud                        *
   *  2 generic       English generic / what it is                        *
   *  3 kind          med | supply | equipment                           *
   *  4 cat           EV.formulary.CATS id                               *
   *  5 dose          human-readable unit dose                           *
   *  6 strength      VERBATIM from the manifest (parsed into .conc)      *
   *  7 form          Ampoule | Vial | Tablet | Kolf | pcs ...            *
   *  8 routes        comma list                                          *
   *  9 defaultRoute                                                      *
   * 10 unit          charting unit for an order                          *
   * 11 par           manifest Jumlah (see merge rule in the file header) *
   * 12 flags         H high-alert · C controlled · S confirm strength    *
   * 13 cls           pharmacological class                               *
   * 14 aliases       comma list, search only                             *
   * 15 stdConc       standard Indonesian presentation, used ONLY when    *
   *                  the manifest strength cannot give mL (concAssumed)  *
   * 16 notes                                                             *
   * ------------------------------------------------------------------ */

  var ROWS = [

    /* ---- Resuscitation ------------------------------------------------ */
    ['adenosine', 'Adenosine', 'Adenosine', 'med', 'resus', '6 mg', '6mg', 'Ampoule', 'IV,IO', 'IV', 'mg', 3, 'H', 'Antiarrhythmic', 'adenocard,svt,adenosin', '6mg/2ml', 'Rapid IV push into a proximal line, immediate saline flush.'],
    ['amiodarone', 'Amiodarone', 'Amiodarone', 'med', 'resus', '150 mg', '150mg', 'Vial', 'IV,IO', 'IV', 'mg', 4, 'H', 'Antiarrhythmic', 'cordarone,tiaryt,amiodaron', '150mg/3ml', 'Arrest dose 300 mg then 150 mg; dilute in D5 for infusion.'],
    ['atropine', 'Atropine', 'Atropine sulfate', 'med', 'resus', '0.25 mg', '0.25/cc', 'Ampoule', 'IV,IM,IO', 'IV', 'mg', 10, 'H', 'Anticholinergic', 'sulfas atropin,atropin,sa', '', 'Four ampoules make the usual 1 mg bradycardia dose.'],
    ['epinephrine', 'Epinephrine', 'Epinephrine (adrenaline)', 'med', 'resus', '1 mg', '1mg', 'Ampoule', 'IV,IM,IO,NEB', 'IV', 'mg', 15, 'H', 'Vasopressor', 'adrenaline,adrenalin,epi,epinefrin,1:1000', '1mg/1ml', 'Anaphylaxis 0.5 mg IM anterolateral thigh; arrest 1 mg IV q3-5 min.'],
    ['vascon', 'Vascon', 'Norepinephrine', 'med', 'resus', '1 mg/mL', '1mg/ml', 'Ampoule', 'IV,IO', 'IV', 'mcg/kg/min', 5, 'H', 'Vasopressor', 'norepinephrine,noradrenaline,norepi,noradrenalin,levophed,raivas', '', 'First-line vasopressor. Central or well-sited large-bore peripheral line.'],
    ['meylon', 'Meylon (Bicnat)', 'Sodium bicarbonate', 'med', 'resus', '25 mEq', '', 'Flacon', 'IV,IO', 'IV', 'mEq', 4, 'HS', 'Alkalinising agent', 'bicnat,natrium bikarbonat,sodium bicarb,bicarbonate,nabic,soda bikarbonat', '25meq/25ml', 'Manifest records quantity only. Meylon 84 is 8.4% / 25 mL = 25 mEq (1 mEq per mL) - confirm the flacon label.'],
    ['ca-gluconas', 'Ca Gluconas', 'Calcium gluconate', 'med', 'resus', '10% (0.1)', '0.1', 'Ampoule', 'IV,IO', 'IV', 'mg', 4, 'HS', 'Electrolyte', 'calcium gluconate,kalsium glukonas,ca gluconate,hyperkalaemia,hyperkalemia', '1000mg/10ml', 'Manifest reads "0.1" i.e. 10%. Standard ampoule 10% / 10 mL = 1000 mg - confirm before pushing.'],
    ['mgso4', 'MgSO4', 'Magnesium sulfate', 'med', 'resus', '400 mg/25 mL', '400mg/25cc', 'Flacon', 'IV,IM,IO', 'IV', 'mg', 5, 'H', 'Electrolyte', 'magnesium,magnesium sulphate,mgso4,magnesium sulfat,torsades,eclampsia', '', 'Torsades / severe asthma. 16 mg per mL at this strength.'],
    ['d40', 'D40', 'Dextrose 40%', 'med', 'resus', '25 mL (10 g)', '40% 25ml', 'Flacon', 'IV,IO', 'IV', 'mL', 10, 'H', 'Concentrated glucose', 'dextrose 40,glukosa 40,d40w,hypoglycaemia,hipoglikemi,gula', '', 'Hypoglycaemia: two flacons = 20 g. Large vein, flush afterwards.'],

    /* ---- Cardiovascular ---------------------------------------------- */
    ['dobutamine', 'Dobutamine', 'Dobutamine', 'med', 'cardio', '250 mg/5 mL', '250/5ml', 'Ampoule', 'IV,IO', 'IV', 'mcg/kg/min', 5, 'H', 'Inotrope', 'dobuject,dobu,dobutamin', '', '50 mg per mL. Cardiogenic shock / low output state.'],
    ['dopamine', 'Dopamine', 'Dopamine', 'med', 'cardio', '200 mg/5 mL', '200/5ml', 'Ampoule', 'IV,IO', 'IV', 'mcg/kg/min', 5, 'H', 'Inotrope', 'cetadop,dopac,dopamin,indop', '', '40 mg per mL. Extravasation risk - watch the cannula.'],
    ['diltiazem', 'Diltiazem', 'Diltiazem', 'med', 'cardio', '50 mg', '50mg', 'Vial', 'IV', 'IV', 'mg', 1, 'HS', 'Calcium channel blocker', 'herbesser,farmabes,dilmen,diltiazem hcl', '50mg/10ml', 'Rate control in stable narrow-complex tachycardia. Avoid in wide-complex and in heart failure.'],
    ['nitrogliserin', 'Nitrogliserin', 'Nitroglycerin', 'med', 'cardio', '1 mg/mL', '1mg/cc', 'Ampoule', 'IV,SL', 'IV', 'mcg/min', 2, 'H', 'Nitrate', 'ntg,glyceryl trinitrate,nitrocine,nitrokaf,gtn,trinitrosan', '', 'Hold if SBP < 90, inferior STEMI with RV involvement, or PDE5 inhibitor in 24-48 h.'],
    ['isdn', 'Isosorbide Dinitrate', 'Isosorbide dinitrate', 'med', 'cardio', '5 mg', '5mg', 'Tablet', 'SL,PO', 'SL', 'mg', 10, '', 'Nitrate', 'isdn,cedocard,farsorbid,isorbid,sublingual', '', 'Sublingual 5 mg, may repeat x3 at 5 min if SBP allows.'],
    ['aspilet', 'Aspilet / Nospirinal', 'Aspirin', 'med', 'cardio', '80 mg', '80mg', 'Tablet', 'PO', 'PO', 'mg', 10, '', 'Antiplatelet', 'aspirin,asa,nospirinal,acetylsalicylic acid,ascardia,asam asetilsalisilat,miniaspi', '', 'ACS loading dose 160-320 mg chewed.'],
    ['ticagrelor', 'Ticagrelor', 'Ticagrelor', 'med', 'cardio', '90 mg', '90mg', 'Tablet', 'PO', 'PO', 'mg', 10, '', 'Antiplatelet', 'brilinta,ticagrelol', '', 'ACS loading dose 180 mg (2 tablets).'],
    ['furosemide', 'Furosemide', 'Furosemide', 'med', 'cardio', '1 mg/mL (manifest)', '1mg/cc', 'Ampoule', 'IV,IM', 'IV', 'mg', 5, 'S', 'Loop diuretic', 'lasix,farsix,furosemid,impugan,uresix', '20mg/2ml', 'Manifest reads 1 mg/cc; the standard Indonesian ampoule is 20 mg/2 mL (10 mg/mL). Confirm the ampoule before dosing.'],

    /* ---- Fluids ------------------------------------------------------- */
    ['nacl-25', 'NaCl 25cc', 'Sodium chloride 0.9%', 'med', 'fluid', '25 mL', '0.9% 25ml', 'Flacon', 'IV,NA', 'IV', 'mL', 30, '', 'Crystalloid / diluent', 'normal saline,saline,ns,natrium klorida,nacl 0.9,flush,diluent,pengencer', '', 'Flush and drug diluent.'],
    ['nacl-100', 'NaCl 100cc', 'Sodium chloride 0.9%', 'med', 'fluid', '100 mL', '0.9% 100ml', 'Mini Kolf', 'IV', 'IV', 'mL', 10, '', 'Crystalloid', 'normal saline,saline,ns,natrium klorida,mini kolf,nacl 0.9', '', 'Infusion carrier for drug dilution.'],
    ['nacl-500', 'NaCl 500cc', 'Sodium chloride 0.9%', 'med', 'fluid', '500 mL', '0.9% 500ml', 'Kolf', 'IV', 'IV', 'mL', 10, '', 'Crystalloid', 'normal saline,saline,ns,natrium klorida,kolf,nacl 0.9,resus fluid', '', 'Resuscitation crystalloid.'],
    ['ringer-laktat', 'Ringer Laktat', "Lactated Ringer's", 'med', 'fluid', '500 mL', '500ml', 'Kolf', 'IV', 'IV', 'mL', 10, '', 'Crystalloid', 'rl,ringer lactate,hartmann,ringer,laktat,asering', '', 'First choice for exertional collapse and trauma.'],
    ['d10', 'D10', 'Dextrose 10%', 'med', 'fluid', '500 mL', '10% 500ml', 'Kolf', 'IV', 'IV', 'mL', 5, '', 'Glucose infusion', 'dextrose 10,glukosa 10,d10w,glucose', '', 'Maintenance glucose after a hypoglycaemia bolus.'],

    /* ---- Airway / RSI ------------------------------------------------- */
    ['rocuronium', 'Rocuronium', 'Rocuronium', 'med', 'airway', '50 mg/5 mL', '50mg/5cc', 'Ampoule', 'IV,IO', 'IV', 'mg', 3, 'H', 'Neuromuscular blocker', 'roculax,esmeron,rocu,rokuronium,paralytic,nmb', '', '10 mg per mL. RSI 1.2 mg/kg. Never before a confirmed plan to ventilate.'],
    ['midazolam', 'Midazolam', 'Midazolam', 'med', 'airway', '15 mg/3 mL', '15mg/3cc', 'Ampoule', 'IV,IM,IN,IO', 'IV', 'mg', 5, 'HC', 'Benzodiazepine', 'miloz,dormicum,sedacum,versed,midazolam hcl,sedation,seizure,kejang', '', '5 mg per mL. Status epilepticus 0.1-0.2 mg/kg IV or 0.2 mg/kg IN.'],
    ['propofol', 'Propofol', 'Propofol', 'med', 'airway', '200 mg/20 mL', '200mg/20cc', 'Ampoule', 'IV', 'IV', 'mg', 2, 'HC', 'General anaesthetic', 'recofol,diprivan,fresofol,propofol lipuro,induction', '', '10 mg per mL. Drops blood pressure - halve the dose in shock.'],
    ['ketamine', 'Ketamine', 'Ketamine', 'med', 'airway', '100 mg/mL', '100mg/ml', 'Vial', 'IV,IM,IO', 'IV', 'mg', 0, 'HC', 'Dissociative anaesthetic', 'ketalar,ketamin,kta,dissociative,induction', '', 'NOT carried on any of the three source manifests - listed so the RSI panel and analgesia ladder can reference it. Stock and set par before relying on it.'],

    /* Neither of the next two appears on any of the three source manifests.
       They are listed so the resuscitation algorithms can reference a real
       concentration, and because an event kit that may see an opioid overdose
       or significant trauma should arguably carry them. par 0 = not stocked. */
    ['naloxone', 'Naloxone', 'Naloxone', 'med', 'resus', '0.4 mg/mL', '0.4mg/1ml', 'Ampoule', 'IV,IM,IN,SC,IO', 'IV', 'mg', 0, 'H', 'Opioid antagonist', 'narcan,nalokson,opioid reversal,overdose,antidote', '', 'NOT carried on the source manifests. Titrate to breathing, not to consciousness; shorter-acting than most opioids, so the patient must be observed.'],
    ['tranexamic', 'Tranexamic Acid', 'Tranexamic acid', 'med', 'resus', '500 mg/5 mL', '500mg/5ml', 'Ampoule', 'IV,IO', 'IV', 'mg', 0, 'H', 'Antifibrinolytic', 'txa,kalnex,transamin,asam traneksamat,trauma,bleeding', '', 'NOT carried on the source manifests. 1 g over 10 min within 3 hours of significant trauma, then 1 g over 8 h.'],

    /* ---- Analgesia ---------------------------------------------------- */
    ['fentanyl', 'Fentanyl', 'Fentanyl', 'med', 'analgesia', '100 mcg/2 mL', '100mc/2cc', 'Ampoule', 'IV,IM,IN,IO', 'IV', 'mcg', 5, 'HC', 'Opioid', 'fenta,fentanil,opioid,narcotic,narkotika', '', 'Manifest writes "100mc/2cc" - that is 100 MICROGRAMS in 2 mL, i.e. 50 mcg/mL. Titrate 25-50 mcg.'],
    ['ketorolac', 'Ketorolac', 'Ketorolac', 'med', 'analgesia', '30 mg', '30mg', 'Ampoule', 'IV,IM', 'IV', 'mg', 5, '', 'NSAID', 'toradol,remopain,ketopain,xevolac,ketorolak,rolac,nsaid', '30mg/1ml', 'Avoid in bleeding, renal impairment, dehydrated runners.'],
    ['sumagesic', 'Sumagesic', 'Paracetamol', 'med', 'analgesia', '600 mg', '600mg', 'Tablet', 'PO', 'PO', 'mg', 30, '', 'Simple analgesic / antipyretic', 'paracetamol,acetaminophen,panadol,parasetamol,pct,antipyretic,demam', '', 'First rung of the ladder for mild pain and fever.'],
    ['paracetamol', 'Paracetamol', 'Paracetamol', 'med', 'analgesia', '500 mg', '500mg', 'Tablet', 'PO', 'PO', 'mg', 10, '', 'Simple analgesic / antipyretic', 'acetaminophen,parasetamol,pct,sanmol,panadol,pamol,demam', '', 'Max 4 g in 24 h.'],
    ['ibuprofen', 'Ibuprofen', 'Ibuprofen', 'med', 'analgesia', '400 mg', '400mg', 'Tablet', 'PO', 'PO', 'mg', 10, '', 'NSAID', 'proris,brufen,ibuprofen,nsaid,ibu', '', 'Withhold in suspected exercise-associated hyponatraemia or AKI risk.'],
    ['as-mefenamat', 'As. Mefenamat', 'Mefenamic acid', 'med', 'analgesia', '500 mg', '500mg', 'Tablet', 'PO', 'PO', 'mg', 10, '', 'NSAID', 'asam mefenamat,mefenamic acid,ponstan,mefinal,lapistan,nsaid', '', ''],
    ['myonal', 'Myonal', 'Eperisone', 'med', 'analgesia', '50 mg', '50mg', 'Tablet', 'PO', 'PO', 'mg', 10, '', 'Muscle relaxant', 'eperisone,myores,epsonal,muscle relaxant,kram,cramp,spasm', '', 'Muscle spasm and cramp after exertion.'],
    ['salonpas-jetspray', 'Salonpas Jetspray', 'Methyl salicylate topical spray', 'med', 'ortho', '60 mL', '60cc', 'Kaleng', 'TOP', 'TOP', 'spray', 5, '', 'Topical rubefacient', 'salonpas,spray otot,counterirritant,topical,semprot,pegal', '', 'Intact skin only.'],

    /* ---- GI ----------------------------------------------------------- */
    ['ondansetron-inj', 'Ondansetron Injection', 'Ondansetron', 'med', 'gi', '4 mg', '4mg', 'Ampoule', 'IV,IM', 'IV', 'mg', 5, '', 'Antiemetic (5-HT3)', 'narfoz,invomit,vomceran,ondan,ondansetron,mual,vomit,antiemetic', '4mg/2ml', ''],
    ['ondansetron-tab', 'Ondansetron Tablet', 'Ondansetron', 'med', 'gi', '4 mg', '4mg', 'Tablet', 'PO,SL', 'PO', 'mg', 10, '', 'Antiemetic (5-HT3)', 'narfoz,ondansetron,ondan,mual,antiemetic,oral', '', ''],
    ['metoclopramide', 'Metoclopramide', 'Metoclopramide', 'med', 'gi', '5 mg/mL', '5mg/cc', 'Ampoule', 'IV,IM', 'IV', 'mg', 5, '', 'Antiemetic / prokinetic', 'metoclompramide,primperan,vomitas,metoclopramid,norvom,mual', '', 'Manifest spells it "Metoclompramide". Watch for dystonia in young patients.'],
    ['ranitidine', 'Ranitidine', 'Ranitidine', 'med', 'gi', '50 mg', '50mg', 'Ampoule', 'IV,IM', 'IV', 'mg', 5, '', 'H2 antagonist', 'rantin,zantac,ranitidin,h2,maag', '50mg/2ml', ''],
    ['lansoprazole-inj', 'Lansoprazole Injection', 'Lansoprazole', 'med', 'gi', '30 mg', '30mg', 'Vial', 'IV', 'IV', 'mg', 5, 'S', 'Proton pump inhibitor', 'prosogan,lanzoprazol,lansoprazol,ppi,maag,gastritis', '30mg/5ml', 'Powder for reconstitution - confirm the reconstituted volume.'],
    ['lansoprazole-caps', 'Lansoprazole Capsule', 'Lansoprazole', 'med', 'gi', '30 mg', '30mg', 'Capsule', 'PO', 'PO', 'mg', 20, '', 'Proton pump inhibitor', 'prosogan,lansoprazol,ppi,oral,maag,gastritis', '', ''],
    ['omeprazole-inj', 'Omeprazole', 'Omeprazole', 'med', 'gi', '40 mg', '40mg', 'Vial', 'IV', 'IV', 'mg', 4, 'S', 'Proton pump inhibitor', 'pumpitor,ozid,losec,omeprazol,ppi,maag,gastritis', '40mg/10ml', 'Powder for reconstitution - confirm the reconstituted volume.'],
    ['buscopan', 'Buscopan', 'Hyoscine butylbromide', 'med', 'gi', '20 mg', '20mg', 'Ampoule', 'IV,IM', 'IV', 'mg', 5, '', 'Antispasmodic', 'hyoscine,butylscopolamine,scopamin,spasmal,hiosin,buscotica,kolik,colic,kram perut', '20mg/1ml', ''],
    ['sucralfat', 'Sucralfat', 'Sucralfate', 'med', 'gi', '100 mL bottle', '100cc', 'Bottle', 'PO', 'PO', 'mL', 3, '', 'Mucosal protectant', 'inpepsa,musin,sucralfate,sukralfat,maag,gastritis,syrup,sirup', '', '10 mL per dose.'],
    ['sendok-obat', 'Sendok Obat', 'Medicine spoon', 'supply', 'consumable', '5 mL', '', 'pcs', 'NA', 'NA', 'pcs', 5, '', 'Dosing device', 'medicine spoon,sendok,spoon,takar', '', ''],

    /* ---- Antibiotic ---------------------------------------------------- */
    ['ceftriaxone', 'Ceftriaxone', 'Ceftriaxone', 'med', 'other', '1 g powder', '1gr Powder', 'Vial', 'IV,IM', 'IV', 'mg', 3, 'S', 'Cephalosporin antibiotic', 'rocephin,broadced,cefrik,seftriakson,antibiotic,antibiotik', '1000mg/10ml', 'Powder - reconstitute with 10 mL water for injection, then dilute.'],

    /* ---- Allergy / steroid --------------------------------------------- */
    ['dexamethasone', 'Dexamethasone', 'Dexamethasone', 'med', 'allergy', '10 mg', '10mg', 'Ampoule', 'IV,IM', 'IV', 'mg', 6, '', 'Corticosteroid', 'dexa,kalmethasone,deksametason,steroid,corticosteroid', '10mg/2ml', 'Manifest row A47 pairs this with Hydrocortisone as one line; split here.'],
    ['hydrocortisone', 'Hydrocortisone', 'Hydrocortisone', 'med', 'allergy', '100 mg', '100mg', 'Vial', 'IV,IM', 'IV', 'mg', 6, 'S', 'Corticosteroid', 'solu-cortef,hidrokortison,steroid,corticosteroid', '100mg/2ml', 'Powder - reconstitute. Shares manifest row A47 with Dexamethasone.'],
    ['diphenhydramine', 'Diphenhydramine', 'Diphenhydramine', 'med', 'allergy', '10 mg', '10mg', 'Ampoule', 'IV,IM', 'IM', 'mg', 6, '', 'H1 antihistamine', 'dipenhydramine,dipenhidramin,benadryl,difenhidramin,antihistamine,alergi', '10mg/1ml', 'Manifest spells it "Dipenhydramine".'],
    ['cetirizine', 'Cetirizine', 'Cetirizine', 'med', 'allergy', '10 mg', '10mg', 'Tablet', 'PO', 'PO', 'mg', 10, '', 'H1 antihistamine', 'incidal,ozen,ryvel,setirizin,estin,antihistamine,alergi,gatal', '', ''],
    ['loratadine', 'Loratadine', 'Loratadine', 'med', 'allergy', '10 mg', '10mg', 'Tablet', 'PO', 'PO', 'mg', 10, '', 'H1 antihistamine', 'claritin,alloris,loratadin,antihistamine,alergi,gatal', '', ''],

    /* ---- Respiratory --------------------------------------------------- */
    ['farbivent', 'Farbivent', 'Ipratropium / Salbutamol', 'med', 'resp', '1 respule', '', 'Respules', 'NEB', 'NEB', 'respule', 5, '', 'Bronchodilator (combination)', 'combivent,ipratropium,salbutamol,duoneb,nebu,asma,asthma,wheeze,sesak', '', 'Nebulise with 6-8 L/min oxygen.'],
    ['pulmicort', 'Pulmicort', 'Budesonide', 'med', 'resp', '1 respule', '', 'Respules', 'NEB', 'NEB', 'respule', 5, '', 'Inhaled corticosteroid', 'budesonide,budesonid,nebu,asma,asthma,croup,stridor', '', ''],
    ['ventolin', 'Ventolin', 'Salbutamol', 'med', 'resp', '2.5 mg', '2.5mg', 'Respules', 'NEB', 'NEB', 'mg', 5, '', 'Beta-2 agonist', 'salbutamol,albuterol,nebu,salbutamol nebu,asma,asthma,wheeze,sesak', '', '2.5 mg per respule.'],

    /* ---- Endocrine / other meds ---------------------------------------- */
    ['novorapid', 'Novorapid', 'Insulin aspart', 'med', 'other', '100 IU/mL pen', '100iu/ml', 'Pen', 'SC,IV', 'SC', 'IU', 2, 'H', 'Rapid-acting insulin', 'insulin,aspart,insulin pen,novo rapid,flexpen,hyperglycaemia,hiperglikemi,gula darah tinggi', '', 'Pen holds 300 IU in 3 mL. Never give without a glucose reading.'],
    ['betaserc', 'Betaserc 24mg', 'Betahistine', 'med', 'other', '24 mg', '24mg', 'Tablet', 'PO', 'PO', 'mg', 10, '', 'Vestibular suppressant', 'betahistine,betahistin,mertigo,vertigo,merislon,pusing,dizzy,dizziness', '', ''],
    ['zegavit', 'Multivitamin (Zegavit)', 'Multivitamin', 'med', 'other', '1 tablet', '', 'Tablet', 'PO', 'PO', 'tab', 10, '', 'Vitamin supplement', 'multivitamin,vitamin,zegavit,supplement,suplemen', '', 'Carried on the Golden Jubilee manifest only.'],
    ['gentamycin-zalf', 'Gentamycin Zalf', 'Gentamicin ointment', 'med', 'wound', '0.1% tube', '0.1%', 'Tube', 'TOP', 'TOP', 'application', 8, '', 'Topical aminoglycoside', 'gentamisin,gentamicin,salep,zalf,ointment,luka,abrasion,topical', '', 'Thin layer on cleaned abrasions.'],

    /* ---- Syringes, lines, cannulae ------------------------------------- */
    ['spuit-3cc', 'Spuit 3cc', 'Syringe 3 mL', 'supply', 'consumable', '3 mL', '3ml', 'pcs', 'NA', 'NA', 'pcs', 30, '', 'Syringe', 'syringe,spuit,3cc,3ml,suntik', '', ''],
    ['spuit-5cc', 'Spuit 5cc', 'Syringe 5 mL', 'supply', 'consumable', '5 mL', '5ml', 'pcs', 'NA', 'NA', 'pcs', 30, '', 'Syringe', 'syringe,spuit,5cc,5ml,suntik', '', ''],
    ['spuit-10cc', 'Spuit 10cc', 'Syringe 10 mL', 'supply', 'consumable', '10 mL', '10ml', 'pcs', 'NA', 'NA', 'pcs', 30, '', 'Syringe', 'syringe,spuit,10cc,10ml,suntik', '', ''],
    ['spuit-20cc', 'Spuit 20cc', 'Syringe 20 mL', 'supply', 'consumable', '20 mL', '20ml', 'pcs', 'NA', 'NA', 'pcs', 5, '', 'Syringe', 'syringe,spuit,20cc,20ml,suntik', '', ''],
    ['spuit-50cc', 'Spuit 50cc', 'Syringe 50 mL', 'supply', 'consumable', '50 mL', '50ml', 'pcs', 'NA', 'NA', 'pcs', 5, '', 'Syringe', 'syringe,spuit,50cc,50ml,pump syringe,syringe pump', '', 'Also the syringe-pump barrel.'],
    ['extension-tube', 'Extension Tube', 'IV extension line', 'supply', 'consumable', '-', '', 'pcs', 'NA', 'NA', 'pcs', 5, '', 'Infusion line', 'extension tube,extension line,infuse pump,syringe pump,selang extension,perpanjangan', '', 'For the syringe / infusion pump.'],
    ['three-way-stopcock', 'Three Way Stopcock', 'Three-way stopcock', 'supply', 'consumable', '-', '', 'pcs', 'NA', 'NA', 'pcs', 5, '', 'Infusion line', 'three way,threeway,stopcock,3 way,kran infus', '', ''],
    ['infuse-set', 'Infuse Set', 'IV administration set', 'supply', 'fluid', '-', '', 'Set', 'NA', 'NA', 'set', 20, '', 'Infusion line', 'infus set,infuse set,giving set,selang infus,iv set,macro set', '', ''],
    ['iv-cannula-22g', 'Venflon / Vasofix 22G', 'IV cannula 22G', 'supply', 'fluid', '22 G', '', 'pcs', 'NA', 'NA', 'pcs', 20, '', 'Vascular access', 'terumo vasofix,vasofix,venflon,abocath,iv catheter,kanul,cannula,22g,iv line,surflo', '', 'Manifest A says Terumo Vasofix 22G, manifests B/C say Venflon 22G - one item here.'],
    ['wing-needle', 'Wing Needle', 'Butterfly needle', 'supply', 'consumable', '-', '', 'pcs', 'NA', 'NA', 'pcs', 10, '', 'Vascular access', 'wing needle,butterfly,scalp vein,kupu kupu', '', ''],
    ['novotwist-needle', 'Novotwist Needle', 'Insulin pen needle', 'supply', 'consumable', '-', '', 'Needle', 'NA', 'NA', 'pcs', 10, '', 'Pen needle', 'novotwist,pen needle,insulin needle,novofine,jarum insulin', '', 'Pairs with the Novorapid pen.'],

    /* ---- Airway consumables --------------------------------------------- */
    ['opa-merah', 'OPA / Guedel Merah', 'Oropharyngeal airway (red, size 4)', 'supply', 'airway', 'Size 4', '', 'pcs', 'NA', 'NA', 'pcs', 5, '', 'Basic airway', 'opa,guedel,oropharyngeal,merah,red,airway,mayo', '', ''],
    ['opa-ungu', 'OPA / Guedel Ungu', 'Oropharyngeal airway (purple, size 3)', 'supply', 'airway', 'Size 3', '', 'pcs', 'NA', 'NA', 'pcs', 5, '', 'Basic airway', 'opa,guedel,oropharyngeal,ungu,purple,airway,mayo', '', ''],
    ['lma-airq-4', 'Air-Q LMA Size 4', 'Laryngeal mask airway size 4', 'supply', 'airway', 'Size 4', '', 'pcs', 'NA', 'NA', 'pcs', 2, '', 'Supraglottic airway', 'lma,air-q,airq,laryngeal mask,supraglottic,sga,rescue airway', '', 'Air-Q specifically - not Teleflex or another LMA brand (manifest note).'],
    ['ett-7', 'ETT ukuran 7', 'Endotracheal tube 7.0 mm', 'supply', 'airway', '7.0 mm', '', 'pcs', 'NA', 'NA', 'pcs', 2, '', 'Definitive airway', 'ett,endotracheal,tube,intubasi,intubation,7.0,size 7', '', ''],
    ['ett-75', 'ETT ukuran 7.5', 'Endotracheal tube 7.5 mm', 'supply', 'airway', '7.5 mm', '', 'pcs', 'NA', 'NA', 'pcs', 2, '', 'Definitive airway', 'ett,endotracheal,tube,intubasi,intubation,7.5', '', ''],
    ['suction-set', 'Suction Set', 'Suction tubing, unit line and probe', 'supply', 'airway', '-', '', 'Set', 'NA', 'NA', 'set', 5, '', 'Suction', 'suction,selang suction,probe suction,yankauer,sedot', '', 'Unit line + suction line + probe.'],
    ['nebulizer-mask', 'Nebulizer Mask', 'Nebuliser mask and chamber', 'supply', 'resp', '-', '', 'pcs', 'NA', 'NA', 'pcs', 5, '', 'Oxygen delivery', 'nebu,nebuliser,nebulizer,masker nebu,chamber', '', ''],
    ['nrm', 'Non-Rebreathing Mask', 'Non-rebreathing mask', 'supply', 'resp', '-', '', 'pcs', 'NA', 'NA', 'pcs', 5, '', 'Oxygen delivery', 'nrm,non rebreathing,non-rebreahing,reservoir mask,masker oksigen,high flow', '', '10-15 L/min, reservoir inflated before application.'],
    ['nasal-canule', 'Nasal Canule', 'Nasal cannula', 'supply', 'resp', '-', '', 'pcs', 'NA', 'NA', 'pcs', 15, '', 'Oxygen delivery', 'nasal cannula,nasal canule,binasal,kanul oksigen,low flow', '', '1-6 L/min.'],

    /* ---- Wound care and tape -------------------------------------------- */
    ['kassa-steril', 'Kassa Steril', 'Sterile gauze', 'supply', 'wound', '-', '', 'Pack', 'NA', 'NA', 'pack', 10, '', 'Dressing', 'kassa sterie,kasa steril,gauze,sterile gauze,dressing,luka', '', 'Manifests B/C list this twice (Kassa Steril + Kassa Sterie) - one item, par summed.'],
    ['kassa-gulung', 'Kassa Gulung', 'Roll gauze', 'supply', 'wound', '-', '', 'pcs', 'NA', 'NA', 'pcs', 2, '', 'Dressing', 'kassa gulung,kasa gulung,roll gauze,bandage roll,verband', '', ''],
    ['micropore', 'Micropore', 'Surgical paper tape', 'supply', 'wound', '-', '', 'Gulung', 'NA', 'NA', 'roll', 3, '', 'Tape', 'micropore,paper tape,plester kertas,surgical tape,3m', '', ''],
    ['hipafix', 'Hipafix', 'Fabric adhesive tape', 'supply', 'wound', '-', '', 'Box', 'NA', 'NA', 'box', 1, '', 'Tape', 'hipafix,hypafix,fixomull,adhesive tape,plester kain', '', ''],
    ['hansaplast', 'Hansaplast Plester', 'Adhesive bandage', 'supply', 'wound', '-', '', 'pcs', 'NA', 'NA', 'pcs', 30, '', 'Dressing', 'hansaplast,plester,band aid,plaster,handyplast,lecet', '', ''],
    ['tegaderm', 'Tegaderm Infuse', 'Transparent film dressing', 'supply', 'wound', '-', '', 'pcs', 'NA', 'NA', 'pcs', 20, '', 'Dressing', 'tegaderm,transparent film dressing,film dressing,iv dressing,opsite', '', 'Secures the cannula; manifests B/C call it Transparent Film Dressing.'],
    ['alkohol-pre-pad', 'Alkohol Pre Pad', 'Alcohol swab', 'supply', 'consumable', '-', '', 'Box', 'NA', 'NA', 'box', 2, '', 'Antiseptic', 'alcohol swab,alkohol,pre pad,prep pad,swab,kapas alkohol', '', ''],
    ['tourniquette', 'Tourniquette', 'Tourniquet', 'supply', 'consumable', '-', '', 'pcs', 'NA', 'NA', 'pcs', 2, '', 'Vascular access / haemorrhage', 'tourniquet,tourniquette,torniket,cat,bendung,haemorrhage,bleeding', '', ''],
    ['gloves-handscoon', 'Gloves Handscoon', 'Examination gloves', 'supply', 'consumable', '-', '', 'Box', 'NA', 'NA', 'box', 2, '', 'PPE', 'gloves,handscoon,handschoen,sarung tangan,ppe,glove', '', 'Manifest A lists this on two rows (1 box each) - par 2.'],
    ['tissue-kering', 'Tissue Kering', 'Dry tissue', 'supply', 'consumable', '-', '', 'Pack', 'NA', 'NA', 'pack', 5, '', 'Consumable', 'tissue,tisu,dry tissue,kering,wipes', '', ''],
    ['plastik-kuning', 'Plastik Kuning Disposable', 'Yellow clinical waste bag', 'supply', 'consumable', '-', '', 'pcs', 'NA', 'NA', 'pcs', 20, '', 'Waste handling', 'plastik kuning,sampah medis,biohazard,clinical waste,yellow bag,infectious', '', ''],
    ['ecg-electrode', 'Elektroda Monitor ECG', 'ECG electrodes', 'supply', 'monitor', '-', '', 'pcs', 'NA', 'NA', 'pcs', 50, '', 'Monitoring consumable', 'elektroda,electrode,ecg sticker,ekg,monitor pad,dot', '', ''],

    /* ---- Ortho / immobilisation ----------------------------------------- */
    ['elastic-bandage-10', 'Elastic Bandage 10cm', 'Elastic bandage 10 cm with clips', 'supply', 'ortho', '10 cm', '', 'pcs', 'NA', 'NA', 'pcs', 10, '', 'Compression / support', 'elastic bandage,elastis,tensocrepe,crepe,10cm,kait,sprain,compression', '', 'Manifest A lists this on two rows (5 each) - par 10.'],
    ['mitella', 'Mitella', 'Triangular bandage', 'supply', 'ortho', '-', '', 'pcs', 'NA', 'NA', 'pcs', 2, '', 'Sling', 'mitella,triangular bandage,sling,arm sling,kain segitiga', '', ''],
    ['collar-neck', 'Collar Neck', 'Cervical collar', 'supply', 'ortho', '-', '', 'pcs', 'NA', 'NA', 'pcs', 1, '', 'Spinal immobilisation', 'collar,neck collar,cervical collar,c-collar,penyangga leher,c spine', '', ''],
    ['long-spalk', 'Long Spalk', 'Long limb splint', 'supply', 'ortho', '-', '', 'pcs', 'NA', 'NA', 'pcs', 2, '', 'Limb immobilisation', 'spalk,splint,bidai,long spalk,limb immobilization,fracture,fraktur', '', ''],

    /* ---- Equipment ------------------------------------------------------- */
    ['mini-bed', 'Mini Bed', 'Mini ICU bed', 'equipment', 'equipment', '-', '', 'unit', 'NA', 'NA', 'unit', 1, '', 'Bed', 'mini bed,bed,tempat tidur,icu bed', '', ''],
    ['stretcher-bed', 'Stretcher Bed (Brankar)', 'Wheeled stretcher', 'equipment', 'equipment', '-', '', 'unit', 'NA', 'NA', 'unit', 1, '', 'Bed', 'stretcher,brankar,trolley,gurney,ambulance cot', '', 'Manifest A calls it Stretcher Bed (ambulance), B/C call it Brankar (tent) - one item.'],
    ['wheelchair', 'Wheelchair', 'Wheelchair', 'equipment', 'equipment', '-', '', 'unit', 'NA', 'NA', 'unit', 2, '', 'Transfer', 'wheelchair,kursi roda,chair', '', ''],
    ['monitor-defib', 'Emergency Monitor w/ Defibrillator', 'Defibrillator-monitor', 'equipment', 'monitor', '-', '', 'unit', 'NA', 'NA', 'unit', 1, '', 'Monitoring / defibrillation', 'defib,defibrillator,aed,monitor,cardiac monitor,pacing,dc shock,kejut', '', 'Pads, paddles and pacing cable checked at every shift handover.'],
    ['ecg', 'Electrocardiogram (ECG)', '12-lead ECG machine', 'equipment', 'monitor', '-', '', 'unit', 'NA', 'NA', 'unit', 2, '', 'Diagnostics', 'ecg,ekg,12 lead,electrocardiogram,elektrokardiogram', '', ''],
    ['glucometer', 'Glucometer', 'Blood glucose meter', 'equipment', 'monitor', '-', '', 'unit', 'NA', 'NA', 'unit', 1, '', 'Diagnostics', 'glucometer,gds,bgl,gula darah,glucose meter,accucheck,strip', '', ''],
    ['thermometer-tympani', 'Termometer Tympani', 'Tympanic thermometer', 'equipment', 'monitor', '-', '', 'unit', 'NA', 'NA', 'unit', 1, '', 'Diagnostics', 'termometer,thermometer,tympanic,timpani,suhu,temperature,core temp', '', 'Core temperature for heat illness - rectal preferred if available.'],
    ['ultrasound', 'Ultrasound Portable', 'Portable ultrasound', 'equipment', 'monitor', '-', '', 'unit', 'NA', 'NA', 'unit', 1, '', 'Diagnostics', 'ultrasound,usg,pocus,echo,fast,sonografi', '', ''],
    ['ventilator', 'Ventilator Portable', 'Portable / mini ventilator', 'equipment', 'resp', '-', '', 'unit', 'NA', 'NA', 'unit', 1, '', 'Ventilation', 'ventilator,mini ventilator,portable ventilator,vent,transport ventilator', '', 'Manifest A calls it Mini Ventilator, B/C Ventilator Portable - one item.'],
    ['suction-machine', 'Portable Suction Machine', 'Portable suction unit', 'equipment', 'airway', '-', '', 'unit', 'NA', 'NA', 'unit', 1, '', 'Suction', 'suction machine,suction unit,portable suction,sedot,penyedot', '', ''],
    ['intubation-kit', 'Intubation Kit w/ Ambubag', 'Laryngoscope, fibre-optic stylet and bag-valve-mask', 'equipment', 'airway', '-', '', 'kit', 'NA', 'NA', 'kit', 1, '', 'Airway kit', 'intubation kit,laryngoscope,laringoskop,stylet,fiber optic,ambubag,bvm,bagging,bag valve mask', '', 'Blade sizes, bulb and cuff integrity checked before every shift.'],
    ['oxygen-cylinder', 'Oksigen Tabung 1.5L', 'Oxygen cylinder 1.5 m3', 'equipment', 'resp', '1.5 m3', '', 'tabung', 'NA', 'NA', 'tabung', 3, '', 'Medical gas', 'oksigen,oxygen,o2,tabung,cylinder,tabung kecil,regulator', '', 'Manifest A: 1.5 L kubik x3 (Mini ICU). B/C: 1.5 L tabung kecil x2 (tent).'],
    ['syringe-pump', 'Syringe Pump', 'Syringe pump', 'equipment', 'equipment', '-', '', 'unit', 'NA', 'NA', 'unit', 2, '', 'Infusion device', 'syringe pump,pump,infusion pump,pompa', '', 'Needed for Vascon / Dobutamine titration.'],
    ['tiang-infus', 'Tiang Infus', 'IV pole', 'equipment', 'equipment', '-', '', 'unit', 'NA', 'NA', 'unit', 2, '', 'Infusion support', 'tiang infus,iv pole,drip stand,standar infus', '', ''],
    ['mini-icu-med-kit', 'Mini ICU Med Kit', 'Mini ICU drug and consumable kit', 'equipment', 'equipment', '-', '', 'kit', 'NA', 'NA', 'kit', 1, '', 'Kit', 'mini icu kit,med kit,drug kit,kit obat', '', 'The sealed drug tray for the Mini ICU post.'],
    ['emergency-kit', 'Emergency Kit (Emergency Bag)', 'Emergency response bag', 'equipment', 'equipment', '-', '', 'kit', 'NA', 'NA', 'kit', 1, '', 'Kit', 'emergency kit,emergency bag,tas emergency,response bag,jump bag', '', 'Manifest A: Emergency Kit in the ambulance. B/C: Emergency Bag in the tent.'],
    ['ambulance-unit', 'Ambulans', 'Ambulance', 'equipment', 'equipment', '-', '', 'unit', 'NA', 'NA', 'unit', 1, '', 'Vehicle', 'ambulans,ambulance,unit,als,bls,evakuasi,transport', '', 'Parked at the venue access point.']
  ];

  /* ------------------------------------------------------------------ *
   * Row -> FormularyItem                                                *
   * ------------------------------------------------------------------ */

  function csv(s) {
    if (!s) return [];
    var parts = String(s).split(','), out = [], i, v;
    for (i = 0; i < parts.length; i++) {
      v = parts[i].trim();
      if (v) out.push(v);
    }
    return out;
  }

  function r4(n) { return Math.round(n * 10000) / 10000; }

  var INJ = { IV: 1, IM: 1, SC: 1, IO: 1 };

  // Charting units that imply a drug amount, so mL cannot be worked out without
  // a concentration. Items charted in mL / respules / pcs need no concentration.
  var MASS_UNITS = { mg: 1, mcg: 1, g: 1, IU: 1, mEq: 1, mmol: 1 };

  function isInjectable(routes) {
    for (var i = 0; i < routes.length; i++) if (INJ[routes[i]]) return true;
    return false;
  }

  // True when this item is dosed by amount through a needle and we still cannot
  // turn that amount into millilitres.
  function wantsStrength(kind, routes, unit, usable) {
    return kind === 'med' && isInjectable(routes) && !!MASS_UNITS[unit] && !usable;
  }

  function buildConc(strength, stdStr) {
    var raw = parseStrength(strength);
    var std = parseStrength(stdStr);
    var rawOk = !!(raw && raw.perMl != null && isFinite(raw.perMl));
    var stdOk = !!(std && std.perMl != null && isFinite(std.perMl));
    if (rawOk) return { amt: raw.amt, ml: raw.ml, unit: raw.unit, perMl: r4(raw.perMl), assumed: false };
    if (stdOk) return { amt: std.amt, ml: std.ml, unit: std.unit, perMl: r4(std.perMl), assumed: true };
    if (raw) return { amt: raw.amt, ml: raw.ml, unit: raw.unit, perMl: null, assumed: false };
    return null;
  }

  function expand(r, i) {
    var kind = r[3];
    var routes = csv(r[8]);
    var flags = String(r[12] || '');
    var forceS = flags.indexOf('S') >= 0;
    var conc = buildConc(r[6], r[15]);
    var usable = !!(conc && conc.perMl != null);

    return {
      _t: 'formulary',
      id: r[0],
      name: r[1],
      generic: r[2],
      cls: r[13],
      kind: kind,
      cat: r[4],
      dose: r[5],
      strength: r[6],
      form: r[7],
      routes: routes,
      defaultRoute: r[9],
      unit: r[10],
      par: r[11],
      stock: null,
      highAlert: flags.indexOf('H') >= 0,
      controlled: flags.indexOf('C') >= 0,
      conc: conc,
      concAssumed: !!(conc && conc.assumed),
      needsStrength: forceS || wantsStrength(kind, routes, r[10], usable),
      aliases: csv(r[14]),
      notes: r[16] || '',
      active: true,
      sort: (i + 1) * 10,
      custom: false
    };
  }

  F.DEFAULTS = (function () {
    var out = [], i;
    for (i = 0; i < ROWS.length; i++) out.push(expand(ROWS[i], i));
    return out;
  })();

  /* ------------------------------------------------------------------ *
   * Packs — exactly what each manifest carried                          *
   * ------------------------------------------------------------------ */

  F.packs = {
    // Manifest A — 2026 Jakarta Running Festival, "Advanced (Mini ICU)"
    'mini-icu': [
      'mini-bed', 'monitor-defib', 'oxygen-cylinder', 'mini-icu-med-kit', 'emergency-kit',
      'stretcher-bed', 'intubation-kit', 'suction-machine', 'ventilator', 'glucometer',
      'thermometer-tympani', 'syringe-pump', 'ultrasound', 'tiang-infus', 'ecg',
      'micropore', 'spuit-3cc', 'spuit-5cc', 'spuit-10cc', 'spuit-20cc', 'spuit-50cc',
      'extension-tube', 'three-way-stopcock', 'opa-merah', 'opa-ungu', 'lma-airq-4',
      'nebulizer-mask', 'nrm', 'adenosine', 'diltiazem', 'dobutamine', 'dopamine',
      'vascon', 'atropine', 'farbivent', 'pulmicort', 'ecg-electrode', 'tegaderm',
      'alkohol-pre-pad', 'hansaplast', 'hipafix', 'tourniquette', 'kassa-steril',
      'nacl-25', 'nacl-100', 'nacl-500', 'ringer-laktat', 'd10', 'd40',
      'novorapid', 'novotwist-needle', 'infuse-set', 'iv-cannula-22g', 'kassa-gulung',
      'nasal-canule', 'ondansetron-inj', 'metoclopramide', 'ceftriaxone', 'ranitidine',
      'ketorolac', 'buscopan', 'dexamethasone', 'hydrocortisone', 'diphenhydramine',
      'lansoprazole-inj', 'ibuprofen', 'sucralfat', 'sendok-obat', 'epinephrine',
      'amiodarone', 'meylon', 'ca-gluconas', 'mgso4', 'gloves-handscoon', 'rocuronium',
      'fentanyl', 'midazolam', 'propofol', 'aspilet', 'ticagrelor', 'isdn',
      'nitrogliserin', 'furosemide', 'ett-75', 'ett-7', 'suction-set',
      'elastic-bandage-10', 'tissue-kering', 'gentamycin-zalf', 'wing-needle', 'mitella',
      'loratadine', 'lansoprazole-caps', 'myonal', 'as-mefenamat', 'sumagesic',
      'salonpas-jetspray', 'collar-neck', 'long-spalk', 'plastik-kuning'
    ],
    // Manifests B + C — Junior Golf / Golden Jubilee, "Intermediate".
    // Identical lists except Zegavit, which only Golden Jubilee carried.
    'intermediate': [
      'wheelchair', 'stretcher-bed', 'oxygen-cylinder', 'emergency-kit', 'ventilator',
      'syringe-pump', 'ecg', 'tiang-infus', 'ambulance-unit',
      'micropore', 'spuit-3cc', 'spuit-5cc', 'spuit-10cc', 'spuit-20cc', 'spuit-50cc',
      'extension-tube', 'zegavit', 'dopamine', 'dobutamine', 'vascon', 'fentanyl',
      'midazolam', 'tegaderm', 'alkohol-pre-pad', 'hansaplast', 'hipafix', 'wing-needle',
      'tourniquette', 'kassa-steril', 'gentamycin-zalf', 'nacl-25', 'nacl-100',
      'nacl-500', 'ringer-laktat', 'd10', 'infuse-set', 'iv-cannula-22g', 'kassa-gulung',
      'mitella', 'paracetamol', 'ibuprofen', 'ondansetron-inj', 'ondansetron-tab',
      'omeprazole-inj', 'betaserc', 'cetirizine', 'ranitidine', 'ketorolac', 'buscopan',
      'dexamethasone', 'diphenhydramine', 'lansoprazole-caps', 'myonal', 'as-mefenamat',
      'sucralfat', 'sendok-obat', 'epinephrine', 'amiodarone', 'gloves-handscoon',
      'sumagesic', 'collar-neck', 'nasal-canule', 'nrm', 'nebulizer-mask', 'ventolin'
    ],
    // Not on any manifest: the sensible first-aid / roaming-post subset derived from
    // Intermediate — no vasopressors or inotropes, no controlled drugs, no advanced
    // airway, no pumps. Edit it in Settings for a given event.
    'basic': [
      'emergency-kit', 'stretcher-bed', 'wheelchair', 'oxygen-cylinder', 'glucometer',
      'thermometer-tympani', 'ecg-electrode',
      'micropore', 'spuit-3cc', 'spuit-5cc', 'spuit-10cc', 'extension-tube',
      'alkohol-pre-pad', 'hansaplast', 'hipafix', 'tegaderm', 'kassa-steril',
      'kassa-gulung', 'elastic-bandage-10', 'mitella', 'collar-neck', 'long-spalk',
      'tourniquette', 'gloves-handscoon', 'plastik-kuning', 'tissue-kering',
      'gentamycin-zalf', 'nacl-25', 'nacl-500', 'ringer-laktat', 'infuse-set',
      'iv-cannula-22g', 'wing-needle', 'nasal-canule', 'nrm', 'nebulizer-mask',
      'ventolin', 'farbivent', 'epinephrine', 'd40', 'dexamethasone', 'diphenhydramine',
      'cetirizine', 'loratadine', 'paracetamol', 'sumagesic', 'ibuprofen',
      'as-mefenamat', 'myonal', 'salonpas-jetspray', 'ondansetron-tab',
      'ondansetron-inj', 'ketorolac', 'buscopan', 'lansoprazole-caps', 'sucralfat',
      'betaserc', 'sendok-obat'
    ]
  };

  /* ------------------------------------------------------------------ *
   * Live catalogue: DEFAULTS + stored user edits + custom items          *
   * ------------------------------------------------------------------ */

  function clone(it) {
    var c = Object.assign({}, it);
    c.routes = it.routes ? it.routes.slice() : [];
    c.aliases = it.aliases ? it.aliases.slice() : [];
    c.conc = it.conc ? Object.assign({}, it.conc) : null;
    return c;
  }

  // Fill in whatever a user-created or user-edited record left out so the rest of
  // the app never has to guard against a half-built item.
  function normalise(doc, base) {
    var it = base ? clone(base) : {
      _t: 'formulary', id: '', name: '', generic: '', cls: '', kind: 'med', cat: 'other',
      dose: '', strength: '', form: '', routes: [], defaultRoute: '', unit: '',
      par: 0, stock: null, highAlert: false, controlled: false, conc: null,
      concAssumed: false, needsStrength: false, aliases: [], notes: '',
      active: true, sort: 9000, custom: true
    };
    var k;
    for (k in doc) {
      if (!Object.prototype.hasOwnProperty.call(doc, k)) continue;
      if (k === 'routes' || k === 'aliases') {
        it[k] = Array.isArray(doc[k]) ? doc[k].slice() : csv(doc[k]);
      } else if (k === 'conc') {
        it.conc = doc.conc ? Object.assign({}, doc.conc) : null;
      } else {
        it[k] = doc[k];
      }
    }
    it._t = 'formulary';
    if (!it.name) it.name = it.generic || it.id;
    if (!it.generic) it.generic = it.name;
    if (F.KINDS.indexOf(it.kind) < 0) it.kind = 'med';
    if (!CAT_BY_ID[it.cat]) it.cat = 'other';
    if (!it.routes.length) it.routes = [it.defaultRoute || 'NA'];
    if (!it.defaultRoute || it.routes.indexOf(it.defaultRoute) < 0) it.defaultRoute = it.routes[0];
    it.par = EV.has(EV.num(it.par)) ? EV.num(it.par) : 0;
    it.highAlert = !!it.highAlert;
    it.controlled = !!it.controlled;
    it.custom = !!it.custom;
    it.active = it.active !== false;

    // Re-derive the concentration whenever the strength was touched, unless the
    // editor supplied an explicit conc object.
    var suppliedConc = Object.prototype.hasOwnProperty.call(doc, 'conc') && doc.conc;
    if (!suppliedConc) {
      var c = buildConc(it.strength, '');
      if (c) {
        it.conc = c;
        it.concAssumed = false;
      } else if (base && base.conc && base.strength === it.strength) {
        it.conc = clone(base).conc;
        it.concAssumed = base.concAssumed;
      } else {
        it.conc = null;
        it.concAssumed = false;
      }
    }
    if (!Object.prototype.hasOwnProperty.call(doc, 'needsStrength')) {
      it.needsStrength = wantsStrength(it.kind, it.routes, it.unit,
        !!(it.conc && it.conc.perMl != null));
    }
    if (!EV.has(EV.num(it.sort))) it.sort = 9000;
    return it;
  }
  F.normalise = normalise;

  function bySort(a, b) {
    if (a.sort !== b.sort) return a.sort - b.sort;
    return a.name < b.name ? -1 : (a.name > b.name ? 1 : 0);
  }

  var DEFAULT_IX = {};
  (function () {
    for (var i = 0; i < F.DEFAULTS.length; i++) DEFAULT_IX[F.DEFAULTS[i].id] = F.DEFAULTS[i];
  })();

  /**
   * Merge stored formulary docs over DEFAULTS.
   *  - a stored doc with _deleted / removed removes the item outright
   *  - a stored doc whose id exists in DEFAULTS patches that item
   *  - any other stored doc is a custom item
   */
  F.merge = function (stored) {
    var out = [], seen = {}, i, doc, base;
    var patch = {}, drop = {}, extra = [];
    stored = stored || [];
    for (i = 0; i < stored.length; i++) {
      doc = stored[i];
      if (!doc || !doc.id) continue;
      if (doc._deleted || doc.removed) { drop[doc.id] = true; continue; }
      if (DEFAULT_IX[doc.id]) patch[doc.id] = doc;
      else extra.push(doc);
    }
    for (i = 0; i < F.DEFAULTS.length; i++) {
      base = F.DEFAULTS[i];
      if (drop[base.id]) continue;
      out.push(patch[base.id] ? normalise(patch[base.id], base) : clone(base));
      seen[base.id] = true;
    }
    for (i = 0; i < extra.length; i++) {
      if (seen[extra[i].id] || drop[extra[i].id]) continue;
      doc = normalise(extra[i], null);
      if (!doc.id) continue;
      doc.custom = true;
      seen[doc.id] = true;
      out.push(doc);
    }
    out.sort(bySort);
    return out;
  };

  var ITEM_IX = {};

  function install(items) {
    F.items = items;
    ITEM_IX = {};
    TRIG = {};
    HAY = {};
    for (var i = 0; i < items.length; i++) ITEM_IX[items[i].id] = items[i];
    F.index = ITEM_IX;
    return items;
  }

  /** Load the catalogue: DEFAULTS + whatever the user has edited or added. */
  /* Synchronous: EV.store keeps the whole working set in memory, and every
     caller (the picker, the editor, the recap, the PDF) needs the catalogue
     inline while it is building a row. Returning a Promise here meant the
     Excel recap tried to sort one. */
  F.load = function () {
    var rows = [];
    if (EV.store && typeof EV.store.all === 'function') {
      try {
        var r = EV.store.all('formulary');
        if (Array.isArray(r)) rows = r;
      } catch (e) { EV.logError('formulary.load', e); }
    }
    install(F.merge(rows));
    return F.items;
  };
  /* Kept for callers that would rather await. */
  F.loadAsync = function () { return Promise.resolve(F.load()); };

  F.byId = function (id) {
    if (!id) return undefined;
    return ITEM_IX[id] || DEFAULT_IX[id];
  };

  /** All active items, optionally filtered by category or kind. */
  F.list = function (opts) {
    var o = opts || {}, out = [], i, it;
    for (i = 0; i < F.items.length; i++) {
      it = F.items[i];
      if (it.active === false && !o.includeInactive) continue;
      if (o.cat && it.cat !== o.cat) continue;
      if (o.kind && it.kind !== o.kind) continue;
      if (o.pack && F.packs[o.pack] && F.packs[o.pack].indexOf(it.id) < 0) continue;
      out.push(it);
    }
    return out;
  };

  /** Resolve a pack name to its items, skipping ids the user has removed. */
  F.pack = function (name) {
    var ids = F.packs[name] || [], out = [], i, it;
    for (i = 0; i < ids.length; i++) {
      it = F.byId(ids[i]);
      if (it) out.push(it);
    }
    return out;
  };

  /* ------------------------------------------------------------------ *
   * Concentration helpers                                               *
   * ------------------------------------------------------------------ */

  /**
   * Amount per millilitre for an injectable.
   * -> { perMl, unit, amt, ml, assumed, id } or null when unknown.
   */
  F.conc = function (idOrItem) {
    var it = typeof idOrItem === 'string' ? F.byId(idOrItem) : idOrItem;
    if (!it || !it.conc || it.conc.perMl == null) return null;
    return {
      id: it.id,
      perMl: it.conc.perMl,
      unit: it.conc.unit,
      amt: it.conc.amt,
      ml: it.conc.ml,
      assumed: !!it.conc.assumed
    };
  };

  /** Millilitres needed for `amount` of `unit` of this item, or null. */
  F.mlFor = function (idOrItem, amount, unit) {
    var c = F.conc(idOrItem);
    var a = EV.num(amount);
    if (!c || !EV.has(a)) return null;
    var want = unit || c.unit;
    var scale = 1;
    if (want !== c.unit) {
      if (want === 'mcg' && c.unit === 'mg') scale = 0.001;
      else if (want === 'mg' && c.unit === 'mcg') scale = 1000;
      else if (want === 'mg' && c.unit === 'g') scale = 0.001;
      else if (want === 'g' && c.unit === 'mg') scale = 1000;
      else return null;
    }
    if (!c.perMl) return null;
    return { ml: r4((a * scale) / c.perMl), perMl: c.perMl, unit: c.unit, assumed: c.assumed };
  };

  /* ------------------------------------------------------------------ *
   * Search — typo tolerant, name + generic + aliases                    *
   * Ranking: exact > full prefix > word prefix > substring > trigram     *
   * ------------------------------------------------------------------ */

  var TRIG = {};   // normalised string -> trigram set
  var HAY = {};    // item id -> weighted haystack fields

  // Lower-case, strip punctuation, keep digits and decimal points ("7.5", "0.9%").
  function norm(s) {
    var t = String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9%.\s]+/g, ' ');
    var src = t;
    t = src.replace(/\./g, function (m, off) {
      var prev = src.charAt(off - 1), next = src.charAt(off + 1);
      var pd = prev >= '0' && prev <= '9';
      var nd = next >= '0' && next <= '9';
      return (pd && nd) ? '.' : ' ';
    });
    return t.replace(/\s+/g, ' ').trim();
  }
  F.norm = norm;

  function trig(s) {
    if (TRIG[s]) return TRIG[s];
    var t = ' ' + s + ' ', m = { __n: 0 }, i, g;
    for (i = 0; i + 3 <= t.length; i++) {
      g = t.substr(i, 3);
      if (!m[g]) { m[g] = 1; m.__n++; }
    }
    TRIG[s] = m;
    return m;
  }

  function dice(a, b) {
    if (!a.__n || !b.__n) return 0;
    var small = a.__n <= b.__n ? a : b;
    var big = small === a ? b : a;
    var shared = 0, k;
    for (k in small) {
      if (k === '__n') continue;
      if (big[k]) shared++;
    }
    return (2 * shared) / (a.__n + b.__n);
  }

  function hay(it) {
    if (HAY[it.id]) return HAY[it.id];
    var fs = [], i, s;
    var nName = norm(it.name);
    fs.push({ s: nName, w: 1 });
    s = norm(it.generic);
    if (s && s !== nName) fs.push({ s: s, w: 0.94 });
    for (i = 0; i < it.aliases.length; i++) {
      s = norm(it.aliases[i]);
      if (s && s !== nName) fs.push({ s: s, w: 0.86 });
    }
    s = norm(it.cls);
    if (s) fs.push({ s: s, w: 0.58 });
    s = norm(it.form);
    if (s) fs.push({ s: s, w: 0.44 });
    s = norm(F.catLabel(it.cat));
    if (s) fs.push({ s: s, w: 0.38 });
    HAY[it.id] = fs;
    return fs;
  }

  function fieldScore(h, q, qt) {
    if (!h) return 0;
    if (h === q) return 1000;
    if (h.indexOf(q) === 0) return 740;
    var words = h.split(' '), i, best = 0, d, dw, w;
    for (i = 0; i < words.length; i++) {
      w = words[i];
      if (w === q) { best = 680; break; }
      if (w.indexOf(q) === 0 && best < 620) best = 620;
    }
    if (best) return best;
    if (h.indexOf(q) >= 0) return 420;
    if (q.length < 4) return 0;                 // too short to fuzzy-match safely
    d = dice(trig(h), qt);
    for (i = 0; i < words.length; i++) {
      if (words[i].length >= 4) {
        dw = dice(trig(words[i]), qt);
        if (dw > d) d = dw;
      }
    }
    if (d >= 0.34) return Math.round(300 * d);
    return 0;
  }

  /** search() with the scores attached: [{ item, score }], best first. */
  F.searchScored = function (q, opts) {
    var o = opts || {};
    var pool = F.list(o);
    var nq = norm(q);
    var out = [], i, j, k;

    if (!nq) {
      for (i = 0; i < pool.length; i++) out.push({ item: pool[i], score: 0 });
      return o.limit ? out.slice(0, o.limit) : out;
    }

    var toks = nq.split(' '), qt = [];
    for (i = 0; i < toks.length; i++) qt.push(trig(toks[i]));

    for (i = 0; i < pool.length; i++) {
      var it = pool[i], fields = hay(it), total = 0, ok = true;
      for (j = 0; j < toks.length; j++) {
        var best = 0;
        for (k = 0; k < fields.length; k++) {
          var sc = fieldScore(fields[k].s, toks[j], qt[j]) * fields[k].w;
          if (sc > best) best = sc;
        }
        if (!best) { ok = false; break; }
        total += best;
      }
      if (!ok) continue;
      if (fields[0].s === nq) total += 1200;      // typed the name exactly
      if (it.active === false) total = total * 0.5;
      out.push({ item: it, score: Math.round(total) });
    }

    out.sort(function (a, b) {
      if (b.score !== a.score) return b.score - a.score;
      if (a.item.name.length !== b.item.name.length) return a.item.name.length - b.item.name.length;
      return a.item.sort - b.item.sort;
    });
    return o.limit ? out.slice(0, o.limit) : out;
  };

  /** Typo-tolerant lookup. An empty query returns the whole active catalogue. */
  F.search = function (q, opts) {
    var scored = F.searchScored(q, opts), out = [], i;
    for (i = 0; i < scored.length; i++) out.push(scored[i].item);
    return out;
  };

  install(F.merge([]));

  /* ------------------------------------------------------------------ *
   * Display                                                             *
   * ------------------------------------------------------------------ */

  function nf(x) { return EV.has(x) ? String(EV.r(x, 3)) : '?'; }

  /* The chart prints the vial strength beside every dose, so the formulary
     owns how a concentration is written rather than each caller inventing a
     format. An assumed strength says so — a nurse must be able to see that
     the number came from a standard ampoule, not from the manifest. */
  var rawConc = F.conc;
  F.conc = function (idOrItem) {
    var c = rawConc(idOrItem);
    if (!c) return null;
    c.label = (c.amt != null && c.ml != null)
      ? nf(c.amt) + ' ' + c.unit + '/' + nf(c.ml) + ' mL'
      : nf(c.perMl) + ' ' + c.unit + '/mL';
    if (c.assumed) c.label += ' — assumed, check the label';
    return c;
  };

  /* ------------------------------------------------------------------ *
   * Self test                                                           *
   * ------------------------------------------------------------------ */

  F.selfTest = function () {
    var fails = [], n = 0;
    function eq(name, got, want) {
      n++;
      var g = JSON.stringify(got), w = JSON.stringify(want);
      if (g !== w) fails.push({ name: name, expected: w, got: g });
    }
    function near(name, got, want, tol) {
      n++;
      if (!EV.has(got) || Math.abs(got - want) > (tol || 0.001)) {
        fails.push({ name: name, expected: String(want), got: String(got) });
      }
    }

    eq('catalogue loaded', F.DEFAULTS.length >= 100, true);

    var ids = {}, dupes = [];
    for (var i = 0; i < F.DEFAULTS.length; i++) {
      var id = F.DEFAULTS[i].id;
      if (ids[id]) dupes.push(id);
      ids[id] = 1;
    }
    eq('no duplicate ids', dupes, []);

    /* The manifest shorthands. Getting any of these wrong is a wrong volume
       drawn up at the bedside. */
    near('250/5ml is 50 mg/mL', parseStrength('250/5ml').perMl, 50);
    near('100mc/2cc is 50 mcg/mL', parseStrength('100mcg/2ml').perMl, 50);
    near('400mg/25cc is 16 mg/mL', parseStrength('400mg/25cc').perMl, 16);
    near('0.25/cc is 0.25 mg/mL', parseStrength('0.25/cc').perMl, 0.25);
    near('40% is 400 mg/mL', parseStrength('40%').perMl, 400);
    near('1g becomes 1000 mg', parseStrength('1g').amt, 1000);
    eq('blank strength is null', parseStrength(''), null);
    eq('dash strength is null', parseStrength('-'), null);

    /* Fentanyl is the one the manifest writes ambiguously ("100mc/2cc").
       Treating those micrograms as milligrams would be a thousand-fold error. */
    var fent = F.conc('fentanyl');
    eq('fentanyl unit is mcg', fent && fent.unit, 'mcg');
    near('fentanyl is 50 mcg/mL', fent && fent.perMl, 50);

    var epi = F.conc('epinephrine');
    near('adrenaline is 1 mg/mL', epi && epi.perMl, 1);
    eq('adrenaline label', epi && epi.label, '1 mg/1 mL — assumed, check the label');
    eq('adrenaline strength is flagged assumed', epi && epi.assumed, true);

    var atr = F.conc('atropine');
    near('atropine is 0.25 mg/mL', atr && atr.perMl, 0.25);

    var mg = F.mlFor('mgso4', 2000, 'mg');
    near('2 g MgSO4 is 125 mL at 16 mg/mL', mg && mg.ml, 125, 0.01);

    var fx = F.mlFor('fentanyl', 50, 'mcg');
    near('50 mcg fentanyl is 1 mL', fx && fx.ml, 1, 0.001);

    eq('mlFor with no dose is null', F.mlFor('epinephrine', '', 'mg'), null);
    eq('mlFor on a tablet is null', F.mlFor('sumagesic', 600, 'mg'), null);

    /* Search has to survive how people actually type at 3 a.m. */
    function finds(q, id) {
      var r = F.search(q, { limit: 8 });
      for (var j = 0; j < r.length; j++) if (r[j].id === id) return true;
      return false;
    }
    eq('norepi finds Vascon', finds('norepi', 'vascon'), true);
    eq('noradrenaline finds Vascon', finds('noradrenaline', 'vascon'), true);
    eq('adrenalin finds epinephrine', finds('adrenalin', 'epinephrine'), true);
    eq('nacl finds a saline', F.search('nacl', { limit: 8 }).length >= 3, true);
    eq('bicnat finds meylon', finds('bicnat', 'meylon'), true);
    eq('typo ondancetron still finds it', F.search('ondancetron', { limit: 5 }).length > 0, true);
    eq('empty query returns the catalogue', F.search('').length >= 100, true);
    eq('nonsense returns nothing', F.search('zzzzqqq', { limit: 5 }).length, 0);

    /* High-alert and controlled flags gate the UI's warnings. */
    function flag(id, key) { var it = F.byId(id); return !!(it && it[key]); }
    eq('adrenaline is high alert', flag('epinephrine', 'highAlert'), true);
    eq('fentanyl is controlled', flag('fentanyl', 'controlled'), true);
    eq('midazolam is controlled', flag('midazolam', 'controlled'), true);
    eq('propofol is controlled', flag('propofol', 'controlled'), true);
    eq('gauze is not high alert', flag('kassa-steril', 'highAlert'), false);

    eq('packs resolve', F.pack('mini-icu').length > 10, true);
    eq('list filters by kind', F.list({ kind: 'med' }).every(function (x) { return x.kind === 'med'; }), true);
    eq('byId on nonsense', F.byId('nope-nope'), undefined);

    return { pass: n - fails.length, fail: fails.length, total: n, failures: fails };
  };

})(window.EV = window.EV || {});
