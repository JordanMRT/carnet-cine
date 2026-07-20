// ============================================
// APP — état global, routing, rendu des vues
// ============================================

const App = {
  session: null,
  library: [],
  diary: [],
  earnedBadges: [],
  genreMaps: { movie: {}, tv: {} },
  _rendering: false, // évite les rendus concurrents (plusieurs événements d'auth d'affilée)
  // Compteur incrémenté à chaque appel à route(). Les vues async (upcoming,
  // show, episode) le capturent et vérifient qu'il n'a pas changé avant
  // d'écrire dans le DOM, pour éviter qu'un rendu obsolète (déclenché par un
  // appel précédent) n'écrase un rendu plus récent une fois sa requête TMDB
  // enfin résolue — ça peut arriver car route() est maintenant appelée deux
  // fois au chargement (affichage rapide, puis rafraîchi après rebuild).
  _renderGen: 0,

  async init() {
    let initialRenderDone = false;
    DB.onAuthChange((session) => {
      const wasLoggedIn = !!this.session;
      const isLoggedIn = !!session;
      this.session = session;
      // Un simple rafraîchissement de token (déjà connecté avant/après) ne
      // doit pas relancer tout le rendu — seule une vraie transition
      // connecté/déconnecté le justifie.
      if (wasLoggedIn && isLoggedIn) return;
      initialRenderDone = true;
      this.renderShell();
    });
    this.session = await DB.getSession();
    if (!initialRenderDone) {
      await this.renderShell();
    }
    window.addEventListener("hashchange", () => this.route());

    // Un seul listener délégué pour tous les cast-cards de l'appli (fiche
    // film, fiche série, fiche épisode...) : ouvre la page du comédien.
    document.addEventListener("click", (e) => {
      const castCard = e.target.closest(".cast-card[data-person-id]");
      if (castCard) location.hash = `#/person/${castCard.dataset.personId}`;
    });

// Service Worker
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js").then((registration) => {
    // Vérifie immédiatement si une mise à jour existe
    registration.update();

    // Un worker était peut-être déjà en attente d'une session précédente
    if (registration.waiting && navigator.serviceWorker.controller) {
      showUpdatePrompt(registration.waiting);
    }

    registration.addEventListener("updatefound", () => {
      const newWorker = registration.installing;
      if (!newWorker) return;

      newWorker.addEventListener("statechange", () => {
        if (newWorker.state === "installed" && navigator.serviceWorker.controller) {
          showUpdatePrompt(newWorker);
        }
      });
    });
  });
}

maybeShowInstallPrompt();
  },

  async renderShell() {
    if (this._rendering) return; // un rendu est déjà en cours, on ne le double pas
    this._rendering = true;
    try {
      const root = qs("#root");
      if (!this.session) {
        root.innerHTML = authTemplate();
        bindAuthEvents();
        return;
      }
      root.innerHTML = shellTemplate();
      setupViewTransitions();
      if (typeof lucide !== "undefined") lucide.createIcons();
      // Les genres TMDB ne servent qu'à l'affichage des stats : on les charge
      // en parallèle (sans attendre) plutôt qu'avant syncAndRoute, pour ne
      // pas retarder le tout premier affichage du journal.
      this.loadGenreMaps();
      await this.syncAndRoute();
      if (typeof lucide !== "undefined") lucide.createIcons();
      bindShellEvents();
    } finally {
      this._rendering = false;
      hideSplash();
    }
  },

  async loadGenreMaps() {
    try {
      const [movie, tv] = await Promise.all([TMDB.getGenreMap("movie"), TMDB.getGenreMap("tv")]);
      this.genreMaps = { movie, tv };
      // Si l'utilisateur est déjà sur l'écran stats (arrivée directe via hash),
      // on rafraîchit une fois les libellés de genre disponibles.
      if ((location.hash.slice(2) || "diary").split("/")[0] === "stats") this.route();
    } catch {
      // Pas bloquant : les stats retomberont sur les ids bruts en libellé.
    }
  },

  async loadData() {
    const userId = this.session.user.id;
    [this.library, this.diary, this.profile, this.pendingRequests, this.following] = await Promise.all([
      DB.getLibrary(userId),
      DB.getDiary(userId),
      DB.getMyProfile(userId),
      DB.getPendingRequests(userId),
      DB.getMyFollowingList(userId),
    ]);
    const earned = await evaluateBadges(this.diary, this.library, userId);
    this.earnedBadges = earned;
  },

  // Recharge les données, reconstruit la bibliothèque (statuts, progression,
  // épisodes restants) depuis le journal, puis affiche la vue. Lance en
  // tâche de fond la récupération des durées manquantes sur TMDB.
  async syncAndRoute() {
    try {
      await this.loadData();
    } catch (err) {
      console.error("Chargement des données impossible :", err);
      qs("#view").innerHTML =
        emptyState("Chargement impossible pour le moment (problème réseau ou Supabase).") +
        `<div style="text-align:center;margin-top:1rem;"><button id="retry-load" class="btn btn--accent">Réessayer</button></div>`;
      qs("#retry-load")?.addEventListener("click", () => this.syncAndRoute());
      hideSplash();
      return;
    }
    // Premier affichage immédiat avec les données déjà en base : l'utilisateur
    // voit son journal tout de suite, sans attendre la reconstruction de la
    // bibliothèque (qui peut faire des appels TMDB en arrière-plan). Le splash
    // se retire ici, dès que ce premier contenu est visible.
    this.route();
    hideSplash();

    try {
      // rebuild() ne reconstruit que ce qui provient du JOURNAL : un film
      // ajouté à la watchlist mais jamais visionné n'a aucune ligne de
      // journal, donc rebuild() ne le renvoie pas. On fusionne son résultat
      // avec les entrées de bibliothèque qu'il n'a pas touchées (watchlist
      // pure, statut "dropped" mis à la main, etc.) au lieu de les perdre —
      // tout en évitant un second aller-retour complet vers Supabase.
      const rebuilt = await LibraryBuilder.rebuild(this.session.user.id, this.diary, this.library);
      const rebuiltKeys = new Set(rebuilt.map((w) => `${w.media_type}_${w.tmdb_id}`));
      const untouched = this.library.filter((l) => !rebuiltKeys.has(`${l.media_type}_${l.tmdb_id}`));
      this.library = [...rebuilt, ...untouched];
      this.earnedBadges = await evaluateBadges(this.diary, this.library, this.session.user.id);
      this.route();
    } catch (err) {
      console.warn("Reconstruction de la bibliothèque impossible :", err);
    }

    RuntimeEnrichment.run(this.diary)
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
    const gen = ++this._renderGen;
    const hash = location.hash.slice(2) || "diary";
    const [view, param] = hash.split("/");
    qsa(".nav-link").forEach((a) => a.classList.toggle("active", a.dataset.view === view));
    updateMobileNavPill();
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
      case "upcoming":
        renderUpcoming(gen);
        break;
      case "show":
        renderShowDetail(param, gen);
        break;
      case "stats":
        view_el.innerHTML = statsTemplate(this.diary, this.library);
        bindStatsEvents();
        DB.getPendingRequests(this.session.user.id).then((reqs) => {
          this.pendingRequests = reqs;
          if ((location.hash.slice(2) || "diary").split("/")[0] === "stats") {
            const container = qs("#pending-requests-container");
            if (container) container.innerHTML = pendingRequestsHTML();
          }
        });
        break;
      case "badges":
        view_el.innerHTML = badgesTemplate(this.earnedBadges);
        break;
      case "diary":
      default:
        view_el.innerHTML = diaryTemplate(this.library);
        bindDiaryEvents();
        break;
        case "episode":
        renderEpisodeDetail(param, gen);
        break;
      case "person":
        renderPersonDetail(param, gen);
        break;
        case "u":
        renderUserProfile(param, gen);
        break;
        case "settings":
        view_el.innerHTML = settingsTemplate();
        bindSettingsEvents();
        break;
        case "social":
        view_el.innerHTML = socialTemplate();
        bindSocialEvents();
        break;
    }
    if (typeof lucide !== "undefined") lucide.createIcons();
  },

  async refresh() {
    await this.syncAndRoute();
  },
};

let _mobileNavPillReady = false;
let _mobileNavResizeBound = false;

function updateMobileNavPill() {
  const nav = qs(".mobile-nav");
  const pill = qs("#mobile-nav-pill");
  const active = nav?.querySelector("a.active");
  if (!nav || !pill || !active) return;

  const navRect = nav.getBoundingClientRect();
  const linkRect = active.getBoundingClientRect();
  pill.style.width = `${linkRect.width}px`;
  pill.style.transform = `translateX(${linkRect.left - navRect.left}px)`;

  if (!_mobileNavPillReady) {
    // Positionne d'abord sans transition, pour éviter un glissement
    // depuis le coin au tout premier affichage — l'animation ne
    // s'active qu'à partir du changement d'onglet suivant.
    requestAnimationFrame(() => {
      pill.classList.add("mobile-nav-pill--ready");
      _mobileNavPillReady = true;
    });
  }

  if (!_mobileNavResizeBound) {
    window.addEventListener("resize", () => updateMobileNavPill());
    _mobileNavResizeBound = true;
  }
}

// ---------- ANIMATION VIEWTRANSITIONS ----------
// Fondu léger à chaque changement de vue. Plutôt que de modifier chacune
// des fonctions de rendu, on observe les mutations de #view et on relance
// une micro-animation CSS à chaque remplacement de contenu.
function setupViewTransitions() {
  const view = qs("#view");
  if (!view) return;
  const observer = new MutationObserver(() => {
    if (view.querySelector(":scope > .loading")) return;
    view.classList.remove("view-fade-in");
    void view.offsetWidth;
    view.classList.add("view-fade-in");
  });
  observer.observe(view, { childList: true });
}

// ---------- SHELL ----------
function shellTemplate() {
  return `
    <header class="topbar">
      <div class="brand">
        <img src="brand-top.png">
        <span>Time To Binge</span>
      </div>

      <nav class="nav">
        <a href="#/diary" class="nav-link" data-view="diary">Journal</a>
        <a href="#/search" class="nav-link" data-view="search">Rechercher</a>
        <a href="#/library" class="nav-link" data-view="library">Bibliothèque</a>
        
        <a href="#/badges" class="nav-link" data-view="badges">Badges</a>
      </nav>

      <div class="topbar-actions">
        <a href="#/stats" class="btn btn--ghost">${escapeHtml(displayName())}</a>

          <button id="logout-btn" class="btn btn--ghost">
          Déconnexion
        </button>
      </div>
    </header>

    <main id="view"></main>

<nav class="mobile-nav">
    <div class="mobile-nav-pill" id="mobile-nav-pill"></div>

    <a href="#/diary" class="nav-link" data-view="diary">
        <i data-lucide="ticket"></i>
        <span>Journal</span>
    </a>

    <a href="#/search" class="nav-link" data-view="search">
        <i data-lucide="search"></i>
        <span>Recherche</span>
    </a>

    <a href="#/library" class="nav-link" data-view="library">
        <i data-lucide="library-big"></i>
        <span>Bibliothèque</span>
    </a>

    <a href="#/badges" class="nav-link" data-view="badges">
        <i data-lucide="award"></i>
        <span>Badges</span>
    </a>

    <a href="#/stats" class="nav-link" data-view="stats">
        <i data-lucide="user-round"></i>
        <span>Profil</span>
    </a>

</nav>

    <input type="file" id="import-shows-input" accept=".json,.csv" hidden />
    <input type="file" id="import-movies-input" accept=".json,.csv" hidden />
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

  qs("#import-shows-input").addEventListener("change", (e) => runImport(e, "shows"));
  qs("#import-movies-input").addEventListener("change", (e) => runImport(e, "movies"));
}

function bindStatsEvents() {
  qs("#edit-banner-btn")?.addEventListener("click", openBannerPicker);
  qs("#edit-avatar-btn")?.addEventListener("click", openAvatarPicker);
  qs("#profile-username-btn")?.addEventListener("click", async () => {
    const current = App.session.user.user_metadata?.username || "";
    const next = prompt("Ton pseudo :", current);
    if (next && next.trim() && next.trim() !== current) {
      try {
        await DB.updateUsername(next.trim());
        App.session = await DB.getSession();
        toast("Pseudo mis à jour.", "success");
        App.route();
      } catch (err) {
        toast(err.message, "error");
      }
    }
  });

  qs("#open-settings-btn")?.addEventListener("click", () => {
    location.hash = "#/settings";
  });

  qs("#pending-requests-container")?.addEventListener("click", async (e) => {
    const acceptBtn = e.target.closest(".request-accept-btn");
    const refuseBtn = e.target.closest(".request-refuse-btn");
    const btn = acceptBtn || refuseBtn;
    if (btn) {
      btn.disabled = true;
      try {
        await DB.respondToRequest(btn.dataset.requestId, !!acceptBtn);
        toast(acceptBtn ? "Demande acceptée." : "Demande refusée.", "success");
        App.pendingRequests = await DB.getPendingRequests(App.session.user.id);
        const container = qs("#pending-requests-container");
        if (container) container.innerHTML = pendingRequestsHTML();
      } catch (err) {
        btn.disabled = false;
        toast(err.message, "error");
      }
      return;
    }
    const card = e.target.closest(".user-result-card[data-user-id]");
    if (card) location.hash = `#/u/${card.dataset.userId}`;
  });

  qs(".stats-section-requests")?.addEventListener("click", async (e) => {
    const acceptBtn = e.target.closest(".request-accept-btn");
    const refuseBtn = e.target.closest(".request-refuse-btn");
    const btn = acceptBtn || refuseBtn;
    if (btn) {
      btn.disabled = true;
      try {
        await DB.respondToRequest(btn.dataset.requestId, !!acceptBtn);
        toast(acceptBtn ? "Demande acceptée." : "Demande refusée.", "success");
        App.pendingRequests = await DB.getPendingRequests(App.session.user.id);
        App.route();
      } catch (err) {
        btn.disabled = false;
        toast(err.message, "error");
      }
      return;
    }

    const card = e.target.closest(".user-result-card[data-user-id]");
    if (card) location.hash = `#/u/${card.dataset.userId}`;
  });

  qs(".stats-section-following")?.addEventListener("click", async (e) => {
    const unfollowBtn = e.target.closest(".other-profile-unfollow-btn");
    if (unfollowBtn) {
      unfollowBtn.disabled = true;
      try {
        await DB.unfollow(App.session.user.id, userId);
        toast("Désabonnement effectué.", "success");
        App.following = await DB.getMyFollowingList(App.session.user.id);
        App.route();
      } catch (err) {
        unfollowBtn.disabled = false;
        toast(err.message, "error");
      }
      return;
    }

    const card = e.target.closest(".user-result-card[data-user-id]");
    if (card) location.hash = `#/u/${card.dataset.userId}`;
  });

  if (typeof lucide !== "undefined") lucide.createIcons();
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


function bindSettingsEvents() {
  qs("#import-shows-btn")?.addEventListener("click", () => qs("#import-shows-input").click());
  qs("#import-movies-btn")?.addEventListener("click", () => qs("#import-movies-input").click());

  qs("#privacy-searchable")?.addEventListener("click", async (e) => {
    const el = e.currentTarget;
    const checkIcon = el.querySelector(".episode-check-toggle");
    const newValue = !App.profile?.is_searchable;

    checkIcon.classList.toggle("is-watched", newValue);
    checkIcon.innerHTML = newValue ? '<i data-lucide="circle-check-big"></i>' : "";
    el.setAttribute("aria-checked", String(newValue));
    if (typeof lucide !== "undefined") lucide.createIcons();

    try {
      await DB.updatePrivacySettings(App.session.user.id, {
        is_searchable: newValue,
        visibility: App.profile?.visibility || "followers",
      });
      App.profile = { ...(App.profile || {}), is_searchable: newValue };
      toast("Réglage mis à jour.", "success");
    } catch (err) {
      checkIcon.classList.toggle("is-watched", !newValue);
      checkIcon.innerHTML = !newValue ? '<i data-lucide="circle-check-big"></i>' : "";
      el.setAttribute("aria-checked", String(!newValue));
      if (typeof lucide !== "undefined") lucide.createIcons();
      toast(err.message, "error");
    }
  });

  qs("#privacy-visibility")?.addEventListener("change", async (e) => {
    const visibility = e.target.value;
    const previous = App.profile?.visibility || "followers";
    try {
      await DB.updatePrivacySettings(App.session.user.id, {
        is_searchable: App.profile?.is_searchable || false,
        visibility,
      });
      App.profile = { ...(App.profile || {}), visibility };
      toast("Réglage mis à jour.", "success");
    } catch (err) {
      e.target.value = previous;
      toast(err.message, "error");
    }
  });

  qs("#delete-account-btn")?.addEventListener("click", async () => {
    const confirmed = await showConfirm(
      "Cette action supprimera définitivement toutes tes données (journal, bibliothèque, badges) ainsi que ton compte. C'est irréversible. Confirmer ?",
      { confirmLabel: "Oui, supprimer", cancelLabel: "Non" }
    );
    if (!confirmed) return;
    try {
      await DB.deleteAccount();
      toast("Compte supprimé.", "success");
      location.hash = "#/";
      location.reload();
    } catch (err) {
      toast(err.message, "error");
    }
  });
}

function pendingRequestsHTML() {
  return App.pendingRequests?.length
    ? `<section class="stats-section-requests">
        <h2>Demandes reçues</h2>
        <div class="request-list">${App.pendingRequests.map(requestCard).join("")}</div>
      </section>`
    : "";
}

// ---------- AUTH ----------
let pendingEmail = "";
let authStep = "email"; // "email" | "code"

function authTemplate() {
  return `
    <div class="auth-screen">
      <div class="auth-card">
        <div class="auth-ticket"><img src="ttb-logo-ticketcorn-shadow.png"></div>
        <h1>Time To Binge</h1>
        <p class="auth-sub">Ton journal de séries et de films, un ticket à la fois.</p>

        <form id="auth-form" class="auth-form">

          <div id="step-email">
            <input type="email" id="auth-email" placeholder="Email" required />
            <input type="text" id="auth-username" placeholder="Pseudo (création)" />
            <button type="submit" class="btn btn--primary-log">
              Recevoir le code
            </button>
          </div>

          <div id="step-code" style="display:none;">
            <input type="text" id="auth-code" placeholder="Code reçu par email" />
            <button type="submit" class="btn btn--primary-log">
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

    const btn = qs(authStep === "email" ? "#step-email button" : "#step-code button", form);
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
      <div class="picker-tabs search-tabs">
        <button class="picker-tab search-tab--active" data-tab="content">Films &amp; séries</button>
        <button class="picker-tab" data-tab="users">Utilisateurs</button>
      </div>
      <input type="search" id="search-input" class="search-input" placeholder="Cherche une série ou un film…" autofocus />
      <div id="search-results" class="grid"></div>
    </div>
  `;
}

function bindSearchEvents() {
  const input = qs("#search-input");
  const results = qs("#search-results");
  const tabs = qsa(".search-tabs .picker-tab");
  let activeTab = "content";
  let myFollowing = {}; // { followedId: status } — chargé une fois, mis à jour localement ensuite

  function setTab(tab) {
    activeTab = tab;
    tabs.forEach((t) => t.classList.toggle("search-tab--active", t.dataset.tab === tab));
    input.placeholder = tab === "users" ? "Cherche un pseudo…" : "Cherche une série ou un film…";
    results.innerHTML = "";
    input.value = "";
    input.focus();
  }

  tabs.forEach((t) => t.addEventListener("click", () => setTab(t.dataset.tab)));

  input.addEventListener(
    "input",
    debounce(async () => {
      const q = input.value.trim();
      if (q.length < 2) {
        results.innerHTML = "";
        return;
      }

      if (activeTab === "content") {
        try {
          const items = await TMDB.searchMulti(q);
          results.innerHTML = items.map(posterCard).join("") || emptyState("Aucun résultat.");
        } catch (err) {
          results.innerHTML = emptyState("Erreur TMDB — vérifie ta clé API dans js/config.js.");
        }
        return;
      }

      try {
        if (!Object.keys(myFollowing).length) {
          const following = await DB.getMyFollowing(App.session.user.id);
          following.forEach((f) => (myFollowing[f.followed_id] = f.status));
        }
        const users = await DB.searchUsers(q, App.session.user.id);
        results.innerHTML =
          users.map((u) => userResultCard(u, myFollowing[u.id])).join("") ||
          emptyState("Aucun utilisateur trouvé.");
      } catch (err) {
        results.innerHTML = emptyState("Erreur lors de la recherche.");
      }
    }, 400)
  );

  results.addEventListener("click", async (e) => {
    const card = e.target.closest(".poster-card");
    if (card) {
      location.hash = `#/show/${card.dataset.type}-${card.dataset.id}`;
      return;
    }

    const followBtn = e.target.closest(".user-follow-btn");
    if (followBtn && !followBtn.disabled) {
      const targetId = followBtn.dataset.userId;
      followBtn.disabled = true;
      followBtn.textContent = "Envoi…";
      try {
        await DB.sendFollowRequest(App.session.user.id, targetId);
        myFollowing[targetId] = "pending";
        followBtn.textContent = "Demande envoyée";
      } catch (err) {
        followBtn.disabled = false;
        followBtn.textContent = "Suivre";
        toast(err.message, "error");
      }
      return;
    }

    const userCard = e.target.closest(".user-result-card[data-user-id]");
    if (userCard) location.hash = `#/u/${userCard.dataset.userId}`;
  });
}

function socialTemplate() {
  return `
    <div class="stats-view social-view">
      <a href="#/stats" class="settings-back">← Retour au profil</a>
      <h1>Abonnements &amp; abonnés</h1>
      <div class="picker-tabs social-tabs">
        <button class="picker-tab search-tab--active" data-tab="following">Abonnements</button>
        <button class="picker-tab" data-tab="followers">Abonnés</button>
      </div>
      <div id="social-list"></div>
    </div>
  `;
}

function followerCard(f) {
  const p = f.profile;
  const username = p?.username || "Utilisateur inconnu";
  const avatarUrl = p?.avatar_url || (p?.avatar_path ? TMDB.posterUrl(p.avatar_path, "w185") : null);
  return `
    <div class="user-result-card" data-user-id="${f.follower_id}">
      <div class="user-result-avatar" style="${avatarUrl ? `background-image:url('${avatarUrl}')` : ""}">
        ${avatarUrl ? "" : `<span class="profile-avatar-fallback">${escapeHtml(username[0]?.toUpperCase() || "?")}</span>`}
      </div>
      <span class="user-result-name">${escapeHtml(username)}</span>
    </div>
  `;
}

function bindSocialEvents() {
  const list = qs("#social-list");
  const tabs = qsa(".social-tabs .picker-tab");
  let activeTab = "following";

  async function render() {
    list.innerHTML = `<p class="loading">Chargement…</p>`;
    try {
      if (activeTab === "following") {
        App.following = await DB.getMyFollowingList(App.session.user.id);
        list.innerHTML = App.following.length
          ? App.following.map(followingCard).join("")
          : emptyState("Tu ne suis personne pour l'instant.");
      } else {
        const followers = await DB.getMyFollowers(App.session.user.id);
        list.innerHTML = followers.length
          ? followers.map(followerCard).join("")
          : emptyState("Personne ne te suit pour l'instant.");
      }
      if (typeof lucide !== "undefined") lucide.createIcons();
    } catch (err) {
      list.innerHTML = emptyState("Erreur lors du chargement.");
    }
  }

  tabs.forEach((t) =>
    t.addEventListener("click", () => {
      activeTab = t.dataset.tab;
      tabs.forEach((x) => x.classList.toggle("search-tab--active", x === t));
      render();
    })
  );

  list.addEventListener("click", async (e) => {
    const unfollowBtn = e.target.closest(".unfollow-btn");
    if (unfollowBtn) {
      unfollowBtn.disabled = true;
      try {
        await DB.unfollow(App.session.user.id, unfollowBtn.dataset.userId);
        toast("Désabonnement effectué.", "success");
        render();
      } catch (err) {
        unfollowBtn.disabled = false;
        toast(err.message, "error");
      }
      return;
    }
    const card = e.target.closest(".user-result-card[data-user-id]");
    if (card) location.hash = `#/u/${card.dataset.userId}`;
  });

  render();
}

function posterCard(item) {
  const title = item.original_title || item.original_name || item.title || item.name;
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

const TV_STATUS_LABELS = {
  "Returning Series": "En cours de diffusion",
  "Ended": "Terminée",
  "Canceled": "Annulée",
  "In Production": "En production",
  "Planned": "Prévue",
  "Pilot": "Pilote",
};

function similarStripHTML(items, type) {
  if (!items.length) return "";
  return `
    <div class="similar-strip">
      <h2 class="similar-title">Tu aimeras peut-être :</h2>
      <div class="similar-scroll">
        ${items.slice(0, 12).map((r) => posterCard({ ...r, media_type: type })).join("")}
      </div>
    </div>`;
}

function watchProvidersHTML(providers) {
  const flatrate = providers?.flatrate || [];
  if (!flatrate.length) return "";
  return `
    <div class="watch-providers">
      <h2 class="watch-providers-title">Disponible sur</h2>
      <div class="watch-providers-list">
        ${flatrate.map((p) => `<img src="${TMDB.posterUrl(p.logo_path, "w45")}" alt="${escapeHtml(p.provider_name)}" title="${escapeHtml(p.provider_name)}" class="watch-provider-logo" />`).join("")}
      </div>
      <span class="watch-providers-attribution">Données JustWatch, via TMDB</span>
    </div>`;
}

function friendsActivityHTML(activity) {
  if (!activity.length) return "";
  return `
    <div class="friends-activity">
      <h2 class="friends-activity-title">Vu par tes abonnements</h2>
      <div class="friends-activity-list">
        ${activity
          .map((a) => {
            const p = a.profile;
            const username = p?.username || "Utilisateur";
            const avatarUrl = p?.avatar_url || (p?.avatar_path ? TMDB.posterUrl(p.avatar_path, "w185") : null);
            const starsLabel = a.avg_rating != null ? "★".repeat(Math.round(a.avg_rating / 2)) : "";
            return `
              <a href="#/u/${p?.id}" class="friend-activity-card">
                <div class="user-result-avatar-activity" style="${avatarUrl ? `background-image:url('${avatarUrl}')` : ""}">
                  ${avatarUrl ? "" : `<span class="profile-avatar-fallback">${escapeHtml(username[0]?.toUpperCase() || "?")}</span>`}
                </div>
                <span class="friend-activity-name">${escapeHtml(username)}</span>
                ${starsLabel ? `<span class="friend-activity-stars">${starsLabel}</span>` : ""}
                ${a.last_note ? `<p class="friend-activity-note">${escapeHtml(a.last_note)}</p>` : ""}
              </a>`;
          })
          .join("")}
      </div>
    </div>`;
}

function seriesNotesHTML(tvId) {
  const notedEpisodes = App.diary
    .filter((e) => e.media_type === "tv" && String(e.tmdb_id) === String(tvId) && e.note)
    .sort((a, b) => (a.season - b.season) || (a.episode - b.episode));
  if (!notedEpisodes.length) return "";
  return `
    <div class="series-notes">
      <h2 class="series-notes-title">Tes commentaires</h2>
      <div class="series-notes-list">
        ${notedEpisodes
          .map(
            (e) => `
          <a href="#/episode/${tvId}-${e.season}-${e.episode}" class="series-note-item">
            <span class="series-note-episode">S${e.season}E${e.episode}</span>
            <p class="series-note-text">${escapeHtml(e.note)}</p>
          </a>`
          )
          .join("")}
      </div>
    </div>`;
}

function userResultCard(profile, status) {
  const avatarUrl = profile.avatar_url || (profile.avatar_path ? TMDB.posterUrl(profile.avatar_path, "w185") : null);
  const label = status === "accepted" ? "Abonné" : status === "pending" ? "Demande envoyée" : "Suivre";
  return `
    <div class="user-result-card" data-user-id="${profile.id}">
      <div class="user-result-avatar" style="${avatarUrl ? `background-image:url('${avatarUrl}')` : ""}">
        ${avatarUrl ? "" : `<span class="profile-avatar-fallback">${escapeHtml(profile.username[0]?.toUpperCase() || "?")}</span>`}
      </div>
      <span class="user-result-name">${escapeHtml(profile.username)}</span>
      <button class="btn btn--ghost user-follow-btn" data-user-id="${profile.id}" ${status ? "disabled" : ""}>${label}</button>
    </div>
  `;
}

function requestCard(req) {
  const p = req.profile;
  const username = p?.username || "Utilisateur inconnu";
  const avatarUrl = p?.avatar_url || (p?.avatar_path ? TMDB.posterUrl(p.avatar_path, "w185") : null);
  return `
    <div class="user-result-card" data-user-id="${req.follower_id}">
      <div class="user-result-avatar" style="${avatarUrl ? `background-image:url('${avatarUrl}')` : ""}">
        ${avatarUrl ? "" : `<span class="profile-avatar-fallback">${escapeHtml(username[0]?.toUpperCase() || "?")}</span>`}
      </div>
      <span class="user-result-name">${escapeHtml(username)}</span>
      <div class="request-actions">
        <button class="btn btn--accent request-accept-btn" data-request-id="${req.id}">Accepter</button>
        <button class="btn btn--ghost request-refuse-btn" data-request-id="${req.id}">Refuser</button>
      </div>
    </div>
  `;
}

function followingCard(f) {
  const p = f.profile;
  const username = p?.username || "Utilisateur inconnu";
  const avatarUrl = p?.avatar_url || (p?.avatar_path ? TMDB.posterUrl(p.avatar_path, "w185") : null);
  const statusLabel = f.status === "pending" ? " · en attente" : "";
  return `
    <div class="user-result-card" data-user-id="${f.followed_id}">
      <div class="user-result-avatar" style="${avatarUrl ? `background-image:url('${avatarUrl}')` : ""}">
        ${avatarUrl ? "" : `<span class="profile-avatar-fallback">${escapeHtml(username[0]?.toUpperCase() || "?")}</span>`}
      </div>
      <span class="user-result-name">${escapeHtml(username)}${statusLabel}</span>
      <button class="btn btn--ghost unfollow-btn" data-user-id="${f.followed_id}">Se désabonner</button>
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
async function renderShowDetail(param, gen) {
  const [type, id] = param.split("-");
  const view = qs("#view");
  view.innerHTML = `<p class="loading">Chargement…</p>`;
  try {
    const data = type === "movie" ? await TMDB.getMovie(id) : await TMDB.getTv(id);
    const title = data.original_title || data.original_name || data.title || data.name;
    const genreNames = (data.genres || []).map((g) => g.name);
    const genreIds = (data.genres || []).map((g) => String(g.id));
    const inLibrary = App.library.find(
      (l) => String(l.tmdb_id) === String(id) && l.media_type === type
    );

    const friendIds = App.following.filter((f) => f.status === "accepted").map((f) => f.followed_id);
    const [recommendations, watchProviders, friendsActivity, rawCast] = await Promise.all([
      TMDB.getRecommendations(type, id).catch(() => []),
      TMDB.getWatchProviders(type, id).catch(() => null),
      friendIds.length ? DB.getFriendsActivityForWork(friendIds, Number(id), type).catch(() => []) : Promise.resolve([]),
      type === "tv" ? TMDB.getAggregateCredits(id).then((r) => r.cast || []) : Promise.resolve(data.credits?.cast || []),
    ]);
    const cast = (await getCastForDisplay(type === "movie" ? "movie" : "series", id, title, rawCast)).slice(0, 12);
    const castHTML = cast.length
      ? `
      <div class="cast-strip">
        <h2 class="cast-title">Casting</h2>
        <div class="cast-scroll">
          ${cast
            .map(
              (actor) => `
            <div class="cast-card${actor.tmdbPersonId ? " cast-card--linked" : ""}"${actor.tmdbPersonId ? ` data-person-id="${actor.tmdbPersonId}"` : ""}>
              <img src="${actor.image}" alt="${escapeHtml(actor.name)}" loading="lazy" />
              <span class="cast-name">${escapeHtml(actor.role)}</span>
              <span class="cast-character">${escapeHtml(actor.name)}</span>
            </div>`
            )
            .join("")}
        </div>
      </div>`
      : "";


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
        ? movieWatchCount > 0
          ? `
        <span class="episode-watch-info"><i data-lucide="circle-check-big"></i> vu${movieWatchCount > 1 ? ` • ${movieWatchCount} visionnages` : ""}</span>
        <button id="movie-rewatch-btn" class="btn btn--accent">
          Rewatch <i data-lucide="rotate-ccw"></i>
        </button>
        <button id="movie-undo-btn" class="btn btn--ghost">Annuler le dernier visionnage</button>`
          : `<button id="quick-log-btn" class="btn btn--accent">Marquer comme vu</button>`
        : "";

    const userRating = inLibrary?.avg_rating != null ? Math.round(inLibrary.avg_rating / 2) : 0;
    const canRate = type === "movie" ? movieWatchCount > 0 : (inLibrary?.watched_episodes || 0) > 0;
    const ratingHTML = `
      <div class="rating-widget-block">
        <h2 class="rating-title">Ta note</h2>
        <div class="rating-widget ${canRate ? "" : "rating-widget--disabled"}" id="rating-widget">
          ${[1, 2, 3, 4, 5]
            .map(
              (n) =>
                `<button class="rating-star ${n <= userRating ? "rating-star--filled" : ""}" data-value="${n}" ${canRate ? "" : "disabled"} title="${n} étoile${n > 1 ? "s" : ""}">${n <= userRating ? "★" : "☆"}</button>`
            )
            .join("")}
        </div>
        ${!canRate ? `<p class="rating-hint">Marque ${type === "movie" ? "le film" : "la série"} comme vu${type === "movie" ? "" : "e"} pour pouvoir ${type === "movie" ? "le" : "la"} noter.</p>` : ""}
      </div>`;
      const noteHTML = type === "movie" ? `
      <div class="note-widget-block">
        <h2 class="rating-title">Ton commentaire</h2>
        <textarea id="work-note" class="note-textarea" placeholder="Ce que tu en as pensé, une scène marquante, une réplique qui t'est restée..." ${canRate ? "" : "disabled"}>${escapeHtml(inLibrary?.last_note || "")}</textarea>
        <button id="save-note-btn" class="btn btn--ghost" ${canRate ? "" : "disabled"}>Enregistrer</button>
      </div>` : "";

    // Une navigation plus récente a eu lieu pendant ces appels TMDB : on
    // n'écrase pas un rendu plus à jour avec ce résultat devenu obsolète.
    if (gen !== App._renderGen) return;

    view.innerHTML = `
      <div class="show-detail" style="--backdrop:url('${TMDB.backdropUrl(data.backdrop_path)}')">
        <div class="show-detail-overlay">
          <img class="show-detail-poster" src="${TMDB.posterUrl(data.poster_path)}" alt="" />
          <div class="show-detail-info">
            <h1>${escapeHtml(title)}</h1>
            ${type === "movie" && data.tagline ? `<p class="show-detail-tagline">${escapeHtml(data.tagline)}</p>` : ""}
            <p class="show-detail-meta">${genreNames.join(" · ")}${type === "movie" && formatRuntime(data.runtime) ? ` · ${formatRuntime(data.runtime)}` : ""}</p>
            ${type === "movie" && data.release_date ? `<p class="show-detail-release">Sorti le ${formatDate(data.release_date)}</p>` : ""}
            ${data.vote_average > 0 ? `<p class="tmdb-rating"><i data-lucide="star"></i> ${data.vote_average.toFixed(1)}/10 sur TMDB · ${data.vote_count.toLocaleString("fr-FR")} votes</p>` : ""}
            ${
              type === "tv"
                ? `<p class="show-detail-status"><span class="status-badge">${TV_STATUS_LABELS[data.status] || data.status}</span>${data.next_episode_to_air ? ` · Prochain épisode le ${formatDate(data.next_episode_to_air.air_date)}` : ""}</p>`
                : ""
            }
            <div class="overview-wrapper">
             <p class="show-detail-overview">${escapeHtml(data.overview || "Pas de synopsis disponible.")}</p>
              <button class="overview-toggle" hidden>Afficher plus</button>
             </div>
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
       ${type === "tv" ? `<div id="seasons-container"></div>` : ""}${ratingHTML}${noteHTML}${type === "tv" ? seriesNotesHTML(id) : ""}${friendsActivityHTML(friendsActivity)}${watchProvidersHTML(watchProviders)}${castHTML}${similarStripHTML(recommendations, type)}
      </div>
    `;
if (typeof lucide !== "undefined") lucide.createIcons();

    qs(".similar-scroll")?.addEventListener("click", (e) => {
      const card = e.target.closest(".poster-card");
      if (card) location.hash = `#/show/${card.dataset.type}-${card.dataset.id}`;
    });

    const overview = qs(".show-detail-overview");
    const overviewWrapper = qs(".overview-wrapper");
    const overviewToggle = qs(".overview-toggle");

    if (overview && overviewWrapper && overviewToggle) {
      requestAnimationFrame(() => {
        if (overview.scrollHeight > overview.clientHeight) {
          overviewWrapper.classList.add("is-truncated");
          overviewToggle.hidden = false;
        }
      });

      overviewToggle.addEventListener("click", () => {
        const expanded = overview.classList.toggle("expanded");

        overviewWrapper.classList.toggle("is-truncated", !expanded);
        overviewToggle.textContent = expanded ? "Réduire" : "Afficher plus";
      });
    }

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

    if (type === "movie") {
      const logMovieEntry = async (rewatch) => {
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
            rewatch,
            note: null,
            genres: genreIds,
            runtime_minutes: data.runtime || null,
            air_date: data.release_date || null,
          });
          toast(rewatch ? "Nouveau visionnage ajouté 🎟️" : "Marqué comme vu 🎟️", "success");
          await App.refresh();
        } catch (err) {
          toast(err.message, "error");
        }
      };

      qs("#quick-log-btn")?.addEventListener("click", () => logMovieEntry(false));
      qs("#movie-rewatch-btn")?.addEventListener("click", () => logMovieEntry(true));
      qs("#movie-undo-btn")?.addEventListener("click", () => undoLastMovieWatch({ tmdb_id: Number(id) }));
    }

if (canRate) {
      const widget = qs("#rating-widget");
      const starEls = qsa(".rating-star", widget);
      const applyPreview = (value) =>
        starEls.forEach((s) => {
          const filled = Number(s.dataset.value) <= value;
          s.classList.toggle("rating-star--filled", filled);
          s.textContent = filled ? "★" : "☆";
        });
      starEls.forEach((btn) => {
        const value = Number(btn.dataset.value);
        btn.addEventListener("mouseenter", () => applyPreview(value));
        btn.addEventListener("click", async () => {
          try {
            await DB.setWorkRating(App.session.user.id, Number(id), type, value * 2);
            toast("Note enregistrée 🎟️", "success");
            await App.refresh();
          } catch (err) {
            toast(err.message, "error");
          }
        });
      });
      widget.addEventListener("mouseleave", () => applyPreview(userRating));
    }

    if (type === "movie" && canRate) {
      qs("#save-note-btn")?.addEventListener("click", async () => {
        try {
          await DB.setWorkNote(App.session.user.id, Number(id), type, qs("#work-note").value.trim() || null);
          toast("Commentaire enregistré 🎟️", "success");
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
    if (gen !== App._renderGen) return;
    view.innerHTML = emptyState("Erreur de chargement — vérifie ta clé TMDB.");
  }
}

// ---------- PROFIL PUBLIC (autre utilisateur) ----------
async function renderUserProfile(userId, gen) {
  const view = qs("#view");
  view.innerHTML = `<p class="loading">Chargement…</p>`;
  try {
    const profile = await DB.getProfileById(userId);
    if (gen !== App._renderGen) return;

    if (!profile) {
      view.innerHTML = emptyState("Ce profil n'existe pas ou n'est pas accessible.");
      return;
    }

    const myFollow = App.following.find((f) => f.followed_id === userId);
    const followStatus = myFollow?.status || null;
    const canViewContent =
      profile.visibility === "public" || (profile.visibility === "followers" && followStatus === "accepted");

    let library = [];
    let diary = [];
    if (canViewContent) {
      [library, diary] = await Promise.all([DB.getLibrary(userId), DB.getDiary(userId)]);
    }
    if (gen !== App._renderGen) return;

    view.innerHTML = otherUserProfileTemplate(profile, library, diary, followStatus, canViewContent);
    bindOtherUserProfileEvents(userId);
    if (typeof lucide !== "undefined") lucide.createIcons();
  } catch (err) {
    if (gen !== App._renderGen) return;
    view.innerHTML = emptyState("Erreur lors du chargement du profil.");
  }
}

function otherProfileHeaderHTML(profile, followStatus) {
  const username = profile.username || "Utilisateur";
  const bannerUrl = profile.banner_path ? TMDB.backdropUrl(profile.banner_path, "w1280") : null;
  const avatarUrl = profile.avatar_url || (profile.avatar_path ? TMDB.posterUrl(profile.avatar_path, "w185") : null);
  const bannerStyle = bannerUrl ? `background-image: url('${bannerUrl}');` : "";

  const followActionHTML =
    followStatus === "accepted"
      ? `<button class="btn btn--ghost profile-banner-follow-btn other-profile-unfollow-btn">Se désabonner</button>`
      : followStatus === "pending"
      ? `<button class="btn btn--ghost profile-banner-follow-btn" disabled>Demande envoyée</button>`
      : `<button class="btn btn--accent profile-banner-follow-btn other-profile-follow-btn">Suivre</button>`;

  return `
    <div class="profile-header">
      <div class="profile-banner-wrap">
        <div class="profile-banner" style="${bannerStyle}"></div>
        ${followActionHTML}
      </div>
      <div class="profile-identity">
        <div class="profile-avatar-wrap">
          <div class="profile-avatar" style="${avatarUrl ? `background-image:url('${avatarUrl}')` : ""}">
            ${avatarUrl ? "" : `<span class="profile-avatar-fallback">${escapeHtml(username[0]?.toUpperCase() || "?")}</span>`}
          </div>
        </div>
        <span class="profile-username profile-username--readonly">${escapeHtml(username)}</span>
      </div>
    </div>`;
}

function otherUserProfileTemplate(profile, library, diary, followStatus, canViewContent) {
  if (!canViewContent) {
    const reason =
      profile.visibility === "private"
        ? "Ce profil est privé."
        : "Ce profil n'est visible que par ses abonnés. Envoie une demande pour voir ses stats et sa bibliothèque.";
    return `
      ${otherProfileHeaderHTML(profile, followStatus)}
      <div class="stats-view"><p class="empty-state">${reason}</p></div>
    `;
  }

  const s = Stats.compute(diary, library, App.genreMaps);
  const recent = library
    .filter((l) => l.status === "completed")
    .sort((a, b) => (b.last_watched_date || "").localeCompare(a.last_watched_date || ""))
    .slice(0, 20);

  return `
    ${otherProfileHeaderHTML(profile, followStatus)}
    <div class="stats-view">
      <section class="stats-section-intro">
        <h2>Stats</h2>
        <div class="stats-cards">
          <div class="stat-card"><span class="stat-num">${s.episodesCount}</span><span class="stat-label">Épisodes</span></div>
          <div class="stat-card"><span class="stat-num">${s.moviesCount}</span><span class="stat-label">Films</span></div>
          <div class="stat-card"><span class="stat-num">${formatWatchDuration(s.totalTvMinutes)}</span><span class="stat-label">passés devant des séries</span></div>
          <div class="stat-card"><span class="stat-num">${formatWatchDuration(s.totalMovieMinutes)}</span><span class="stat-label">passés devant des films</span></div>
          <div class="stat-card"><span class="stat-num">${s.avgRating ? s.avgRating.toFixed(1) : "—"}</span><span class="stat-label">Note moyenne</span></div>
          <div class="stat-card"><span class="stat-num">${s.showsCompleted}</span><span class="stat-label">Séries terminées</span></div>
        </div>
      </section>

      <section class="stats-section">
        <h2>Derniers visionnages</h2>
        ${recent.length ? `<div class="ticket-list">${recent.map(otherUserTicketCard).join("")}</div>` : emptyState("Rien à afficher pour l'instant.")}
      </section>
    </div>
  `;
}

// Comme journalTicketCard, mais sans les actions réservées au
// propriétaire (suppression, partage) — juste cliquable vers la fiche.
function otherUserTicketCard(item) {
  const sub =
    item.media_type === "tv"
      ? `Série · ${item.total_episodes || item.watched_episodes} épisode${(item.total_episodes || item.watched_episodes) > 1 ? "s" : ""}`
      : "Film";
  const rewatchCount = item.media_type === "movie" ? item.watch_count : 0;
  const ticketId = `${item.media_type}-${item.tmdb_id}`;

  return `
    <div class="ticket" data-type="${item.media_type}" data-tmdb-id="${item.tmdb_id}">
      <div class="ticket-poster">
        <img src="${TMDB.posterUrl(item.poster_path, "w185")}" alt="" loading="lazy" />
      </div>
      <div class="ticket-perforation"></div>
      <div class="ticket-body">
        <div class="ticket-row">
          <span class="ticket-title">${escapeHtml(item.title)}</span>
          <span class="ticket-sub">${sub}</span>
        </div>
        <div class="ticket-row ticket-row--meta">
          <span class="ticket-date">${formatDate(item.last_watched_date)}</span>
          ${rewatchCount > 1 ? `<span class="ticket-tag">×${rewatchCount}</span>` : ""}
        </div>
        ${item.avg_rating != null ? `<div class="ticket-stars">${stars(item.avg_rating)}</div>` : ""}
        ${item.last_note ? `<p class="ticket-note">${escapeHtml(item.last_note)}</p>` : ""}
        <div class="ticket-barcode">${barcodeSVG(ticketId + item.last_watched_date)}</div>
      </div>
    </div>
  `;
}

function bindOtherUserProfileEvents(userId) {
  const view_el = qs("#view");
  view_el.dataset.otherProfileUserId = userId;
  if (view_el.dataset.otherProfileEventsBound) return;
  view_el.dataset.otherProfileEventsBound = "1";
  view_el.addEventListener("click", async (e) => {
    const currentUserId = view_el.dataset.otherProfileUserId;
    const followBtn = e.target.closest(".other-profile-follow-btn");
    if (followBtn && !followBtn.disabled) {
      followBtn.disabled = true;
      try {
        await DB.sendFollowRequest(App.session.user.id, currentUserId);
        toast("Demande envoyée.", "success");
        App.following = await DB.getMyFollowingList(App.session.user.id);
        App.route();
      } catch (err) {
        followBtn.disabled = false;
        toast(err.message, "error");
      }
      return;
    }

    const unfollowBtn = e.target.closest(".other-profile-unfollow-btn");
    if (unfollowBtn) {
      unfollowBtn.disabled = true;
      const myFollow = App.following.find((f) => f.followed_id === currentUserId);
      if (!myFollow) return;
      try {
        await DB.unfollow(myFollow.id);
        toast("Désabonnement effectué.", "success");
        App.following = await DB.getMyFollowingList(App.session.user.id);
        App.route();
      } catch (err) {
        unfollowBtn.disabled = false;
        toast(err.message, "error");
      }
      return;
    }

    const ticket = e.target.closest(".ticket[data-tmdb-id]");
    if (ticket) location.hash = `#/show/${ticket.dataset.type}-${ticket.dataset.tmdbId}`;
  });
}

// ---------- PERSON DETAIL ----------
// Genres TMDB à traiter comme du "guest" plutôt qu'un vrai rôle : talk-show,
// actualités, télé-réalité. Combiné à un test sur le nom du personnage
// ("Self", "Lui-même"...), ça filtre la plupart des passages plateau tout
// en gardant les vraies apparitions dans des fictions.
const GUEST_TV_GENRE_IDS = [10767, 10763, 10764];
function isGuestAppearance(w) {
  if (w.media_type !== "tv") return false;
  if ((w.genre_ids || []).some((g) => GUEST_TV_GENRE_IDS.includes(g))) return true;
  const character = (w.character || "").trim().toLowerCase();
  return /^(self|lui-m[eê]me|elle-m[eê]me|narrator|narrateur)\b/.test(character);
}

// Fiche comédien : filmographie complète (films + séries), ouverte au
// clic sur un cast-card depuis une fiche film/série/épisode. Reprend la
// mise en page de show-detail (backdrop, fondu du synopsis) pour rester
// cohérent visuellement avec les fiches film/série.
async function renderPersonDetail(id, gen) {
  const view = qs("#view");
  view.innerHTML = `<p class="loading">Chargement…</p>`;
  try {
    const person = await TMDB.getPerson(id);
    const credits = person.combined_credits?.cast || [];

    // Une même œuvre peut apparaître plusieurs fois dans combined_credits
    // (plusieurs rôles) : on ne garde qu'une entrée par œuvre. On écarte
    // aussi les apparitions "guest" (talk-shows, plateaux...).
    const byWork = new Map();
    credits.forEach((c) => {
      if (!c.title && !c.name) return;
      if (isGuestAppearance(c)) return;
      const key = `${c.media_type}_${c.id}`;
      if (!byWork.has(key)) byWork.set(key, c);
    });
    const works = [...byWork.values()].sort((a, b) => {
      const dateA = a.release_date || a.first_air_date || "";
      const dateB = b.release_date || b.first_air_date || "";
      return dateB.localeCompare(dateA);
    });

    // Backdrop : celui de l'œuvre la plus populaire de la filmo, à
    // défaut de photo de plateau propre au comédien côté TMDB.
    const backdropSource = [...works]
      .filter((w) => w.backdrop_path)
      .sort((a, b) => (b.popularity || 0) - (a.popularity || 0))[0];

    // Une navigation plus récente a eu lieu pendant l'appel TMDB.
    if (gen !== App._renderGen) return;

    const rowsData = works.map((w) => {
      const type = w.media_type === "movie" ? "movie" : "tv";
      const title = w.title || w.name || "Sans titre";
      const date = w.release_date || w.first_air_date || "";
      const inLibrary = App.library.find(
        (l) => String(l.tmdb_id) === String(w.id) && l.media_type === type
      );
      const seen =
        type === "movie"
          ? App.diary.some((e) => String(e.tmdb_id) === String(w.id) && e.media_type === "movie")
          : inLibrary?.status === "completed";
      return { w, type, title, date, seen };
    });

    const seenCount = rowsData.filter((r) => r.seen).length;
    const totalWorks = rowsData.length;
    const progressPct = totalWorks ? Math.round((seenCount / totalWorks) * 100) : 0;

    const rows = rowsData
      .map(({ w, type, title, date, seen }) => {
        const genreIds = (w.genre_ids || []).join(",");
        return `
        <div class="filmography-item ${seen ? "filmography-item--watched" : ""}" data-id="${w.id}" data-type="${type}">
          <img class="filmography-poster" src="${TMDB.posterUrl(w.poster_path)}" alt="${escapeHtml(title)}" loading="lazy" />
          <div class="filmography-info">
            <span class="filmography-title">${escapeHtml(title)}</span>
            <span class="filmography-meta">${date ? date.slice(0, 4) : ""}${w.character ? " · " + escapeHtml(w.character) : ""}</span>
          </div>
          <button class="episode-check-toggle ${seen ? "is-watched" : ""}" title="${seen ? "Marquer comme non vu" : "Marquer comme vu"}" data-id="${w.id}" data-type="${type}" data-title="${escapeHtml(title)}" data-poster="${w.poster_path || ""}" data-genres="${genreIds}" data-air-date="${date}">${seen ? '<i data-lucide="circle-check-big"></i>' : ""}</button>
        </div>`;
      })
      .join("");

    const metaParts = [];
    if (person.known_for_department) metaParts.push(escapeHtml(person.known_for_department));
    if (person.deathday) metaParts.push(`Décédé(e) le ${formatDate(person.deathday)}`);
    else if (person.birthday) metaParts.push(`Né(e) le ${formatDate(person.birthday)}`);

    view.innerHTML = `
      <div class="show-detail" style="--backdrop:url('${backdropSource ? TMDB.backdropUrl(backdropSource.backdrop_path) : ""}')">
        <div class="show-detail-overlay">
          <img class="show-detail-poster" src="${TMDB.posterUrl(person.profile_path)}" alt="${escapeHtml(person.name)}" />
          <div class="show-detail-info">
            <h1>${escapeHtml(person.name)}</h1>
            ${metaParts.length ? `<p class="show-detail-meta">${metaParts.join(" · ")}</p>` : ""}
            <div class="overview-wrapper">
              <p class="show-detail-overview">${escapeHtml(person.biography || "Pas de biographie disponible.")}</p>
              <button class="overview-toggle" hidden>Afficher plus</button>
            </div>
            ${
              totalWorks > 0
                ? `<div class="show-progress">
                     <div class="progress-bar"><div class="progress-bar-fill" style="width:${progressPct}%"></div></div>
                     <span class="progress-label">${seenCount}/${totalWorks} œuvres vues — ${progressPct}%</span>
                   </div>`
                : ""
            }
          </div>
        </div>
        <h2 class="cast-title">Filmographie</h2>
        <div class="filmography-grid">${rows || emptyState("Aucune filmographie disponible.")}</div>
      </div>
    `;

    if (typeof lucide !== "undefined") lucide.createIcons();

    // Fondu + "Afficher plus" sur la biographie, identique à show-detail.
    const overview = qs(".show-detail-overview");
    const overviewWrapper = qs(".overview-wrapper");
    const overviewToggle = qs(".overview-toggle");

    if (overview && overviewWrapper && overviewToggle) {
      requestAnimationFrame(() => {
        if (overview.scrollHeight > overview.clientHeight) {
          overviewWrapper.classList.add("is-truncated");
          overviewToggle.hidden = false;
        }
      });

      overviewToggle.addEventListener("click", () => {
        const expanded = overview.classList.toggle("expanded");
        overviewWrapper.classList.toggle("is-truncated", !expanded);
        overviewToggle.textContent = expanded ? "Réduire" : "Afficher plus";
      });
    }

    qsa(".filmography-item", view).forEach((item) =>
      item.addEventListener("click", (e) => {
        if (e.target.closest("button")) return;
        location.hash = `#/show/${item.dataset.type}-${item.dataset.id}`;
      })
    );

    qsa(".filmography-item .episode-check-toggle", view).forEach((btn) =>
      btn.addEventListener("click", async (e) => {
        e.stopPropagation();
        await toggleWorkWatched({
          tmdbId: btn.dataset.id,
          type: btn.dataset.type,
          title: btn.dataset.title,
          posterPath: btn.dataset.poster,
          genreIds: btn.dataset.genres ? btn.dataset.genres.split(",") : [],
          airDate: btn.dataset.airDate || null,
        });
      })
    );
  } catch (err) {
    console.error(err);
    if (gen !== App._renderGen) return;
    view.innerHTML = emptyState("Impossible de charger cette fiche comédien.");
  }
}

// Coche rapide sur la filmographie d'un comédien : marque un film comme vu
// (ajoute une entrée journal, comme le bouton "Marquer comme vu" de sa
// fiche) ou décoche (retire tout l'historique de ce film). Pour une
// série, la coche/décoche marque ou retire tous les épisodes — une
// confirmation est demandée dans les deux sens vu l'ampleur de l'action.
async function toggleWorkWatched({ tmdbId, type, title, posterPath, genreIds, airDate }) {
  try {
    if (type === "movie") {
      const alreadySeen = App.diary.some(
        (e) => String(e.tmdb_id) === String(tmdbId) && e.media_type === "movie"
      );
      if (alreadySeen) {
        await DB.deleteAllEntriesForWork(App.session.user.id, Number(tmdbId), "movie");
        toast("Marqué comme non vu.", "success");
      } else {
        await DB.addDiaryEntry({
          user_id: App.session.user.id,
          tmdb_id: Number(tmdbId),
          media_type: "movie",
          title,
          poster_path: posterPath || null,
          season: null,
          episode: null,
          watched_date: new Date().toISOString().slice(0, 10),
          rating: null,
          rewatch: false,
          note: null,
          genres: genreIds,
          runtime_minutes: null,
          air_date: airDate || null,
        });
        toast("Marqué comme vu 🎟️", "success");
      }
    } else {
      const inLibrary = App.library.find(
        (l) => String(l.tmdb_id) === String(tmdbId) && l.media_type === "tv"
      );
      const alreadyCompleted = inLibrary?.status === "completed";

      if (alreadyCompleted) {
        const confirmUndo = await showConfirm(
          "Retirer tout l'historique de visionnage de cette série ?",
          { confirmLabel: "Oui, tout retirer", cancelLabel: "Annuler" }
        );
        if (!confirmUndo) return;
        await DB.deleteAllEntriesForWork(App.session.user.id, Number(tmdbId), "tv");
        await DB.upsertLibraryItem({
          user_id: App.session.user.id,
          tmdb_id: Number(tmdbId),
          media_type: "tv",
          title,
          poster_path: posterPath || null,
          status: "watchlist",
          updated_at: new Date().toISOString(),
        });
        toast("Historique retiré.", "success");
      } else {
        const markAll = await showConfirm(
          "Marquer tous les épisodes de cette série comme vus ?",
          { confirmLabel: "Oui, tout marquer", cancelLabel: "Annuler" }
        );
        if (!markAll) return;
        const show = await TMDB.getTv(tmdbId);
        toast("Marquage de tous les épisodes en cours…");
        await markAllEpisodesWatched(tmdbId, show.number_of_seasons, title, posterPath, genreIds);
      }
    }
    await App.refresh();
  } catch (err) {
    toast(err.message, "error");
  }
}

// Retire uniquement le DERNIER visionnage d'un film (le plus récent).
async function undoLastMovieWatch(ctx) {
  const existing = App.diary
    .filter((e) => String(e.tmdb_id) === String(ctx.tmdb_id) && e.media_type === "movie")
    .sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));

  if (existing.length === 0) return;

  try {
    await DB.deleteDiaryEntries([existing[0].id]);
    toast(existing.length > 1 ? "Dernier visionnage annulé." : "Marqué comme non vu.", "success");
    await App.refresh();
  } catch (err) {
    toast(err.message, "error");
  }
}

async function renderEpisodeDetail(param, gen) {
  const [tvId, seasonNumber, episodeNumber] = param.split("-");

  const view = qs("#view");
  view.innerHTML = `<p class="loading">Chargement…</p>`;

  try {
    const show = await TMDB.getTv(tvId);
    const season = await TMDB.getSeason(tvId, Number(seasonNumber));
    const aggregateCredits = await TMDB.getAggregateCredits(tvId).catch(() => null);

    const episode = season.episodes.find(
      (ep) => ep.episode_number === Number(episodeNumber)
    );

    if (!episode) {
      throw new Error("Episode introuvable");
    }

    const entries = App.diary.filter(
      (e) =>
        String(e.tmdb_id) === String(tvId) &&
        e.media_type === "tv" &&
        e.season === Number(seasonNumber) &&
        e.episode === Number(episodeNumber)
    );

    const watched = entries.length > 0;
    const watchCount = entries.length;

    // Cast : le casting principal de la série (agrégé sur toute la
    // série) + les invités propres à cet épisode, sans doublons.
    const mainCast = aggregateCredits?.cast || show.credits?.cast || [];
    const guestStars = episode.guest_stars || [];
    const seenIds = new Set();
    const tmdbFallbackCast = [...mainCast, ...guestStars].filter((actor) => {
      if (!actor.profile_path || seenIds.has(actor.id)) return false;
      seenIds.add(actor.id);
      return true;
    });
    const episodeCast = (await getCastForDisplay("series", tvId, show.name, tmdbFallbackCast)).slice(0, 12);
    const castHTML = episodeCast.length
      ? `
      <div class="cast-strip">
        <h2 class="cast-title">Casting</h2>
        <div class="cast-scroll">
          ${episodeCast
            .map(
              (actor) => `
            <div class="cast-card${actor.tmdbPersonId ? " cast-card--linked" : ""}"${actor.tmdbPersonId ? ` data-person-id="${actor.tmdbPersonId}"` : ""}>
              <img src="${actor.image}" alt="${escapeHtml(actor.name)}" loading="lazy" />
              <span class="cast-name">${escapeHtml(actor.role)}</span>
              <span class="cast-character">${escapeHtml(actor.name)}</span>
            </div>`
            )
            .join("")}
        </div>
      </div>`
      : "";

    // Note de l'épisode (5 étoiles, activée une fois l'épisode vu)
    const epRatingRaw = entries.find((e) => e.rating != null)?.rating;
    const userEpRating = epRatingRaw != null ? Math.round(epRatingRaw / 2) : 0;
    const ratingHTML = `
      <div class="rating-widget-block">
        <h2 class="rating-title">Ta note</h2>
        <div class="rating-widget ${watched ? "" : "rating-widget--disabled"}" id="episode-rating-widget">
          ${[1, 2, 3, 4, 5]
            .map(
              (n) =>
                `<button class="rating-star ${n <= userEpRating ? "rating-star--filled" : ""}" data-value="${n}" ${watched ? "" : "disabled"} title="${n} étoile${n > 1 ? "s" : ""}">${n <= userEpRating ? "★" : "☆"}</button>`
            )
            .join("")}
        </div>
        ${!watched ? `<p class="rating-hint">Marque l'épisode comme vu pour pouvoir le noter.</p>` : ""}
      </div>`;
      const epNote = entries.find((e) => e.note)?.note || "";
    const noteHTML = `
      <div class="note-widget-block">
        <h2 class="rating-title">Ton commentaire</h2>
        <textarea id="episode-note" class="note-textarea" placeholder="Ce que tu en as pensé..." ${watched ? "" : "disabled"}>${escapeHtml(epNote)}</textarea>
        <button id="save-episode-note-btn" class="btn btn--ghost" ${watched ? "" : "disabled"}>Enregistrer</button>
      </div>`;

    // Une navigation plus récente a eu lieu pendant ces appels TMDB : on
    // n'écrase pas un rendu plus à jour avec ce résultat devenu obsolète.
    if (gen !== App._renderGen) return;

    view.innerHTML = `
      <div class="show-detail"
           style="--backdrop:url('${TMDB.backdropUrl(show.backdrop_path)}')">

        <div class="show-detail-overlay">

          <img
            class="show-detail-poster"
            src="${TMDB.posterUrl(episode.still_path || show.poster_path, "w500")}"
            alt=""
          />

          <div class="show-detail-info">

            <h1>${escapeHtml(episode.name)}</h1>

            <p class="show-detail-meta">
              <a href="#/show/tv-${tvId}" class="episode-show-link">${escapeHtml(show.name)}</a> • S${seasonNumber}E${episodeNumber}
            </p>

            <div class="overview-wrapper">
              <p class="show-detail-overview">
                ${escapeHtml(episode.overview || "Pas de synopsis disponible.")}
              </p>
            </div>

            <p class="episode-airdate">
              Diffusé le ${episode.air_date ? formatDate(episode.air_date) : "Date inconnue"}
            </p>
            ${episode.vote_average > 0 ? `<p class="tmdb-rating"><i data-lucide="star"></i> ${episode.vote_average.toFixed(1)}/10 sur TMDB · ${episode.vote_count.toLocaleString("fr-FR")} votes</p>` : ""}
            ${formatRuntime(episode.runtime) ? `<p class="show-detail-meta">${formatRuntime(episode.runtime)}</p>` : ""}

            <div class="show-detail-actions">
              ${
                watched
                  ? `
                  <span class="episode-watch-info"><i data-lucide="circle-check-big"></i> vu${watchCount > 1 ? ` • ${watchCount} visionnages` : ""}</span>
                  <button id="episode-rewatch-btn" class="btn btn--accent">
                    Rewatch <i data-lucide="rotate-ccw"></i>
                  </button>
                  <button id="episode-undo-btn" class="btn btn--ghost">Annuler le dernier visionnage</button>
                  `
                  : `
                  <button id="episode-toggle-btn" class="btn btn--accent">Marquer comme vu</button>
                  `
              }
            </div>
            </div>
            </div>

            ${ratingHTML}
            ${noteHTML}
            ${castHTML}

          </div>

        </div>

      </div>
    `;

    if (typeof lucide !== "undefined") {
      lucide.createIcons();
    }

    const episodeCtx = {
      tmdb_id: Number(tvId),
      title: show.name,
      poster_path: show.poster_path,
      genres: (show.genres || []).map((g) => String(g.id)),
      season: Number(seasonNumber),
      episode: Number(episodeNumber),
      runtime_minutes: episode.runtime || null,
      air_date: episode.air_date || null,
    };

    qs("#episode-toggle-btn")?.addEventListener("click", async () => {
      await toggleEpisodeWatched(episodeCtx);
    });

    qs("#episode-undo-btn")?.addEventListener("click", async () => {
      await undoLastEpisodeWatch(episodeCtx);
    });

    qs("#episode-rewatch-btn")?.addEventListener("click", async () => {
      await addEpisodeRewatch(episodeCtx);
    });

    if (watched) {
      const widget = qs("#episode-rating-widget");
      const starEls = qsa(".rating-star", widget);
      const applyPreview = (value) =>
        starEls.forEach((s) => {
          const filled = Number(s.dataset.value) <= value;
          s.classList.toggle("rating-star--filled", filled);
          s.textContent = filled ? "★" : "☆";
        });
      starEls.forEach((btn) => {
        const value = Number(btn.dataset.value);
        btn.addEventListener("mouseenter", () => applyPreview(value));
        btn.addEventListener("click", async () => {
          try {
            await DB.setEpisodeRating(
              App.session.user.id,
              Number(tvId),
              Number(seasonNumber),
              Number(episodeNumber),
              value * 2
            );
            toast("Note enregistrée 🎟️", "success");
            await App.refresh();
          } catch (err) {
            toast(err.message, "error");
          }
        });
      });
      if (watched) {
      qs("#save-episode-note-btn")?.addEventListener("click", async () => {
        try {
          await DB.setEpisodeNote(
            App.session.user.id,
            Number(tvId),
            Number(seasonNumber),
            Number(episodeNumber),
            qs("#episode-note").value.trim() || null
          );
          toast("Commentaire enregistré 🎟️", "success");
          await App.refresh();
        } catch (err) {
          toast(err.message, "error");
        }
      });
    }
      widget.addEventListener("mouseleave", () => applyPreview(userEpRating));
    }
  } catch (err) {
    console.error(err);
    if (gen !== App._renderGen) return;
    view.innerHTML = emptyState("Impossible de charger cet épisode.");
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
            air_date: ep.air_date || null,
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
        <div class="episode-row ${watched ? "episode-row--watched" : ""}" data-season="${selectedSeason}" data-episode="${ep.episode_number}" data-runtime="${ep.runtime || ""}" data-air-date="${ep.air_date || ""}">
          <img class="episode-thumb" src="${TMDB.posterUrl(ep.still_path, "w300")}" alt="" loading="lazy" />
          <div class="episode-info">
            <span class="episode-title-row">
              <span class="episode-num">S${selectedSeason}E${ep.episode_number}</span>
              <span class="episode-title">${escapeHtml(ep.name)}</span>
            </span>
            <span class="episode-date">${ep.air_date ? formatDate(ep.air_date) : ""}</span>
          </div>
          <div class="episode-row-actions">
            ${count > 1 ? `<span class="episode-rewatch-badge">×${count}</span>` : ""}
            ${watched ? `<button class="episode-rewatch-btn" title="Ajouter un revisionnage" data-season="${selectedSeason}" data-episode="${ep.episode_number}" data-runtime="${ep.runtime || ""}" data-air-date="${ep.air_date || ""}"><i data-lucide="rotate-ccw"></i></button>` : ""}
            <button class="episode-check-toggle ${watched ? "is-watched" : ""}" title="${watched ? "Marquer comme non vu" : "Marquer comme vu"}" data-season="${selectedSeason}" data-episode="${ep.episode_number}" data-runtime="${ep.runtime || ""}" data-air-date="${ep.air_date || ""}">${watched ? '<i data-lucide="circle-check-big"></i>' : ""}</button>
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

if (typeof lucide !== "undefined") lucide.createIcons();

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
  seasonEpisodes: season.episodes || [],
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
          air_date: btn.dataset.airDate || null,
        });
      })
    );

    qsa(".episode-row", container).forEach((row) =>
  row.addEventListener("click", (e) => {
    if (e.target.closest("button")) return;

    location.hash = `#/episode/${tvId}-${row.dataset.season}-${row.dataset.episode}`;
  })
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
      const watchedEpisodes = new Set(
        App.diary
          .filter(
            (e) =>
              String(e.tmdb_id) === String(ctx.tmdb_id) &&
              e.media_type === "tv" &&
              e.season === ctx.season
          )
          .map((e) => e.episode)
      );

      const missingEpisodes = (ctx.seasonEpisodes || []).filter(
        (ep) =>
          ep.episode_number < ctx.episode &&
          !watchedEpisodes.has(ep.episode_number)
      );

      let markPrevious = false;

      if (missingEpisodes.length > 0) {
        markPrevious = await showConfirm(
          `Marquer également les ${missingEpisodes.length} épisode${missingEpisodes.length > 1 ? "s" : ""} précédent${missingEpisodes.length > 1 ? "s" : ""} comme vus ?`,
          {
            confirmLabel: "Oui",
            cancelLabel: "Non",
          }
        );
      }

      const today = new Date().toISOString().slice(0, 10);

      if (markPrevious) {
        await DB.bulkInsertDiary([
          ...missingEpisodes.map((ep) => ({
            user_id: App.session.user.id,
            tmdb_id: ctx.tmdb_id,
            media_type: "tv",
            title: ctx.title,
            poster_path: ctx.poster_path,
            season: ctx.season,
            episode: ep.episode_number,
            watched_date: today,
            rating: null,
            rewatch: false,
            note: null,
            genres: ctx.genres || [],
            runtime_minutes: ep.runtime || null,
            air_date: ep.air_date || null,
          })),
          {
            user_id: App.session.user.id,
            tmdb_id: ctx.tmdb_id,
            media_type: "tv",
            title: ctx.title,
            poster_path: ctx.poster_path,
            season: ctx.season,
            episode: ctx.episode,
            watched_date: today,
            rating: null,
            rewatch: false,
            note: null,
            genres: ctx.genres || [],
            runtime_minutes: ctx.runtime_minutes,
            air_date: ctx.air_date || null,
          },
        ]);

        toast(`${missingEpisodes.length + 1} épisodes marqués comme vus 🎟️`, "success");
      } else {
        await DB.addDiaryEntry({
          user_id: App.session.user.id,
          tmdb_id: ctx.tmdb_id,
          media_type: "tv",
          title: ctx.title,
          poster_path: ctx.poster_path,
          season: ctx.season,
          episode: ctx.episode,
          watched_date: today,
          rating: null,
          rewatch: false,
          note: null,
          genres: ctx.genres || [],
          runtime_minutes: ctx.runtime_minutes,
          air_date: ctx.air_date || null,
        });

        toast("Épisode marqué comme vu 🎟️", "success");
      }
    } else {
      await DB.deleteDiaryEntries(existing.map((e) => e.id));
      toast("Épisode marqué comme non vu.", "success");
    }
    await App.refresh();
  } catch (err) {
    toast(err.message, "error");
  }
}

// Retire uniquement le DERNIER visionnage d'un épisode (contrairement à
// toggleEpisodeWatched, utilisé par la coche rapide, qui efface tout).
async function undoLastEpisodeWatch(ctx) {
  const existing = App.diary
    .filter(
      (e) =>
        String(e.tmdb_id) === String(ctx.tmdb_id) &&
        e.media_type === "tv" &&
        e.season === ctx.season &&
        e.episode === ctx.episode
    )
    .sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));

  if (existing.length === 0) return;

  try {
    await DB.deleteDiaryEntries([existing[0].id]);
    toast(
      existing.length > 1 ? "Dernier visionnage annulé." : "Épisode marqué comme non vu.",
      "success"
    );
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
      air_date: ctx.air_date || null,
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

// ---------- LIBRARY ----------
let libraryFilter = "all"; // "all" | "movie" | "tv"

function libraryNavBar(active) {
  return `
    <div class="library-filters">
      <a href="#/library" class="filter-btn ${active === "all" ? "filter-btn--active" : ""}" data-filter="all">Tout</a>
      <a href="#/library" class="filter-btn ${active === "movie" ? "filter-btn--active" : ""}" data-filter="movie">Films</a>
      <a href="#/library" class="filter-btn ${active === "tv" ? "filter-btn--active" : ""}" data-filter="tv">Séries</a>
      <a href="#/upcoming" class="filter-btn ${active === "upcoming" ? "filter-btn--active" : ""}">À venir</a>
    </div>`;
}

function libraryTemplate(library) {
  const filterBar = libraryNavBar(libraryFilter);

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
  const view_el = qs("#view");
  if (view_el.dataset.libraryEventsBound) return;
  view_el.dataset.libraryEventsBound = "1";
  view_el.addEventListener("click", async (e) => {
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

// ---------- À VENIR (calendrier) ----------
async function renderUpcoming(gen) {
  const view = qs("#view");
  view.innerHTML = `${libraryNavBar("upcoming")}<p class="loading">Chargement du calendrier…</p>`;

  try {
    const today = new Date().toISOString().slice(0, 10);
    const watchlistMovies = App.library.filter((l) => l.media_type === "movie" && l.status === "watchlist");
    const watchingShows = App.library.filter((l) => l.media_type === "tv" && l.status === "watching");

    // ---- Films ----
    const movieDetails = await Promise.all(
      watchlistMovies.map(async (m) => {
        try {
          const data = await TMDB.getMovie(m.tmdb_id);
          return { ...m, release_date: data.release_date || null };
        } catch {
          return { ...m, release_date: null };
        }
      })
    );
    const moviesToWatch = movieDetails
      .filter((m) => m.release_date && m.release_date <= today)
      .sort((a, b) => b.release_date.localeCompare(a.release_date));
    const moviesUpcoming = movieDetails
      .filter((m) => m.release_date && m.release_date > today)
      .sort((a, b) => a.release_date.localeCompare(b.release_date));

    // ---- Séries ----
    const showResults = await Promise.all(
      watchingShows.map(async (show) => {
        try {
          const data = await TMDB.getTv(show.tmdb_id);
          const showEntries = App.diary.filter(
            (e) => String(e.tmdb_id) === String(show.tmdb_id) && e.media_type === "tv"
          );
          const watchedKeys = new Set(showEntries.map((e) => `${e.season}x${e.episode}`));
          const watchedSeasons = showEntries.map((e) => e.season || 1);
          const startSeason = watchedSeasons.length ? Math.max(...watchedSeasons) : 1;

          let nextEpisode = null;
          const lastSeasonToCheck = Math.min(startSeason + 1, data.number_of_seasons || startSeason);
          for (let s = startSeason; s <= lastSeasonToCheck; s++) {
            const season = await TMDB.getSeason(show.tmdb_id, s);
            const found = (season.episodes || []).find(
              (ep) => !watchedKeys.has(`${s}x${ep.episode_number}`) && ep.air_date && ep.air_date <= today
            );
            if (found) {
              nextEpisode = { ...found, season_number: s };
              break;
            }
          }

          return { show, toWatch: nextEpisode, upcoming: data.next_episode_to_air || null };
        } catch {
          return { show, toWatch: null, upcoming: null };
        }
      })
    );

    const showsToWatch = showResults
      .filter((r) => r.toWatch)
      .map((r) => ({ show: r.show, episode: r.toWatch, genres: r.genres }))
      .sort((a, b) => (a.episode.air_date || "").localeCompare(b.episode.air_date || ""));
    const showsUpcoming = showResults
      .filter((r) => r.upcoming)
      .map((r) => ({ show: r.show, episode: r.upcoming, genres: r.genres }))
      .sort((a, b) => (a.episode.air_date || "").localeCompare(b.episode.air_date || ""));

    // Une navigation ou un rafraîchissement plus récent a eu lieu pendant
    // ces appels TMDB (ex: double appel à route() au chargement) : on
    // n'écrase pas un rendu plus à jour avec ce résultat devenu obsolète.
    if (gen !== App._renderGen) return;

    view.innerHTML = `
      ${libraryNavBar("upcoming")}
      <div class="upcoming-view">
        <section class="upcoming-section">
          <h2>Films à voir</h2>
          ${
            moviesToWatch.length
              ? `<div class="upcoming-list">${moviesToWatch.map((m) => upcomingMovieCard(m, { showDate: false })).join("")}</div>`
              : emptyState("Rien de sorti à voir pour l'instant dans ta watchlist.")
          }
        </section>

        <section class="upcoming-section">
          <h2>Films à venir</h2>
          ${
            moviesUpcoming.length
              ? `<div class="upcoming-list">${moviesUpcoming.map(upcomingMovieCard).join("")}</div>`
              : emptyState("Aucun film pas encore sorti dans ta watchlist.")
          }
        </section>

        <section class="upcoming-section">
          <h2>Épisodes à voir</h2>
          ${
            showsToWatch.length
              ? `<div class="upcoming-list upcoming-list--episodes">${showsToWatch.map((item) => upcomingEpisodeCard(item, { showCheckbox: true, showDate: false })).join("")}</div>`
              : emptyState("Tu es à jour sur toutes tes séries en cours.")
          }
        </section>

        <section class="upcoming-section">
          <h2>Épisodes à venir</h2>
          ${
            showsUpcoming.length
              ? `<div class="upcoming-list upcoming-list--episodes">${showsUpcoming.map((item) => upcomingEpisodeCard(item)).join("")}</div>`
              : emptyState("Aucun épisode annoncé pour tes séries en cours.")
          }
        </section>
      </div>
    `;

    qsa(".upcoming-card", view).forEach((card) =>
      card.addEventListener("click", () => {
        location.hash = card.dataset.href;
      })
    );

    qsa(".upcoming-check-toggle", view).forEach((btn) =>
      btn.addEventListener("click", async (e) => {
        e.stopPropagation();
        await toggleEpisodeWatched({
          tmdb_id: Number(btn.dataset.tmdbId),
          title: btn.dataset.title,
          poster_path: btn.dataset.poster || null,
          genres: (btn.dataset.genres || "").split(",").filter(Boolean),
          season: Number(btn.dataset.season),
          episode: Number(btn.dataset.episode),
          runtime_minutes: Number(btn.dataset.runtime) || null,
          air_date: btn.dataset.airDate || null,
        });
      })
    );

    if (typeof lucide !== "undefined") lucide.createIcons();
  } catch (err) {
    console.error(err);
    if (gen !== App._renderGen) return;
    view.innerHTML = libraryNavBar("upcoming") + emptyState("Impossible de charger le calendrier.");
  }
}

function upcomingMovieCard(m, { showDate = true } = {}) {
  return `
    <div class="upcoming-card upcoming-card--movie" data-href="#/show/movie-${m.tmdb_id}">
      ${showDate ? `<span class="upcoming-date">${m.release_date ? formatDate(m.release_date) : "Date inconnue"}</span>` : ""}
      <div class="upcoming-card-media">
        <img src="${TMDB.posterUrl(m.poster_path)}" alt="${escapeHtml(m.title)}" loading="lazy" />
        <div class="upcoming-card-info">
          <span class="upcoming-card-title">${escapeHtml(m.title)}</span>
        </div>
      </div>
    </div>`;
}

function upcomingEpisodeCard({ show, episode, genres = [] }, { showCheckbox = false, showDate = true } = {}) {
  const seasonNum = episode.season_number;
  const epNum = episode.episode_number;
  const checkboxHTML = showCheckbox
    ? `<button class="upcoming-check-toggle" title="Marquer comme vu"
        data-tmdb-id="${show.tmdb_id}" data-title="${escapeHtml(show.title)}" data-poster="${show.poster_path || ""}"
        data-season="${seasonNum}" data-episode="${epNum}" data-runtime="${episode.runtime || ""}"
        data-air-date="${episode.air_date || ""}" data-genres="${genres.join(",")}">
        <i data-lucide="circle-check-big"></i>
      </button>`
    : "";
  return `
    <div class="upcoming-card upcoming-card--episode" data-href="#/episode/${show.tmdb_id}-${seasonNum}-${epNum}">
      ${showDate ? `<span class="upcoming-date">${episode.air_date ? formatDate(episode.air_date) : "Date inconnue"}</span>` : ""}
      <div class="upcoming-card-media">
        <img src="${TMDB.posterUrl(episode.still_path || show.poster_path, "w500")}" alt="" loading="lazy" />
        <div class="upcoming-card-info">
          <div class="upcoming-card-text">
            <span class="upcoming-card-title">${escapeHtml(show.title)}</span>
            <span class="upcoming-card-sub">S${seasonNum}E${epNum}${episode.name ? ` · ${escapeHtml(episode.name)}` : ""}</span>
          </div>
          ${checkboxHTML}
        </div>
      </div>
    </div>`;
}

// ---------- DIARY (ticket display) ----------
// ---------- JOURNAL (1 ticket par film vu / série terminée) ----------
// S'appuie sur la bibliothèque (déjà agrégée par LibraryBuilder) plutôt
// que sur le journal épisode par épisode : beaucoup plus léger à
// afficher, même avec un gros historique importé.
function diaryTemplate(library) {
  const items = library
    .filter(
      (l) =>
        (l.media_type === "movie" && l.status === "completed") ||
        (l.media_type === "tv" && l.status === "completed")
    )
    .sort((a, b) => (b.last_watched_date || "").localeCompare(a.last_watched_date || ""));

  if (!items.length)
    return emptyState(
      "Ton journal est vide pour l'instant. Un ticket apparaît ici dès qu'un film est vu ou qu'une série est entièrement terminée. Importe ton export TV Time ou enregistre un visionnage pour commencer."
    );
  return `<div class="ticket-list">${items.map(journalTicketCard).join("")}</div>`;
}

function journalTicketCard(item) {
  const sub =
    item.media_type === "tv"
      ? `Série · ${item.total_episodes || item.watched_episodes} épisode${(item.total_episodes || item.watched_episodes) > 1 ? "s" : ""}`
      : "Film";
  const rewatchCount = item.media_type === "movie" ? item.watch_count : 0;
  const ticketId = `${item.media_type}-${item.tmdb_id}`;

  return `
    <div class="ticket" data-ticket-id="${ticketId}" data-lib-id="${item.id}" data-type="${item.media_type}" data-tmdb-id="${item.tmdb_id}" data-title="${escapeHtml(item.title)}">
      <div class="ticket-poster">
        <img src="${TMDB.posterUrl(item.poster_path, "w185")}" alt="" loading="lazy" />
      </div>
      <div class="ticket-perforation"></div>
      <div class="ticket-body">
        <div class="ticket-row">
          <span class="ticket-title">${escapeHtml(item.title)}</span>
          <span class="ticket-sub">${sub}</span>
        </div>
        <div class="ticket-row ticket-row--meta">
          <span class="ticket-date">${formatDate(item.last_watched_date)}</span>
          ${rewatchCount > 1 ? `<span class="ticket-tag">×${rewatchCount}</span>` : ""}
        </div>
        ${item.avg_rating != null ? `<div class="ticket-stars">${stars(item.avg_rating)}</div>` : ""}
        <div class="ticket-barcode">${barcodeSVG(ticketId + item.last_watched_date)}</div>
      
      <div class="ticket-actions">
        <button class="ticket-delete" data-lib-id="${item.id}" data-tmdb-id="${item.tmdb_id}" data-type="${item.media_type}" title="Supprimer">✕</button>
        <button class="ticket-share" data-ticket-id="${ticketId}" title="Partager en image"><i data-lucide="share"></i></button>
      </div>
      </div>
    </div>
  `;
}

// Version individuelle (par entrée) utilisée pour "Tes meilleures notes"
// dans les stats — reste au niveau épisode/film, contrairement au Journal.
function entryTicketCard(entry) {
  const sub = entry.media_type === "tv" && entry.season != null ? `S${entry.season}E${entry.episode}` : "Film";
  return `
    <div class="ticket ticket--compact">
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
        </div>
        ${entry.rating != null ? `<div class="ticket-stars">${stars(entry.rating)}</div>` : ""}
      </div>
    </div>
  `;
}

function bindDiaryEvents() {
  const view_el = qs("#view");
  if (view_el.dataset.diaryEventsBound) return;
  view_el.dataset.diaryEventsBound = "1";
  view_el.addEventListener("click", async (e) => {
    const shareBtn = e.target.closest(".ticket-share");
    if (shareBtn) {
      e.stopPropagation();
      const [type, tmdbId] = shareBtn.dataset.ticketId.split("-");
      const item = App.library.find((l) => l.media_type === type && String(l.tmdb_id) === tmdbId);
      if (item) await TicketShare.generate(item);
      return;
    }

    const deleteBtn = e.target.closest(".ticket-delete");
    if (deleteBtn) {
      e.stopPropagation();
      const confirmed = await showConfirm(
        "Supprimer ce ticket ? Tous les visionnages associés (épisodes compris) seront effacés du journal.",
        { confirmLabel: "Supprimer", cancelLabel: "Annuler" }
      );
      if (!confirmed) return;
      try {
        await DB.deleteAllEntriesForWork(App.session.user.id, Number(deleteBtn.dataset.tmdbId), deleteBtn.dataset.type);
        await DB.removeLibraryItem(deleteBtn.dataset.libId);
        toast("Ticket supprimé.", "success");
        await App.refresh();
      } catch (err) {
        toast(err.message, "error");
      }
      return;
    }

    const ticket = e.target.closest(".ticket[data-tmdb-id]");
    if (ticket) {
      location.hash = `#/show/${ticket.dataset.type}-${ticket.dataset.tmdbId}`;
    }
  });
}

// ---------- PROFIL ----------
function profileHeaderHTML() {
  const meta = App.session.user.user_metadata || {};
  const username = meta.username || App.session.user.email?.split("@")[0] || "Toi";
  const bannerUrl = meta.banner_path ? TMDB.backdropUrl(meta.banner_path, "w1280") : null;
  const avatarUrl = meta.avatar_url || (meta.avatar_path ? TMDB.posterUrl(meta.avatar_path, "w185") : null);
  const bannerStyle = bannerUrl ? `background-image: url('${bannerUrl}');` : "";

  return `
    <div class="profile-header">
      <div class="profile-banner-wrap">
        <div class="profile-banner" style="${bannerStyle}"></div>
        <button id="edit-banner-btn" class="profile-banner-edit" title="Modifier la bannière"><i data-lucide="pencil"></i></button>
      </div>
      <div class="profile-identity">
        <div class="profile-avatar-wrap">
          <div class="profile-avatar" style="${avatarUrl ? `background-image:url('${avatarUrl}')` : ""}">
            ${avatarUrl ? "" : `<span class="profile-avatar-fallback">${escapeHtml(username[0]?.toUpperCase() || "?")}</span>`}
          </div>
          <button id="edit-avatar-btn" class="profile-avatar-edit" title="Modifier l'avatar"><i data-lucide="pencil"></i></button>
        </div>
        <button id="profile-username-btn" class="profile-username" title="Modifier ton pseudo">${escapeHtml(username)}</button>
        <a href="#/social" class="profile-social-btn" title="Abonnements et abonnés"><i data-lucide="users"></i></a>
      </div>
    </div>`;
}

// ---------- SÉLECTEURS BANNIÈRE / AVATAR (recherche TMDB) ----------
function openBannerPicker() {
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal modal--picker">
      <h2>Choisir une bannière</h2>
      <p class="modal-subtitle" id="banner-modal-subtitle">Cherche un film ou une série.</p>
      <div id="banner-modal-body"></div>
      <div class="modal-actions">
        <button id="banner-back" class="btn btn--ghost" hidden>Retour</button>
        <button id="banner-cancel" class="btn btn--ghost">Annuler</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  overlay.querySelector("#banner-cancel").addEventListener("click", () => overlay.remove());
  overlay.addEventListener("click", (e) => e.target === overlay && overlay.remove());

  const body = qs("#banner-modal-body", overlay);
  const subtitle = qs("#banner-modal-subtitle", overlay);
  const backBtn = qs("#banner-back", overlay);

  async function selectBanner(path) {
    try {
      await DB.updateProfile({ banner_path: path });
      toast("Bannière mise à jour 🎟️", "success");
      overlay.remove();
      App.session = await DB.getSession();
      App.route();
    } catch (err) {
      toast(err.message, "error");
    }
  }

  function renderSearchStep() {
    backBtn.hidden = true;
    backBtn.onclick = null;
    subtitle.textContent = "Cherche un film ou une série.";
    body.innerHTML = `
      <input type="search" id="banner-search-input" class="search-input" placeholder="Cherche un titre…" autofocus />
      <div id="banner-search-results" class="picker-grid"></div>
    `;
    const input = qs("#banner-search-input", body);
    const results = qs("#banner-search-results", body);
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
          results.innerHTML =
            items
              .map((it) => {
                const title = it.original_title || it.original_name || it.title || it.name;
                return `
              <div class="picker-item picker-item--show" data-id="${it.id}" data-type="${it.media_type}" data-title="${escapeHtml(title)}">
                <img src="${TMDB.posterUrl(it.poster_path, "w185")}" alt="" loading="lazy" />
                <span>${escapeHtml(title)}</span>
              </div>`;
              })
              .join("") || emptyState("Aucun résultat.");
        } catch {
          results.innerHTML = emptyState("Erreur TMDB.");
        }
      }, 400)
    );
    results.addEventListener("click", (e) => {
      const item = e.target.closest(".picker-item--show");
      if (item) renderImageStep(item.dataset.type, item.dataset.id, item.dataset.title);
    });
  }

  async function renderImageStep(mediaType, id, title) {
    backBtn.hidden = false;
    backBtn.onclick = renderSearchStep;
    subtitle.textContent = title;

    const hasEpisodes = mediaType === "tv";
    body.innerHTML = `
      <div class="picker-tabs">
        <button class="picker-tab picker-tab--active" data-tab="backdrops">Fonds d'écran</button>
        ${hasEpisodes ? `<button class="picker-tab" data-tab="episodes">Épisodes</button>` : ""}
      </div>
      <div id="banner-image-grid" class="picker-grid picker-grid--wide"><p class="loading">Chargement…</p></div>
    `;
    const grid = qs("#banner-image-grid", body);

    // Un seul écouteur, valable pour tous les contenus qui seront
    // injectés ensuite (fonds d'écran ou vignettes d'épisode).
    grid.addEventListener("click", (e) => {
      const item = e.target.closest(".picker-item--image");
      if (item) selectBanner(item.dataset.path);
    });

    let numberOfSeasons = null;

    async function loadBackdrops() {
      grid.innerHTML = `<p class="loading">Chargement…</p>`;
      try {
        const images = await TMDB.getImages(mediaType, id);
        const backdrops = (images.backdrops || []).slice(0, 30);
        grid.innerHTML = backdrops.length
          ? backdrops
              .map(
                (img) => `
              <div class="picker-item picker-item--image" data-path="${img.file_path}">
                <img src="${TMDB.backdropUrl(img.file_path, "w300")}" alt="" loading="lazy" />
              </div>`
              )
              .join("")
          : emptyState("Aucune image disponible pour ce titre.");
      } catch {
        grid.innerHTML = emptyState("Erreur TMDB.");
      }
    }

    async function loadEpisodes(season) {
      grid.innerHTML = `<p class="loading">Chargement…</p>`;
      try {
        if (numberOfSeasons === null) {
          const show = await TMDB.getTv(id);
          numberOfSeasons = show.number_of_seasons || 1;
        }
        const seasonData = await TMDB.getSeason(id, season);
        const episodes = (seasonData.episodes || []).filter((ep) => ep.still_path);
        const seasonOptions = Array.from({ length: numberOfSeasons }, (_, i) => i + 1)
          .map((n) => `<option value="${n}" ${n === season ? "selected" : ""}>Saison ${n}</option>`)
          .join("");
        grid.innerHTML = `
          <select id="banner-season-select" class="banner-season-select">${seasonOptions}</select>
          <div class="picker-grid picker-grid--wide">
            ${
              episodes.length
                ? episodes
                    .map(
                      (ep) => `
                  <div class="picker-item picker-item--image" data-path="${ep.still_path}">
                    <img src="${TMDB.backdropUrl(ep.still_path, "w300")}" alt="" loading="lazy" />
                    <span>S${season}E${ep.episode_number}</span>
                  </div>`
                    )
                    .join("")
                : emptyState("Pas de vignettes disponibles pour cette saison.")
            }
          </div>
        `;
        qs("#banner-season-select", grid).addEventListener("change", (e) => loadEpisodes(Number(e.target.value)));
      } catch {
        grid.innerHTML = emptyState("Erreur TMDB.");
      }
    }

    qsa(".picker-tab", body).forEach((tab) =>
      tab.addEventListener("click", () => {
        qsa(".picker-tab", body).forEach((t) => t.classList.remove("picker-tab--active"));
        tab.classList.add("picker-tab--active");
        if (tab.dataset.tab === "backdrops") loadBackdrops();
        else loadEpisodes(1);
      })
    );

    await loadBackdrops();
  }

  renderSearchStep();
}

// AVATAR PICKER

function openAvatarPicker() {
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal modal--picker">
      <h2>Choisir un avatar</h2>
      <p class="modal-subtitle">Cherche un film ou une série, puis choisis un personnage dans son casting.</p>
      <input type="search" id="avatar-search-input" class="search-input" placeholder="Cherche un titre…" autofocus />
      <div id="avatar-step-results" class="picker-grid"></div>
      <div class="modal-actions">
        <button id="avatar-cancel" class="btn btn--ghost">Annuler</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  overlay.querySelector("#avatar-cancel").addEventListener("click", () => overlay.remove());
  overlay.addEventListener("click", (e) => e.target === overlay && overlay.remove());

  const input = qs("#avatar-search-input", overlay);
  const resultsEl = qs("#avatar-step-results", overlay);

  input.addEventListener(
    "input",
    debounce(async () => {
      const q = input.value.trim();
      if (q.length < 2) {
        resultsEl.innerHTML = "";
        return;
      }
      try {
        const items = await TMDB.searchMulti(q);
        resultsEl.innerHTML =
          items
            .map((it) => {
              const title = it.original_title || it.original_name || it.title || it.name;
              return `
          <div class="picker-item picker-item--show" data-id="${it.id}" data-type="${it.media_type}" data-title="${escapeHtml(title)}">
            <img src="${TMDB.posterUrl(it.poster_path, "w185")}" alt="" loading="lazy" />
            <span>${escapeHtml(title)}</span>
          </div>`;
            })
            .join("") || emptyState("Aucun résultat.");
      } catch {
        resultsEl.innerHTML = emptyState("Erreur TMDB.");
      }
    }, 400)
  );

  resultsEl.addEventListener("click", async (e) => {
    const showItem = e.target.closest(".picker-item--show");
    if (showItem) {
      resultsEl.innerHTML = `<p class="loading">Chargement du casting…</p>`;
      try {
        const type = showItem.dataset.type;
        const title = showItem.dataset.title;
        let rawCast;
        if (type === "movie") {
          const data = await TMDB.getMovie(showItem.dataset.id);
          rawCast = data.credits?.cast || [];
        } else {
          const data = await TMDB.getAggregateCredits(showItem.dataset.id);
          rawCast = data.cast || [];
        }

        const cast = (
          await getCastForDisplay(type === "movie" ? "movie" : "series", showItem.dataset.id, title, rawCast)
        ).slice(0, 20);

        resultsEl.innerHTML = cast.length
          ? cast
              .map(
                (actor) => `
            <div class="picker-item picker-item--actor" data-image="${actor.image}">
              <img src="${actor.image}" alt="" loading="lazy" />
              <span class="cast-name">${escapeHtml(actor.role)}</span>
              <br>
              <span>${escapeHtml(actor.name)}</span>
            </div>`
              )
              .join("")
          : emptyState("Pas de photos de casting disponibles pour ce titre.");
      } catch {
        resultsEl.innerHTML = emptyState("Erreur TMDB.");
      }
      return;
    }

    const actorItem = e.target.closest(".picker-item--actor");
    if (actorItem) {
      try {
        await DB.updateProfile({ avatar_url: actorItem.dataset.image, avatar_path: null });
        toast("Avatar mis à jour 🎟️", "success");
        overlay.remove();
        App.session = await DB.getSession();
        App.route();
      } catch (err) {
        toast(err.message, "error");
      }
    }
  });
}

// ---------- STATS ----------
function statsTemplate(diary, library) {
  const s = Stats.compute(diary, library, App.genreMaps);
  return `
    ${profileHeaderHTML()}
    <div class="stats-view">
    <section class="stats-section-intro">
        <h2>Mes stats</h2>
      <div class="stats-cards">
        <div class="stat-card"><span class="stat-num">${s.episodesCount}</span><span class="stat-label">Épisodes</span></div>
        <div class="stat-card"><span class="stat-num">${s.moviesCount}</span><span class="stat-label">Films</span></div>
        <div class="stat-card"><span class="stat-num">${formatWatchDuration(s.totalTvMinutes)}</span><span class="stat-label">passés devant des séries</span></div>
        <div class="stat-card"><span class="stat-num">${formatWatchDuration(s.totalMovieMinutes)}</span><span class="stat-label">passés devant des films</span></div>
        <div class="stat-card"><span class="stat-num">${s.avgRating ? s.avgRating.toFixed(1) : "—"}</span><span class="stat-label">Note moyenne</span></div>
        <div class="stat-card"><span class="stat-num">${s.showsCompleted}</span><span class="stat-label">Séries terminées</span></div>
      </div>
     </section>

     <div id="pending-requests-container">${pendingRequestsHTML()}</div>

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
          ? `<section class="stats-section-ratings">
        <h2>Tes meilleures notes</h2>
        <div class="ticket-list">${s.topRated.map(entryTicketCard).join("")}</div>
      </section>`
          : ""
      }

      <button id="open-settings-btn" class="btn btn--ghost settings-entry-btn">
        <i data-lucide="settings"></i>
        Paramètres généraux
      </button>
      
      <footer class="app-attribution">
        <p>
          Ce produit utilise l'API TMDB mais n'est ni approuvé ni certifié par TMDB.<br />
          Métadonnées et images de personnages fournies par TheTVDB.
        </p>
        <p class="app-attribution-links">
          <a href="https://www.themoviedb.org" target="_blank" rel="noopener">TMDB</a>
          ·
          <a href="https://www.thetvdb.com" target="_blank" rel="noopener">TheTVDB</a>
        </p>
      </footer>
    </div>
  `;
}

// ---------- SETTINGS ----------
function settingsTemplate() {
  return `
    <div class="stats-view settings-view">
      <a href="#/stats" class="settings-back">← Retour au profil</a>
      <h1>Paramètres</h1>

      <section class="stats-section-privacy">
        <h2>Confidentialité</h2>
        <div class="privacy-toggle" id="privacy-searchable" role="switch" aria-checked="${App.profile?.is_searchable ? "true" : "false"}">
          <span class="episode-check-toggle ${App.profile?.is_searchable ? "is-watched" : ""}">${App.profile?.is_searchable ? '<i data-lucide="circle-check-big"></i>' : ""}</span>
          <span>Trouvable dans la recherche d'utilisateurs</span>
        </div>
        <div class="privacy-visibility">
          <label for="privacy-visibility">Qui peut voir tes stats et ta bibliothèque ?</label>
          <select id="privacy-visibility">
            <option value="public" ${App.profile?.visibility === "public" ? "selected" : ""}>Public (tout le monde)</option>
            <option value="followers" ${!App.profile || App.profile.visibility === "followers" ? "selected" : ""}>Abonnés acceptés uniquement</option>
            <option value="private" ${App.profile?.visibility === "private" ? "selected" : ""}>Privé (personne)</option>
          </select>
        </div>
      </section>

      <section class="stats-section-import">
        <h2>Importer mon historique</h2>
        <p class="import-hint">
          Depuis un export TV Time, séries et films séparément : au format JSON, ou au format CSV de ton export GDPR.<br />
          <br><em>(CSV : Décompresse le ZIP et choisis
          <code>tracking-prod-records-v2.csv</code> pour les séries et
          <code>tracking-prod-records.csv</code> pour les films).</em>
        </p>
        <div class="import-actions">
          <button id="import-shows-btn" class="btn btn--ghost">Importer mes séries</button>
          <button id="import-movies-btn" class="btn btn--ghost">Importer mes films</button>
        </div>
      </section>

      <section class="stats-section-danger">
        <h2 class="danger-h2">Zone de danger</h2>
        <button id="delete-account-btn" class="btn btn--danger">Supprimer mon compte</button>
      </section>
    </div>
  `;
}

// ---------- BADGES ----------
function progressRingSVG(fraction, size = 56, strokeWidth = 4) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - Math.min(Math.max(fraction, 0), 1));
  return `
    <svg class="badge-ring" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
      <circle class="badge-ring-bg" cx="${size / 2}" cy="${size / 2}" r="${radius}" stroke-width="${strokeWidth}" fill="none" />
      <circle class="badge-ring-fill" cx="${size / 2}" cy="${size / 2}" r="${radius}" stroke-width="${strokeWidth}" fill="none"
        stroke-dasharray="${circumference}" stroke-dashoffset="${offset}"
        transform="rotate(-90 ${size / 2} ${size / 2})" />
    </svg>`;
}

function badgeCardHTML(badge, info) {
  if (!badge.tiers) {
    const earned = (info?.tier || 0) > 0;
    return `
      <div class="badge-card ${earned ? "badge-card--earned" : ""}">
        <span class="badge-icon">${badge.icon}</span>
        <span class="badge-name">${badge.name}</span>
        <span class="badge-desc">${badge.description}</span>
      </div>`;
  }

  const tier = info?.tier || 0;
  const value = info?.value || 0;
  const maxTier = badge.tiers.length;
  const earned = tier > 0;
  const nextThreshold = tier < maxTier ? badge.tiers[tier] : null;
  const prevThreshold = tier > 0 ? badge.tiers[tier - 1] : 0;
  const fraction = tier >= maxTier ? 1 : (value - prevThreshold) / (nextThreshold - prevThreshold);
  const unit = badge.unit === "percent" ? "%" : "";
  const format = badge.formatValue || ((v) => `${v}${unit}`);
  const counterText = nextThreshold != null ? `${format(value)}/${format(nextThreshold)}` : format(value);

  return `
    <div class="badge-card badge-card--tiered ${earned ? "badge-card--earned" : ""}">
      <div class="badge-ring-wrap">
        ${progressRingSVG(fraction)}
        <span class="badge-icon badge-icon--ring">${badge.icon}</span>
      </div>
      <span class="badge-progress-counter">${counterText}</span>
      <span class="badge-name">${badge.name}</span>
      <span class="badge-tier-label">${earned ? `Niveau ${tier}/${maxTier}` : "Pas encore débloqué"}</span>
      <span class="badge-desc">${badge.description}</span>
    </div>`;
}

function badgesTemplate(earned) {
  return `
    <div class="badges-grid">
      ${BADGES.map((b) => badgeCardHTML(b, earned[b.key])).join("")}
    </div>
  `;
}

App.init();
