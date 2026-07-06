// ============================================
// BADGES — définitions et conditions d'obtention
// Chaque badge a une fonction check(entries, library) -> bool
// entries = tableau des diary_entries de l'utilisateur
// library = tableau des items de la bibliothèque
// ============================================

function daysBetween(a, b) {
  return Math.round((new Date(a) - new Date(b)) / 86400000);
}

function longestStreak(entries) {
  const days = [...new Set(entries.map((e) => e.watched_date))].sort();
  let longest = 0,
    current = 0,
    prev = null;
  for (const day of days) {
    if (prev && daysBetween(day, prev) === 1) current += 1;
    else current = 1;
    longest = Math.max(longest, current);
    prev = day;
  }
  return longest;
}

const BADGES = [
  {
    key: "first_watch",
    name: "Premier ticket",
    icon: "🎬",
    description: "Enregistre ta première entrée dans le journal.",
    check: (entries) => entries.length >= 1,
  },
  {
    key: "century",
    name: "Cinéphile centenaire",
    icon: "💯",
    description: "Enregistre 100 entrées au journal.",
    check: (entries) => entries.length >= 100,
  },
  {
    key: "movie_buff",
    name: "Habitué du grand écran",
    icon: "🍿",
    description: "Enregistre 25 films.",
    check: (entries) => entries.filter((e) => e.media_type === "movie").length >= 25,
  },
  {
    key: "binge_master",
    name: "Maître du binge",
    icon: "⚡",
    description: "Regarde 5 épisodes de la même série en une journée.",
    check: (entries) => {
      const byShowDay = {};
      entries
        .filter((e) => e.media_type === "tv")
        .forEach((e) => {
          const k = `${e.tmdb_id}_${e.watched_date}`;
          byShowDay[k] = (byShowDay[k] || 0) + 1;
        });
      return Object.values(byShowDay).some((n) => n >= 5);
    },
  },
  {
    key: "night_owl",
    name: "Oiseau de nuit",
    icon: "🦉",
    description: "Enregistre 10 visionnages entre minuit et 5h du matin.",
    check: (entries) =>
      entries.filter((e) => {
        if (!e.created_at) return false;
        const h = new Date(e.created_at).getHours();
        return h >= 0 && h < 5;
      }).length >= 10,
  },
  {
    key: "streak_7",
    name: "Une semaine assidue",
    icon: "🔥",
    description: "Enregistre au moins une entrée par jour pendant 7 jours d'affilée.",
    check: (entries) => longestStreak(entries) >= 7,
  },
  {
    key: "streak_30",
    name: "Habitude bien ancrée",
    icon: "🔥",
    description: "Enregistre au moins une entrée par jour pendant 30 jours d'affilée.",
    check: (entries) => longestStreak(entries) >= 30,
  },
  {
    key: "completionist",
    name: "Complétionniste",
    icon: "🏁",
    description: "Termine 10 séries.",
    check: (_entries, library) =>
      library.filter((l) => l.media_type === "tv" && l.status === "completed").length >= 10,
  },
  {
    key: "critic",
    name: "Critique aguerri",
    icon: "⭐",
    description: "Attribue une note à 50 entrées du journal.",
    check: (entries) => entries.filter((e) => e.rating != null).length >= 50,
  },
  {
    key: "rewatcher",
    name: "Sur un replay",
    icon: "🔁",
    description: "Enregistre 10 rediffusions (rewatch).",
    check: (entries) => entries.filter((e) => e.rewatch).length >= 10,
  },
  {
    key: "marathon",
    name: "Marathon",
    icon: "🏃",
    description: "Termine une saison entière en une seule journée.",
    check: (entries) => {
      const bySeasonDay = {};
      entries
        .filter((e) => e.media_type === "tv" && e.season != null)
        .forEach((e) => {
          const k = `${e.tmdb_id}_s${e.season}_${e.watched_date}`;
          bySeasonDay[k] = (bySeasonDay[k] || 0) + 1;
        });
      // Heuristique : 8+ épisodes d'une même saison en un jour = marathon
      return Object.values(bySeasonDay).some((n) => n >= 8);
    },
  },
  {
    key: "genre_explorer",
    name: "Explorateur de genres",
    icon: "🧭",
    description: "Regarde des œuvres d'au moins 8 genres différents.",
    check: (entries) => {
      const genres = new Set();
      entries.forEach((e) => (e.genres || []).forEach((g) => genres.add(g)));
      return genres.size >= 8;
    },
  },
];

async function evaluateBadges(entries, library, userId) {
  const earned = [];
  for (const badge of BADGES) {
    try {
      if (badge.check(entries, library)) {
        earned.push(badge.key);
        await DB.awardBadge(userId, badge.key);
      }
    } catch (e) {
      console.error(`Erreur badge ${badge.key}`, e);
    }
  }
  return earned;
}
