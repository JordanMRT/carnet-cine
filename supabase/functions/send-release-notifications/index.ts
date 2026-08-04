import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const TMDB_API_KEY = Deno.env.get("TMDB_API_KEY");
const CRON_SECRET = Deno.env.get("CRON_SECRET");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

webpush.setVapidDetails(
  Deno.env.get("VAPID_SUBJECT")!,
  Deno.env.get("VAPID_PUBLIC_KEY")!,
  Deno.env.get("VAPID_PRIVATE_KEY")!
);

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

async function tmdb(path: string) {
  const sep = path.includes("?") ? "&" : "?";
  const res = await fetch(`https://api.themoviedb.org/3${path}${sep}api_key=${TMDB_API_KEY}&language=fr-FR`);
  if (!res.ok) throw new Error(`TMDB ${res.status}`);
  return res.json();
}

// Heure/date à Paris, pas le fuseau du serveur (UTC) — c'est cette
// date-là qui doit correspondre à "aujourd'hui" pour des utilisateurs
// français, surtout maintenant qu'on tourne plusieurs fois par jour.
function nowInParis() {
  const fmt = new Intl.DateTimeFormat("fr-FR", {
    timeZone: "Europe/Paris",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  });
  const p = Object.fromEntries(fmt.formatToParts(new Date()).map((x) => [x.type, x.value]));
  return { dateStr: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour), minute: Number(p.minute) };
}

// TheTVDB mélange les formats selon les séries : "21:00" ou "3:00 AM".
function parseAirsTime(raw: string | null) {
  if (!raw) return null;
  const ampm = raw.match(/^(\d{1,2}):(\d{2})\s*([AP]M)$/i);
  if (ampm) {
    let hour = parseInt(ampm[1], 10) % 12;
    if (/PM/i.test(ampm[3])) hour += 12;
    return { hour, minute: parseInt(ampm[2], 10) };
  }
  const h24 = raw.match(/^(\d{1,2}):(\d{2})$/);
  if (h24) return { hour: parseInt(h24[1], 10), minute: parseInt(h24[2], 10) };
  return null;
}

// Créneau habituel de la série via TheTVDB (par tvdb-proxy, même
// authentification que le reste de l'app, pas dupliquée ici).
// Approximation assumée : traité comme heure française, alors que
// TheTVDB ne garantit pas le fuseau d'origine — mieux que de supposer
// minuit, mais imparfait pour une série dont le réseau d'origine est
// dans un fuseau très différent.
async function getAirsTime(showTmdbId: string | number) {
  try {
    const externalIds = await tmdb(`/tv/${showTmdbId}/external_ids`);
    if (!externalIds.tvdb_id) return null;
    const res = await fetch(`${SUPABASE_URL}/functions/v1/tvdb-proxy`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
      body: JSON.stringify({ action: "seriesInfo", tvdbId: externalIds.tvdb_id }),
    });
    if (!res.ok) return null;
    const json = await res.json();
    return parseAirsTime(json.airsTime);
  } catch {
    return null;
  }
}

serve(async (req) => {
  if (req.headers.get("x-cron-secret") !== CRON_SECRET) {
    return new Response("Non autorisé", { status: 401 });
  }

  // Chemin de test : envoie une notification factice à un seul
  // utilisateur, sans toucher au scan des watchlists ni à la table
  // anti-doublon. Jamais utilisé par le cron.
  const body = await req.json().catch(() => ({}));
  if (body.test && body.userId) {
    const { data: testSubs } = await supabase
      .from("push_subscriptions").select("*").eq("user_id", body.userId);
    if (!testSubs?.length) return new Response("Aucun abonnement pour cet utilisateur", { status: 404 });

    const payload = {
      title: "Ceci est un test 🦋",
      body: "Si cette notification apparaît, alors toute la logique fonctionne.",
      url: "#/upcoming",
    };
    for (const sub of testSubs) {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        JSON.stringify(payload)
      );
    }
    return new Response("Test envoyé", { status: 200 });
  }

  const { dateStr: today, hour: nowHour, minute: nowMinute } = nowInParis();
  const { data: subs } = await supabase.from("push_subscriptions").select("*");
  const userIds = [...new Set((subs || []).map((s) => s.user_id))];
  if (!userIds.length) return new Response("Aucun abonné", { status: 200 });

  for (const userId of userIds) {
    const candidates: {
      title: string; body: string; url: string;
      mediaType: "movie" | "tv"; tmdbId: string; season: number | null; episode: number | null;
    }[] = [];

    // ---- Films de la watchlist (date seule : TMDB ne fournit pas
    // d'heure de sortie pour les films) ----
    const { data: watchlistMovies } = await supabase
      .from("library").select("tmdb_id, title")
      .eq("user_id", userId).eq("media_type", "movie").eq("status", "watchlist");

    for (const movie of watchlistMovies || []) {
      try {
        const data = await tmdb(`/movie/${movie.tmdb_id}`);
        if (data.release_date === today) {
          candidates.push({
            title: `${movie.title} est sorti aujourd'hui 🎬`,
            body: "C'est dans ta watchlist ! Direction la fiche ?",
            url: `#/show/movie-${movie.tmdb_id}`,
            mediaType: "movie", tmdbId: String(movie.tmdb_id), season: null, episode: null,
          });
        }
      } catch (e) {
        console.error(`TMDB film ${movie.tmdb_id}`, e);
      }
    }

    // ---- Prochain épisode des séries en cours ----
    const { data: watchingShows } = await supabase
      .from("library").select("tmdb_id, title")
      .eq("user_id", userId).eq("media_type", "tv").eq("status", "watching");

    for (const show of watchingShows || []) {
      try {
        const { data: entries } = await supabase
          .from("diary_entries").select("season, episode")
          .eq("user_id", userId).eq("media_type", "tv").eq("tmdb_id", show.tmdb_id);
        const watchedKeys = new Set((entries || []).map((e) => `${e.season}x${e.episode}`));
        const startSeason = entries?.length ? Math.max(...entries.map((e) => e.season || 1)) : 1;

        const showData = await tmdb(`/tv/${show.tmdb_id}`);
        const lastSeasonToCheck = Math.min(startSeason + 1, showData.number_of_seasons || startSeason);

        let nextEp: any = null;
        let nextEpSeason = startSeason;
        for (let s = startSeason; s <= lastSeasonToCheck; s++) {
          const season = await tmdb(`/tv/${show.tmdb_id}/season/${s}`);
          const found = (season.episodes || []).find(
            (ep: any) => !watchedKeys.has(`${s}x${ep.episode_number}`) && ep.air_date === today
          );
          if (found) { nextEp = found; nextEpSeason = s; break; }
        }
        if (!nextEp) continue;

        // Créneau connu : on attend qu'il soit passé. Créneau inconnu :
        // on garde l'ancien comportement (dès que la date correspond).
        const airsTime = await getAirsTime(show.tmdb_id);
        if (airsTime) {
          const notYetAired = nowHour < airsTime.hour || (nowHour === airsTime.hour && nowMinute < airsTime.minute);
          if (notYetAired) continue;
        }

        candidates.push({
          title: `${show.title} - L'épisode ${nextEp.episode_number} est sorti 📺`,
          body: `Saison ${nextEpSeason}${nextEp.name ? " · " + nextEp.name : ""}`,
          url: `#/episode/${show.tmdb_id}-${nextEpSeason}-${nextEp.episode_number}`,
          mediaType: "tv", tmdbId: String(show.tmdb_id), season: nextEpSeason, episode: nextEp.episode_number,
        });
      } catch (e) {
        console.error(`TMDB série ${show.tmdb_id}`, e);
      }
    }

    if (!candidates.length) continue;

    // Verrou anti-doublon par élément (cf. explication plus haut).
    const toSend = [];
    for (const c of candidates) {
      const { error } = await supabase.from("sent_notifications").insert({
        user_id: userId, media_type: c.mediaType, tmdb_id: c.tmdbId,
        season: c.season, episode: c.episode, sent_date: today,
      });
      if (!error) toSend.push(c);
    }
    if (!toSend.length) continue;

    const payload =
      toSend.length === 1
        ? toSend[0]
        : {
            title: `${toSend.length} nouveautés aujourd'hui 🎬`,
            body: toSend.map((n) => n.title).join(" · "),
            url: "#/upcoming",
          };

    const userSubs = (subs || []).filter((s) => s.user_id === userId);
    for (const sub of userSubs) {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          JSON.stringify(payload)
        );
      } catch (err: any) {
        if (err.statusCode === 404 || err.statusCode === 410) {
          await supabase.from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
        } else {
          console.error("Envoi push échoué", err);
        }
      }
    }
  }

  return new Response("OK", { status: 200 });
});