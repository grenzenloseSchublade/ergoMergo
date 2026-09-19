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
export const toastErr = msg => toast(msg, 'err', 5000);
