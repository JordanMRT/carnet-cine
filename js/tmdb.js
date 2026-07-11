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
    return tmdbFetch(`/movie/${id}`, { append_to_response: "credits" });
  },

  async getTv(id) {
    return tmdbFetch(`/tv/${id}`, { append_to_response: "credits" });
  },

  async getSeason(tvId, seasonNumber) {
    return tmdbFetch(`/tv/${tvId}/season/${seasonNumber}`);
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
