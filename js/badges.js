// ============================================
// BADGES — définitions et conditions d'obtention
//
// Deux types de badges :
// - Simples : fonction check(entries, library) -> bool
// - À paliers : fonction getValue(entries, library) -> nombre, comparé
//   au tableau `tiers` (ex: [10, 50, 150, 300]) pour déterminer le
//   niveau atteint (0 = pas encore débloqué, 1 à N = palier atteint).
//   `unit: "percent"` affiche un % plutôt qu'un chiffre brut.
//
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

function tierReached(value, tiers) {
  let level = 0;
  for (let i = 0; i < tiers.length; i++) {
    if (value >= tiers[i]) level = i + 1;
  }
  return level;
}

const BADGES = [
  // ---------- Badges simples (déjà existants) ----------
  {
    key: "first_watch",
    name: "Premier ticket",
    icon: "🎬",
    iconImage: "assets/badges/first_watch.png",
    description: "Enregistre ta première entrée dans le journal.",
    check: (entries) => entries.length >= 1,
  },
  {
    key: "century",
    name: "Cinéphile centenaire",
    icon: "💯",
    iconImage: "assets/badges/century.png",
    description: "Enregistre 100 entrées au journal.",
    check: (entries) => entries.length >= 100,
  },
  {
    key: "movie_buff",
    name: "Habitué du grand écran",
    icon: "🍿",
    iconImage: "assets/badges/movie_buff.png",
    description: "Enregistre 25 films.",
    check: (entries) => entries.filter((e) => e.media_type === "movie").length >= 25,
  },
  {
    key: "binge_master",
    name: "Maître du binge",
    icon: "⚡",
    iconImage: "assets/badges/binge_master.png",
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
    key: "streak_7",
    name: "Une semaine assidue",
    icon: "🔥",
    iconImage: "assets/badges/streak_7.png",
    description: "Enregistre au moins une entrée par jour pendant 7 jours d'affilée.",
    check: (entries) => longestStreak(entries) >= 7,
  },
  {
    key: "streak_30",
    name: "Habitude bien ancrée",
    icon: "🔥",
    iconImage: "assets/badges/streak_30.png",
    description: "Enregistre au moins une entrée par jour pendant 30 jours d'affilée.",
    check: (entries) => longestStreak(entries) >= 30,
  },
  {
    key: "completionist",
    name: "Complétionniste",
    icon: "🏁",
    iconImage: "assets/badges/completionist.png",
    description: "Termine 10 séries.",
    check: (_entries, library) =>
      library.filter((l) => l.media_type === "tv" && l.status === "completed").length >= 10,
  },
  {
    key: "marathon",
    name: "Marathon",
    icon: "🏃",
    iconImage: "assets/badges/marathon.png",
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
    iconImage: "assets/badges/genre_explorer.png",
    description: "Regarde des œuvres d'au moins 8 genres différents.",
    check: (entries) => {
      const genres = new Set();
      entries.forEach((e) => (e.genres || []).forEach((g) => genres.add(g)));
      return genres.size >= 8;
    },
  },

  // ---------- Badges à paliers ----------
  {
    key: "night_owl",
    name: "Oiseau de nuit",
    icon: "🦉",
    description: "Enregistre des visionnages entre minuit et 5h du matin.",
    tiers: [10, 50, 150, 300],
    getValue: (entries) =>
      entries.filter((e) => {
        if (!e.created_at) return false;
        const h = new Date(e.created_at).getHours();
        return h >= 0 && h < 5;
      }).length,
  },
  {
    key: "rewatcher",
    name: "Sur un replay",
    icon: "🔁",
    description: "Enregistre des rediffusions (rewatch).",
    tiers: [10, 50, 150, 300],
    getValue: (entries) => entries.filter((e) => e.rewatch).length,
  },
  {
    key: "critic",
    name: "Critique aguerri",
    icon: "⭐",
    description: "Attribue une note à des entrées du journal.",
    tiers: [50, 150, 300, 600],
    getValue: (entries) => entries.filter((e) => e.rating != null).length,
  },
  {
    key: "weekend_binger",
    name: "Marathonien de week-end",
    icon: "🛋️",
    description: "Enregistre des visionnages un samedi ou un dimanche.",
    tiers: [10, 50, 150, 300],
    getValue: (entries) =>
      entries.filter((e) => {
        const day = new Date(e.watched_date).getDay();
        return day === 0 || day === 6;
      }).length,
  },
  {
    key: "double_feature",
    name: "Séance double",
    icon: "🎞️",
    description: "Regarde 2 films ou plus le même jour.",
    tiers: [1, 5, 15, 30],
    getValue: (entries) => {
      const byDay = {};
      entries
        .filter((e) => e.media_type === "movie")
        .forEach((e) => (byDay[e.watched_date] = (byDay[e.watched_date] || 0) + 1));
      return Object.values(byDay).filter((c) => c >= 2).length;
    },
  },
  {
    key: "harsh_critic",
    name: "Critique sévère",
    icon: "🥶",
    description: "Attribue une note de 3/10 ou moins.",
    tiers: [5, 25, 75, 150],
    getValue: (entries) => entries.filter((e) => e.rating != null && e.rating <= 3).length,
  },
  {
    key: "soft_heart",
    name: "Cœur tendre",
    icon: "🥰",
    description: "Attribue une note de 9/10 ou plus.",
    tiers: [5, 25, 75, 150],
    getValue: (entries) => entries.filter((e) => e.rating != null && e.rating >= 9).length,
  },
  {
    key: "aficionado",
    name: "Aficionado",
    icon: "🎭",
    description: "Revoit une série entière (autant de rewatchs que d'épisodes).",
    tiers: [1, 3, 5, 10],
    getValue: (entries, library) => {
      const rewatchCounts = {};
      entries
        .filter((e) => e.media_type === "tv" && e.rewatch)
        .forEach((e) => (rewatchCounts[e.tmdb_id] = (rewatchCounts[e.tmdb_id] || 0) + 1));
      let qualifying = 0;
      for (const [tmdbId, count] of Object.entries(rewatchCounts)) {
        const lib = library.find((l) => l.media_type === "tv" && String(l.tmdb_id) === tmdbId);
        const total = lib?.total_episodes || lib?.watched_episodes || 0;
        if (total > 0 && count >= total) qualifying++;
      }
      return qualifying;
    },
  },
  {
    key: "genre_specialist",
    name: "Spécialiste d'un genre",
    icon: "🎯",
    description: "Regarde beaucoup d'œuvres différentes d'un même genre.",
    tiers: [10, 25, 50, 100],
    getValue: (entries) => {
      const counts = {};
      const seenWorks = new Set();
      entries.forEach((e) => {
        const workKey = `${e.media_type}_${e.tmdb_id}`;
        if (seenWorks.has(workKey)) return;
        seenWorks.add(workKey);
        (e.genres || []).forEach((g) => {
          counts[g] = (counts[g] || 0) + 1;
        });
      });
      return Math.max(...Object.values(counts), 0);
    },
  },
  {
    key: "day_one",
    name: "Jour de diffusion",
    icon: "📅",
    description: "Regarde un épisode le jour même de sa diffusion.",
    tiers: [1, 10, 25, 50],
    getValue: (entries) =>
      entries.filter((e) => e.media_type === "tv" && e.air_date && e.air_date === e.watched_date)
        .length,
  },
  {
    key: "premiere_day",
    name: "Jour de sortie",
    icon: "🎟️",
    description: "Regarde un film le jour même de sa sortie.",
    tiers: [1, 5, 15, 30],
    getValue: (entries) =>
      entries.filter((e) => e.media_type === "movie" && e.air_date && e.air_date === e.watched_date)
        .length,
  },
  {
    key: "release_week",
    name: "Sortie de la semaine",
    icon: "🚀",
    description: "Regarde un film ou démarre un épisode dans la semaine suivant sa sortie.",
    tiers: [5, 20, 50, 100],
    getValue: (entries) =>
      entries.filter((e) => {
        if (!e.air_date || !e.watched_date) return false;
        const diff = daysBetween(e.watched_date, e.air_date);
        return diff >= 0 && diff <= 6;
      }).length,
  },
  {
    key: "big_day",
    name: "Grosse journée",
    icon: "⏳",
    description: "Bats ton record d'heures de visionnage en une journée, chaque mois.",
    tiers: [180, 360, 540, 720], // en minutes : 3h, 6h, 9h, 12h
    formatValue: (mins) => {
      const h = Math.floor(mins / 60);
      const m = mins % 60;
      return m > 0 ? `${h}h${String(m).padStart(2, "0")}` : `${h}h`;
    },
    getValue: (entries) => {
      const now = new Date();
      const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
      const byDay = {};
      entries.forEach((e) => {
        if (!e.watched_date || !e.runtime_minutes || !e.created_at) return;
        if (!e.watched_date.startsWith(currentMonth)) return;
        (byDay[e.watched_date] ||= []).push(e);
      });

      let maxMinutes = 0;
      for (const dayEntries of Object.values(byDay)) {
        // Des entrées créées exactement au même instant (à la microseconde
        // près) viennent forcément d'un seul clic groupé — import ou "tout
        // marquer comme vu" — jamais d'un vrai visionnage étalé sur la
        // journée. On ne garde que les horodatages uniques ce jour-là.
        const createdCounts = {};
        dayEntries.forEach((e) => (createdCounts[e.created_at] = (createdCounts[e.created_at] || 0) + 1));
        const realMinutes = dayEntries
          .filter((e) => createdCounts[e.created_at] === 1)
          .reduce((sum, e) => sum + e.runtime_minutes, 0);
        if (realMinutes > maxMinutes) maxMinutes = realMinutes;
      }
      return maxMinutes;
    },
  },
  {
    key: "holiday_binge",
    name: "Fêtes du visionnage",
    icon: "🎄",
    description: "Enregistre des visionnages entre le 24 décembre et le 1er janvier.",
    tiers: [5, 15, 40, 80],
    getValue: (entries) =>
      entries.filter((e) => {
        const d = new Date(e.watched_date);
        const m = d.getMonth() + 1;
        const day = d.getDate();
        return (m === 12 && day >= 24) || (m === 1 && day === 1);
      }).length,
  },
  {
    key: "late_finisher",
    name: "Mieux vaut tard",
    icon: "🐌",
    iconImage: "assets/badges/late_finisher.png",
    description: "Termine une série mise plus d'un an à finir.",
    check: (_entries, library) =>
      library.some(
        (l) =>
          l.media_type === "tv" &&
          l.status === "completed" &&
          l.first_watched_date &&
          l.last_watched_date &&
          daysBetween(l.last_watched_date, l.first_watched_date) >= 365
      ),
  },
  {
    key: "note_writer",
    name: "Plume assidue",
    icon: "✍️",
    iconImage: "assets/badges/note_writer.png",
    description: "Laisse un commentaire écrit sur au moins 20 entrées du journal.",
    check: (entries) => entries.filter((e) => e.note && e.note.trim()).length >= 20,
  },
  {
    key: "resurrection",
    name: "Résurrection",
    icon: "🔮",
    description: "Reprends un film ou une série après plus de 6 mois de pause.",
    tiers: [1, 3, 5, 10],
    getValue: (entries) => {
      const byWork = {};
      entries.forEach((e) => {
        if (!e.tmdb_id) return;
        const key = `${e.media_type}_${e.tmdb_id}`;
        (byWork[key] = byWork[key] || []).push(e.watched_date);
      });
      let resurrections = 0;
      Object.values(byWork).forEach((dates) => {
        const sorted = [...new Set(dates)].sort();
        for (let i = 1; i < sorted.length; i++) {
          if (daysBetween(sorted[i], sorted[i - 1]) >= 180) resurrections++;
        }
      });
      return resurrections;
    },
  },
];

async function evaluateBadges(entries, library, userId) {
  const results = {};
  const existingTiers = await DB.getBadgeTiers(userId);
  for (const badge of BADGES) {
    try {
      if (badge.tiers) {
        const value = badge.getValue(entries, library);
        const tier = tierReached(value, badge.tiers);
        results[badge.key] = { tier, value, maxTier: badge.tiers.length };
        if (tier > (existingTiers[badge.key] || 0)) await DB.awardBadgeTier(userId, badge.key, tier);
      } else {
        const ok = badge.check(entries, library);
        results[badge.key] = { tier: ok ? 1 : 0, maxTier: 1 };
        if (ok) await DB.awardBadge(userId, badge.key);
      }
    } catch (e) {
      console.error(`Erreur badge ${badge.key}`, e);
      results[badge.key] = { tier: 0, maxTier: badge.tiers ? badge.tiers.length : 1 };
    }
  }
  return results;
}