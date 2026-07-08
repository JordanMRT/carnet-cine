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

  async _getShowMeta(tmdbId) {
    if (this._showMetaCache.has(tmdbId)) return this._showMetaCache.get(tmdbId);
    const details = await TMDB.getTv(tmdbId);
    const meta = {
      total_episodes: details.number_of_episodes ?? 0,
      total_seasons: details.number_of_seasons ?? 0,
    };
    this._showMetaCache.set(tmdbId, meta);
    return meta;
  },

  async rebuild(userId, diaryOverride, existingLibrary = []) {
    const diary = diaryOverride || (await DB.getDiary(userId));
    const existingStatus = new Map(
      existingLibrary.map((l) => [`${l.media_type}_${l.tmdb_id}`, l.status])
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
          last_watched_date: entry.watched_date,
          watch_count: 0, // uniquement les films
          watched_episodes: 0, // épisodes uniques vus (séries)
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
      if (entry.watched_date > work.last_watched_date) work.last_watched_date = entry.watched_date;

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

    const library = [];

    for (const work of works.values()) {
      if (work.media_type === "movie") {
        work.status = work.watch_count > 0 ? "completed" : "watchlist";
      } else {
        work.status = work.watched_episodes > 0 ? "watching" : "watchlist";

        try {
          const meta = await this._getShowMeta(work.tmdb_id);
          work.total_episodes = meta.total_episodes;
          work.total_seasons = meta.total_seasons;

          if (work.total_episodes > 0) {
            const cappedWatched = Math.min(work.watched_episodes, work.total_episodes);
            work.progress = Number(((cappedWatched / work.total_episodes) * 100).toFixed(1));
            work.status =
              work.watched_episodes >= work.total_episodes ? "completed" : "watching";
          }
        } catch {
          // TMDB indisponible pour ce show : on garde les valeurs par défaut
        }
      }

      library.push({
        user_id: work.user_id,
        tmdb_id: work.tmdb_id,
        media_type: work.media_type,
        title: work.title,
        poster_path: work.poster_path,
        status:
          existingStatus.get(`${work.media_type}_${work.tmdb_id}`) === "dropped"
            ? "dropped"
            : work.status,
        first_watched_date: work.first_watched_date,
        last_watched_date: work.last_watched_date,
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
