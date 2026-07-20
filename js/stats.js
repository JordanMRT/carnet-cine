// ============================================
// STATS — calculs à partir du journal
// ============================================

const Stats = {
  // genreMaps: { movie: {id: name}, tv: {id: name} } — voir TMDB.getGenreMap()
  compute(entries, library, genreMaps = { movie: {}, tv: {} }) {
    const totalEntries = entries.length;
    const movies = entries.filter((e) => e.media_type === "movie");
    const episodes = entries.filter((e) => e.media_type === "tv");

    const totalMinutes = entries.reduce((sum, e) => sum + (e.runtime_minutes || 0), 0);
    const totalMovieMinutes = movies.reduce((sum, e) => sum + (e.runtime_minutes || 0), 0);
    const totalTvMinutes = episodes.reduce((sum, e) => sum + (e.runtime_minutes || 0), 0);

    const ratedEntries = entries.filter((e) => e.rating != null);
    const avgRating = ratedEntries.length
      ? ratedEntries.reduce((s, e) => s + e.rating, 0) / ratedEntries.length
      : 0;

    const showsCompleted = library.filter(
      (l) => l.media_type === "tv" && l.status === "completed"
    ).length;
    const showsWatching = library.filter(
      (l) => l.media_type === "tv" && l.status === "watching"
    ).length;
    const watchlistCount = library.filter((l) => l.status === "watchlist").length;

    // Genres favoris — chaque film/série ne doit compter qu'une seule
    // fois (au moins commencée), pas une fois par épisode, sinon une
    // série de 100 épisodes écraserait le classement face aux films.
    // Affiché en nombre brut d'œuvres plutôt qu'en pourcentage : un %
    // recalcule sa base à chaque nouveau visionnage (voir le badge
    // "Spécialiste d'un genre"), donc ne représente jamais un vrai
    // palier de progression pour l'utilisateur.
    const genreCount = {};
    const seenWorksForGenres = new Set();
    entries.forEach((e) => {
      const workKey = `${e.media_type}_${e.tmdb_id}`;
      if (seenWorksForGenres.has(workKey)) return;
      seenWorksForGenres.add(workKey);
      const map = genreMaps[e.media_type] || {};
      (e.genres || []).forEach((gid) => {
        const label = map[gid] || map[Number(gid)] || `Genre ${gid}`;
        genreCount[label] = (genreCount[label] || 0) + 1;
      });
    });
    const topGenres = Object.entries(genreCount)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6);

    // Entrées par mois (12 derniers mois)
    const monthly = {};
    const now = new Date();
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      monthly[key] = 0;
    }
    entries.forEach((e) => {
      const d = new Date(e.watched_date);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      if (key in monthly) monthly[key] += 1;
    });

    // Meilleures notes — un seul ticket par œuvre (la note s'applique à
    // tout le journal de ce film/série), avec la date du premier
    // visionnage. Tri par note, puis par date la plus récente ; 4 max.
    const byWork = new Map();
    ratedEntries.forEach((e) => {
      const key = `${e.media_type}_${e.tmdb_id}`;
      const existing = byWork.get(key);
      if (!existing || e.watched_date < existing.watched_date) {
        byWork.set(key, { ...e, rewatch: false });
      }
    });
    const topRated = [...byWork.values()]
      .sort((a, b) => b.rating - a.rating || b.watched_date.localeCompare(a.watched_date))
      .slice(0, 4);

    return {
      totalEntries,
      moviesCount: movies.length,
      episodesCount: episodes.length,
      totalMinutes,
      totalMovieMinutes,
      totalTvMinutes,
      avgRating,
      showsCompleted,
      showsWatching,
      watchlistCount,
      topGenres,
      monthly,
      topRated,
    };
  },

  renderMonthlyChart(monthly) {
    const entries = Object.entries(monthly);
    const max = Math.max(...entries.map(([, v]) => v), 1);
    const bars = entries
      .map(([key, val]) => {
        const [y, m] = key.split("-");
        const label = new Date(y, m - 1, 1).toLocaleDateString("fr-FR", { month: "short" });
        const h = Math.round((val / max) * 100);
        return `
          <div class="chart-bar-wrap">
            <div class="chart-bar" style="height:${h}%" title="${val} entrées"></div>
            <span class="chart-bar-label">${label}</span>
          </div>`;
      })
      .join("");
    return `<div class="chart chart--monthly">${bars}</div>`;
  },

  // topGenres: [[label, count], ...]
  renderGenreChart(topGenres) {
    const max = Math.max(...topGenres.map(([, count]) => count), 1);
    return topGenres
      .map(
        ([genre, count]) => `
      <div class="genre-row">
        <span class="genre-row-label">${escapeHtml(genre)}</span>
        <div class="genre-row-track">
          <div class="genre-row-fill" style="width:${(count / max) * 100}%"></div>
        </div>
        <span class="genre-row-count">${count}</span>
      </div>`
      )
      .join("");
  },
};