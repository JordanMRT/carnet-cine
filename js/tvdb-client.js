// ============================================
// TVDB CLIENT — passe par l'Edge Function Supabase (jamais d'appel
// direct à TheTVDB depuis le navigateur, la clé reste secrète côté serveur)
// ============================================

const TVDBProxy = {
  async getCharacters(mediaType, tvdbId) {
    const { data, error } = await supabaseClient.functions.invoke("tvdb-proxy", {
      body: { mediaType, tvdbId },
    });
    if (error) throw error;
    return data?.characters || [];
  },

  async search(mediaType, query) {
    const { data, error } = await supabaseClient.functions.invoke("tvdb-proxy", {
      body: { action: "search", mediaType, query },
    });
    if (error) throw error;
    return data?.results || [];
  },
};

// Cache mémoire (le temps de la session) pour éviter de re-résoudre le
// même titre plusieurs fois.
const _tvdbIdCache = new Map();

// Retrouve l'id TheTVDB pour un titre TMDB. Fiable pour les séries (via
// external_ids), en repli par recherche de titre pour les films (TMDB ne
// fournit presque jamais le tvdb_id des films).
async function resolveTvdbId(mediaType, tmdbId, title) {
  const cacheKey = `${mediaType}_${tmdbId}`;
  if (_tvdbIdCache.has(cacheKey)) return _tvdbIdCache.get(cacheKey);

  let tvdbId = null;
  try {
    const externalIds = await TMDB.getExternalIds(mediaType === "movie" ? "movie" : "tv", tmdbId);
    if (externalIds.tvdb_id) tvdbId = externalIds.tvdb_id;
  } catch {
    // ignoré, on tente la recherche par titre ci-dessous
  }

  if (!tvdbId && title) {
    try {
      const results = await TVDBProxy.search(mediaType, title);
      if (results.length) tvdbId = results[0].tvdbId;
    } catch {
      // ignoré : pas de correspondance trouvée, on restera sur TMDB
    }
  }

  _tvdbIdCache.set(cacheKey, tvdbId);
  return tvdbId;
}

const _castDisplayCache = new Map();
// Casting à afficher : personnages TheTVDB (image du personnage, acteur
// en repli) si disponibles, sinon casting TMDB classique.
// mediaType attendu ici : "movie" | "series"
async function getCastForDisplay(mediaType, tmdbId, title, tmdbCastFallback) {
  const cacheKey = `${mediaType}_${tmdbId}`;
  if (_castDisplayCache.has(cacheKey)) return _castDisplayCache.get(cacheKey);

  // Normalise un nom pour matcher "Jean Dujardin" côté TVDB avec le même
  // acteur côté TMDB, malgré d'éventuels accents/espaces différents.
  const normalizeName = (n) =>
    (n || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .trim();

  const fallbackByName = new Map(
    (tmdbCastFallback || []).map((a) => [normalizeName(a.name), a.id])
  );

  const result = await (async () => {
    try {
      const tvdbId = await resolveTvdbId(mediaType, tmdbId, title);
      if (tvdbId) {
        const characters = await TVDBProxy.getCharacters(mediaType, tvdbId);
        if (characters.length) {
          return characters
            .filter((c) => c.characterImage || c.personImage)
            .map((c) => ({
              image: c.characterImage || c.personImage,
              name: c.personName || "?",
              role: c.characterName || "",
              tmdbPersonId: fallbackByName.get(normalizeName(c.personName)) || null,
            }));
        }
      }
    } catch {
      // TheTVDB indisponible pour ce titre : on retombe sur TMDB
    }
    return (tmdbCastFallback || [])
      .filter((a) => a.profile_path)
      .map((a) => ({
        image: TMDB.posterUrl(a.profile_path, "w185"),
        name: a.name,
        role: a.character || "",
        tmdbPersonId: a.id,
      }));
  })();

  _castDisplayCache.set(cacheKey, result);
  return result;
}