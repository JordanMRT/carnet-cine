// ============================================
// RUNTIME ENRICHMENT
// Complète runtime_minutes sur les entrées du journal qui ne l'ont pas
// (typiquement les entrées importées), pour des stats de temps de
// visionnage fiables. Tourne en tâche de fond après import / ouverture.
// ============================================

const RuntimeEnrichment = {
  _seasonCache: new Map(), // `${tmdbId}_${season}` -> Map(episodeNumber -> runtime)
  _movieCache: new Map(), // tmdbId -> runtime

  _sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  },

  async _getMovieRuntime(tmdbId) {
    if (this._movieCache.has(tmdbId)) return this._movieCache.get(tmdbId);
    let runtime = null;
    try {
      const data = await TMDB.getMovie(tmdbId);
      runtime = data.runtime || null;
    } catch {
      /* ignoré */
    }
    this._movieCache.set(tmdbId, runtime);
    return runtime;
  },

  async _getSeasonRuntimes(tmdbId, season) {
    const key = `${tmdbId}_${season}`;
    if (this._seasonCache.has(key)) return this._seasonCache.get(key);
    const map = new Map();
    try {
      const data = await TMDB.getSeason(tmdbId, season);
      (data.episodes || []).forEach((ep) => map.set(ep.episode_number, ep.runtime || null));
    } catch {
      /* ignoré */
    }
    this._seasonCache.set(key, map);
    return map;
  },

  // Complète les entrées manquantes, met à jour Supabase, retourne le
  // nombre d'entrées effectivement enrichies.
  async run(diary, onProgress) {
    const missing = diary.filter((e) => !e.runtime_minutes && e.tmdb_id);
    if (missing.length === 0) return 0;

    let enriched = 0;
    let done = 0;

    for (const entry of missing) {
      let runtime = null;
      if (entry.media_type === "movie") {
        runtime = await this._getMovieRuntime(entry.tmdb_id);
        await this._sleep(50);
      } else if (entry.season != null && entry.episode != null) {
        const seasonMap = await this._getSeasonRuntimes(entry.tmdb_id, entry.season);
        runtime = seasonMap.get(entry.episode) || null;
        await this._sleep(50);
      }

      if (runtime) {
        try {
          await DB.updateDiaryEntryRuntime(entry.id, runtime);
          entry.runtime_minutes = runtime; // reflète direct dans l'objet en mémoire
          enriched++;
        } catch {
          /* ignoré, on continue avec les autres entrées */
        }
      }

      done++;
      if (done % 20 === 0) onProgress?.(`Durées : ${done}/${missing.length}…`);
    }

    return enriched;
  },
};
