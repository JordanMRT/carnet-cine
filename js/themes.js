// ============================================
// THÈMES — palettes d'accent alternatives (moutarde/corail/sauge).
// Le fond navy et le crème restent fixes : seuls les 3 accents changent.
// Les thèmes films seront ajoutés ici plus tard (couleurs + déblocage à
// choisir ensemble) ; "oiseau_nuit" ci-dessous n'est qu'un exemple pour
// valider le mécanisme de déblocage par badge, à remplacer.
// ============================================

const THEMES = [
  { id: "default", name: "Time To Binge", mustard: "#e8a33d", coral: "#e8636b", sage: "#7c9885", bg: "#1b1d2a", bgelevated: "#23263a", unlock: null },
  { id: "braise", name: "Braise", mustard: "#e8a33d", coral: "#d64545", sage: "#8f5a3d", bg: "#130c08", bgelevated: "#201a17", unlock: null },
  { id: "embruns", name: "Embruns", mustard: "#5fb0a8", coral: "#e8636b", sage: "#4a7c94", bg: "#0d161a", bgelevated: "#2a3e48", unlock: null },
  { id: "twentyonepilots", name: "Twenty One Pilots", mustard: "#fde61e", coral: "#e6413b", sage: "#d2cfbd", bg: "#202020", bgelevated: "#873132", unlock: null },
  // Exemple de thème verrouillé — à remplacer par les vrais thèmes-films.
  { id: "oiseau_nuit", name: "Oiseau de nuit", mustard: "#5b7fd6", coral: "#8f6fd6", sage: "#2f4a6e", unlock: { badgeKey: "night_owl", tier: 1 } },
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
  root.setProperty("--bg", theme.bg);
  root.setProperty("--bg-elevated", theme.bgelevated);
  localStorage.setItem("ttb-theme", theme.id);
}

function loadSavedTheme() {
  const saved = localStorage.getItem("ttb-theme");
  if (saved) applyTheme(saved);
}