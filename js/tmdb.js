// ============================================
// TMDB — recherche et récupération des métadonnées
// ============================================

const TMDB_BASE = "https://api.themoviedb.org/3";

async function tmdbFetch(path, params = {}) {
  const url = new URL(TMDB_BASE + path);
  url.searchParams.set("api_key", CONFIG.TMDB_API_KEY);
  url.searchParams.set("language", "fr-FR");
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Erreur TMDB (${res.status})`);
  return res.json();
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

  return promise;
},

async getReleaseDates(id) {

  if (this._releaseDatesCache.has(id)) {
    return this._releaseDatesCache.get(id);
  }

  const promise = tmdbFetch(`/movie/${id}/release_dates`);

  this._releaseDatesCache.set(id, promise);

  return promise;
},

  async getTv(id) {

  if (this._tvCache.has(id)) {
    return this._tvCache.get(id);
  }

  const promise = tmdbFetch(`/tv/${id}`, {
    append_to_response: "credits"
  });

  this._tvCache.set(id, promise);

  return promise;
},

  async getSeason(tvId, seasonNumber) {

  const key = `${tvId}_${seasonNumber}`;

  if (this._seasonCache.has(key)) {
    return this._seasonCache.get(key);
  }

  const promise = tmdbFetch(`/tv/${tvId}/season/${seasonNumber}`);

  this._seasonCache.set(key, promise);

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

  return promise;
},

  async getExternalIds(mediaType, id) {

  const key = `${mediaType}_${id}`;

  if (this._externalIdsCache.has(key)) {
    return this._externalIdsCache.get(key);
  }

  const promise = tmdbFetch(`/${mediaType}/${id}/external_ids`);

  this._externalIdsCache.set(key, promise);

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
