// ============================================
// UPDATE PROMPT — invite à mettre à jour l'appli
// (PWA uniquement)
// ============================================

let swUpdateRequested = false; // évite de recharger au tout premier contrôle (première installation)

function showUpdatePrompt(worker) {
  // uniquement dans la PWA
  if (!window.matchMedia("(display-mode: standalone)").matches) return;

  if (document.getElementById("update-prompt")) return;

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
          <p>Profite immédiatement des dernières nouveautés de Time To Binge :</p>
          <br>
          <p>Les acteurs/actrices ont maintenant leurs pages dédiées avec leur filmographie depuis leur photo dans le casting d'un film ou d'une série. ✨</p>
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