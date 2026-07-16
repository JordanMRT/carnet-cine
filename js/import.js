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
        title: show.original_name || show.name,
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
        title: movie.original_title || movie.title,
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

// Parse un fichier CSV (export GDPR TV Time) via PapaParse. Contrairement au
// JSON, ce format ne fournit aucun id externe (TheTVDB/IMDb) : la résolution
// se fait par titre (± année) sur TMDB, moins fiable que par id mais c'est
// la seule option disponible dans ces fichiers.
function parseCsvFile(file) {
  return new Promise((resolve, reject) => {
    if (typeof Papa === "undefined") {
      reject(new Error("PapaParse n'est pas chargé."));
      return;
    }
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => resolve(results),
      error: (err) => reject(err),
    });
  });
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

// ---------- IMPORT SÉRIES (CSV, export GDPR : tracking-prod-records-v2.csv) ----------
// Une ligne par événement "épisode vu"/"épisode revu", avec date exacte.
// Pas d'id TheTVDB ici : résolution par titre (le nom de série contient
// parfois "(AAAA)" pour désambiguïser, ex. "Osmosis (2019)").
async function importShowsCsvRows(rows, userId, onProgress) {
  const entries = [];
  const unresolvedShows = [];

  const watchRows = rows.filter(
    (r) => r.key && (r.key.startsWith("watch-episode-") || r.key.startsWith("rewatch-episode-"))
  );

  const showsById = new Map();
  for (const r of watchRows) {
    if (!r.s_id || showsById.has(r.s_id)) continue;
    const match = /^(.*)\s\((\d{4})\)$/.exec((r.series_name || "").trim());
    showsById.set(r.s_id, {
      rawName: r.series_name,
      title: match ? match[1] : r.series_name,
      year: match ? match[2] : null,
    });
  }

  const uniqueIds = [...showsById.keys()];
  onProgress?.(`Résolution de ${uniqueIds.length} série(s) sur TMDB…`);
  let done = 0;
  for (const sId of uniqueIds) {
    const cacheKey = `tvtitle_${sId}`;
    if (!importCache.has(cacheKey)) {
      const { title, year } = showsById.get(sId);
      let resolved = null;
      try {
        const found = await TMDB.searchTvByTitle(title, year);
        if (found) {
          resolved = {
            tmdb_id: found.id,
            title: found.original_name || found.name,
            poster_path: found.poster_path,
            genres: (found.genre_ids || []).map(String),
          };
        }
      } catch {
        /* laisse resolved à null */
      }
      importCache.set(cacheKey, resolved);
      await sleep(60); // ménage l'API TMDB
    }
    done++;
    if (done % 10 === 0) onProgress?.(`${done}/${uniqueIds.length} séries résolues…`);
  }

  for (const r of watchRows) {
    if (!r.created_at || !r.season_number || !r.episode_number) continue;
    const resolved = importCache.get(`tvtitle_${r.s_id}`);
    if (!resolved) {
      const label = showsById.get(r.s_id)?.rawName || r.s_id;
      if (!unresolvedShows.includes(label)) unresolvedShows.push(label);
    }
    entries.push({
      user_id: userId,
      tmdb_id: resolved?.tmdb_id ?? null,
      media_type: "tv",
      title: resolved?.title ?? showsById.get(r.s_id)?.title ?? "Série inconnue",
      poster_path: resolved?.poster_path ?? null,
      season: Number(r.season_number),
      episode: Number(r.episode_number),
      watched_date: r.created_at.slice(0, 10),
      rating: null,
      rewatch: r.key.startsWith("rewatch-episode-"),
      note: null,
      genres: resolved?.genres ?? [],
      runtime_minutes: r.runtime ? Math.round(Number(r.runtime) / 60) : null,
    });
  }

  return { entries, unresolvedShows };
}

// ---------- IMPORT FILMS (CSV, export GDPR : tracking-prod-records.csv) ----------
// Une ligne par événement "film vu"/"film revu". Les lignes "follow" du même
// fichier donnent parfois une release_date : utilisée comme indice d'année
// pour désambiguïser la recherche TMDB des lignes "watch" (qui n'ont pas
// cette info directement).
async function importMoviesCsvRows(rows, userId, onProgress) {
  const entries = [];
  const unresolvedMovies = [];

  const yearHints = new Map();
  for (const r of rows) {
    if (r.type === "follow" && r.movie_name && r.release_date) {
      const year = r.release_date.slice(0, 4);
      if (/^\d{4}$/.test(year)) yearHints.set(r.movie_name, year);
    }
  }

  const watchRows = rows.filter(
    (r) => r.movie_name && (r.type === "watch" || r.type === "rewatch") && r.created_at
  );

  const uniqueTitles = [...new Set(watchRows.map((r) => r.movie_name))];
  onProgress?.(`Résolution de ${uniqueTitles.length} film(s) sur TMDB…`);
  let done = 0;
  for (const title of uniqueTitles) {
    const cacheKey = `movietitle_${title}`;
    if (!importCache.has(cacheKey)) {
      let resolved = null;
      try {
        const found = await TMDB.searchMovieByTitle(title, yearHints.get(title));
        if (found) {
          resolved = {
            tmdb_id: found.id,
            title: found.original_title || found.title,
            poster_path: found.poster_path,
            genres: (found.genre_ids || []).map(String),
          };
        }
      } catch {
        /* laisse resolved à null */
      }
      importCache.set(cacheKey, resolved);
      await sleep(60);
    }
    done++;
    if (done % 10 === 0) onProgress?.(`${done}/${uniqueTitles.length} films résolus…`);
  }

  for (const r of watchRows) {
    const resolved = importCache.get(`movietitle_${r.movie_name}`);
    if (!resolved && !unresolvedMovies.includes(r.movie_name)) unresolvedMovies.push(r.movie_name);

    entries.push({
      user_id: userId,
      tmdb_id: resolved?.tmdb_id ?? null,
      media_type: "movie",
      title: resolved?.title ?? r.movie_name,
      poster_path: resolved?.poster_path ?? null,
      season: null,
      episode: null,
      watched_date: r.created_at.slice(0, 10),
      rating: null,
      rewatch: r.type === "rewatch",
      note: null,
      genres: resolved?.genres ?? [],
      runtime_minutes: r.runtime ? Math.round(Number(r.runtime) / 60) : null,
    });
  }

  return { entries, unresolvedMovies };
}

// ---------- POINT D'ENTRÉE COMMUN ----------
async function handleImportFile(file, userId, kind, onProgress) {
  const isCsv = file.name.toLowerCase().endsWith(".csv");

  if (isCsv) {
    const { data, meta, errors } = await parseCsvFile(file);
    if (errors?.length) console.warn("Avertissements PapaParse :", errors);
    const fields = meta.fields || [];

    if (kind === "shows") {
      const required = ["key", "series_name", "s_id", "season_number", "episode_number", "created_at"];
      if (!required.every((f) => fields.includes(f))) {
        throw new Error(
          'Ce CSV ne correspond pas au fichier attendu pour les séries. Dans ton export GDPR TV Time, sélectionne "tracking-prod-records-v2.csv".'
        );
      }
      const result = await importShowsCsvRows(data, userId, onProgress);
      if (result.entries.length === 0) {
        throw new Error("Aucun épisode vu trouvé dans ce fichier.");
      }
      onProgress?.(`Écriture de ${result.entries.length} entrées dans le journal…`);
      const inserted = await DB.bulkInsertDiary(result.entries);
      return { inserted, unresolved: result.unresolvedShows };
    }

    const required = ["movie_name", "type", "created_at"];
    if (!required.every((f) => fields.includes(f))) {
      throw new Error(
        'Ce CSV ne correspond pas au fichier attendu pour les films. Dans ton export GDPR TV Time, sélectionne "tracking-prod-records.csv".'
      );
    }
    const result = await importMoviesCsvRows(data, userId, onProgress);
    if (result.entries.length === 0) {
      throw new Error('Aucun film vu (type "watch"/"rewatch") trouvé dans ce fichier.');
    }
    onProgress?.(`Écriture de ${result.entries.length} entrées dans le journal…`);
    const inserted = await DB.bulkInsertDiary(result.entries);
    return { inserted, unresolved: result.unresolvedMovies };
  }

  // ---- JSON (comportement existant, inchangé) ----
  const text = await file.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error("Le fichier n'est ni un JSON ni un CSV valide.");
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
