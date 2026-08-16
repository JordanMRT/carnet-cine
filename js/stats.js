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

    // Meilleures notes — un ticket par œuvre. On part de `library` (dont
// avg_rating est déjà la vraie moyenne des notes du journal pour cette
// œuvre, recalculée par LibraryBuilder) plutôt que d'une ligne
// diary_entries arbitraire : noter une série entière via setWorkRating
// copie la même note sur CHAQUE épisode du journal, donc piocher "la
// première entrée trouvée" revenait à afficher un épisode au hasard
// (ex. S1E5) comme s'il représentait toute la série. Tri par note,
// puis par dernier visionnage le plus récent ; 4 max.
const topRated = library
  .filter((l) => l.avg_rating != null)
  .sort(
    (a, b) =>
      b.avg_rating - a.avg_rating ||
      (b.last_watched_date || "").localeCompare(a.last_watched_date || "")
  )
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

// ============================================
  // WRAPPED ANNUEL — calculs dédiés, séparés de compute() pour ne pas
  // risquer de modifier le comportement des stats existantes (qui
  // raisonnent en 12 derniers mois glissants, pas en année civile).
  // entries/library : mêmes formes que pour compute(). year : ex. 2026.
  // ============================================
  computeForYear(entries, library, genreMaps = { movie: {}, tv: {} }, year) {
    const yearEntries = entries.filter((e) => {
      const d = new Date(e.watched_date);
      return !Number.isNaN(d.getTime()) && d.getFullYear() === year;
    });

    const movies = yearEntries.filter((e) => e.media_type === "movie");
    const episodes = yearEntries.filter((e) => e.media_type === "tv");
    const totalMinutes = yearEntries.reduce((sum, e) => sum + (e.runtime_minutes || 0), 0);

    // Séries terminées "de l'année" : approximation — on ne connaît pas
    // l'historique des statuts, seulement le statut actuel de `library`.
    // On considère donc une série comme "terminée cette année-là" si au
    // moins un épisode a été regardé pendant l'année ET que son statut
    // actuel est "completed". Une série finie depuis mais dont le dernier
    // épisode regardé date de l'année visée compte, ce qui est le
    // comportement voulu pour un récap.
    const libraryStatusByWork = new Map(
      library.map((l) => [`${l.media_type}_${l.tmdb_id}`, l.status])
    );
    const showsCompletedInYear = new Set(
      episodes
        .filter((e) => libraryStatusByWork.get(`${e.media_type}_${e.tmdb_id}`) === "completed")
        .map((e) => `${e.media_type}_${e.tmdb_id}`)
    ).size;

    // Genres — même logique de dédoublonnage par œuvre que compute(),
    // mais restreinte aux entrées de l'année ciblée.
    const genreCount = {};
    const seenWorksForGenres = new Set();
    yearEntries.forEach((e) => {
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
      .slice(0, 4);
    const topGenre = topGenres.length ? { label: topGenres[0][0], count: topGenres[0][1] } : null;

    // Mois le plus intense — 12 mois fixes de l'année ciblée (contrairement
    // à compute() qui glisse sur les 12 derniers mois depuis aujourd'hui).
    const monthly = [];
    for (let m = 0; m < 12; m++) {
      const label = new Date(year, m, 1).toLocaleDateString("fr-FR", { month: "long" });
      monthly.push({ key: `${year}-${String(m + 1).padStart(2, "0")}`, label, value: 0 });
    }
    yearEntries.forEach((e) => {
      const d = new Date(e.watched_date);
      monthly[d.getMonth()].value += 1;
    });
    const peakMonth = monthly.reduce(
      (best, m) => (!best || m.value > best.value ? m : best),
      null
    );

    // Meilleures notes de l'année — dédoublonnées par œuvre (une série
    // notée copie la même note sur chaque épisode, voir compute()), en
    // gardant l'entrée la plus représentative de chaque œuvre plutôt que
    // la première rencontrée au hasard.
    const ratedByWork = new Map();
    yearEntries
      .filter((e) => e.rating != null)
      .forEach((e) => {
        const workKey = `${e.media_type}_${e.tmdb_id}`;
        const existing = ratedByWork.get(workKey);
        if (!existing || e.rating > existing.rating || (e.rating === existing.rating && e.watched_date > existing.watched_date)) {
          ratedByWork.set(workKey, e);
        }
      });
    const topRated = Array.from(ratedByWork.values())
      .sort((a, b) => b.rating - a.rating || (b.watched_date || "").localeCompare(a.watched_date || ""))
      .slice(0, 4)
      .map((e) => ({
        title: e.title,
        mediaType: e.media_type,
        tmdbId: e.tmdb_id,
        rating: e.rating,
        posterPath: e.poster_path,
      }));

    // Pool d'affiches pour la mosaïque finale — une par œuvre distincte,
    // uniquement celles avec une affiche connue, triées par note puis
    // récence pour privilégier les œuvres marquantes de l'année.
    const seenWorksForPosters = new Set();
    const posterPool = yearEntries
      .slice()
      .sort((a, b) => (b.rating || 0) - (a.rating || 0) || (b.watched_date || "").localeCompare(a.watched_date || ""))
      .filter((e) => {
        const workKey = `${e.media_type}_${e.tmdb_id}`;
        if (!e.poster_path || seenWorksForPosters.has(workKey)) return false;
        seenWorksForPosters.add(workKey);
        return true;
      })
      .slice(0, 12)
      .map((e) => ({ title: e.title, mediaType: e.media_type, tmdbId: e.tmdb_id, posterPath: e.poster_path }));

    return {
      year,
      totalEntries: yearEntries.length,
      moviesCount: movies.length,
      episodesCount: episodes.length,
      totalMinutes,
      showsCompletedInYear,
      topGenres,
      topGenre,
      monthly,
      peakMonth,
      topRated,
      posterPool,
    };
  },

  renderMonthlyChart(monthly) {
    const entries = Object.entries(monthly);
    const data = entries.map(([key, val]) => {
      const [y, m] = key.split("-");
      const label = new Date(y, m - 1, 1).toLocaleDateString("fr-FR", { month: "short" });
      return { val, label };
    });

    const colW = 86;
    const padL = 18, padR = 20, padTop = 40, padBottom = 34;
    const pointInset = 10;
    const n = data.length;
    const plotW = colW * (n - 1);
    const W = padL + plotW + padR;
    const H = 210;
    const plotH = H - padTop - padBottom;

    const sqrtScale = (v) => Math.sqrt(v);
    const realMax = Math.max(...data.map((d) => d.val), 1);
    const domainMax = sqrtScale(realMax) * 1.3;

    const x0 = padL + pointInset, x1 = W - padR - pointInset;
    const stepX = n > 1 ? (x1 - x0) / (n - 1) : 0;

    const points = data.map((d, i) => ({
      ...d,
      x: x0 + stepX * i,
      y: padTop + plotH - (sqrtScale(d.val) / domainMax) * plotH,
    }));

    const linePath = points
      .map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`)
      .join(" ");

    // Grille purement décorative : intervalles réguliers de la hauteur du
    // graphique, sans lien avec les valeurs réelles (les chiffres exacts
    // sont déjà portés par chaque point, l'axe n'a plus besoin de graduer).
    const gridlines = [0.25, 0.5, 0.75, 1]
      .map((frac) => {
        const y = padTop + plotH - frac * plotH;
        return `<line class="chart-grid" x1="${padL}" y1="${y.toFixed(1)}" x2="${W - padR}" y2="${y.toFixed(1)}"></line>`;
      })
      .join("");

    // Placement adaptatif : le chiffre est toujours au-dessus du point par
    // défaut (le plus lisible), sauf s'il n'y a pas la place en haut du
    // cadre (pic proche du sommet) — dans ce cas il bascule en-dessous,
    // sans jamais pouvoir chevaucher la ligne des noms de mois.
    const labelGap = 12, topLimit = 14, bottomLimit = H - padBottom - 8;
    const pointsSvg = points
      .map((p) => {
        const aboveY = p.y - labelGap;
        const labelY = aboveY >= topLimit ? aboveY : Math.min(p.y + labelGap + 4, bottomLimit);
        return `
          <circle class="chart-dot" cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="4"></circle>
          <text class="chart-point-value" x="${p.x.toFixed(1)}" y="${labelY.toFixed(1)}" text-anchor="middle">${p.val}</text>
          <text class="chart-month-label" x="${p.x.toFixed(1)}" y="${H - 10}" text-anchor="middle">${p.label}</text>`;
      })
      .join("");

    return `
      <div class="chart chart--monthly">
        <svg class="chart-svg" viewBox="0 0 ${W} ${H}" width="${W}">
          ${gridlines}
          <path class="chart-line" d="${linePath}"></path>
          ${pointsSvg}
        </svg>
      </div>`;
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