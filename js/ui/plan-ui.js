// Trainingsplan in der Oberfläche: Karte auf Home (heutige Einheit,
// Wochenstreifen, Hinweis nach langer Pause) und der Dialog zum Anlegen
// und Ändern. Die Rechnung steckt in js/plan.js; der Plan liegt als
// Einstellung „plan" in der Datenbank (und damit auch in der Sicherung).

import { getSettings, setSetting, listSessions } from '../storage.js';
import { planAnlegen, wocheAb, wocheWirksam, naechsteEinheit, wochenMinuten, titel, programmFuer,
  verschiebeZiele, mitAnpassung, ohneAnpassungen, hatAnpassungen, kuerzerDauer, istHart,
  planWoche, planEnde, planBilanz, istAbgeschlossen, pausieren, wiedereinstieg,
  tagIso, montag, WOCHENTAGE, DAUERN, LAENGEN, ZIELE } from '../plan.js';
import { baueBlocks } from '../program.js';
import { drawProfile, beobachte } from './chart.js';
import { effektiveFtp } from '../metrics.js';
import { oeffneModal } from '../navigation.js';
import { toastOk, toastRueckgaengig } from './toast.js';

const $ = s => document.querySelector(s);
const TAG_MS = 864e5;
const HINWEIS_NACH_TAGEN = 7;              // ohne Fahrt → Wiedereinstieg anbieten
const minutenText = m => m >= 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min` : `${m} min`;
const wochentagLang = iso => new Date(iso + 'T12:00').toLocaleDateString('de-DE', { weekday: 'short' });

let profilAbmelden = null;
const montagPlus = (d, n) => { const m = montag(d); return new Date(m.getFullYear(), m.getMonth(), m.getDate() + n); };

// Karte auf Home. starte(programm, { vorgaben, planRef }) öffnet den Startdialog.
export async function renderPlan({ starte, heute = new Date() } = {}) {
  const [settings, sessions] = await Promise.all([getSettings(), listSessions()]);
  const plan = settings.plan;
  const karte = $('#plan-karte');
  $('#plan-anlegen').hidden = !!plan;
  karte.hidden = !plan;
  profilAbmelden?.();
  profilAbmelden = null;
  if (!plan) return;

  const ftp = settings.ftp;
  const heuteIso = tagIso(heute);
  const neuZeichnen = () => renderPlan({ starte, heute });
  const speichern = async (neu, meldung) => {
    await setSetting('plan', neu);
    neuZeichnen();
    toastRueckgaengig(meldung, async () => { await setSetting('plan', plan); neuZeichnen(); });
  };
  const hinweis = (text, aktion, aktion2 = null) => {
    $('#plan-hinweis').hidden = !text && !aktion;
    $('#plan-hinweis-text').hidden = !text;
    $('#plan-hinweis-text').textContent = text ?? '';
    const [a, b] = [$('#plan-aktion'), $('#plan-aktion-2')];
    a.textContent = aktion?.label ?? ''; a.onclick = aktion?.fn ?? null; a.hidden = !aktion;
    b.textContent = aktion2?.label ?? ''; b.onclick = aktion2?.fn ?? null; b.hidden = !aktion2;
  };
  const sonderzustand = (kicker, titelText, sub) => {
    $('#plan-kicker').textContent = kicker;
    $('#plan-titel').textContent = titelText;
    $('#plan-sub').textContent = sub;
    $('#plan-heute').disabled = true;
    $('#plan-heute').onclick = null;
    $('#plan-profil').hidden = true;
    $('#plan-woche').hidden = true;
    $('#plan-info').hidden = true;
  };
  $('#plan-woche').hidden = false;

  // Pausiert: keine Einheiten, nichts wird verpasst; Fortsetzen nach Pausenlänge
  if (plan.pause) {
    const vorschau = wiedereinstieg(plan, plan.pause.seit, heute);
    sonderzustand('Trainingsplan · pausiert', `Pausiert seit ${datumLang(plan.pause.seit)}`,
      `Fortsetzen heute nach ${vorschau.tage} ${vorschau.tage === 1 ? 'Tag' : 'Tagen'}: ${vorschau.text}.`);
    hinweis('', { label: 'Fortsetzen', fn: () => speichern(vorschau.plan, `Plan läuft wieder — ${vorschau.text}`) });
    return;
  }
  // Abgeschlossen: Bilanz, dann weiter (+4 Wochen) oder neuer Plan
  if (istAbgeschlossen(plan, heute)) {
    const bilanz = planBilanz(plan, sessions, heute);
    sonderzustand('Trainingsplan · abgeschlossen', 'Plan geschafft ✓',
      `${bilanz.gefahren} Trainingstage in ${plan.laenge} Wochen (${bilanz.geplant} Einheiten geplant)`
      + (plan.ftp && ftp ? ` · FTP ${plan.ftp} → ${ftp} W` : ftp ? ` · FTP jetzt ${ftp} W` : ''));
    const ende = tagIso(new Date(planEnde(plan).getTime() + TAG_MS));
    hinweis('', {
      label: '4 Wochen weiter',
      fn: () => { const w = wiedereinstieg({ ...plan, laenge: plan.laenge + 4 }, ende, heute);
        speichern(w.plan, `Plan verlängert — ${w.text}`); },
    }, { label: 'Neuer Plan', fn: () => oeffnePlanDialog({ heute, neu: true }).then(g => g && neuZeichnen()) });
    return;
  }
  // Die Woche, wie sie wirklich läuft: verpasste harte Einheiten sind schon verschoben
  const woche = wocheWirksam(plan, heute, sessions, heute, ftp);
  const heuteTag = woche.find(t => t.datum === heuteIso);
  const e = heuteTag.einheit;
  const erledigt = heuteTag.status === 'erledigt';
  const naechste = woche.find(t => t.datum > heuteIso && t.einheit)?.einheit
    ?? naechsteEinheit(plan, montagPlus(heute, 7), ftp);

  // Kopf: Planwoche (von Länge), leichte Woche benannt
  const pw = Math.max(0, planWoche(plan, heute));
  $('#plan-kicker').textContent = `Trainingsplan · Woche ${pw + 1}${plan.laenge ? ` von ${plan.laenge}` : ''}${pw % 4 === 3 ? ' · leichte Woche' : ''}`;

  // Heute
  const knopf = $('#plan-heute');
  const profil = $('#plan-profil');
  const naechsteText = naechste ? `Nächste: ${wochentagLang(naechste.datum)} · ${titel(naechste)}` : '';
  if (e && !erledigt) {
    $('#plan-titel').textContent = `Heute: ${titel(e)}`;
    const art = e.typ === 'T' ? 'FTP-Test — danach passen sich alle Einheiten an'
      : `${e.art === 'hart' ? 'Hart' : 'Locker'} · ${e.sub ?? programmFuer(e).sub}`;
    $('#plan-sub').textContent = e.verschobenVon ? `Verschoben von ${wochentagLang(e.verschobenVon)} · ${art}` : art;
    knopf.disabled = false;
    // Lockere Einheiten heißen nach ihrer Rolle („Grundlage", nicht „Ausdauer") —
    // so stehen sie auch in Startdialog und Fahrtenliste
    const p = e.art === 'locker' ? { ...programmFuer(e), name: e.name } : programmFuer(e);
    knopf.onclick = () => starte(p, { vorgaben: e.opts, planRef: e.ref });
    profil.hidden = false;
    const zeichne = c => drawProfile(c, baueBlocks(programmFuer(e), { ...e.opts }, ftp), effektiveFtp(ftp));
    zeichne(profil);
    profilAbmelden = beobachte(profil, zeichne);
  } else {
    $('#plan-titel').textContent = erledigt ? `Heute erledigt ✓` : 'Heute frei';
    $('#plan-sub').textContent = naechsteText;
    knopf.disabled = true;
    knopf.onclick = null;
    profil.hidden = true;
  }

  // Wochenstreifen: Balken in Zonenfarbe, Höhe = Dauer; ↷ = hierher verschoben
  const ol = $('#plan-woche');
  ol.replaceChildren();
  for (const t of woche) {
    const li = document.createElement('li');
    li.className = 'plan-tag' + (t.datum === heuteIso ? ' heute' : '');
    const balken = document.createElement('i');
    let beschreibung = 'frei';
    if (t.einheit) {
      beschreibung = `${titel(t.einheit)} — ${t.status}${t.hinweis ? `, ${t.hinweis}` : ''}`
        + (t.einheit.verschobenVon ? ` (von ${wochentagLang(t.einheit.verschobenVon)})` : '');
      balken.style.setProperty('--farbe', `var(${t.einheit.farbe})`);
      balken.style.setProperty('--hoehe', `${Math.round(6 + (t.einheit.opts.dauer ?? 30) / 90 * 22)}px`);
    }
    li.dataset.status = t.status;
    li.title = `${t.kurz}: ${beschreibung}`;
    li.setAttribute('aria-label', li.title);
    const zeichen = t.status === 'erledigt' ? ' ✓' : t.einheit?.verschobenVon && t.status === 'geplant' ? ' ↷' : '';
    const text = document.createElement('span');
    text.textContent = `${t.kurz}${zeichen}`;
    if (t.einheit) {
      // Tag mit Einheit antippen: Blatt mit Heute fahren/Verschieben/Kürzer/Leichter/Auslassen
      const b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('aria-label', `${li.title} — ändern`);
      b.append(balken, text);
      b.onclick = () => oeffneEinheit({ plan, tag: t, sessions, heute, ftp, neuZeichnen: () => renderPlan({ starte, heute }) });
      li.append(b);
    } else li.append(balken, text);
    ol.append(li);
  }
  // Was mit Verpasstem passiert ist, in einer Zeile
  const info = woche.filter(t => t.status === 'verpasst' && t.hinweis)
    .map(t => `${wochentagLang(t.datum)} verpasst — ${t.hinweis.replace('verschoben auf ', 'auf ')}${t.hinweis.startsWith('verschoben') ? ' verschoben' : ''}`);
  // sonst der Hinweis, dass Tage tippbar sind
  $('#plan-info').hidden = false;
  $('#plan-info').textContent = info.length ? info.join(' · ') : 'Tag antippen: verschieben, kürzer, leichter oder auslassen';

  // Länger nicht gefahren (ohne Pause-Knopf): Wiedereinstieg nach denselben Stufen anbieten
  const bezugTag = new Date((plan.aktivAb ?? plan.angelegt) + 'T00:00').getTime();
  // zählt wie überall im Plan: Fahrt aus dem Plan oder ≥ 15 min (keine Probefahrten)
  const letzteFahrt = sessions.filter(f => f.planRef || (f.dauer ?? 0) >= 900).reduce((a, f) => Math.max(a, f.start), 0);
  const letzteAktiv = Math.max(letzteFahrt, bezugTag - TAG_MS);
  const seit = Math.floor((new Date(heuteIso + 'T00:00') - new Date(tagIso(new Date(letzteAktiv)) + 'T00:00')) / TAG_MS) - 1;
  if (seit >= HINWEIS_NACH_TAGEN) {
    const ab = tagIso(new Date(letzteAktiv + TAG_MS));
    const w = wiedereinstieg(plan, ab, heute);
    hinweis(`${seit} Tage ohne Fahrt — Wiedereinstieg: ${w.text}.`,
      { label: 'Übernehmen', fn: () => speichern(w.plan, `Wiedereinstieg — ${w.text}`) });
  } else hinweis('');
}

const datumLang = iso => new Date(iso + 'T12:00').toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' });

// Dialog: anlegen (kein Plan) oder ändern (Plan vorhanden). Liefert true, wenn sich etwas geändert hat.
export async function oeffnePlanDialog({ heute = new Date(), neu = false } = {}) {
  const settings = await getSettings();
  const alt = neu ? null : settings.plan;
  const dlg = $('#dlg-plan');
  const vorlage = alt ?? settings.plan;          // „Neuer Plan": Einstellungen des alten übernehmen
  const wahl = { tage: vorlage?.tage ?? [1, 3, 5], dauer: vorlage?.dauer ?? 45, ziel: vorlage?.ziel ?? 'fitness',
    einsteiger: vorlage?.einsteiger ?? false, laenge: vorlage && 'laenge' in vorlage ? vorlage.laenge : 8 };

  // Wochentage als Umschalter
  const tageEl = $('#plan-tage');
  tageEl.replaceChildren(...WOCHENTAGE.map((kurz, i) => {
    const l = document.createElement('label');
    l.innerHTML = `<input type="checkbox" value="${i}"${wahl.tage.includes(i) ? ' checked' : ''}>${kurz}`;
    return l;
  }));
  $('#plan-dauer').replaceChildren(...DAUERN.map(d => {
    const l = document.createElement('label');
    l.innerHTML = `<input type="radio" name="plan-dauer" value="${d}"${d === wahl.dauer ? ' checked' : ''}>${d} min`;
    return l;
  }));
  $('#plan-laenge').replaceChildren(...LAENGEN.map(l => {
    const el = document.createElement('label');
    el.innerHTML = `<input type="radio" name="plan-laenge" value="${l ?? ''}"${l === wahl.laenge ? ' checked' : ''}>${l ? `${l} Wochen` : 'Fortlaufend'}`;
    return el;
  }));
  $('#plan-ziel').replaceChildren(...Object.entries(ZIELE).map(([id, z]) => {
    const l = document.createElement('label');
    l.innerHTML = `<input type="radio" name="plan-ziel" value="${id}"${id === wahl.ziel ? ' checked' : ''}>
      <span class="schalter-text">${z.name}<small>${z.sub}</small></span>`;
    return l;
  }));
  $('#plan-einsteiger').checked = wahl.einsteiger;
  $('#plan-beenden').hidden = !alt;
  $('#plan-pausieren').hidden = !alt || !!alt.pause;
  $('#plan-ok').textContent = alt ? 'Übernehmen' : 'Plan starten';

  const lies = () => ({
    tage: [...tageEl.querySelectorAll('input:checked')].map(i => +i.value),
    dauer: +dlg.querySelector('[name="plan-dauer"]:checked').value,
    ziel: dlg.querySelector('[name="plan-ziel"]:checked').value,
    laenge: +dlg.querySelector('[name="plan-laenge"]:checked').value || null,
    einsteiger: $('#plan-einsteiger').checked,
  });
  // Vorschau: erste bzw. aktuelle Woche mit Farbpunkt, Tag, Einheit; Umfang
  const vorschau = () => {
    const w = lies();
    const ok = w.tage.length >= 2 && w.tage.length <= 6;
    $('#plan-ok').disabled = !ok;
    const liste = $('#plan-vorschau');
    liste.replaceChildren();
    if (!ok) {
      $('#plan-umfang').textContent = w.tage.length < 2 ? 'Mindestens 2 Tage wählen.' : 'Höchstens 6 Tage — ein Ruhetag pro Woche gehört dazu.';
      return;
    }
    const plan = planAnlegen({ ...w, ftp: settings.ftp, heute });
    const woche = wocheAb(plan, heute, settings.ftp).filter(t => t.einheit);
    for (const t of woche) {
      const li = document.createElement('li');
      li.innerHTML = `<i style="--farbe: var(${t.einheit.farbe})"></i><b>${t.kurz}</b><span></span>`;
      li.querySelector('span').textContent = titel(t.einheit);
      liste.append(li);
    }
    const min = wochenMinuten(plan, heute, settings.ftp);
    const ende = planEnde(alt ? { ...plan, start: alt.start } : plan);
    $('#plan-umfang').textContent = `≈ ${minutenText(min)} in dieser Woche · jeder 4-Wochen-Block steigt 3 Wochen, die 4. ist leicht mit FTP-Test.`
      + (ende ? ` Endet ${datumLang(tagIso(ende))}` : ' Läuft fortlaufend weiter.')
      + (alt && w.laenge && planWoche({ ...alt, laenge: w.laenge }, heute) >= w.laenge ? ' — damit ist der Plan schon abgeschlossen.' : '')
      + (settings.ftp ? '' : ' Ohne FTP beginnt der Plan mit dem Rampentest.');
  };
  dlg.querySelector('.plan-form').oninput = vorschau;
  vorschau();

  return new Promise(resolve => {
    dlg.onclose = async () => {
      if (dlg.returnValue === 'ok') {
        const w = lies();
        // Ändern behält den Start (Woche im Block läuft weiter); neu = diese Woche
        const neuPlan = planAnlegen({ ...w, ftp: settings.ftp, heute });
        await setSetting('plan', alt ? { ...alt, ...neuPlan, start: alt.start, angelegt: alt.angelegt, ftp: alt.ftp } : neuPlan);
        toastOk(alt ? 'Plan geändert' : 'Plan angelegt — los geht’s');
        resolve(true);
      } else if (dlg.returnValue === 'pausieren') {
        await setSetting('plan', pausieren(alt, heute));
        toastRueckgaengig('Plan pausiert — beim Fortsetzen richtet sich der Einstieg nach der Pausenlänge',
          async () => { await setSetting('plan', alt); document.dispatchEvent(new Event('plan-geaendert')); });
        resolve(true);
      } else if (dlg.returnValue === 'beenden') {
        if (confirm('Trainingsplan beenden? Gefahrene Einheiten bleiben in den Fahrten.')) {
          await setSetting('plan', null);
          resolve(true);
        } else resolve(false);
      } else resolve(false);
    };
    oeffneModal(dlg, 'plan');
  });
}

// --- Blatt „Einheit ändern" ---
// Aktionen nach der Recherche (docs/trainingsplan.md): Heute fahren,
// Verschieben (heute bis Sonntag, belegter Tag = Tausch, gesperrt mit Grund),
// Kürzer, Leichter (Grundlage), Auslassen. Keine Rückfragen — jede Änderung
// lässt sich 6 s lang rückgängig machen.
function oeffneEinheit({ plan, tag, sessions, heute, ftp, neuZeichnen }) {
  const dlg = $('#dlg-einheit');
  const e = tag.einheit;
  const heuteIso = tagIso(heute);
  const vorbei = tag.datum < heuteIso || tag.status === 'erledigt';
  $('#ein-titel').textContent = `${wochentagLang(tag.datum)} · ${titel(e)}`;
  const stand = { erledigt: 'Gefahren ✓', verpasst: `Verpasst${tag.hinweis ? ' — ' + tag.hinweis : ''}`,
    ausgelassen: 'Ausgelassen', geplant: e.art === 'hart' ? 'Hart' : e.typ === 'T' ? 'FTP-Test' : 'Locker' }[tag.status] ?? '';
  const extra = [e.verschobenVon && `verschoben von ${wochentagLang(e.verschobenVon)}`,
    e.variante === 'leichter' && `statt ${e.statt}`, e.variante === 'kürzer' && 'gekürzt'].filter(Boolean);
  $('#ein-sub').textContent = [stand, ...extra].join(' · ');

  // Änderung speichern, Karte neu, Toast mit Rückgängig (stellt den alten Plan her)
  const aendern = async (neuerPlan, meldung) => {
    await setSetting('plan', neuerPlan);
    dlg.close();
    neuZeichnen();
    toastRueckgaengig(meldung, async () => { await setSetting('plan', plan); neuZeichnen(); });
  };
  const op = o => mitAnpassung(plan, montag(heute), o);

  const aktionen = $('#ein-aktionen');
  aktionen.replaceChildren();
  const zeile = (titelText, text, wirkung, aus = false) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'fo-zeile';
    b.innerHTML = '<span class="fo-text"><b></b><small></small></span>';
    b.querySelector('b').textContent = titelText;
    b.querySelector('small').textContent = text;
    b.disabled = aus;
    b.onclick = wirkung;
    aktionen.append(b);
  };
  const ziele = vorbei ? [] : verschiebeZiele(plan, tag.datum, sessions, heute, ftp);
  $('#ein-ziele').hidden = true;

  if (!vorbei && tag.status === 'ausgelassen') {
    zeile('Wieder einplanen', 'Die Einheit gilt wieder für diesen Tag', () => {
      const woche = tagIso(montag(heute));
      const liste = (plan.anpassungen?.[woche] ?? []).filter(o => !(o.art === 'auslassen' && o.datum === tag.datum));
      aendern({ ...plan, anpassungen: { ...plan.anpassungen, [woche]: liste } }, 'Wieder eingeplant');
    });
  } else if (!vorbei) {
    if (tag.datum > heuteIso) {
      const z = ziele.find(x => x.datum === heuteIso);
      zeile('Heute fahren', !z ? 'Heute ist schon gefahren' : z.zustand === 'gesperrt' ? `Geht nicht: ${z.grund}` : z.tauschMit ? `Tauscht mit ${z.tauschMit}` : 'Heute ist frei',
        () => aendern(op({ art: 'verschieben', von: tag.datum, nach: heuteIso }), 'Auf heute verschoben'), !z || z.zustand === 'gesperrt');
    }
    zeile('Verschieben …', 'Auf einen anderen Tag dieser Woche', () => zeigeZiele(), !ziele.length);
    const kd = kuerzerDauer(e);
    if (kd) zeile(`Kürzer (${kd} min)`, 'Gleiche Art, weniger Wiederholungen',
      () => aendern(op({ art: 'kuerzer', datum: tag.datum }), `Gekürzt auf ${kd} min`));
    if (istHart(e) && e.typ !== 'T') zeile('Leichter (Grundlage)', 'Müde? Locker in Zone 2, gleiche Dauer — zählt nicht als hart',
      () => aendern(op({ art: 'leichter', datum: tag.datum }), 'Als Grundlage geplant'));
    zeile('Auslassen', e.typ === 'T' ? 'Die bisherige FTP gilt weiter' : 'Fällt diese Woche weg, wird nicht nachgeholt',
      () => aendern(op({ art: 'auslassen', datum: tag.datum }), `${wochentagLang(tag.datum)} ausgelassen`));
  }

  // Zieltage: frei / Tausch / gesperrt (mit Grund darunter)
  const zeigeZiele = () => {
    $('#ein-ziele').hidden = false;
    const wahl = $('#ein-ziel-tage');
    wahl.replaceChildren(...ziele.map(z => {
      const b = document.createElement('button');
      b.type = 'button';
      b.dataset.ziel = z.zustand;
      b.disabled = z.zustand === 'gesperrt';
      b.innerHTML = `<span>${z.datum === heuteIso ? 'Heute' : z.kurz}</span><small>${{ frei: 'frei', tausch: 'Tausch', gesperrt: 'gesperrt' }[z.zustand]}</small>`;
      b.title = z.tauschMit ? `Tauscht mit ${z.tauschMit}` : z.grund;
      b.onclick = () => aendern(op({ art: 'verschieben', von: tag.datum, nach: z.datum }),
        `Auf ${z.datum === heuteIso ? 'heute' : z.kurz} verschoben${z.tauschMit ? ' (getauscht)' : ''}`);
      return b;
    }));
    $('#ein-gruende').textContent = ziele.filter(z => z.zustand === 'gesperrt').map(z => `${z.datum === heuteIso ? 'Heute' : z.kurz}: ${z.grund}`).join(' · ');
    wahl.querySelector('button:not(:disabled)')?.focus();
  };

  const zurueck = $('#ein-zuruecksetzen');
  zurueck.hidden = !hatAnpassungen(plan, heute);
  zurueck.onclick = () => aendern(ohneAnpassungen(plan, heute), 'Woche wie geplant');
  oeffneModal(dlg, 'einheit');
}
