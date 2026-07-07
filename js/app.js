// ============================================
// APP — état global, routing, rendu des vues
// ============================================

const App = {
  session: null,
  library: [],
  diary: [],
  earnedBadges: [],
  genreMaps: { movie: {}, tv: {} },

  async init() {
    DB.onAuthChange((session) => {
      this.session = session;
      this.renderShell();
    });
    this.session = await DB.getSession();
    this.renderShell();
    window.addEventListener("hashchange", () => this.route());
  },

  async renderShell() {
    const root = qs("#root");
    if (!this.session) {
      root.innerHTML = authTemplate();
      bindAuthEvents();
      return;
    }
    root.innerHTML = shellTemplate();
    lucide.createIcons();
    await this.loadGenreMaps();
    await this.syncAndRoute();
    lucide.createIcons();
    bindShellEvents();
  },

  async loadGenreMaps() {
    try {
      const [movie, tv] = await Promise.all([TMDB.getGenreMap("movie"), TMDB.getGenreMap("tv")]);
      this.genreMaps = { movie, tv };
    } catch {
      // Pas bloquant : les stats retomberont sur les ids bruts en libellé.
    }
  },

  async loadData() {
    const userId = this.session.user.id;
    [this.library, this.diary] = await Promise.all([
      DB.getLibrary(userId),
      DB.getDiary(userId),
    ]);
    const earned = await evaluateBadges(this.diary, this.library, userId);
    this.earnedBadges = earned;
  },

  // Recharge les données, reconstruit la bibliothèque (statuts, progression,
  // épisodes restants) depuis le journal, puis affiche la vue. Lance en
  // tâche de fond la récupération des durées manquantes sur TMDB.
  async syncAndRoute() {
    await this.loadData();
    try {
      await LibraryBuilder.rebuild(this.session.user.id, this.diary, this.library);
      await this.loadData();
    } catch (err) {
      console.warn("Reconstruction de la bibliothèque impossible :", err);
    }
    this.route();

    RuntimeEnrichment.run(this.diary, (msg) => toast(msg))
      .then((count) => {
        if (count > 0) {
          toast(`${count} durée(s) de visionnage récupérées sur TMDB.`, "success");
          this.loadData().then(() => {
            if ((location.hash.slice(2) || "diary").split("/")[0] === "stats") this.route();
          });
        }
      })
      .catch(() => {});
  },

  route() {
    const hash = location.hash.slice(2) || "diary";
    const [view, param] = hash.split("/");
    qsa(".nav-link").forEach((a) => a.classList.toggle("active", a.dataset.view === view));
    const view_el = qs("#view");
    switch (view) {
      case "search":
        view_el.innerHTML = searchTemplate();
        bindSearchEvents();
        break;
      case "library":
        view_el.innerHTML = libraryTemplate(this.library);
        bindLibraryEvents();
        break;
      case "show":
        renderShowDetail(param);
        break;
      case "stats":
        view_el.innerHTML = statsTemplate(this.diary, this.library);
        break;
      case "badges":
        view_el.innerHTML = badgesTemplate(this.earnedBadges);
        break;
      case "diary":
      default:
        view_el.innerHTML = diaryTemplate(this.diary);
        bindDiaryEvents();
        break;
    }
  },

  async refresh() {
    await this.syncAndRoute();
  },
};

// ---------- SHELL ----------
function shellTemplate() {
  return `
    <header class="topbar">
      <div class="brand">
        🎟️
        <span>Carnet Ciné</span>
      </div>

      <nav class="nav">
        <a href="#/diary" class="nav-link" data-view="diary">Journal</a>
        <a href="#/search" class="nav-link" data-view="search">Rechercher</a>
        <a href="#/library" class="nav-link" data-view="library">Bibliothèque</a>
        <a href="#/stats" class="nav-link" data-view="stats">Stats</a>
        <a href="#/badges" class="nav-link" data-view="badges">Badges</a>
      </nav>

      <div class="topbar-actions">
        <button id="username-btn" class="btn btn--ghost">
          ${escapeHtml(displayName())}
        </button>

        <button id="import-shows-btn" class="btn btn--ghost">
          Import séries
        </button>

        <button id="import-movies-btn" class="btn btn--ghost">
          Import films
        </button>

        <button id="logout-btn" class="btn btn--ghost">
          Déconnexion
        </button>
      </div>
    </header>

    <main id="view"></main>

<nav class="mobile-nav">

    <!-- <a href="#/diary" class="nav-link" data-view="diary">
        <i data-lucide="ticket"></i>
        <span>Journal</span>
    </a> -->

    <a href="#/search" class="nav-link" data-view="search">
        <i data-lucide="search"></i>
        <span>Recherche</span>
    </a>

    <a href="#/library" class="nav-link" data-view="library">
        <i data-lucide="library-big"></i>
        <span>Bibliothèque</span>
    </a>

    <a href="#/stats" class="nav-link" data-view="stats">
        <i data-lucide="chart-column"></i>
        <span>Stats</span>
    </a>

    <a href="#/badges" class="nav-link" data-view="badges">
        <i data-lucide="award"></i>
        <span>Badges</span>
    </a>

</nav>

    <input type="file" id="import-shows-input" accept=".json" hidden />
    <input type="file" id="import-movies-input" accept=".json" hidden />
  `;
}

function displayName() {
  const username = App.session?.user?.user_metadata?.username;
  return username || App.session?.user?.email?.split("@")[0] || "Toi";
}

function bindShellEvents() {
  qs("#logout-btn").addEventListener("click", async () => {
    await DB.signOut();
  });

  qs("#username-btn").addEventListener("click", async () => {
    const current = App.session.user.user_metadata?.username || "";
    const next = prompt("Ton pseudo :", current);
    if (next && next.trim() && next.trim() !== current) {
      try {
        await DB.updateUsername(next.trim());
        App.session = await DB.getSession();
        qs("#username-btn").textContent = displayName();
        toast("Pseudo mis à jour.", "success");
      } catch (err) {
        toast(err.message, "error");
      }
    }
  });

  qs("#import-shows-btn").addEventListener("click", () => qs("#import-shows-input").click());
  qs("#import-movies-btn").addEventListener("click", () => qs("#import-movies-input").click());

  qs("#import-shows-input").addEventListener("change", (e) => runImport(e, "shows"));
  qs("#import-movies-input").addEventListener("change", (e) => runImport(e, "movies"));
}

async function runImport(e, kind) {
  const file = e.target.files[0];
  if (!file) return;
  try {
    toast("Import en cours, ça peut prendre un moment (résolution TMDB)…");
    const { inserted, unresolved } = await handleImportFile(file, App.session.user.id, kind, (msg) =>
      toast(msg)
    );
    if (unresolved.length) {
      toast(
        `${inserted} entrées importées. ${unresolved.length} non reconnues sur TMDB (voir console).`,
        "success"
      );
      console.warn(`Titres non résolus sur TMDB (${kind}) :`, unresolved);
    } else {
      toast(`${inserted} entrées importées avec succès.`, "success");
    }
    await App.refresh();
  } catch (err) {
    toast(err.message, "error");
  }
  e.target.value = "";
}

// ---------- AUTH ----------
let pendingEmail = "";
let authStep = "email"; // "email" | "code"

function authTemplate() {
  return `
    <div class="auth-screen">
      <div class="auth-card">
        <div class="auth-ticket">🎟️</div>
        <h1>Carnet Ciné</h1>
        <p class="auth-sub">Ton journal de séries et de films, un ticket à la fois.</p>

        <form id="auth-form" class="auth-form">

          <div id="step-email">
            <input type="email" id="auth-email" placeholder="Email" required />
            <input type="text" id="auth-username" placeholder="Pseudo (optionnel)" />
            <button type="submit" class="btn btn--primary">
              Recevoir le code
            </button>
          </div>

          <div id="step-code" style="display:none;">
            <input type="text" id="auth-code" placeholder="Code reçu par email" />
            <button type="submit" class="btn btn--primary">
              Valider le code
            </button>
          </div>

        </form>

        <p id="auth-error" class="auth-error"></p>
        <p id="auth-success" class="auth-success"></p>
      </div>
    </div>
  `;
}

function bindAuthEvents() {
  const form = qs("#auth-form");
  const errorEl = qs("#auth-error");
  const successEl = qs("#auth-success");

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    errorEl.textContent = "";
    successEl.textContent = "";

    const btn = form.querySelector("button");
    btn.disabled = true;

    try {
      // ---------------- STEP EMAIL ----------------
      if (authStep === "email") {
        const email = qs("#auth-email").value.trim();
        const username = qs("#auth-username").value.trim();

        pendingEmail = email;

        btn.textContent = "Envoi…";

        await DB.sendOtp(email, username || undefined);

        // switch UI
        authStep = "code";
        qs("#step-email").style.display = "none";
        qs("#step-code").style.display = "block";

        btn.disabled = false;
        btn.textContent = "Valider le code";

        successEl.textContent = "Code envoyé ! Vérifie tes mails.";

        return;
      }

      // ---------------- STEP CODE ----------------
     if (authStep === "code") {
  const code = qs("#auth-code").value.trim();

  btn.textContent = "Vérification…";

  await DB.verifyOtp(pendingEmail, code);

  successEl.textContent = "Connexion réussie !";

  pendingEmail = "";
  authStep = "email";

  return;
}

    } catch (err) {
      errorEl.textContent = err.message;

      btn.disabled = false;
      btn.textContent =
        authStep === "email"
          ? "Recevoir le code"
          : "Valider le code";
    }
  });
}

// ---------- SEARCH ----------
function searchTemplate() {
  return `
    <div class="search-view">
      <input type="search" id="search-input" class="search-input" placeholder="Cherche une série ou un film…" autofocus />
      <div id="search-results" class="grid"></div>
    </div>
  `;
}

function bindSearchEvents() {
  const input = qs("#search-input");
  const results = qs("#search-results");
  input.addEventListener(
    "input",
    debounce(async () => {
      const q = input.value.trim();
      if (q.length < 2) {
        results.innerHTML = "";
        return;
      }
      try {
        const items = await TMDB.searchMulti(q);
        results.innerHTML = items.map(posterCard).join("") || emptyState("Aucun résultat.");
      } catch (err) {
        results.innerHTML = emptyState("Erreur TMDB — vérifie ta clé API dans js/config.js.");
      }
    }, 400)
  );
  results.addEventListener("click", (e) => {
    const card = e.target.closest(".poster-card");
    if (card) location.hash = `#/show/${card.dataset.type}-${card.dataset.id}`;
  });
}

function posterCard(item) {
  const title = item.title || item.name;
  const date = item.release_date || item.first_air_date || "";
  return `
    <div class="poster-card" data-id="${item.id}" data-type="${item.media_type}">
      <img src="${TMDB.posterUrl(item.poster_path)}" alt="${escapeHtml(title)}" loading="lazy" />
      <div class="poster-card-info">
        <span class="poster-card-title">${escapeHtml(title)}</span>
        <span class="poster-card-year">${date ? date.slice(0, 4) : ""}</span>
      </div>
    </div>
  `;
}

function emptyState(msg) {
  return `<p class="empty-state">${escapeHtml(msg)}</p>`;
}

// Mémorise la dernière saison consultée par série, pour ne pas revenir
// à la saison 1 après chaque coche.
const lastViewedSeason = {};

// ---------- SHOW DETAIL ----------
async function renderShowDetail(param) {
  const [type, id] = param.split("-");
  const view = qs("#view");
  view.innerHTML = `<p class="loading">Chargement…</p>`;
  try {
    const data = type === "movie" ? await TMDB.getMovie(id) : await TMDB.getTv(id);
    const title = data.title || data.name;
    const genreNames = (data.genres || []).map((g) => g.name);
    const genreIds = (data.genres || []).map((g) => String(g.id));
    const inLibrary = App.library.find(
      (l) => String(l.tmdb_id) === String(id) && l.media_type === type
    );

    const progressHTML =
      type === "tv" && inLibrary && inLibrary.total_episodes > 0
        ? `<div class="show-progress">
             <div class="progress-bar"><div class="progress-bar-fill" style="width:${inLibrary.progress}%"></div></div>
             <span class="progress-label">${Math.min(inLibrary.watched_episodes, inLibrary.total_episodes)}/${inLibrary.total_episodes} épisodes vus — ${inLibrary.progress}%</span>
           </div>`
        : "";

    // Films : bouton de log qui devient "revoir" une fois déjà vu, + badge ×N
    const movieEntries =
      type === "movie" ? App.diary.filter((e) => String(e.tmdb_id) === String(id) && e.media_type === "movie") : [];
    const movieWatchCount = movieEntries.length;
    const movieActionsHTML =
      type === "movie"
        ? `
        <button id="quick-log-btn" class="btn btn--accent">
          ${movieWatchCount > 0 ? "Revoir (nouveau visionnage)" : "Marquer comme vu"}
        </button>
        ${movieWatchCount > 0 ? `<span class="rewatch-badge">×${movieWatchCount}</span>` : ""}
        <button id="log-btn" class="btn btn--ghost">Détails (note, date…)</button>`
        : `<button id="log-btn" class="btn btn--accent">Enregistrer un visionnage</button>`;

    view.innerHTML = `
      <div class="show-detail" style="--backdrop:url('${TMDB.backdropUrl(data.backdrop_path)}')">
        <div class="show-detail-overlay">
          <img class="show-detail-poster" src="${TMDB.posterUrl(data.poster_path)}" alt="" />
          <div class="show-detail-info">
            <h1>${escapeHtml(title)}</h1>
            <p class="show-detail-meta">${genreNames.join(" · ")}</p>
            <p class="show-detail-overview">${escapeHtml(data.overview || "Pas de synopsis disponible.")}</p>
            ${progressHTML}
            <div class="show-detail-actions">
              <select id="status-select">
                <option value="">+ Ajouter à ma bibliothèque</option>
                <option value="watchlist" ${inLibrary?.status === "watchlist" ? "selected" : ""}>À voir</option>
                <option value="watching" ${inLibrary?.status === "watching" ? "selected" : ""}>En cours</option>
                <option value="completed" ${inLibrary?.status === "completed" ? "selected" : ""}>Terminé</option>
                <option value="dropped" ${inLibrary?.status === "dropped" ? "selected" : ""}>Abandonné</option>
              </select>
              ${movieActionsHTML}
            </div>
          </div>
        </div>
        ${type === "tv" ? `<div id="seasons-container"></div>` : ""}
      </div>
    `;

    qs("#status-select").addEventListener("change", async (e) => {
      const status = e.target.value;
      if (!status) return;

      if (status === "completed" && type === "tv") {
        const markAll = await showConfirm(
          "Marquer tous les épisodes de cette série comme vus ?",
          { confirmLabel: "Oui, tout marquer", cancelLabel: "Non, juste le statut" }
        );
        if (markAll) {
          toast("Marquage de tous les épisodes en cours…");
          await markAllEpisodesWatched(id, data.number_of_seasons, title, data.poster_path, genreIds);
        } else {
          await DB.upsertLibraryItem({
            user_id: App.session.user.id,
            tmdb_id: Number(id),
            media_type: type,
            title,
            poster_path: data.poster_path,
            status,
            updated_at: new Date().toISOString(),
          });
        }
      } else {
        await DB.upsertLibraryItem({
          user_id: App.session.user.id,
          tmdb_id: Number(id),
          media_type: type,
          title,
          poster_path: data.poster_path,
          status,
          updated_at: new Date().toISOString(),
        });
      }
      toast("Bibliothèque mise à jour.", "success");
      await App.refresh();
    });

    qs("#log-btn").addEventListener("click", () =>
      openLogModal({ tmdb_id: Number(id), media_type: type, title, poster_path: data.poster_path, genres: genreIds })
    );

    if (type === "movie") {
      qs("#quick-log-btn").addEventListener("click", async () => {
        try {
          await DB.addDiaryEntry({
            user_id: App.session.user.id,
            tmdb_id: Number(id),
            media_type: "movie",
            title,
            poster_path: data.poster_path,
            season: null,
            episode: null,
            watched_date: new Date().toISOString().slice(0, 10),
            rating: null,
            rewatch: movieWatchCount > 0,
            note: null,
            genres: genreIds,
            runtime_minutes: data.runtime || null,
          });
          toast(movieWatchCount > 0 ? "Nouveau visionnage ajouté 🎟️" : "Marqué comme vu 🎟️", "success");
          await App.refresh();
        } catch (err) {
          toast(err.message, "error");
        }
      });
    }

    if (type === "tv") {
      const initialSeason = lastViewedSeason[id] || 1;
      await renderSeasonsInto(qs("#seasons-container"), id, data.number_of_seasons, title, data.poster_path, genreIds, initialSeason);
    }
  } catch (err) {
    view.innerHTML = emptyState("Erreur de chargement — vérifie ta clé TMDB.");
  }
}

// Marque tous les épisodes d'une série comme vus (toutes saisons), en
// ne créant des entrées que pour ceux qui ne sont pas déjà loggués.
async function markAllEpisodesWatched(tvId, numberOfSeasons, title, posterPath, genreIds) {
  const watchedKeys = new Set(
    App.diary
      .filter((e) => String(e.tmdb_id) === String(tvId) && e.media_type === "tv")
      .map((e) => `${e.season}x${e.episode}`)
  );
  const today = new Date().toISOString().slice(0, 10);
  const toInsert = [];

  for (let s = 1; s <= numberOfSeasons; s++) {
    try {
      const season = await TMDB.getSeason(tvId, s);
      (season.episodes || []).forEach((ep) => {
        const key = `${s}x${ep.episode_number}`;
        if (!watchedKeys.has(key)) {
          toInsert.push({
            user_id: App.session.user.id,
            tmdb_id: Number(tvId),
            media_type: "tv",
            title,
            poster_path: posterPath,
            season: s,
            episode: ep.episode_number,
            watched_date: today,
            rating: null,
            rewatch: false,
            note: null,
            genres: genreIds,
            runtime_minutes: ep.runtime || null,
          });
        }
      });
      await new Promise((r) => setTimeout(r, 60));
    } catch {
      // saison indisponible sur TMDB, on continue avec les autres
    }
  }

  if (toInsert.length) await DB.bulkInsertDiary(toInsert);
  toast(`${toInsert.length} épisode(s) marqué(s) comme vus.`, "success");
}

async function renderSeasonsInto(container, tvId, numberOfSeasons, title, posterPath, genreIds, selectedSeason = 1) {
  if (!numberOfSeasons) {
    container.innerHTML = "";
    return;
  }
  lastViewedSeason[tvId] = selectedSeason;
  container.innerHTML = `<p class="loading">Chargement de la saison…</p>`;
  try {
    const season = await TMDB.getSeason(tvId, selectedSeason);
    const watchCounts = {};
    App.diary
      .filter((e) => String(e.tmdb_id) === String(tvId) && e.media_type === "tv" && e.season === selectedSeason)
      .forEach((e) => {
        watchCounts[e.episode] = (watchCounts[e.episode] || 0) + 1;
      });

    const seasonOptions = Array.from({ length: numberOfSeasons }, (_, i) => i + 1)
      .map((n) => `<option value="${n}" ${n === selectedSeason ? "selected" : ""}>Saison ${n}</option>`)
      .join("");
    const rows = (season.episodes || [])
      .map((ep) => {
        const count = watchCounts[ep.episode_number] || 0;
        const watched = count > 0;
        return `
        <div class="episode-row ${watched ? "episode-row--watched" : ""}" data-season="${selectedSeason}" data-episode="${ep.episode_number}" data-runtime="${ep.runtime || ""}">
          <span class="episode-num">S${selectedSeason}E${ep.episode_number}</span>
          <span class="episode-title">${escapeHtml(ep.name)}</span>
          <span class="episode-date">${ep.air_date ? formatDate(ep.air_date) : ""}</span>
          <div class="episode-row-actions">
            ${count > 1 ? `<span class="episode-rewatch-badge">×${count}</span>` : ""}
            ${watched ? `<button class="episode-rewatch-btn" title="Ajouter un revisionnage" data-season="${selectedSeason}" data-episode="${ep.episode_number}" data-runtime="${ep.runtime || ""}">↻</button>` : ""}
            <button class="episode-check-toggle ${watched ? "is-watched" : ""}" title="${watched ? "Marquer comme non vu" : "Marquer comme vu"}" data-season="${selectedSeason}" data-episode="${ep.episode_number}" data-runtime="${ep.runtime || ""}">${watched ? "✓" : ""}</button>
          </div>
        </div>`;
      })
      .join("");
    container.innerHTML = `
      <div class="seasons-block">
        <div class="seasons-header">
          <h2>Épisodes</h2>
          <select id="season-select">${seasonOptions}</select>
        </div>
        <div class="episode-list">${rows}</div>
      </div>`;

    qs("#season-select", container).addEventListener("change", (e) => {
      renderSeasonsInto(container, tvId, numberOfSeasons, title, posterPath, genreIds, Number(e.target.value));
    });

    qsa(".episode-check-toggle", container).forEach((btn) =>
      btn.addEventListener("click", async (e) => {
        e.stopPropagation();
        await toggleEpisodeWatched({
          tmdb_id: Number(tvId),
          title,
          poster_path: posterPath,
          genres: genreIds,
          season: Number(btn.dataset.season),
          episode: Number(btn.dataset.episode),
          runtime_minutes: Number(btn.dataset.runtime) || null,
        });
      })
    );

    qsa(".episode-rewatch-btn", container).forEach((btn) =>
      btn.addEventListener("click", async (e) => {
        e.stopPropagation();
        await addEpisodeRewatch({
          tmdb_id: Number(tvId),
          title,
          poster_path: posterPath,
          genres: genreIds,
          season: Number(btn.dataset.season),
          episode: Number(btn.dataset.episode),
          runtime_minutes: Number(btn.dataset.runtime) || null,
        });
      })
    );

    qsa(".episode-row", container).forEach((row) =>
      row.addEventListener("click", () =>
        openLogModal({
          tmdb_id: Number(tvId),
          media_type: "tv",
          title,
          poster_path: posterPath,
          genres: genreIds,
          season: Number(row.dataset.season),
          episode: Number(row.dataset.episode),
          runtime_minutes: Number(row.dataset.runtime) || null,
        })
      )
    );
  } catch {
    container.innerHTML = emptyState("Impossible de charger les épisodes de cette saison.");
  }
}

// Coche rapide : ajoute une entrée si l'épisode n'est pas vu, ou retire
// TOUTES les entrées (y compris les revisionnages) si on décoche.
async function toggleEpisodeWatched(ctx) {
  const existing = App.diary.filter(
    (e) =>
      String(e.tmdb_id) === String(ctx.tmdb_id) &&
      e.media_type === "tv" &&
      e.season === ctx.season &&
      e.episode === ctx.episode
  );
  try {
    if (existing.length === 0) {
      await DB.addDiaryEntry({
        user_id: App.session.user.id,
        tmdb_id: ctx.tmdb_id,
        media_type: "tv",
        title: ctx.title,
        poster_path: ctx.poster_path,
        season: ctx.season,
        episode: ctx.episode,
        watched_date: new Date().toISOString().slice(0, 10),
        rating: null,
        rewatch: false,
        note: null,
        genres: ctx.genres || [],
        runtime_minutes: ctx.runtime_minutes,
      });
      toast("Épisode marqué comme vu 🎟️", "success");
    } else {
      await DB.deleteDiaryEntries(existing.map((e) => e.id));
      toast("Épisode marqué comme non vu.", "success");
    }
    await App.refresh();
  } catch (err) {
    toast(err.message, "error");
  }
}

// Ajoute un revisionnage (rewatch) pour un épisode déjà vu.
async function addEpisodeRewatch(ctx) {
  try {
    await DB.addDiaryEntry({
      user_id: App.session.user.id,
      tmdb_id: ctx.tmdb_id,
      media_type: "tv",
      title: ctx.title,
      poster_path: ctx.poster_path,
      season: ctx.season,
      episode: ctx.episode,
      watched_date: new Date().toISOString().slice(0, 10),
      rating: null,
      rewatch: true,
      note: null,
      genres: ctx.genres || [],
      runtime_minutes: ctx.runtime_minutes,
    });
    toast("Revisionnage ajouté 🎟️", "success");
    await App.refresh();
  } catch (err) {
    toast(err.message, "error");
  }
}

// ---------- CONFIRM MODAL (générique) ----------
function showConfirm(message, { confirmLabel = "Oui", cancelLabel = "Non" } = {}) {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.innerHTML = `
      <div class="modal modal--confirm">
        <p class="modal-confirm-text">${escapeHtml(message)}</p>
        <div class="modal-actions">
          <button id="confirm-no" class="btn btn--ghost">${escapeHtml(cancelLabel)}</button>
          <button id="confirm-yes" class="btn btn--accent">${escapeHtml(confirmLabel)}</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    const close = (result) => {
      overlay.remove();
      resolve(result);
    };
    overlay.querySelector("#confirm-no").addEventListener("click", () => close(false));
    overlay.querySelector("#confirm-yes").addEventListener("click", () => close(true));
    overlay.addEventListener("click", (e) => e.target === overlay && close(false));
  });
}

// ---------- LOG MODAL (ticket de visionnage) ----------
function openLogModal(ctx) {
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal">
      <h2>Nouveau ticket</h2>
      <p class="modal-subtitle">${escapeHtml(ctx.title)}${ctx.season ? ` — S${ctx.season}E${ctx.episode}` : ""}</p>
      <label>Date de visionnage</label>
      <input type="date" id="log-date" value="${new Date().toISOString().slice(0, 10)}" />
      <label>Note (0 à 10)</label>
      <input type="number" id="log-rating" min="0" max="10" step="0.5" placeholder="optionnel" />
      <label><input type="checkbox" id="log-rewatch" /> Rediffusion (rewatch)</label>
      <label>Note personnelle</label>
      <textarea id="log-note" rows="2" placeholder="optionnel"></textarea>
      <div class="modal-actions">
        <button id="log-cancel" class="btn btn--ghost">Annuler</button>
        <button id="log-save" class="btn btn--accent">Valider le ticket</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.querySelector("#log-cancel").addEventListener("click", () => overlay.remove());
  overlay.addEventListener("click", (e) => e.target === overlay && overlay.remove());
  overlay.querySelector("#log-save").addEventListener("click", async () => {
    const entry = {
      user_id: App.session.user.id,
      tmdb_id: ctx.tmdb_id,
      media_type: ctx.media_type,
      title: ctx.title,
      poster_path: ctx.poster_path,
      season: ctx.season ?? null,
      episode: ctx.episode ?? null,
      watched_date: qs("#log-date", overlay).value,
      rating: qs("#log-rating", overlay).value ? Number(qs("#log-rating", overlay).value) : null,
      rewatch: qs("#log-rewatch", overlay).checked,
      note: qs("#log-note", overlay).value || null,
      genres: ctx.genres || [],
      runtime_minutes: ctx.runtime_minutes || null,
    };
    try {
      await DB.addDiaryEntry(entry);
      toast("Ticket ajouté au journal 🎟️", "success");
      overlay.remove();
      await App.refresh();
    } catch (err) {
      toast(err.message, "error");
    }
  });
}

// ---------- LIBRARY ----------
let libraryFilter = "all"; // "all" | "movie" | "tv"

function libraryTemplate(library) {
  const filterBar = `
    <div class="library-filters">
      <button class="filter-btn ${libraryFilter === "all" ? "filter-btn--active" : ""}" data-filter="all">Tout</button>
      <button class="filter-btn ${libraryFilter === "movie" ? "filter-btn--active" : ""}" data-filter="movie">Films</button>
      <button class="filter-btn ${libraryFilter === "tv" ? "filter-btn--active" : ""}" data-filter="tv">Séries</button>
    </div>`;

  const filtered = libraryFilter === "all" ? library : library.filter((l) => l.media_type === libraryFilter);

  if (!library.length) return emptyState("Ta bibliothèque est vide pour l'instant — va chercher une série ou un film.");
  if (!filtered.length) return filterBar + emptyState("Rien dans cette catégorie pour l'instant.");

  const groups = ["watching", "watchlist", "completed", "dropped"];
  const labels = { watching: "En cours", watchlist: "À voir", completed: "Terminé", dropped: "Abandonné" };
  const groupsHTML = groups
    .map((g) => {
      const items = filtered.filter((l) => l.status === g);
      if (!items.length) return "";
      return `
        <section class="library-group">
          <h2>${labels[g]} <span class="muted">(${items.length})</span></h2>
          <div class="grid">
            ${items
              .map((l) => {
                const showProgress = l.media_type === "tv" && l.total_episodes > 0;
                const clampedWatched = showProgress ? Math.min(l.watched_episodes, l.total_episodes) : 0;
                return `
              <div class="poster-card" data-id="${l.tmdb_id}" data-type="${l.media_type}" data-lib-id="${l.id}">
                <img src="${TMDB.posterUrl(l.poster_path)}" alt="${escapeHtml(l.title)}" loading="lazy" />
                ${
                  showProgress
                    ? `<div class="poster-card-progress" title="${clampedWatched}/${l.total_episodes} épisodes">
                        <div class="poster-card-progress-fill" style="width:${l.progress}%"></div>
                      </div>`
                    : ""
                }
                <div class="poster-card-info">
                  <span class="poster-card-title">${escapeHtml(l.title)}</span>
                  <button class="remove-btn" data-lib-id="${l.id}" title="Retirer">✕</button>
                </div>
                ${showProgress ? `<span class="poster-card-progress-label">${clampedWatched}/${l.total_episodes} épisodes</span>` : ""}
              </div>`;
              })
              .join("")}
          </div>
        </section>`;
    })
    .join("");

  return filterBar + groupsHTML;
}

function bindLibraryEvents() {
  qs("#view").addEventListener("click", async (e) => {
    const filterBtn = e.target.closest(".filter-btn");
    if (filterBtn) {
      libraryFilter = filterBtn.dataset.filter;
      App.route();
      return;
    }
    if (e.target.classList.contains("remove-btn")) {
      e.stopPropagation();
      await DB.removeLibraryItem(e.target.dataset.libId);
      await App.refresh();
      return;
    }
    const card = e.target.closest(".poster-card");
    if (card) location.hash = `#/show/${card.dataset.type}-${card.dataset.id}`;
  });
}

// ---------- DIARY (ticket display) ----------
function diaryTemplate(diary) {
  if (!diary.length)
    return emptyState("Ton journal est vide. Enregistre un visionnage depuis une fiche série/film, ou importe ton export TV Time.");
  return `<div class="ticket-list">${diary.map(ticketCard).join("")}</div>`;
}

function ticketCard(entry) {
  const sub = entry.media_type === "tv" && entry.season != null ? `S${entry.season}E${entry.episode}` : "Film";
  return `
    <div class="ticket" data-id="${entry.id}">
      <div class="ticket-poster">
        <img src="${TMDB.posterUrl(entry.poster_path, "w185")}" alt="" loading="lazy" />
      </div>
      <div class="ticket-perforation"></div>
      <div class="ticket-body">
        <div class="ticket-row">
          <span class="ticket-title">${escapeHtml(entry.title)}</span>
          <span class="ticket-sub">${sub}</span>
        </div>
        <div class="ticket-row ticket-row--meta">
          <span class="ticket-date">${formatDate(entry.watched_date)}</span>
          ${entry.rewatch ? '<span class="ticket-tag">Rewatch</span>' : ""}
        </div>
        ${entry.rating != null ? `<div class="ticket-stars">${stars(entry.rating)}</div>` : ""}
        ${entry.note ? `<p class="ticket-note">${escapeHtml(entry.note)}</p>` : ""}
        <div class="ticket-barcode">${barcodeSVG(String(entry.id) + entry.watched_date)}</div>
      </div>
      <button class="ticket-delete" data-id="${entry.id}" title="Supprimer">✕</button>
    </div>
  `;
}

function bindDiaryEvents() {
  qs("#view").addEventListener("click", async (e) => {
    if (e.target.classList.contains("ticket-delete")) {
      await DB.deleteDiaryEntry(e.target.dataset.id);
      await App.refresh();
    }
  });
}

// ---------- STATS ----------
function statsTemplate(diary, library) {
  const s = Stats.compute(diary, library, App.genreMaps);
  return `
    <div class="stats-view">
      <div class="stats-cards">
        <div class="stat-card"><span class="stat-num">${s.episodesCount}</span><span class="stat-label">Épisodes</span></div>
        <div class="stat-card"><span class="stat-num">${s.moviesCount}</span><span class="stat-label">Films</span></div>
        <div class="stat-card"><span class="stat-num">${formatWatchDuration(s.totalTvMinutes)}</span><span class="stat-label">passés devant des séries</span></div>
        <div class="stat-card"><span class="stat-num">${formatWatchDuration(s.totalMovieMinutes)}</span><span class="stat-label">passés devant des films</span></div>
        <div class="stat-card"><span class="stat-num">${s.avgRating ? s.avgRating.toFixed(1) : "—"}</span><span class="stat-label">Note moyenne</span></div>
        <div class="stat-card"><span class="stat-num">${s.showsCompleted}</span><span class="stat-label">Séries terminées</span></div>
      </div>

      <section class="stats-section">
        <h2>Activité (12 derniers mois)</h2>
        ${Stats.renderMonthlyChart(s.monthly)}
      </section>

      ${
        s.topGenres.length
          ? `<section class="stats-section-genres">
        <h2>Genres favoris</h2>
        ${Stats.renderGenreChart(s.topGenres)}
      </section>`
          : ""
      }

      ${
        s.topRated.length
          ? `<section class="stats-section">
        <h2>Tes meilleures notes</h2>
        <div class="ticket-list">${s.topRated.map(ticketCard).join("")}</div>
      </section>`
          : ""
      }
    </div>
  `;
}

// ---------- BADGES ----------
function badgesTemplate(earnedKeys) {
  return `
    <div class="badges-grid">
      ${BADGES.map((b) => {
        const earned = earnedKeys.includes(b.key);
        return `
        <div class="badge-card ${earned ? "badge-card--earned" : ""}">
          <span class="badge-icon">${b.icon}</span>
          <span class="badge-name">${b.name}</span>
          <span class="badge-desc">${b.description}</span>
        </div>`;
      }).join("")}
    </div>
  `;
}

App.init();
