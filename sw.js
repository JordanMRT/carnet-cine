const SW_VERSION = "2026-07-18-1"; // ⚠️ change cette valeur à chaque déploiement
const CACHE_NAME = `timetobinge-${SW_VERSION}`;

// App shell : fichiers statiques du projet, mis en cache dès l'installation
// pour que les visites suivantes (et l'ouverture en PWA installée) se
// chargent depuis le disque plutôt que de refaire un aller-retour réseau
// pour chaque fichier JS/CSS.
const APP_SHELL = [
  "./",
  "./index.html",
  "./css/style.css",
  "./manifest.json",
  "./brand-top.png",
  "./ttb-logo-ticketcorn-flat.png",
  "./ttb-logo-ticketcorn-shadow.png",
  "./favico.ico",
  "./assets/poster-placeholder.svg",
  "./js/config.js",
  "./js/utils.js",
  "./js/tmdb.js",
  "./js/supabase-client.js",
  "./js/tvdb-client.js",
  "./js/badges.js",
  "./js/stats.js",
  "./js/import.js",
  "./js/library-builder.js",
  "./js/runtime-enrichment.js",
  "./js/ticket-share.js",
  "./js/install-prompt.js",
  "./js/update-prompt.js",
  "./js/app.js",
];

self.addEventListener("install", (event) => {
  console.log("Service Worker installé");
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .catch((err) => console.warn("Précache app shell impossible :", err))
  );
});

self.addEventListener("activate", (event) => {
  console.log("Service Worker activé");
  event.waitUntil(
    Promise.all([
      // Nettoie les caches des anciennes versions du service worker.
      caches.keys().then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
      ),
      clients.claim(),
    ])
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

// Stratégie de cache volontairement limitée à l'app shell (fichiers
// statiques same-origin ci-dessus) : les données (Supabase) et les
// métadonnées/images (TMDB) partent toujours au réseau, pour ne jamais
// afficher un journal ou des posters obsolètes.
self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // TMDB, Supabase, polices, etc.

  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
          }
          return res;
        })
        .catch(() => cached);

      // Cache-first pour un affichage instantané, avec revalidation en
      // arrière-plan (stale-while-revalidate) pour rester à jour.
      return cached || network;
    })
  );
});
