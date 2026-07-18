// ============================================
// UPDATE PROMPT — invite à mettre à jour l'appli
// (PWA uniquement)
// ============================================

let swUpdateRequested = false; // évite de recharger au tout premier contrôle (première installation)

async function fetchChangelogHighlights() {
  try {
    // Le paramètre anti-cache force une URL différente à chaque appel, donc
    // le service worker (cache-first par URL) ne trouve jamais de
    // correspondance et va systématiquement chercher la version fraîche —
    // même si l'ancien SW est encore actif au moment de l'appel.
    const res = await fetch(`./changelog.json?t=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) return null;
    const data = await res.json();
    return Array.isArray(data.highlights) && data.highlights.length ? data.highlights : null;
  } catch {
    return null;
  }
}

async function showUpdatePrompt(worker) {
  if (!window.matchMedia("(display-mode: standalone)").matches) return;

  document.getElementById("update-prompt")?.remove(); // remplace une éventuelle carte déjà affichée

  const highlights = await fetchChangelogHighlights();

  const bodyHTML = highlights
    ? `<p>${highlights.map((h, i) => (i === 0 ? escapeHtml(h) : `· ${escapeHtml(h)}`)).join("<br>")}</p>`
    : `<p>Profite immédiatement des dernières nouveautés de Time To Binge.</p>`;

  const card = document.createElement("div");
  card.id = "update-prompt";
  card.className = "install-prompt";

  card.innerHTML = `
    <div class="install-prompt-card">
      <button class="install-prompt-close" aria-label="Plus tard">✕</button>
      <div class="install-prompt-header">
        <span class="install-prompt-emoji">🎟️</span>
        <div>
          <strong>Une mise à jour est disponible</strong>
          ${bodyHTML}
        </div>
      </div>
      <button class="btn btn--accent" id="update-app-btn" style="width: 100%;">
        Mettre à jour
      </button>
    </div>
  `;

  document.body.appendChild(card);
  requestAnimationFrame(() => card.classList.add("install-prompt--visible"));

  card.querySelector(".install-prompt-close").addEventListener("click", () => {
    card.classList.remove("install-prompt--visible");
    setTimeout(() => card.remove(), 300);
  });

  qs("#update-app-btn").addEventListener("click", () => {
    swUpdateRequested = true;
    worker.postMessage({ type: "SKIP_WAITING" });
    card.remove();
  });
}

navigator.serviceWorker?.addEventListener("controllerchange", () => {
  if (!swUpdateRequested) return; // premier contrôle initial : rien à recharger
  window.location.reload();
});