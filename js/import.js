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
        title: resolveDisplayTitle(show.name, show.original_name, show.original_language),
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
        title: resolveDisplayTitle(movie.title, movie.original_title, movie.original_language),
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
            title: resolveDisplayTitle(found.name, found.original_name, found.original_language),
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
            title: resolveDisplayTitle(found.title, found.original_title, found.original_language),
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

// ============================================
// EXPORT — génère un ZIP réimportable via les boutons
// "Importer mes séries" / "Importer mes films" ci-dessus, sans toucher à
// leur logique : on reconstruit simplement les CSV au format GDPR TV Time
// (mêmes colonnes que tracking-prod-records-v2.csv / tracking-prod-records.csv)
// à partir d'App.diary.
//
// ⚠️ Le format CSV ne porte pas de champ rating : seul le rewatch est
// préservé (voir importShowsCsvRows / importMoviesCsvRows ci-dessus, qui
// forcent `rating: null`). C'est un choix assumé : les entrées rewatch
// n'ont de toute façon jamais de rating dans l'app (voir logMediaEntry),
// donc c'était rating (JSON) ou rewatch (CSV), pas les deux à la fois.
// ============================================

// Charge JSZip à la demande seulement (~30 Ko gzippés) : inutile d'alourdir
// le chargement de l'app pour une action qu'on fait rarement. Le navigateur
// mettra ensuite le script en cache HTTP pour les exports suivants.
let jszipLoadPromise = null;
function loadJSZip() {
  if (typeof JSZip !== "undefined") return Promise.resolve();
  if (jszipLoadPromise) return jszipLoadPromise;
  jszipLoadPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js";
    script.onload = () => resolve();
    script.onerror = () => {
      jszipLoadPromise = null;
      reject(new Error("Impossible de charger l'outil de compression (JSZip)."));
    };
    document.head.appendChild(script);
  });
  return jszipLoadPromise;
}

// Colonnes calquées sur tracking-prod-records-v2.csv (voir importShowsCsvRows).
function buildShowsCsv(diary) {
  const rows = diary
    .filter((e) => e.media_type === "tv" && e.season != null && e.episode != null)
    .map((e) => ({
      key: `${e.rewatch ? "rewatch" : "watch"}-episode-${e.id}`,
      series_name: e.title || "",
      s_id: String(e.tmdb_id ?? ""),
      season_number: e.season,
      episode_number: e.episode,
      created_at: `${e.watched_date}T00:00:00.000Z`,
      runtime: e.runtime_minutes ? e.runtime_minutes * 60 : "",
    }));
  return Papa.unparse(rows, { columns: ["key", "series_name", "s_id", "season_number", "episode_number", "created_at", "runtime"] });
}

// Colonnes calquées sur tracking-prod-records.csv (voir importMoviesCsvRows).
// On ajoute une ligne "follow" par film avec sa release_date : c'est ce que
// importMoviesCsvRows utilise comme indice d'année pour désambiguïser la
// résolution TMDB par titre au réimport.
function buildMoviesCsv(diary) {
  const movieEntries = diary.filter((e) => e.media_type === "movie");
  const rows = [];
  const seenTitles = new Set();

  for (const e of movieEntries) {
    if (e.title && e.air_date && !seenTitles.has(e.title)) {
      seenTitles.add(e.title);
      rows.push({
        movie_name: e.title,
        type: "follow",
        created_at: `${e.watched_date}T00:00:00.000Z`,
        release_date: e.air_date,
        runtime: "",
      });
    }
  }

  for (const e of movieEntries) {
    rows.push({
      movie_name: e.title || "",
      type: e.rewatch ? "rewatch" : "watch",
      created_at: `${e.watched_date}T00:00:00.000Z`,
      release_date: e.air_date || "",
      runtime: e.runtime_minutes ? e.runtime_minutes * 60 : "",
    });
  }

  return Papa.unparse(rows, { columns: ["movie_name", "type", "created_at", "release_date", "runtime"] });
}

// Point d'entrée : construit le zip ttb-export-{date}.zip et déclenche le
// téléchargement. `onProgress` est optionnel (ex: pour afficher un toast
// "Préparation de l'export…" pendant le chargement de JSZip).
async function exportDiaryAsZip(diary, onProgress) {
  onProgress?.("Préparation de l'export…");
  await loadJSZip();

  const zip = new JSZip();
  zip.file("ttb-series.csv", buildShowsCsv(diary));
  zip.file("ttb-films.csv", buildMoviesCsv(diary));

  const blob = await zip.generateAsync({ type: "blob" });
  const date = new Date().toISOString().slice(0, 10);
  const filename = `ttb-export-${date}.zip`;

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);

  return filename;
}

// ---------- DÉDOUBLONNAGE ----------
// Aucune contrainte unique en base sur diary_entries : sans ce filtre,
// réimporter un fichier qui recoupe des entrées déjà présentes (son propre
// export, un export TV Time déjà importé avant, etc.) créerait des lignes
// en double. Signature volontairement simple (pas de note de temps précise
// disponible dans ces formats) : media_type + identifiant (tmdb_id, ou titre
// si non résolu) + saison/épisode + date + rewatch.
function diarySignature(e) {
  return [e.media_type, e.tmdb_id ?? e.title, e.season, e.episode, e.watched_date, e.rewatch ? 1 : 0].join("|");
}

// Filtre les entrées déjà présentes dans App.diary (et les doublons internes
// au fichier lui-même), insère le reste, puis met à jour App.diary en
// mémoire directement — sans dépendre d'un App.refresh() ultérieur. Important
// pour l'étape import de l'onboarding, qui enchaîne deux imports
// (séries puis films) avec { refresh: false }.
// Solution de repli en cas d'erreur en cours de route (ex : coupure réseau
// au milieu d'un gros import) : App.diary est mis à jour lot par lot, pas
// seulement à la fin. Si un lot échoue, les lots précédents sont déjà
// synchronisés — donc si l'utilisateur relance le même fichier, le filtre
// de signature ci-dessus ignorera automatiquement ce qui a déjà été inséré,
// sans créer de doublon.
async function insertNewEntriesOnly(entries) {
  const existing = new Set(App.diary.map(diarySignature));
  const seenInBatch = new Set();
  const toInsert = [];
  for (const entry of entries) {
    const sig = diarySignature(entry);
    if (existing.has(sig) || seenInBatch.has(sig)) continue;
    seenInBatch.add(sig);
    toInsert.push(entry);
  }

  const skipped = entries.length - toInsert.length;
  if (toInsert.length === 0) return { inserted: 0, skipped };

  let insertedSoFar = 0;
  try {
    const { rows } = await DB.bulkInsertDiary(toInsert, (chunkRows) => {
      App.diary.push(...chunkRows);
      insertedSoFar += chunkRows.length;
    });
    return { inserted: rows.length, skipped };
  } catch (err) {
    if (insertedSoFar > 0) {
      err.message = `${err.message} (${insertedSoFar} entrée(s) déjà enregistrée(s) avant l'erreur — tu peux relancer le même fichier sans risque de doublon.)`;
    }
    throw err;
  }
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
      const { inserted, skipped } = await insertNewEntriesOnly(result.entries);
      return { inserted, skipped, unresolved: result.unresolvedShows };
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
    const { inserted, skipped } = await insertNewEntriesOnly(result.entries);
    return { inserted, skipped, unresolved: result.unresolvedMovies };
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
  const { inserted, skipped } = await insertNewEntriesOnly(result.entries);
  const unresolved = result.unresolvedShows || result.unresolvedMovies || [];
  return { inserted, skipped, unresolved };
}
