const SW_VERSION = "2026-07-12-1"; // ⚠️ change cette valeur à chaque déploiement
const CACHE_NAME = `timetobinge-${SW_VERSION}`;

self.addEventListener("install", () => {
  console.log("Service Worker installé");
});

self.addEventListener("activate", (event) => {
  console.log("Service Worker activé");
  event.waitUntil(clients.claim());
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});