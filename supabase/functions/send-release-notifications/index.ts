import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const TMDB_API_KEY = Deno.env.get("TMDB_API_KEY");
const CRON_SECRET = Deno.env.get("CRON_SECRET");

webpush.setVapidDetails(
  Deno.env.get("VAPID_SUBJECT")!,
  Deno.env.get("VAPID_PUBLIC_KEY")!,
  Deno.env.get("VAPID_PRIVATE_KEY")!
);

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

async function tmdb(path: string) {
  const sep = path.includes("?") ? "&" : "?";
  const res = await fetch(`https://api.themoviedb.org/3${path}${sep}api_key=${TMDB_API_KEY}&language=fr-FR`);
  if (!res.ok) throw new Error(`TMDB ${res.status}`);
  return res.json();
}

serve(async (req) => {
  if (req.headers.get("x-cron-secret") !== CRON_SECRET) {
    return new Response("Non autorisé", { status: 401 });
  }

  const today = new Date().toISOString().slice(0, 10);
  const { data: subs } = await supabase.from("push_subscriptions").select("*");
  const userIds = [...new Set((subs || []).map((s) => s.user_id))];
  if (!userIds.length) return new Response("Aucun abonné", { status: 200 });

  for (const userId of userIds) {
    const notifications: { title: string; body: string; url: string }[] = [];

    // ---- Films de la watchlist ----
    const { data: watchlistMovies } = await supabase
      .from("library").select("tmdb_id, title")
      .eq("user_id", userId).eq("media_type", "movie").eq("status", "watchlist");

    for (const movie of watchlistMovies || []) {
      try {
        const data = await tmdb(`/movie/${movie.tmdb_id}`);
        if (data.release_date === today) {
          notifications.push({
            title: `${movie.title} est sorti aujourd'hui 🎬`,
            body: "C'est dans ta watchlist — direction la fiche ?",
            url: `#/show/movie-${movie.tmdb_id}`,
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

        const season = await tmdb(`/tv/${show.tmdb_id}/season/${startSeason}`);
        const nextEp = (season.episodes || []).find(
          (ep: any) => !watchedKeys.has(`${startSeason}x${ep.episode_number}`) && ep.air_date === today
        );
        if (nextEp) {
          notifications.push({
            title: `${show.title} — épisode ${nextEp.episode_number} sorti aujourd'hui 🎬`,
            body: `Saison ${startSeason}${nextEp.name ? " · " + nextEp.name : ""}`,
            url: `#/episode/${show.tmdb_id}-${startSeason}-${nextEp.episode_number}`,
          });
        }
      } catch (e) {
        console.error(`TMDB série ${show.tmdb_id}`, e);
      }
    }

    if (!notifications.length) continue;

    // Plusieurs sorties le même jour : une seule notif groupée vers "à
    // venir", plutôt qu'une par sortie (cf. décision prise plus tôt).
    const payload =
      notifications.length === 1
        ? notifications[0]
        : {
            title: `${notifications.length} nouveautés aujourd'hui 🎬`,
            body: notifications.map((n) => n.title).join(" · "),
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
        // Abonnement expiré/révoqué côté navigateur : on nettoie la base
        // plutôt que de réessayer indéfiniment un endpoint mort.
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