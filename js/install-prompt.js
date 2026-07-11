// ============================================
// INSTALL PROMPT — invite à ajouter l'appli à l'écran d'accueil
// (mobile uniquement)
// ============================================

const INSTALL_PERMANENT_DISMISS_KEY = "carnetcine_install_dismissed_forever";
const INSTALL_SESSION_DISMISS_KEY = "carnetcine_install_dismissed_session";

function detectInstallPlatform() {
  const ua = navigator.userAgent;
  const isStandalone =
    window.matchMedia?.("(display-mode: standalone)")?.matches || window.navigator.standalone === true;
  if (isStandalone) return null; // déjà installé

  const isIOS = /iPad|iPhone|iPod/.test(ua) && !window.MSStream;
  const isAndroid = /Android/.test(ua);

  if (isIOS) return "ios";
  if (isAndroid) return "android";
  return null; // desktop, ou mobile non reconnu : on ne devine pas les étapes
}

function maybeShowInstallPrompt() {
  if (localStorage.getItem(INSTALL_PERMANENT_DISMISS_KEY)) return;
  if (sessionStorage.getItem(INSTALL_SESSION_DISMISS_KEY)) return;
  const platform = detectInstallPlatform();
  if (!platform) return;
  setTimeout(() => showInstallPrompt(platform), 1200);
}

function showInstallPrompt(platform) {
  if (document.getElementById("install-prompt")) return;

  const steps =
    platform === "ios"
      ? `
      <li><i data-lucide="share"></i> Appuie sur l'icône <strong>Partager</strong> en bas de Safari</li>
      <li><i data-lucide="square-plus"></i> Choisis <strong>« Sur l'écran d'accueil »</strong></li>
      <li><i data-lucide="check"></i> Confirme avec <strong>« Ajouter »</strong></li>
    `
      : `
      <li><i data-lucide="more-vertical"></i> Appuie sur le menu en haut à droite de Chrome</li>
      <li><i data-lucide="square-plus"></i> Choisis <strong>« Ajouter à l'écran d'accueil »</strong></li>
      <li><i data-lucide="check"></i> Confirme l'installation</li>
    `;

  const el = document.createElement("div");
  el.id = "install-prompt";
  el.className = "install-prompt";
  el.innerHTML = `
    <div class="install-prompt-card">
      <button class="install-prompt-close" aria-label="Fermer">✕</button>
      <div class="install-prompt-header">
        <span class="install-prompt-emoji">🎟️</span>
        <div>
          <strong>Installe Time To Binge</strong>
          <p>Ajoute-le à ton écran d'accueil pour l'ouvrir comme une vraie appli.</p>
        </div>
      </div>
      <ol class="install-steps">${steps}</ol>
      <button class="install-prompt-forever">Ne plus jamais afficher</button>
    </div>
  `;
  document.body.appendChild(el);
  if (typeof lucide !== "undefined") lucide.createIcons();

  requestAnimationFrame(() => el.classList.add("install-prompt--visible"));

  const close = (permanent) => {
    el.classList.remove("install-prompt--visible");
    setTimeout(() => el.remove(), 250);
    if (permanent) localStorage.setItem(INSTALL_PERMANENT_DISMISS_KEY, "1");
    else sessionStorage.setItem(INSTALL_SESSION_DISMISS_KEY, "1");
  };

  el.querySelector(".install-prompt-close").addEventListener("click", () => close(false));
  el.querySelector(".install-prompt-forever").addEventListener("click", () => close(true));
}