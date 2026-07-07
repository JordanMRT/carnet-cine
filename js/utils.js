// ============================================
// UTILITAIRES
// ============================================

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

function formatDate(dateStr) {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" });
}

function formatDateShort(dateStr) {
  const d = new Date(dateStr);
  return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "2-digit" });
}

function formatMinutes(mins) {
  if (!mins) return "0 min";
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) return `${m} min`;
  return `${h} h ${m > 0 ? m + " min" : ""}`.trim();
}

// Convertit un temps de visionnage en une échelle lisible : mois > jours > heures.
// Repères : 1 jour = 24h, 1 mois ≈ 30 jours (720h).
function formatWatchDuration(mins) {
  if (!mins) return "0 h";
  const totalHours = mins / 60;

  if (totalHours >= 720) {
    const months = Math.floor(totalHours / 720);
    const remDays = Math.floor((totalHours % 720) / 24);
    return `${months} mois${remDays > 0 ? ` ${remDays} j` : ""}`;
  }
  if (totalHours >= 24) {
    const days = Math.floor(totalHours / 24);
    const remHours = Math.floor(totalHours % 24);
    return `${days} j${remHours > 0 ? ` ${remHours} h` : ""}`;
  }
  return formatMinutes(mins);
}

function debounce(fn, delay = 350) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

function stars(rating, max = 5) {
  const filled = Math.round((rating / 10) * max);
  let html = "";
  for (let i = 0; i < max; i++) {
    html += `<span class="star ${i < filled ? "star--filled" : ""}">★</span>`;
  }
  return html;
}

// Génère un faux code-barres SVG pour l'esthétique "ticket de cinéma"
function barcodeSVG(seed = "") {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) % 997;
  const bars = [];
  let x = 0;
  const rng = mulberry32(hash || 1);
  while (x < 120) {
    const w = 1 + Math.floor(rng() * 3);
    if (rng() > 0.4) bars.push(`<rect x="${x}" y="0" width="${w}" height="24" fill="currentColor"/>`);
    x += w + 1;
  }
  return `<svg viewBox="0 0 120 24" class="barcode" xmlns="http://www.w3.org/2000/svg">${bars.join("")}</svg>`;
}

function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let toastTimer;
function toast(message, type = "info") {
  let el = document.getElementById("toast");
  if (!el) {
    el = document.createElement("div");
    el.id = "toast";
    document.body.appendChild(el);
  }
  el.textContent = message;
  el.className = `toast toast--${type} toast--visible`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("toast--visible"), 3000);
}

function qs(sel, ctx = document) {
  return ctx.querySelector(sel);
}
function qsa(sel, ctx = document) {
  return Array.from(ctx.querySelectorAll(sel));
}
