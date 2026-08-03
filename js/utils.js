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

// Convertit la durée d'un film/série/épisodes
// Repères : 1 jour = 24h, 1 mois ≈ 30 jours (720h).

function formatRuntime(minutes) {
  if (!minutes) return null;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}h${m > 0 ? String(m).padStart(2, "0") : ""}` : `${m}min`;
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

// Durée minimale d'affichage du splash screen : évite un flash trop bref
// et disgracieux quand tout charge très vite (session déjà en cache).
// Calée pour laisser le temps à un premier passage complet du reflet sur
// le logo (délai 0.15s + balayage ~0.7s, cf. keyframes splashShine dans
// index.html) avant que le fondu de sortie ne démarre.
const SPLASH_MIN_DISPLAY_MS = 1100;
function hideSplash() {
  const el = document.getElementById("splash-screen");
  if (!el || el.dataset.hidden === "1") return;
  el.dataset.hidden = "1";
  const elapsed = Date.now() - (window.__splashShownAt || Date.now());
  const remaining = Math.max(0, SPLASH_MIN_DISPLAY_MS - elapsed);
  setTimeout(() => {
    el.classList.add("splash--hide");
    el.addEventListener("transitionend", () => el.remove(), { once: true });
    // Filet de sécurité si la transition ne se déclenche pas (ex: onglet
    // passé en arrière-plan, où les animations peuvent être suspendues).
    setTimeout(() => el.remove(), 700);
  }, remaining);
}

// ---------- SKELETON SWAP ----------
// Génère des blocs placeholders animés à afficher pendant le chargement,
// à la place du texte "Chargement…". Le remplacement par le contenu réel
// est ensuite un simple innerHTML — pas d'animation de transition (0ms).
const SKELETON_WIDTHS = [100, 93, 97, 88, 95, 91];
function skeletonWidthFor(index, total) {
  if (total > 1 && index === total - 1) return 62;
  return SKELETON_WIDTHS[(index * 7 + 3) % SKELETON_WIDTHS.length];
}

function skeletonLinesHTML(count = 3) {
  return Array.from({ length: count }, (_, i) => {
    const w = skeletonWidthFor(i, count);
    return `<div class="skeleton-block skeleton-line" style="width:${w}%"></div>`;
  }).join("");
}

// Grille de vignettes (résultats de recherche, calendrier, sélecteur d'images…)
function skeletonGridHTML(count = 10) {
  return `<div class="skeleton-grid">${Array.from(
    { length: count },
    () => `<div class="skeleton-block skeleton-poster"></div>`
  ).join("")}</div>`;
}

// Fiche détail (film, série, épisode, profil) : affiche + colonne de texte
function skeletonDetailHTML(lines = 4) {
  return `
    <div class="skeleton-detail">
      <div class="skeleton-block skeleton-poster"></div>
      <div class="skeleton-detail-info">
        <div class="skeleton-block skeleton-line" style="width:70%"></div>
        ${skeletonLinesHTML(lines)}
      </div>
    </div>`;
}

// Liste de lignes (épisodes d'une saison, liste d'abonnements…)
function skeletonRowsHTML(count = 6, withThumb = true) {
  return `<div class="skeleton-rows">${Array.from({ length: count }, () => `
    <div class="skeleton-row">
      <div class="skeleton-block ${withThumb ? "skeleton-thumb" : "skeleton-avatar"}"></div>
      <div class="skeleton-block skeleton-line" style="width:${40 + Math.random() * 40}%"></div>
    </div>`).join("")}</div>`;
}

// Lignes d'épisodes d'une saison, au gabarit exact de .episode-row
// (mêmes classes que le vrai composant : la largeur de la vignette suit
// automatiquement la colonne de grille 100px/72px définie dans le CSS,
// pas de dimension dupliquée à maintenir à la main).
function skeletonEpisodeRowsHTML(count = 8) {
  return `<div class="episode-list">${Array.from({ length: count }, () => `
    <div class="episode-row">
      <div class="skeleton-block skeleton-episode-thumb"></div>
      <div>
        <div class="skeleton-block skeleton-line" style="width:${50 + Math.random() * 30}%"></div>
        <div class="skeleton-block skeleton-line" style="width:${25 + Math.random() * 20}%;margin-top:0.4rem;"></div>
      </div>
      <div class="skeleton-block skeleton-episode-check"></div>
    </div>`).join("")}</div>`;
}

// Grille de portraits circulaires (sélecteur de photo d'acteur)
function skeletonActorGridHTML(count = 8) {
  return `<div class="picker-grid">${Array.from({ length: count }, () => `
    <div class="picker-item picker-item--actor">
      <div class="skeleton-block skeleton-actor-photo"></div>
      <div class="skeleton-block skeleton-line" style="width:70%;margin:0.3rem auto 0;"></div>
    </div>`).join("")}</div>`;
}


// ---------- RECHERCHES RÉCENTES ----------
// Stockées en local (pas de sync entre appareils), onglet "Films & séries"
// uniquement. 5 maximum, les plus anciennes sont retirées automatiquement.
const RECENT_SEARCHES_KEY = "ttb-recent-searches";
const RECENT_SEARCHES_MAX = 5;

function getRecentSearches() {
  try {
    return JSON.parse(localStorage.getItem(RECENT_SEARCHES_KEY)) || [];
  } catch {
    return [];
  }
}

function addRecentSearch(query) {
  const q = query.trim();
  if (!q) return;
  const list = getRecentSearches().filter((item) => item.toLowerCase() !== q.toLowerCase());
  list.unshift(q);
  localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(list.slice(0, RECENT_SEARCHES_MAX)));
}

function recentSearchChipsHTML() {
  const recent = getRecentSearches();
  if (!recent.length) return "";
  return `
    <div class="recent-searches">
      <span class="recent-searches-label">Recherches récentes</span>
      <div class="recent-searches-chips">
        ${recent.map((q) => `<button class="recent-search-chip" data-query="${escapeHtml(q)}">${escapeHtml(q)}</button>`).join("")}
      </div>
    </div>`;
}

// ---------- OTP INPUT ----------
// Cases séparées pour le code de connexion. Le collage du code reçu par
// email fonctionne dans n'importe quelle case : il redistribue les
// caractères sur toutes les cases suivantes.
function createOtpInput(container, { length = 6, mode = "numeric", onComplete, onChange } = {}) {
  const allow = mode === "numeric" ? /[0-9]/ : /[0-9a-zA-Z]/;
  container.innerHTML = "";
  const inputs = [];

  const currentValue = () => inputs.map((i) => i.value).join("");

  function emit() {
    const value = currentValue();
    onChange?.(value);
    if (value.length === length && !value.includes("")) onComplete?.(value);
  }

  function focusAt(index) {
    const target = inputs[Math.max(0, Math.min(length - 1, index))];
    target?.focus();
    target?.select();
  }

  function fillFrom(index, text) {
    const chars = text.split("").filter((c) => allow.test(c));
    if (!chars.length) return;
    let cursor = index;
    chars.forEach((c) => {
      if (cursor >= length) return;
      inputs[cursor].value = c;
      cursor += 1;
    });
    emit();
    focusAt(Math.min(cursor, length - 1));
  }

  for (let i = 0; i < length; i++) {
    const input = document.createElement("input");
    input.type = "text";
    input.inputMode = mode === "numeric" ? "numeric" : "text";
    input.maxLength = 1;
    input.autocomplete = i === 0 ? "one-time-code" : "off";
    input.autocapitalize = "off";
    input.spellcheck = false;
    input.className = "otp-cell";

    input.addEventListener("input", (e) => {
      const incoming = e.target.value.split("").filter((c) => allow.test(c));
      if (!incoming.length) {
        input.value = "";
        return;
      }
      if (incoming.length === 1) {
        input.value = incoming[0];
        emit();
        if (i < length - 1) focusAt(i + 1);
        return;
      }
      // Plusieurs caractères d'un coup (arrive sur mobile sans passer par
      // l'event "paste") : on les redistribue comme pour un collage.
      input.value = "";
      fillFrom(i, incoming.join(""));
    });

    input.addEventListener("keydown", (e) => {
      if (e.key === "Backspace") {
        if (input.value) {
          input.value = "";
          emit();
          return;
        }
        if (i > 0) {
          inputs[i - 1].value = "";
          emit();
          focusAt(i - 1);
        }
        return;
      }
      if (e.key === "ArrowLeft") { e.preventDefault(); focusAt(i - 1); }
      if (e.key === "ArrowRight") { e.preventDefault(); focusAt(i + 1); }
    });

    input.addEventListener("paste", (e) => {
      e.preventDefault();
      const text = (e.clipboardData || window.clipboardData).getData("text");
      const clean = text.split("").filter((c) => allow.test(c)).join("");
      fillFrom(clean.length >= length ? 0 : i, clean);
    });

    input.addEventListener("focus", () => input.select());

    inputs.push(input);
    container.appendChild(input);
  }

  return {
    get value() { return currentValue(); },
    clear() { inputs.forEach((i) => (i.value = "")); focusAt(0); },
    focus() { focusAt(0); },
  };
}

// ---------- PWA ----------
// display-mode: standalone n'est pas fiable sur iOS, d'où navigator.standalone
// en complément. Utilisé pour l'install prompt et les notifications push.
function isStandalone() {
  return window.matchMedia?.("(display-mode: standalone)")?.matches || window.navigator.standalone === true;
}
