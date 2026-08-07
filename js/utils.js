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

// Pluie de confettis, déclenchée quand une série passe en "Terminé" en
// direct (jamais au chargement ni après un import en masse, voir
// App.refreshSilently). Éléments DOM générés dynamiquement plutôt qu'un
// canvas : pas de dépendance externe, cohérent avec le reste du projet
// (vanilla JS, sans build step).
function celebrateCompletion() {
  const CONFETTI_COLORS = ["var(--mustard)", "var(--coral)", "var(--sage)"];
  const CONFETTI_COUNT = 40;

  const container = document.createElement("div");
  container.className = "confetti-burst";

  for (let i = 0; i < CONFETTI_COUNT; i++) {
    const piece = document.createElement("span");
    piece.className = "confetti-piece";
    piece.style.setProperty("--confetti-color", CONFETTI_COLORS[i % CONFETTI_COLORS.length]);
    piece.style.setProperty("--confetti-x", `${Math.random() * 100}vw`);
    piece.style.setProperty("--confetti-delay", `${Math.random() * 0.3}s`);
    piece.style.setProperty("--confetti-duration", `${2.2 + Math.random() * 1.2}s`);
    piece.style.setProperty("--confetti-rotate", `${Math.random() * 720 - 360}deg`);
    container.appendChild(piece);
  }

  document.body.appendChild(container);
  setTimeout(() => container.remove(), 3600);
}

// Easter egg : carte "Abonnement à vie", débloquée après 50 jours
// d'ancienneté du compte (rétroactif : peu importe quand ce code est
// déployé, un compte de 3 mois débloque la carte dès le premier chargement
// après mise à jour, pas seulement 50 jours après le déploiement).
const LIFETIME_CARD_THRESHOLD_DAYS = 50;

function isLifetimeCardUnlocked(userCreatedAt) {
  if (!userCreatedAt) return false;
  const createdDate = new Date(userCreatedAt);
  const daysSince = (Date.now() - createdDate.getTime()) / (1000 * 60 * 60 * 24);
  return daysSince >= LIFETIME_CARD_THRESHOLD_DAYS;
}

// Easter egg : 5 taps rapides sur le logo du header. Messages affichés
// dans l'ordre puis en boucle (pas aléatoire), pour que quelqu'un qui
// retape plusieurs fois de suite découvre bien les 4 avant qu'un message
// ne se répète.
const LOGO_EASTER_EGG_MESSAGES = [
  "Tu es la 3ᵉ personne à trouver ça. Ou pas. On ne compte pas vraiment.",
  "Rien à voir ici. Enfin si, un peu.",
  "Le générique de fin n'existe pas ici. Continue de binge watcher.",
  "Bravo, tu as trouvé un easter egg. Il n'y a pas de prix à gagner, juste ça.",
];

let _logoTapCount = 0;
let _logoTapTimer = null;
let _logoEasterEggIndex = 0;

function handleLogoTap(brandEl) {
  _logoTapCount++;
  clearTimeout(_logoTapTimer);
  // Fenêtre glissante de 1.5s entre deux taps : au-delà, on repart de zéro.
  _logoTapTimer = setTimeout(() => { _logoTapCount = 0; }, 1500);

  if (_logoTapCount >= 5) {
    _logoTapCount = 0;
    clearTimeout(_logoTapTimer);

    brandEl.classList.remove("brand--flicker");
    void brandEl.offsetWidth; // force le reflow pour pouvoir rejouer l'animation si retapé peu après
    brandEl.classList.add("brand--flicker");

    const message = LOGO_EASTER_EGG_MESSAGES[_logoEasterEggIndex % LOGO_EASTER_EGG_MESSAGES.length];
    _logoEasterEggIndex++;
    toast(message, "info");
  }
}

// Easter egg : tap sur les cartes "temps passé devant des films/séries"
// dans les stats personnelles. Comparaison absurde façon "ça fait X fois
// Titanic bout à bout", calculée dynamiquement à partir des vraies
// minutes du profil. Référence tirée au hasard à chaque tap, pour éviter
// la lassitude si quelqu'un retape plusieurs fois.
const ABSURD_MOVIE_REFERENCES = [
  { title: "Titanic", minutes: 194 },
  { title: "Le Seigneur des Anneaux : Le Retour du Roi", minutes: 201 },
  { title: "Avengers: Endgame", minutes: 181 },
];

const ABSURD_TV_REFERENCES = [
  { title: "Friends", minutes: 236 * 22 },
  { title: "The Office (US)", minutes: 186 * 22 },
  { title: "Grey's Anatomy", minutes: 466 * 43 },
];

// Formate un ratio en texte pour les comparaisons absurdes : arrondi à
// l'entier pour les valeurs significatives, message qualitatif ("même pas
// le quart de…") pour les petits totaux où "0 fois" serait moins parlant.
// tvMode ajuste juste "rewatch de" → l'appelant fournit déjà ce mot, donc
// ce paramètre ne sert qu'à garder la fonction lisible si un jour le texte
// diffère entre films et séries.
function formatAbsurdRatio(ratio) {
  if (ratio < 0.25) return "même pas le quart de";
  if (ratio < 0.5) return "même pas la moitié de";
  if (ratio < 1) return "pas encore un";
  return String(Math.round(ratio));
}

function showAbsurdMovieComparison(totalMovieMinutes) {
  if (!totalMovieMinutes) {
    toast("Pas encore assez de films pour comparer à quoi que ce soit.", "info");
    return;
  }
  const ref = ABSURD_MOVIE_REFERENCES[Math.floor(Math.random() * ABSURD_MOVIE_REFERENCES.length)];
  const ratio = totalMovieMinutes / ref.minutes;
  toast(`C'est ${formatAbsurdRatio(ratio)} fois "${ref.title}".`, "info");
}

function showAbsurdTvComparison(totalTvMinutes) {
  if (!totalTvMinutes) {
    toast("Pas encore assez de séries pour comparer à quoi que ce soit.", "info");
    return;
  }
  const ref = ABSURD_TV_REFERENCES[Math.floor(Math.random() * ABSURD_TV_REFERENCES.length)];
  const ratio = totalTvMinutes / ref.minutes;
  toast(`C'est ${formatAbsurdRatio(ratio)} fois "${ref.title}" regardé${/^\d+$/.test(formatAbsurdRatio(ratio)) && Math.round(ratio) > 1 ? "s" : ""} en entier.`, "info");
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
    <div class="show-detail">
      <div class="show-detail-overlay">
        <div class="skeleton-block show-detail-poster" style="aspect-ratio:2/3;"></div>
        <div class="show-detail-info">
          <div class="skeleton-block skeleton-line" style="width:70%;height:26px;margin-bottom:18px;"></div>
          ${skeletonLinesHTML(lines)}
        </div>
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
