// ============================================
// UPDATE PROMPT — invite à mettre à jour l'appli
// (PWA uniquement)
// ============================================

function showUpdatePrompt(worker) {

  // uniquement dans la PWA
  if (!window.matchMedia("(display-mode: standalone)").matches) return;

  if (document.querySelector(".update-card")) return;

  const card = document.createElement("div");
  card.id = "update-prompt";
  card.className = "install-prompt";

  card.innerHTML = `
    <div class="install-prompt-card">
      <div class="install-card-icon">🎟️</div>

      <div class="install-card-content">
        <h3>Une mise à jour est disponible</h3>
        <p>Profite immédiatement des dernières nouveautés de Time To Binge.</p>
      </div>

      <button class="btn btn--accent" id="update-app-btn">
        Mettre à jour
      </button>
    </div>
  `;

  document.body.appendChild(card);

  qs("#update-app-btn").addEventListener("click", () => {
    worker.postMessage({
      type: "SKIP_WAITING"
    });
  });
}

navigator.serviceWorker?.addEventListener("controllerchange", () => {
  window.location.reload();
});