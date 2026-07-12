const CACHE_NAME = "timetobinge-v1";

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