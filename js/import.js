// ============================================
// IMPORT — export TV Time réel (format GDPR)
// ============================================
//
// Deux imports séparés : un pour les séries, un pour les films,
// car TV Time exporte ces deux catégories dans des structures différentes.
//
// SÉRIES : tableau d'objets { uuid, id: { tvdb, imdb }, seasons: [
//            { number, episodes: [{ id: { tvdb, imdb }, number, special,
//              is_watched, watched_at, rating }] } ] }
//   ⚠️ Le nom de la série n'apparaît pas dans cette structure : on le
//   récupère automatiquement via TMDB en résolvant l'id TheTVDB.
//
// FILMS : tableau d'objets { id: { tvdb, imdb }, created_at, uuid,
//           title, watched_at, is_watched, rating }

const importCache = new Map(); // évite de refaire un appel TMDB pour le même show/film

async function resolveTvdbShow(tvdbId) {
  if (importCache.has(`tv_${tvdbId}`)) return importCache.get(`tv_${tvdbId}`);
  let resolved = null;
  try {
    const found = await TMDB.findExternal(tvdbId, "tvdb_id");
    const show = found.tv_results?.[0];
    if (show) {
      resolved = {
        tmdb_id: show.id,
        title: show.name,
        poster_path: show.poster_path,
        genres: (show.genre_ids || []).map(String),
      };
    }
  } catch {
    /* ignoré : géré via le résultat null ci-dessous */
  }
  importCache.set(`tv_${tvdbId}`, resolved);
  return resolved;
}

async function resolveImdbMovie(imdbId) {
  if (importCache.has(`mv_${imdbId}`)) return importCache.get(`mv_${imdbId}`);
  let resolved = null;
  try {
    const found = await TMDB.findExternal(imdbId, "imdb_id");
    const movie = found.movie_results?.[0];
    if (movie) {
      resolved = {
        tmdb_id: movie.id,
        title: movie.title,
        poster_path: movie.poster_path,
        genres: (movie.genre_ids || []).map(String),
      };
    }
  } catch {
    /* ignoré */
  }
  importCache.set(`mv_${imdbId}`, resolved);
  return resolved;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ---------- IMPORT SÉRIES ----------
async function importShowsExport(rawArray, userId, onProgress) {
  const entries = [];
  const unresolvedShows = [];
  const uniqueTvdbIds = [...new Set(rawArray.map((s) => s.id?.tvdb).filter((id) => id && id !== -1))];

  onProgress?.(`Résolution de ${uniqueTvdbIds.length} série(s) sur TMDB…`);
  let done = 0;
  for (const tvdbId of uniqueTvdbIds) {
    await resolveTvdbShow(tvdbId);
    done++;
    if (done % 10 === 0) onProgress?.(`${done}/${uniqueTvdbIds.length} séries résolues…`);
    await sleep(60); // ménage l'API TMDB
  }

  for (const show of rawArray) {
    const tvdbId = show.id?.tvdb;
    const resolved = tvdbId ? importCache.get(`tv_${tvdbId}`) : null;
    if (!resolved) unresolvedShows.push(show.uuid || tvdbId || "id inconnu");

    for (const season of show.seasons || []) {
      for (const ep of season.episodes || []) {
        if (!ep.is_watched || !ep.watched_at) continue;
        entries.push({
          user_id: userId,
          tmdb_id: resolved?.tmdb_id ?? null,
          media_type: "tv",
          title: resolved?.title ?? `Série inconnue (tvdb ${tvdbId ?? "?"})`,
          poster_path: resolved?.poster_path ?? null,
          season: season.number,
          episode: ep.number,
          watched_date: ep.watched_at.slice(0, 10),
          rating: ep.rating ?? null,
          rewatch: false,
          note: null,
          genres: resolved?.genres ?? [],
          runtime_minutes: null,
        });
      }
    }
  }

  return { entries, unresolvedShows };
}

// ---------- IMPORT FILMS ----------
async function importMoviesExport(rawArray, userId, onProgress) {
  const entries = [];
  const unresolvedMovies = [];

  onProgress?.(`Résolution de ${rawArray.length} film(s) sur TMDB…`);
  let done = 0;
  for (const movie of rawArray) {
    if (!movie.is_watched || !movie.watched_at) {
      done++;
      continue;
    }
    const imdbId = movie.id?.imdb;
    let resolved = null;
    if (imdbId && imdbId !== "-1") {
      resolved = await resolveImdbMovie(imdbId);
      await sleep(60);
    }
    if (!resolved) unresolvedMovies.push(movie.title || movie.uuid);

    entries.push({
      user_id: userId,
      tmdb_id: resolved?.tmdb_id ?? null,
      media_type: "movie",
      title: resolved?.title ?? movie.title ?? "Film inconnu",
      poster_path: resolved?.poster_path ?? null,
      season: null,
      episode: null,
      watched_date: movie.watched_at.slice(0, 10),
      rating: movie.rating ?? null,
      rewatch: false,
      note: null,
      genres: resolved?.genres ?? [],
      runtime_minutes: null,
    });

    done++;
    if (done % 10 === 0) onProgress?.(`${done}/${rawArray.length} films traités…`);
  }

  return { entries, unresolvedMovies };
}

// ---------- POINT D'ENTRÉE COMMUN ----------
async function handleImportFile(file, userId, kind, onProgress) {
  const text = await file.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error("Le fichier n'est pas un JSON valide.");
  }
  const rawArray = Array.isArray(json) ? json : json.shows || json.movies || json.data || [];
  if (!Array.isArray(rawArray) || rawArray.length === 0) {
    throw new Error("Impossible de trouver un tableau d'entrées dans ce fichier.");
  }

  const result =
    kind === "shows"
      ? await importShowsExport(rawArray, userId, onProgress)
      : await importMoviesExport(rawArray, userId, onProgress);

  if (result.entries.length === 0) {
    throw new Error("Aucune entrée regardée (is_watched: true) trouvée dans ce fichier.");
  }

  onProgress?.(`Écriture de ${result.entries.length} entrées dans le journal…`);
  const inserted = await DB.bulkInsertDiary(result.entries);
  const unresolved = result.unresolvedShows || result.unresolvedMovies || [];
  return { inserted, unresolved };
}
