// Nicht-blockierende Kurzmeldungen. Ein Stil, auto-hide, safe-area-tauglich.
// alert()/confirm() bleiben nur für echte Entscheidungen und Destruktives.

let wrap = null;

export function toast(msg, art = 'info', dauer = 3200) {
  if (!wrap) {
    wrap = document.createElement('div');
    wrap.className = 'toasts';
    wrap.setAttribute('aria-live', 'polite');
    document.body.append(wrap);
  }
  const t = document.createElement('div');
  t.className = `toast ${art}`;
  t.textContent = msg;
  wrap.append(t);
  requestAnimationFrame(() => t.classList.add('zeig'));
  setTimeout(() => {
    t.classList.remove('zeig');
    setTimeout(() => t.remove(), 250);
  }, dauer);
}

export const toastOk = msg => toast(msg, 'ok');

// Meldung mit „Rückgängig" (6 s) — statt einer Rückfrage vor der Aktion
export function toastRueckgaengig(msg, rueckgaengig) {
  toast(msg, 'ok', 6000);
  const t = wrap.lastElementChild;
  t.classList.add('mit-aktion');
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'toast-aktion';
  b.textContent = 'Rückgängig';
  b.onclick = () => { t.remove(); rueckgaengig(); };
  t.append(b);
}
export const toastErr = msg => toast(msg, 'err', 5000);
