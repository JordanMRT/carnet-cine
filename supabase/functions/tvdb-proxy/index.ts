import { serve } from "https://deno.land/std@0.190.0/http/server.ts";

const TVDB_API_KEY = Deno.env.get("TVDB_API_KEY");
const TVDB_PIN = Deno.env.get("TVDB_PIN"); // optionnel, laisse vide si pas d'abonné

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function getToken(): Promise<string> {
  const body: Record<string, string> = { apikey: TVDB_API_KEY! };
  if (TVDB_PIN) body.pin = TVDB_PIN;

  const res = await fetch("https://api4.thetvdb.com/v4/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Connexion à TheTVDB échouée (${res.status})`);
  const json = await res.json();
  return json.data.token;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const payload = await req.json();
    const token = await getToken();

    // ---- Recherche par titre (repli pour les films, sans tvdb_id via TMDB) ----
    if (payload.action === "search") {
      const { query, mediaType } = payload;
      if (!query) {
        return new Response(JSON.stringify({ error: "Requête manquante" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const type = mediaType === "movie" ? "movie" : "series";
      const url = `https://api4.thetvdb.com/v4/search?query=${encodeURIComponent(query)}&type=${type}`;
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) {
        return new Response(JSON.stringify({ error: `TheTVDB a répondu ${res.status}` }), {
          status: 502,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const json = await res.json();
      const results = (json.data || []).slice(0, 5).map((r: any) => ({
        tvdbId: r.tvdb_id ? Number(r.tvdb_id) : Number(String(r.id).replace(/\D/g, "")),
        name: r.name,
        year: r.year || null,
      }));
      return new Response(JSON.stringify({ results }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ---- Personnages (comportement par défaut) ----
    const { mediaType, tvdbId } = payload;
    if (!tvdbId || !["movie", "series"].includes(mediaType)) {
      return new Response(JSON.stringify({ error: "Paramètres invalides" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const endpoint =
      mediaType === "movie"
        ? `https://api4.thetvdb.com/v4/movies/${tvdbId}/extended`
        : `https://api4.thetvdb.com/v4/series/${tvdbId}/extended`;

    const res = await fetch(endpoint, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) {
      return new Response(JSON.stringify({ error: `TheTVDB a répondu ${res.status}` }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const json = await res.json();

    const characters = (json.data?.characters || [])
      .filter((c: any) => c.image || c.personImgURL)
      .map((c: any) => ({
        characterName: c.name || null,
        characterImage: c.image || null,
        personName: c.personName || null,
        personImage: c.personImgURL || null,
      }));

    return new Response(JSON.stringify({ characters }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});