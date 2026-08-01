// ============================================
// LIBRARY BUILDER
// Reconstruit automatiquement la bibliothèque (statut, progression,
// nombre d'épisodes restants, note moyenne, dernière note) à partir
// du journal de visionnage. C'est cette table qui alimente le Journal
// (1 ticket par film vu / série terminée), beaucoup plus légère que de
// parcourir tout le journal épisode par épisode à chaque affichage.
// ============================================

const LibraryBuilder = {
  // Cache mémoire (le temps de la session) pour éviter de re-interroger
  // TMDB à chaque rebuild pour un show déjà résolu.
  _showMetaCache: new Map(),

  // Cache persistant (localStorage) pour éviter de refaire les appels TMDB
  // à CHAQUE ouverture de l'app — c'était le principal goulot d'étranglement
  // au démarrage (un appel séquentiel par série du journal). TTL de 30 minutes car
  // total_episodes/total_seasons peuvent évoluer pour une série en cours.
  _META_TTL_MS: 30 * 60 * 1000,
  _metaStorageKey(tmdbId) {
    return `ttb_show_meta_${tmdbId}`;
  },

  _readPersistedMeta(tmdbId) {
    try {
      const raw = localStorage.getItem(this._metaStorageKey(tmdbId));
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || Date.now() - parsed.ts > this._META_TTL_MS) return null;
      return { total_episodes: parsed.total_episodes, total_seasons: parsed.total_seasons, status: parsed.status, poster_path: parsed.poster_path ?? null, };
    } catch {
      return null;
    }
  },

  _writePersistedMeta(tmdbId, meta) {
    try {
      localStorage.setItem(
        this._metaStorageKey(tmdbId),
        JSON.stringify({ ...meta, ts: Date.now() })
      );
    } catch {
      // Quota localStorage dépassé ou indisponible : pas bloquant, on
      // retombera simplement sur un appel TMDB la prochaine fois.
    }
  },

  // Séries dont TMDB confirme qu'il n'y aura plus rien à venir. Une série
  // "Returning Series"/"In Production"/"Planned" reste "en cours" même une
  // fois tous les épisodes connus vus, le temps que la saison suivante soit
  // annoncée — seule une série vraiment finie doit passer en "Terminé".
  _ENDED_TMDB_STATUSES: new Set(["Ended", "Canceled"]),

  async _getShowMeta(tmdbId) {
    if (this._showMetaCache.has(tmdbId)) return this._showMetaCache.get(tmdbId);

    const persisted = this._readPersistedMeta(tmdbId);
    if (persisted && persisted.status) {
      this._showMetaCache.set(tmdbId, persisted);
      return persisted;
    }

    const details = await TMDB.getTv(tmdbId);
    const meta = {
      total_episodes: details.number_of_episodes ?? 0,
      total_seasons: details.number_of_seasons ?? 0,
      poster_path: details.poster_path ?? null,
      status: details.status || null,
    };
    this._showMetaCache.set(tmdbId, meta);
    this._writePersistedMeta(tmdbId, meta);
    return meta;
  },

  async rebuild(userId, diaryOverride, existingLibrary = []) {
    const diary = diaryOverride || (await DB.getDiary(userId));
    const existingStatus = new Map(
      existingLibrary.map((l) => [`${l.media_type}_${l.tmdb_id}`, l.status])
    );
    const existingWatchedEpisodes = new Map(
      existingLibrary.map((l) => [`${l.media_type}_${l.tmdb_id}`, l.watched_episodes || 0])
    );
    const works = new Map();

    for (const entry of diary) {
      if (!entry.tmdb_id) continue;
      const key = `${entry.media_type}_${entry.tmdb_id}`;

      if (!works.has(key)) {
        works.set(key, {
          user_id: userId,
          tmdb_id: entry.tmdb_id,
          media_type: entry.media_type,
          title: entry.title,
          poster_path: entry.poster_path,
          first_watched_date: entry.watched_date,
          last_watched_date: null,
          watch_count: 0,
          watched_episodes: 0,
          seenEpisodeKeys: new Set(),
          total_episodes: 0,
          total_seasons: 0,
          progress: 0,
          status: "watching",
          ratingSum: 0,
          ratingCount: 0,
          lastNote: null,
          lastNoteDate: null,
          lastNoteCreatedAt: null,
        });
      }

      const work = works.get(key);

      if (entry.media_type === "movie") {
        work.watch_count++;
      } else {
        const epKey = `${entry.season}x${entry.episode}`;
        if (!work.seenEpisodeKeys.has(epKey)) {
          work.seenEpisodeKeys.add(epKey);
          work.watched_episodes++;
        }
      }

      if (entry.watched_date < work.first_watched_date) work.first_watched_date = entry.watched_date;

      // Un revisionnage d'épisode (rewatch: true) ne doit pas faire remonter
      // ni changer la date du ticket série — contrairement aux films, où le
      // rewatch met à jour intentionnellement le ticket (tag ×N).
      const countsForLastWatched = entry.media_type === "movie" || !entry.rewatch;
      if (countsForLastWatched && (!work.last_watched_date || entry.watched_date > work.last_watched_date)) {
        work.last_watched_date = entry.watched_date;
      }

      if (entry.rating != null) {
        work.ratingSum += entry.rating;
        work.ratingCount++;
      }

      if (entry.note) {
        const isNewer =
          !work.lastNoteDate ||
          entry.watched_date > work.lastNoteDate ||
          (entry.watched_date === work.lastNoteDate &&
            (entry.created_at || "") > (work.lastNoteCreatedAt || ""));
        if (isNewer) {
          work.lastNote = entry.note;
          work.lastNoteDate = entry.watched_date;
          work.lastNoteCreatedAt = entry.created_at || null;
        }
      }
    }

    // Résout les métadonnées TMDB (nb d'épisodes/saisons) de toutes les
    // séries en parallèle plutôt qu'une par une : avec un journal de 50
    // séries, ça remplace 50 allers-retours séquentiels par 1 seul batch,
    // ce qui était le principal goulot d'étranglement au démarrage.
    const tvWorks = [...works.values()].filter((w) => w.media_type !== "movie");
    await Promise.all(
      tvWorks.map(async (work) => {
        try {
          const meta = await this._getShowMeta(work.tmdb_id);
          work.total_episodes = meta.total_episodes;
          work.total_seasons = meta.total_seasons;
          work.status_tmdb = meta.status;
          if (meta.poster_path) {
  work.poster_path = meta.poster_path;
}
        } catch {
          // TMDB indisponible pour ce show : on garde les valeurs par défaut
        }
      })
    );

    const library = [];

    for (const work of works.values()) {
      if (work.media_type === "movie") {
        work.status = work.watch_count > 0 ? "completed" : "watchlist";
      } else {
        work.status = work.watched_episodes > 0 ? "watching" : "watchlist";

        if (work.total_episodes > 0) {
          const cappedWatched = Math.min(work.watched_episodes, work.total_episodes);
          work.progress = Number(((cappedWatched / work.total_episodes) * 100).toFixed(1));
          const showHasEnded = this._ENDED_TMDB_STATUSES.has(work.status_tmdb);
          const caughtUp = work.watched_episodes >= work.total_episodes;
          // Rattrapé mais la série tourne encore (pause entre deux saisons,
          // saison suivante pas encore annoncée) : reste "En cours" plutôt
          // que de basculer en "Terminé" — sinon elle disparaît de la vue
          // "à venir" dès que de nouveaux épisodes sont annoncés.
          work.status = caughtUp ? (showHasEnded ? "completed" : "watching") : "watching";
        }
      }

      // "dropped" et "completed" sont des choix manuels de l'utilisateur
      // (menu déroulant sur la fiche) : une fois posés, ils ne doivent pas
      // être écrasés par le recalcul automatique — seul un nouveau
      // changement de statut manuel, ou un nouveau visionnage (voir
      // ci-dessous), doit les faire bouger.
      const STICKY_STATUSES = new Set(["dropped", "completed"]);
      const previousStatus = existingStatus.get(`${work.media_type}_${work.tmdb_id}`);
      const previousWatchedEpisodes = existingWatchedEpisodes.get(`${work.media_type}_${work.tmdb_id}`) ?? 0;
      const hasNewProgress = work.watched_episodes > previousWatchedEpisodes;

      library.push({
        user_id: work.user_id,
        tmdb_id: work.tmdb_id,
        media_type: work.media_type,
        title: work.title,
        poster_path: work.poster_path,
        status:
          STICKY_STATUSES.has(previousStatus) && !hasNewProgress
            ? previousStatus
            : work.status,
        first_watched_date: work.first_watched_date,
        last_watched_date: work.last_watched_date || work.first_watched_date,
        watch_count: work.watch_count,
        watched_episodes: work.watched_episodes,
        total_episodes: work.total_episodes,
        total_seasons: work.total_seasons,
        progress: work.progress,
        tmdb_last_sync: new Date().toISOString(),
        avg_rating: work.ratingCount > 0 ? Number((work.ratingSum / work.ratingCount).toFixed(1)) : null,
        last_note: work.lastNote,
      });
    }

    await DB.upsertLibraryItems(library);
    return library;
  },
};
