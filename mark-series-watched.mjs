#!/usr/bin/env node
// ============================================
// mark-series-watched.mjs
//
// Génère le SQL à coller dans Supabase > SQL Editor pour marquer TOUS
// les épisodes déjà diffusés d'une série comme vus, à leur date de
// diffusion TMDB. Usage exceptionnel (import d'historique), en dehors
// de l'app.
//
// Usage :
//   node mark-series-watched.mjs <TMDB_SERIES_ID> <SUPABASE_USER_ID> [--include-specials]
//
// Où trouver ces deux identifiants :
//   - TMDB_SERIES_ID : dans l'URL de la fiche sur themoviedb.org
//     (ex: https://www.themoviedb.org/tv/1396-breaking-bad -> 1396)
//   - SUPABASE_USER_ID : Supabase > Authentication > Users > copie ton
//     "User UID" (colonne id), ou :
//     select id from auth.users where email = 'ton@email.com';
//
// Ne requiert aucune dépendance (Node 18+, fetch natif).
// ============================================

import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));

const [, , seriesIdArg, userIdArg, ...flags] = process.argv;
const includeSpecials = flags.includes("--include-specials");

if (!seriesIdArg || !userIdArg) {
  console.error("Usage : node mark-series-watched.mjs <TMDB_SERIES_ID> <9cf5e60b-8e68-4743-9894-a43e9320d319> [--include-specials]");
  process.exit(1);
}

const seriesId = Number(seriesIdArg);
const userId = userIdArg;

// Récupère la clé TMDB directement depuis js/config.js du projet, pour
// éviter d'avoir à la ressaisir. Si le script est déplacé ailleurs,
// utilise la variable d'env TMDB_API_KEY à la place.
function getTmdbKey() {
  if (process.env.TMDB_API_KEY) return process.env.TMDB_API_KEY;
  const configPath = join(__dirname, "js", "config.js");
  try {
    const raw = readFileSync(configPath, "utf8");
    const match = raw.match(/TMDB_API_KEY:\s*["']([^"']+)["']/);
    if (match) return match[1];
  } catch {
    // pas trouvé, on retombe sur l'erreur ci-dessous
  }
  throw new Error(
    "Clé TMDB introuvable. Lance ce script depuis la racine du projet (à côté de js/config.js), " +
    "ou fournis-la via : TMDB_API_KEY=xxxx node mark-series-watched.mjs ..."
  );
}

const TMDB_KEY = getTmdbKey();
const TMDB_BASE = "https://api.themoviedb.org/3";

async function tmdbGet(path) {
  const url = new URL(TMDB_BASE + path);
  url.searchParams.set("api_key", TMDB_KEY);
  url.searchParams.set("language", "fr-FR");
  const res = await fetch(url);
  if (!res.ok) throw new Error(`TMDB ${path} -> ${res.status}`);
  return res.json();
}

// Échappe les apostrophes pour une insertion sûre dans une chaîne SQL.
function sqlStr(value) {
  if (value == null) return "NULL";
  return `'${String(value).replace(/'/g, "''")}'`;
}

function sqlArray(values) {
  if (!values || !values.length) return "'{}'::text[]";
  return `'{${values.map((v) => String(v).replace(/'/g, "''")).join(",")}}'::text[]`;
}

async function main() {
  const show = await tmdbGet(`/tv/${seriesId}`);
  if (!show || show.success === false) {
    throw new Error(`Série TMDB ${seriesId} introuvable.`);
  }

  const title = show.name;
  const posterPath = show.poster_path;
  const genreIds = (show.genres || []).map((g) => String(g.id));
  const today = new Date().toISOString().slice(0, 10);

  console.error(`Série : ${title} (${show.number_of_seasons} saison(s))`);

  const seasonNumbers = (show.seasons || [])
    .map((s) => s.season_number)
    .filter((n) => includeSpecials || n > 0)
    .sort((a, b) => a - b);

  const rows = [];
  const skipped = [];
  const seasonsFailed = [];

  for (const seasonNumber of seasonNumbers) {
    let season;
    try {
      season = await tmdbGet(`/tv/${seriesId}/season/${seasonNumber}`);
    } catch (err) {
      // Une saison en cours de mise à jour côté TMDB peut renvoyer une
      // erreur (404 si la fiche saison n'est pas encore publiée, ou une
      // erreur réseau transitoire) : on ne bloque pas la génération du SQL
      // pour les autres saisons, on note juste celle-ci comme ignorée.
      seasonsFailed.push(`Saison ${seasonNumber} — ${err.message}`);
      continue;
    }
    for (const ep of season.episodes || []) {
      if (!ep.air_date) {
        skipped.push(`S${seasonNumber}E${ep.episode_number} — pas de date de diffusion`);
        continue;
      }
      if (ep.air_date > today) {
        skipped.push(`S${seasonNumber}E${ep.episode_number} — pas encore diffusé (${ep.air_date})`);
        continue;
      }
      rows.push({
        season: seasonNumber,
        episode: ep.episode_number,
        air_date: ep.air_date,
        runtime: ep.runtime ?? null,
      });
    }
  }

  if (!rows.length) {
    console.error("Aucun épisode diffusé trouvé, rien à générer.");
    return;
  }

  const valuesSQL = rows
    .map(
      (r) =>
        `  (${sqlStr(userId)}::uuid, ${seriesId}, ${sqlStr(title)}, ${sqlStr(posterPath)}, ${r.season}, ${r.episode}, ${sqlStr(r.air_date)}::date, ${sqlArray(genreIds)}, ${r.runtime ?? "NULL"})`
    )
    .join(",\n");

  const sql = `-- Marque ${rows.length} épisode(s) de "${title}" (TMDB ${seriesId}) comme vus
-- à leur date de diffusion. Idempotent : peut être relancé sans créer
-- de doublons ni écraser les épisodes déjà à la bonne date.
--
-- 1) Corrige la watched_date des épisodes déjà présents en base (ex:
--    cochés via l'app au moment où tu as regardé, donc datés à ce
--    jour-là) pour les aligner sur leur date de diffusion réelle.
--    Ne touche ni à la note, ni à la note écrite, ni au flag rewatch.
update diary_entries d
set watched_date = v.air_date, air_date = v.air_date
from (values
${valuesSQL}
) as v(user_id, tmdb_id, title, poster_path, season, episode, air_date, genres, runtime_minutes)
where d.user_id = v.user_id
  and d.tmdb_id = ${seriesId}
  and d.media_type = 'tv'
  and d.season = v.season
  and d.episode = v.episode
  and coalesce(d.rewatch, false) = false
  and d.watched_date is distinct from v.air_date;

-- 2) Insère les épisodes qui n'ont encore aucune entrée en base.
insert into diary_entries (user_id, tmdb_id, media_type, title, poster_path, season, episode, watched_date, rating, rewatch, note, genres, runtime_minutes, air_date)
select v.user_id, ${seriesId}, 'tv', v.title, v.poster_path, v.season, v.episode, v.air_date, null, false, null, v.genres, v.runtime_minutes, v.air_date
from (values
${valuesSQL}
) as v(user_id, tmdb_id, title, poster_path, season, episode, air_date, genres, runtime_minutes)
where not exists (
  select 1 from diary_entries d
  where d.user_id = v.user_id
    and d.tmdb_id = ${seriesId}
    and d.media_type = 'tv'
    and d.season = v.season
    and d.episode = v.episode
);
`;

  console.log(sql);

  if (skipped.length) {
    console.error(`\n${skipped.length} épisode(s) ignoré(s) :`);
    skipped.forEach((s) => console.error(`  - ${s}`));
  }

  if (seasonsFailed.length) {
    console.error(`\n${seasonsFailed.length} saison(s) inaccessible(s) sur TMDB (ignorée(s), réessaie plus tard) :`);
    seasonsFailed.forEach((s) => console.error(`  - ${s}`));
  }
}

main().catch((err) => {
  console.error("Erreur :", err.message);
  process.exit(1);
});
