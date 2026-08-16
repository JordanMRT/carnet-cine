// ============================================
// WRAPPED UI — carrousel plein écran des 6 cartes générées par Wrapped
// (wrapped.js), avec navigation swipe, points de progression et actions
// partager/télécharger. Ne contient aucune logique de calcul de stats
// (Stats.computeForYear) ni de rendu canvas (Wrapped) : uniquement le DOM.
// ============================================

const WrappedUI = {
  // year : année civile à afficher (ex. 2026)
  async open(year) {
    const loading = this._showLoading();
    try {
      const stats = Stats.computeForYear(App.diary, App.library, App.genreMaps, year);

      // Avatar/pseudo réels de l'utilisateur connecté — même résolution
      // que myNoteCardHTML / openLifetimeCard dans app.js, pour être sûr
      // que ce sont bien les vraies infos du profil, pas un placeholder.
      const meta = App.session.user.user_metadata || {};
      const profile = {
        username: displayName(),
        avatarUrl: meta.avatar_url || (meta.avatar_path ? TMDB.posterUrl(meta.avatar_path, "w185") : null),
      };

      const canvases = await Wrapped.generateCanvases(stats, profile);
      loading.remove();
      this._renderOverlay(canvases, stats);
    } catch (err) {
      loading.remove();
      toast("Impossible de générer ton Wrapped pour l'instant.", "error");
    }
  },

  _showLoading() {
    const overlay = document.createElement("div");
    overlay.className = "wrapped-loading-overlay";
    overlay.innerHTML = `
      <div class="spinner"></div>
      <p>Préparation de ton année…</p>`;
    document.body.appendChild(overlay);
    return overlay;
  },

  _renderOverlay(canvases, stats) {
    const overlay = document.createElement("div");
    overlay.className = "wrapped-overlay";
    overlay.innerHTML = `
      <button class="wrapped-close-btn" id="wrapped-close-btn" aria-label="Fermer">
        <i data-lucide="x"></i>
      </button>
      <div class="wrapped-rail" id="wrapped-rail">
        ${canvases
          .map(
            (canvas, i) => `
          <div class="wrapped-card-frame">
            <img src="${canvas.toDataURL("image/png")}" alt="Carte ${i + 1} du Wrapped ${stats.year}" />
          </div>`
          )
          .join("")}
      </div>
      <div class="wrapped-progress-dots" id="wrapped-dots">
        ${canvases.map((_, i) => `<div class="d${i === 0 ? " active" : ""}"></div>`).join("")}
      </div>
      <div class="wrapped-actions">
        <button class="btn btn--ghost" id="wrapped-download-btn">
          <i data-lucide="download"></i>
          Télécharger
        </button>
        <button class="btn btn--accent" id="wrapped-share-btn">
          <i data-lucide="share-2"></i>
          Partager
        </button>
      </div>`;
    document.body.appendChild(overlay);
    if (typeof lucide !== "undefined") lucide.createIcons();

    let currentIndex = 0;
    const rail = qs("#wrapped-rail", overlay);
    const dots = [...overlay.querySelectorAll("#wrapped-dots .d")];
    const frames = [...rail.children];

    // Détermine la carte la plus proche du centre du rail — robuste face
    // aux largeurs responsives (min(86vw, 400px)), contrairement à un
    // calcul basé sur une largeur de carte fixe.
    const updateActive = () => {
      const railRect = rail.getBoundingClientRect();
      const centerX = railRect.left + railRect.width / 2;
      let closest = 0;
      let closestDist = Infinity;
      frames.forEach((f, i) => {
        const r = f.getBoundingClientRect();
        const dist = Math.abs(r.left + r.width / 2 - centerX);
        if (dist < closestDist) {
          closestDist = dist;
          closest = i;
        }
      });
      currentIndex = closest;
      dots.forEach((d, i) => d.classList.toggle("active", i === closest));
    };
    rail.addEventListener("scroll", () => requestAnimationFrame(updateActive));

    overlay.querySelector("#wrapped-close-btn").addEventListener("click", () => overlay.remove());
    overlay.querySelector("#wrapped-share-btn").addEventListener("click", () => {
      Wrapped.shareCard(canvases[currentIndex], stats);
    });
    overlay.querySelector("#wrapped-download-btn").addEventListener("click", () => {
      Wrapped.downloadCard(canvases[currentIndex], currentIndex);
    });
  },
};