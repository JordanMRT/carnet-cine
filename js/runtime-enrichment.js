// ============================================
// RUNTIME ENRICHMENT
// Complète runtime_minutes (tous types) et air_date (films et épisodes)
// sur les entrées du journal qui ne les ont pas — typiquement les
// entrées importées, ou loggées avant l'ajout de ces champs. Tourne en
// tâche de fond après import / ouverture.
// ============================================

const RuntimeEnrichment = {
  _seasonCache: new Map(), // `${tmdbId}_${season}` -> Map(episodeNumber -> {runtime, air_date})
  _movieCache: new Map(), // tmdbId -> objet film TMDB complet (ou null)

  _sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  },

  async _getMovie(tmdbId) {
    if (this._movieCache.has(tmdbId)) return this._movieCache.get(tmdbId);
    let data = null;
    try {
      data = await TMDB.getMovie(tmdbId);
    } catch {
      /* ignoré */
    }
    this._movieCache.set(tmdbId, data);
    return data;
  },

  async _getSeasonData(tmdbId, season) {
    const key = `${tmdbId}_${season}`;
    if (this._seasonCache.has(key)) return this._seasonCache.get(key);
    const map = new Map();
    try {
      const data = await TMDB.getSeason(tmdbId, season);
      (data.episodes || []).forEach((ep) =>
        map.set(ep.episode_number, { runtime: ep.runtime || null, air_date: ep.air_date || null })
      );
    } catch {
      /* ignoré */
    }
    this._seasonCache.set(key, map);
    return map;
  },

  // Complète les entrées manquantes, met à jour Supabase par lots,
  // retourne le nombre d'entrées effectivement enrichies.
  async run(diary, onProgress) {
    const missing = diary.filter(
      (e) =>
        e.tmdb_id &&
        (!e.runtime_minutes ||
          (e.media_type === "movie" && !e.air_date) ||
          (e.media_type === "tv" && !e.air_date && e.season != null && e.episode != null))
    );
    if (missing.length === 0) return 0;

    let enriched = 0;
    let done = 0;
    let pendingWrites = [];

    const flushWrites = async () => {
      if (!pendingWrites.length) return;
      const batch = pendingWrites;
      pendingWrites = [];
      await Promise.all(
        batch.map(({ id, fields }) =>
          DB.updateDiaryEntryFields(id, fields).catch(() => {
            /* ignoré, on continue avec les autres entrées */
          })
        )
      );
    };

    for (const entry of missing) {
      const fields = {};

      if (entry.media_type === "movie") {
        const movie = await this._getMovie(entry.tmdb_id);
        await this._sleep(50);
        if (!entry.runtime_minutes && movie?.runtime) fields.runtime_minutes = movie.runtime;
        if (!entry.air_date && movie?.release_date) fields.air_date = movie.release_date;
      } else if (entry.season != null && entry.episode != null) {
        const seasonMap = await this._getSeasonData(entry.tmdb_id, entry.season);
        await this._sleep(50);
        const epData = seasonMap.get(entry.episode);
        if (epData) {
          if (!entry.runtime_minutes && epData.runtime) fields.runtime_minutes = epData.runtime;
          if (!entry.air_date && epData.air_date) fields.air_date = epData.air_date;
        }
      }

      if (Object.keys(fields).length) {
        Object.assign(entry, fields); // reflète direct dans l'objet en mémoire
        pendingWrites.push({ id: entry.id, fields });
        enriched++;
        if (pendingWrites.length >= 20) await flushWrites();
      }

      done++;
      if (done % 20 === 0) onProgress?.(`Enrichissement : ${done}/${missing.length}…`);
    }

    await flushWrites();
    return enriched;
  },
};