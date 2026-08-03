// ============================================
// NOTIFICATION PROMPT — invite à activer les notifications push
// Uniquement en PWA installée (isStandalone()), après connexion.
// ============================================

const NOTIF_PERMANENT_DISMISS_KEY = "carnetcine_notif_dismissed_forever";
const NOTIF_SESSION_DISMISS_KEY = "carnetcine_notif_dismissed_session";

function maybeShowNotificationPrompt() {
  if (!isStandalone()) return;
  if (!("Notification" in window) || !("PushManager" in window)) return;
  if (Notification.permission !== "default") return; // déjà accordé ou refusé
  if (localStorage.getItem(NOTIF_PERMANENT_DISMISS_KEY)) return;
  if (sessionStorage.getItem(NOTIF_SESSION_DISMISS_KEY)) return;
  setTimeout(showNotificationPrompt, 1200);
}

function showNotificationPrompt() {
  if (document.getElementById("notification-prompt")) return;

  const el = document.createElement("div");
  el.id = "notification-prompt";
  el.className = "install-prompt"; // même carte/animation que l'install prompt
  el.innerHTML = `
    <div class="install-prompt-card">
      <button class="install-prompt-close" aria-label="Fermer">✕</button>
      <div class="install-prompt-header">
        <span class="install-prompt-emoji">🔔</span>
        <div>
          <strong>Active les notifications</strong>
          <p>Sois prévenu dès qu'un film de ta watchlist ou un épisode sort. Modifiable à tout moment dans les réglages.</p>
        </div>
      </div>
      <button class="notif-prompt-enable">Activer les notifications</button>
      <button class="install-prompt-forever">Ne plus jamais afficher</button>
    </div>
  `;
  document.body.appendChild(el);
  if (typeof lucide !== "undefined") lucide.createIcons();
  requestAnimationFrame(() => el.classList.add("install-prompt--visible"));

  const close = (permanent) => {
    el.classList.remove("install-prompt--visible");
    setTimeout(() => el.remove(), 250);
    if (permanent) localStorage.setItem(NOTIF_PERMANENT_DISMISS_KEY, "1");
    else sessionStorage.setItem(NOTIF_SESSION_DISMISS_KEY, "1");
  };

  el.querySelector(".install-prompt-close").addEventListener("click", () => close(false));
  el.querySelector(".install-prompt-forever").addEventListener("click", () => close(true));
  el.querySelector(".notif-prompt-enable").addEventListener("click", async () => {
    close(false);
    // Implémenté au bloc 3 : demande la permission native puis s'abonne.
    if (typeof subscribeToPushNotifications === "function") {
      await subscribeToPushNotifications();
    }
  });
}

// Le navigateur attend la clé au format Uint8Array, pas la chaîne brute.
function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}

async function subscribeToPushNotifications() {
  try {
    const permission = await Notification.requestPermission();
    if (permission !== "granted") return; // refusé : on ne fait rien de plus

    const registration = await navigator.serviceWorker.ready;
    const subscription =
      (await registration.pushManager.getSubscription()) ||
      (await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(CONFIG.VAPID_PUBLIC_KEY),
      }));

    await DB.savePushSubscription(App.session.user.id, subscription);
    toast("Notifications activées 🔔", "success");
  } catch (err) {
    console.error("Abonnement push impossible :", err);
    toast("Impossible d'activer les notifications pour l'instant.", "error");
  }
}