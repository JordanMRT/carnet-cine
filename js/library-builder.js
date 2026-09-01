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
  // au démarrage (un appel séquentiel par série du journal).
  //
  // TTL différencié : une série "Ended"/"Canceled" ne bougera plus jamais
  // (total_episodes figé), on peut donc la garder longtemps en cache. Une
  // série encore en cours ("Returning Series"/"In Production"/"Planned")
  // peut voir TMDB lui ajouter des épisodes/saisons à tout moment : un TTL
  // de 30 min y était trop long et provoquait un faux "100% — 144/144"
  // pendant qu'une mise à jour TMDB était en cours (nouveaux épisodes
  // visibles dans la grille, mais total_episodes du cache pas encore
  // rafraîchi). D'où un TTL bien plus court pour ces séries-là.
  _META_TTL_MS_ENDED: 24 * 60 * 60 * 1000,
  _META_TTL_MS_ONGOING: 5 * 60 * 1000,
  _metaStorageKey(tmdbId) {
    return `ttb_show_meta_${tmdbId}`;
  },

  _readPersistedMeta(tmdbId) {
    try {
      const raw = localStorage.getItem(this._metaStorageKey(tmdbId));
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed) return null;
      const ttl = this._ENDED_TMDB_STATUSES.has(parsed.status)
        ? this._META_TTL_MS_ENDED
        : this._META_TTL_MS_ONGOING;
      if (Date.now() - parsed.ts > ttl) return null;
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

  async _getShowMeta(tmdbId, watchedEpisodes = 0) {
    // Le cache mémoire (session) est vérifié en premier, mais il ne doit
    // PAS court-circuiter le garde-fou anti-staleness : sans ce check, une
    // série déjà résolue plus tôt dans la session (donc déjà en mémoire)
    // ignorerait complètement le TTL et le forceRefresh ci-dessous, et
    // aucune revérification TMDB n'aurait jamais lieu tant que la page
    // n'est pas rechargée.
    if (this._showMetaCache.has(tmdbId)) {
      const cached = this._showMetaCache.get(tmdbId);
      const memCacheLooksSuspicious =
        !this._ENDED_TMDB_STATUSES.has(cached.status) &&
        cached.total_episodes > 0 &&
        watchedEpisodes >= cached.total_episodes;
      if (!memCacheLooksSuspicious) return cached;
    }

    const persisted = this._readPersistedMeta(tmdbId);
    // Une série "rattrapée" d'après le cache (watched >= total mis en cache)
    // et pas encore marquée "Ended"/"Canceled" est le cas exact où une
    // valeur périmée fait le plus de dégâts : elle affiche 100% alors que
    // TMDB est peut-être en train d'ajouter de nouveaux épisodes. Dans ce
    // cas précis, on ignore le cache et on revérifie auprès de TMDB, même
    // si le TTL n'est pas encore expiré.
    const cacheLooksSuspicious =
      persisted &&
      !this._ENDED_TMDB_STATUSES.has(persisted.status) &&
      persisted.total_episodes > 0 &&
      watchedEpisodes >= persisted.total_episodes;

    if (persisted && persisted.status && !cacheLooksSuspicious) {
      this._showMetaCache.set(tmdbId, persisted);
      return persisted;
    }

    const details = await TMDB.getTv(tmdbId, /* forceRefresh */ true);
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
    // series_rating ne se recalcule jamais depuis le journal (contrairement
    // à avg_rating) : c'est une donnée posée manuellement par l'utilisateur
    // via "Ta note", à préserver telle quelle à chaque rebuild.
    const existingSeriesRating = new Map(
      existingLibrary.map((l) => [`${l.media_type}_${l.tmdb_id}`, l.series_rating ?? null])
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

    // Éléments de la bibliothèque qui avaient une progression avant (film vu
    // au moins une fois / série avec des épisodes vus) mais qui n'ont plus
    // AUCUNE entrée de journal maintenant (ex: le seul visionnage d'un film
    // vient d'être annulé) : sans ça, ils ne passeraient jamais par la boucle
    // ci-dessus ni par le recalcul de statut plus bas, et resteraient
    // bloqués sur leur ancien statut ("Terminé" alors que watch_count est
    // retombé à 0). On les réintègre avec une progression à zéro pour
    // qu'ils suivent exactement la même logique (y compris la protection
    // sticky sur un statut choisi manuellement). Les éléments jamais
    // regardés (ajoutés en watchlist sans historique de journal) ne sont
    // volontairement PAS concernés ici, pour ne pas re-traiter toute la
    // watchlist à chaque rafraîchissement.
    for (const item of existingLibrary) {
      const key = `${item.media_type}_${item.tmdb_id}`;
      if (works.has(key)) continue;
      const hadProgressBefore =
        item.media_type === "movie" ? (item.watch_count || 0) > 0 : (item.watched_episodes || 0) > 0;
      if (!hadProgressBefore) continue;
      works.set(key, {
        user_id: userId,
        tmdb_id: item.tmdb_id,
        media_type: item.media_type,
        title: item.title,
        poster_path: item.poster_path,
        first_watched_date: item.first_watched_date,
        last_watched_date: null,
        watch_count: 0,
        watched_episodes: 0,
        seenEpisodeKeys: new Set(),
        total_episodes: item.total_episodes || 0,
        total_seasons: item.total_seasons || 0,
        progress: 0,
        status: "watching",
        ratingSum: 0,
        ratingCount: 0,
        lastNote: null,
        lastNoteDate: null,
        lastNoteCreatedAt: null,
      });
    }

    // Résout les métadonnées TMDB (nb d'épisodes/saisons) de toutes les
    // séries en parallèle plutôt qu'une par une : avec un journal de 50
    // séries, ça remplace 50 allers-retours séquentiels par 1 seul batch,
    // ce qui était le principal goulot d'étranglement au démarrage.
    const tvWorks = [...works.values()].filter((w) => w.media_type !== "movie");
    await Promise.all(
      tvWorks.map(async (work) => {
        try {
          const meta = await this._getShowMeta(work.tmdb_id, work.watched_episodes);
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

    const existingWatchCounts = new Map(
      existingLibrary.map((l) => [`${l.media_type}_${l.tmdb_id}`, l.watch_count || 0])
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
      const previousWatchCount = existingWatchCounts.get(`${work.media_type}_${work.tmdb_id}`) ?? 0;
      // Pour un film, watched_episodes ne bouge jamais (seul watch_count
      // compte) : s'y fier ici rendrait "completed" inamovible pour de bon
      // dès le premier visionnage, y compris après une annulation qui
      // ramène watch_count à 0. On compare donc watch_count pour un film
      // (dans les deux sens, hausse ou baisse), watched_episodes pour une
      // série (uniquement en hausse, comportement inchangé).
      const hasNewProgress =
        work.media_type === "movie"
          ? work.watch_count !== previousWatchCount
          : work.watched_episodes > previousWatchedEpisodes;

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
        series_rating: existingSeriesRating.get(`${work.media_type}_${work.tmdb_id}`) ?? null,
        last_note: work.lastNote,
      });
    }

    await DB.upsertLibraryItems(library);

    // Séries qui viennent de passer en "Terminé" lors de CE rebuild (pas
    // déjà "completed" avant) : c'est à l'appelant de décider s'il s'agit
    // d'une vraie action en direct de l'utilisateur (→ célébration) ou d'un
    // simple rechargement/import en masse (→ rien).
    this.lastCompletedTransitions = library.filter((item) => {
      const key = `${item.media_type}_${item.tmdb_id}`;
      return (
        item.media_type === "tv" &&
        item.status === "completed" &&
        existingStatus.get(key) !== "completed"
      );
    });

    return library;
  },
};
