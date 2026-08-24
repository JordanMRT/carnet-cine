// ============================================
// TMDB — recherche et récupération des métadonnées
// ============================================

const TMDB_BASE = "https://api.themoviedb.org/3";

/**
 * TMDB fetch avec timeout, retry, et gestion intelligente des erreurs.
 * - timeout de 8 s par tentative (AbortController)
 * - jusqu'à 3 tentatives (essai initial + 2 retries)
 * - back‑off progressif (500 ms, 1 s, 2 s)
 * - retry uniquement sur : erreurs de réseau, timeout, 5xx, 429
 * - ne pas retry sur 4xx autres que 429 (ex. 404, 400, 401, 403)
 */
async function tmdbFetch(path, params = {}) {
  const url = new URL(TMDB_BASE + path);
  url.searchParams.set("api_key", CONFIG.TMDB_API_KEY);
  url.searchParams.set("language", "fr-FR");
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));

  const maxAttempts = 3;          // 1 essai + 2 nouvelles tentatives
  const baseDelay = 500;          // ms

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);

    try {
      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(timeoutId);

      if (response.ok) {
        return await response.json();
      }

      // Décider si on doit réessayer en fonction du statut
      const status = response.status;
      const shouldRetry =
        status === 429 || // dépassement de quota
        (status >= 500);  // erreurs serveur

      // Pour les erreurs 4xx autres que 429, on considère l'erreur comme définitive
      if (!shouldRetry) {
        throw new Error(`Erreur TMDB (${status})`);
      }
      // sinon poursuivre vers la gestion des nouvelles tentatives
    } catch (err) {
      clearTimeout(timeoutId);
      const isTimeout = err.name === 'AbortError';
      const isNetworkError = err instanceof TypeError; // échec de fetch

      // Déterminer si on doit réessayer cette erreur
      const shouldRetry =
        isTimeout ||
        isNetworkError ||
        (err instanceof Error &&
          err.message.startsWith('Erreur TMDB (') &&
          // extraire le code de statut du message s'il est présent
          ['429', ...Array.from({ length: 10 }, (_, i) => 500 + i)].includes(
            err.message.match(/\((\d+)\)/)?.[1] ?? ''
          ));

      // Si c'était la dernière tentative ou si l'erreur n'est pas réessayable, relancer l'erreur
      if (attempt === maxAttempts - 1 || !shouldRetry) {
        // Préserver la même forme d'erreur qu'auparavant
        if (err.name === 'AbortError') {
          throw new Error('Requête TMDB timeout');
        }
        if (err instanceof Error && err.message.startsWith('Erreur TMDB (')) {
          throw err;
        }
        throw new Error(`Erreur TMDB (${err.message || 'unknown'})`);
      }

      // Attendre avant la prochaine tentative (back‑off exponentiel)
      await new Promise(resolve =>
        setTimeout(resolve, baseDelay * Math.pow(2, attempt))
      );
    }
  }
}

const TMDB = {
  _genreCache: { movie: null, tv: null },

  _movieCache: new Map(),
  _tvCache: new Map(),
  _seasonCache: new Map(),
  _imagesCache: new Map(),
  _externalIdsCache: new Map(),
  _aggregateCreditsCache: new Map(),
  _releaseDatesCache: new Map(),
  _personCache: new Map(),
  _recommendationsCache: new Map(),
  _watchProvidersCache: new Map(),

  // Résout les ids de genre TMDB en noms lisibles (mis en cache).
  // mediaType: "movie" | "tv"
  async getGenreMap(mediaType) {
    if (this._genreCache[mediaType]) return this._genreCache[mediaType];
    const data = await tmdbFetch(`/genre/${mediaType}/list`);
    const map = {};
    (data.genres || []).forEach((g) => (map[g.id] = g.name));
    this._genreCache[mediaType] = map;
    return map;
  },

  async searchMulti(query, page = 1) {
    const data = await tmdbFetch("/search/multi", { query, page, include_adult: false });
    return data.results.filter((r) => r.media_type === "movie" || r.media_type === "tv");
  },

  // Affiche les recommandations + les service providers
  // mediaType: "movie" | "tv"

  async getRecommendations(mediaType, id) {
    const key = `${mediaType}_${id}`;

    if (this._recommendationsCache.has(key)) {
      return this._recommendationsCache.get(key);
    }

    const path = mediaType === "movie" ? `/movie/${id}/recommendations` : `/tv/${id}/recommendations`;
    const promise = tmdbFetch(path).then((data) => data.results || []);

    this._recommendationsCache.set(key, promise);
    promise.catch(() => this._recommendationsCache.delete(key));

    return promise;
  },

  async getWatchProviders(mediaType, id) {
    const key = `${mediaType}_${id}`;

    if (this._watchProvidersCache.has(key)) {
      return this._watchProvidersCache.get(key);
    }

    const path = mediaType === "movie" ? `/movie/${id}/watch/providers` : `/tv/${id}/watch/providers`;
    const promise = tmdbFetch(path).then((data) => data.results?.FR || null);

    this._watchProvidersCache.set(key, promise);
    promise.catch(() => this._watchProvidersCache.delete(key));

    return promise;
  },

  // Résolution par titre (± année) : utilisée pour l'import CSV (export GDPR
  // TV Time), qui ne fournit aucun id externe (TheTVDB/IMDb), contrairement
  // au JSON. On retente sans l'année si la recherche filtrée ne donne rien.
  async searchMovieByTitle(title, year) {
    if (year) {
      const withYear = await tmdbFetch("/search/movie", { query: title, year, include_adult: false });
      if (withYear.results?.[0]) return withYear.results[0];
    }
    const data = await tmdbFetch("/search/movie", { query: title, include_adult: false });
    return data.results?.[0] ?? null;
  },

  async searchTvByTitle(title, year) {
    if (year) {
      const withYear = await tmdbFetch("/search/tv", {
        query: title,
        first_air_date_year: year,
        include_adult: false,
      });
      if (withYear.results?.[0]) return withYear.results[0];
    }
    const data = await tmdbFetch("/search/tv", { query: title, include_adult: false });
    return data.results?.[0] ?? null;
  },

  async getMovie(id) {

    if (this._movieCache.has(id)) {
      return this._movieCache.get(id);
    }

    const promise = (async () => {

      const movie = await tmdbFetch(`/movie/${id}`, {
        append_to_response: "credits"
      });

      try {

        const releases = await this.getReleaseDates(id);

        // On privilégie les dates de sortie publiques dans les principaux pays
        // francophones puis anglophones afin d'ignorer les avant-premières,
        // festivals et sorties anticipées dans certains territoires.
        const preferredCountries = ["FR", "BE", "CH", "CA", "US", "GB"];

        let bestDate = null;

        for (const countryCode of preferredCountries) {

          const country = releases.results.find(
            r => r.iso_3166_1 === countryCode
          );

          if (!country) continue;

          const publicRelease = country.release_dates.find(
            rd => rd.type === 3 || rd.type === 4
          );

          if (publicRelease) {
            bestDate = publicRelease.release_date.slice(0, 10);
            break;
          }
        }

        if (bestDate) {
          movie.release_date = bestDate;
        }

      } catch (e) {
        console.warn("Impossible de déterminer la meilleure date de sortie :", e);
      }

      return movie;

    })();

    this._movieCache.set(id, promise);
    promise.catch(() => this._movieCache.delete(id));

    return promise;
  },

  async getReleaseDates(id) {

    if (this._releaseDatesCache.has(id)) {
      return this._releaseDatesCache.get(id);
    }

    const promise = tmdbFetch(`/movie/${id}/release_dates`);

    this._releaseDatesCache.set(id, promise);
    promise.catch(() => this._releaseDatesCache.delete(id));

    return promise;
  },

  async getTv(id, forceRefresh = false) {

    if (!forceRefresh && this._tvCache.has(id)) {
      return this._tvCache.get(id);
    }

    const promise = tmdbFetch(`/tv/${id}`, {
      append_to_response: "credits"
    });

    this._tvCache.set(id, promise);
    promise.catch(() => this._tvCache.delete(id));

    return promise;
  },

  async getSeason(tvId, seasonNumber) {

    const key = `${tvId}_${seasonNumber}`;

    if (this._seasonCache.has(key)) {
      return this._seasonCache.get(key);
    }

    const promise = tmdbFetch(`/tv/${tvId}/season/${seasonNumber}`);

    this._seasonCache.set(key, promise);
    promise.catch(() => this._seasonCache.delete(key));

    return promise;
  },

  async getImages(mediaType, id) {

    const key = `${mediaType}_${id}`;

    if (this._imagesCache.has(key)) {
      return this._imagesCache.get(key);
    }

    const promise = tmdbFetch(`/${mediaType}/${id}/images`, {
      include_image_language: "en,fr,null"
    });

    this._imagesCache.set(key, promise);
    promise.catch(() => this._imagesCache.delete(key));

    return promise;
  },

  // Pour les séries : contrairement à /tv/{id}?append_to_response=credits
  // (qui renvoie un instantané limité), cet endpoint agrège le casting
  // sur l'ensemble des épisodes diffusés — plus complet.
  async getAggregateCredits(tvId) {

    if (this._aggregateCreditsCache.has(tvId)) {
      return this._aggregateCreditsCache.get(tvId);
    }

    const promise = tmdbFetch(`/tv/${tvId}/aggregate_credits`);

    this._aggregateCreditsCache.set(tvId, promise);
    promise.catch(() => this._aggregateCreditsCache.delete(tvId));

    return promise;
  },

  // Fiche comédien + filmographie complète (films + séries), utilisée
  // par la page acteur ouverte depuis un cast-card.
  async getPerson(id) {

    if (this._personCache.has(id)) {
      return this._personCache.get(id);
    }

    const promise = tmdbFetch(`/person/${id}`, {
      append_to_response: "combined_credits"
    });

    this._personCache.set(id, promise);
    promise.catch(() => this._personCache.delete(id));

    return promise;
  },

  async getExternalIds(mediaType, id) {

    const key = `${mediaType}_${id}`;

    if (this._externalIdsCache.has(key)) {
      return this._externalIdsCache.get(key);
    }

    const promise = tmdbFetch(`/${mediaType}/${id}/external_ids`);

    this._externalIdsCache.set(key, promise);
    promise.catch(() => this._externalIdsCache.delete(key));

    return promise;
  },

  async getTrending(mediaType = "all", window = "week") {
    const data = await tmdbFetch(`/trending/${mediaType}/${window}`);
    return data.results;
  },

  // Convertit un id externe (TheTVDB pour les séries, IMDb pour les films)
  // en fiche TMDB. external_source: "tvdb_id" | "imdb_id"
  async findExternal(externalId, externalSource) {
    const data = await tmdbFetch(`/find/${externalId}`, { external_source: externalSource });
    return data;
  },

  posterUrl(path, size = "w500") {
    if (!path) return "assets/poster-placeholder.svg";
    return `${CONFIG.TMDB_IMG_BASE}${size}${path}`;
  },

  backdropUrl(path, size = "w1280") {
    if (!path) return "";
    return `${CONFIG.TMDB_IMG_BASE}${size}${path}`;
  },
};