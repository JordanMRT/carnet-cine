// ============================================
// THÈMES — palettes d'accent alternatives (moutarde/corail/sauge).
// Le fond navy et le crème restent fixes : seuls les 3 accents changent.
// Les thèmes films seront ajoutés ici plus tard (couleurs + déblocage à
// choisir ensemble) ; "oiseau_nuit" ci-dessous n'est qu'un exemple pour
// valider le mécanisme de déblocage par badge, à remplacer.
// ============================================

const THEMES = [
  { id: "default", name: "Time To Binge", mustard: "#e8a33d", coral: "#e8636b", sage: "#7c9885", bg: "#1b1d2a", bgelevated: "#23263a", unlock: null },
  { id: "braise", name: "Braise", mustard: "#e8a33d", coral: "#d64545", sage: "#8f5a3d", bg: "#130c08", bgelevated: "#201a17", topbar: "#0d0705", unlock: null },
  { id: "embruns", name: "Embruns", mustard: "#5fb0a8", coral: "#e8636b", sage: "#4a7c94", bg: "#0d161a", bgelevated: "#2a3e48", topbar: "#070d10", unlock: null },
  { id: "twentyonepilots", name: "Twenty One Pilots", mustard: "#fde61e", coral: "#e6413b", sage: "#d2cfbd", bg: "#202020", bgelevated: "#873132", topbar: "#131010", unlock: null },

  // ---------- Thèmes films (accès libre) ----------
  { id: "avatar", name: "Avatar", mustard: "#4dd9c0", coral: "#d94dc9", sage: "#2f6b4f", bg: "#071410", bgelevated: "#0f2620", topbar: "#040b08", unlock: null },
  { id: "barbie", name: "Barbie", mustard: "#ff6fb0", coral: "#ff3d94", sage: "#7fe0c9", bg: "#1a0f18", bgelevated: "#2b1826", topbar: "#120a10", unlock: null },
  { id: "drive", name: "Drive", mustard: "#f2c94c", coral: "#ff2e6e", sage: "#2ec4d6", bg: "#0a0a14", bgelevated: "#16162b", topbar: "#07070d", unlock: null },
  { id: "amelie_poulain", name: "Amélie Poulain", mustard: "#e0a339", coral: "#c23b3b", sage: "#4f7a52", bg: "#1a100a", bgelevated: "#2b1c12", topbar: "#120b07", unlock: null },
  { id: "la_la_land", name: "La La Land", mustard: "#ff9d4d", coral: "#e0559c", sage: "#5b6bab", bg: "#14102a", bgelevated: "#241b42", topbar: "#0c0a1b", unlock: null },
  { id: "blade_runner", name: "Blade Runner", mustard: "#ff9a3d", coral: "#ff3d7a", sage: "#2fd4c7", bg: "#0c0906", bgelevated: "#1f150d", topbar: "#080604", unlock: null },

  // ---------- Thèmes verrouillés (liés à un badge) ----------
  { id: "oiseau_nuit", name: "Oiseau de nuit", mustard: "#5b7fd6", coral: "#8f6fd6", sage: "#2f4a6e", bg: "#0a0e1a", bgelevated: "#161d33", topbar: "#06080f", unlock: { badgeKey: "night_owl", tier: 1 } },
  { id: "vhs", name: "VHS", mustard: "#e0883d", coral: "#d6486b", sage: "#4f9e8f", bg: "#170f0a", bgelevated: "#2b1f16", topbar: "#100a07", unlock: { badgeKey: "rewatcher", tier: 1 } },
  { id: "givre", name: "Givre", mustard: "#a8d8e8", coral: "#e85d5d", sage: "#4a6b7a", bg: "#080d12", bgelevated: "#141f28", topbar: "#05080b", unlock: { badgeKey: "harsh_critic", tier: 1 } },
  { id: "coeur_tendre", name: "Cœur tendre", mustard: "#f0a878", coral: "#e87ba0", sage: "#a389b0", bg: "#1c1015", bgelevated: "#2e1c24", topbar: "#120a0d", unlock: { badgeKey: "soft_heart", tier: 1 } },
  { id: "reveillon", name: "Réveillon", mustard: "#e0b84d", coral: "#c23b45", sage: "#2f6b45", bg: "#0a1410", bgelevated: "#16281f", topbar: "#060d0a", unlock: { badgeKey: "holiday_binge", tier: 1 } },
];

function isThemeUnlocked(theme) {
  if (!theme.unlock) return true;
  const earned = App.earnedBadges?.[theme.unlock.badgeKey];
  return (earned?.tier || 0) >= theme.unlock.tier;
}

function applyTheme(themeId) {
  const theme = THEMES.find((t) => t.id === themeId) || THEMES[0];
  const root = document.documentElement.style;
  root.setProperty("--mustard", theme.mustard);
  root.setProperty("--coral", theme.coral);
  root.setProperty("--sage", theme.sage);
  // Filet de sécurité : si un futur thème oublie bg/bgelevated, on retombe
  // sur le thème par défaut plutôt que de casser tout le fond de l'app.
  root.setProperty("--bg", theme.bg || THEMES[0].bg);
  root.setProperty("--bg-elevated", theme.bgelevated || THEMES[0].bgelevated);
  // Repli sur le noir actuel si le thème ne définit pas sa propre topbar —
  // aucun thème n'est donc affecté tant qu'on ne choisit pas d'en ajuster une.
  root.setProperty("--topbar", theme.topbar || "#0e0f14");
  localStorage.setItem("ttb-theme", theme.id);
}

function loadSavedTheme() {
  const saved = localStorage.getItem("ttb-theme");
  if (saved) applyTheme(saved);
}