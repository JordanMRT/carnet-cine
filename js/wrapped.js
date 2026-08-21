// ============================================
// WRAPPED — génère les 6 cartes du récap annuel en 1080x1920 (canvas),
// une par une, sur le modèle de TicketShare (mêmes helpers : roundRectPath,
// loadImageCORS, tmdbImageProxyUrl, wrapText, mulberry32 — tous globaux,
// définis dans ticket-share.js / utils.js).
//
// Ce fichier ne fait QUE le rendu (bloc 2). Le carrousel / bouton partager
// dans l'UI viendra dans un fichier séparé pour ne pas mélanger les deux.
// ============================================

const Wrapped = {
  CARD_W: 1080,
  CARD_H: 1920,

  // stats : sortie de Stats.computeForYear(...)
  // profile : { username, avatarUrl } — optionnel, fallback sur "Toi"
  async generateCanvases(stats, profile = {}) {
    await this._preloadFonts();
    return [
      await this._cardCover(stats, profile),
      await this._cardBigNumber(stats),
      await this._cardTopRated(stats),
      await this._cardGenre(stats),
      await this._cardMonth(stats),
      await this._cardFinal(stats),
    ];
  },

  async downloadCard(canvas, index) {
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `ttb-wrapped-${index + 1}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 3000);
  },

  // Partage une seule carte (celle affichée à l'écran au moment du tap)
  async shareCard(canvas, stats) {
    try {
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
      if (!blob) throw new Error("Impossible de générer l'image.");
      const file = new File([blob], `ttb-wrapped-${stats.year}.png`, { type: "image/png" });

      if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({
          files: [file],
          title: `Mon ${stats.year} sur Time To Binge`,
          text: `Mon année ${stats.year} sur Time To Binge 🎟️`,
        });
      } else {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `ttb-wrapped-${stats.year}.png`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 3000);
        toast("Image téléchargée 🎟️", "success");
      }
    } catch (err) {
      if (err?.name !== "AbortError") toast("Impossible de partager cette carte pour l'instant.", "error");
    }
  },

  // ---------- Thème ----------
  _theme() {
    const ink = "#0e0f14";
    const cream = "#f2efe9";
    const border = "#34374d";
    const muted = "#8a8ea3";
    const bgElevated = "#23263a";
    // Comme ticket-share.js : le canvas ne peut pas lire les CSS vars
    // directement, on résout au moment du dessin pour hériter du thème actif.
    const rootStyles = getComputedStyle(document.documentElement);
    const bg = rootStyles.getPropertyValue("--bg").trim() || "#1b1d2a";
    const mustard = rootStyles.getPropertyValue("--mustard").trim() || "#e8a33d";
    const coral = rootStyles.getPropertyValue("--coral").trim() || "#e8636b";
    const sage = rootStyles.getPropertyValue("--sage").trim() || "#7c9885";
    return { bg, bgElevated, ink, cream, border, muted, mustard, coral, sage };
  },

  async _preloadFonts() {
    await Promise.all([
      document.fonts.load('900 200px "Unbounded"').catch(() => {}),
      document.fonts.load('800 40px "Unbounded"').catch(() => {}),
      document.fonts.load('700 40px "Unbounded"').catch(() => {}),
      document.fonts.load('600 40px "Unbounded"').catch(() => {}),
      document.fonts.load('700 30px "Albert Sans"').catch(() => {}),
      document.fonts.load('500 30px "Albert Sans"').catch(() => {}),
      document.fonts.load('400 30px "Albert Sans"').catch(() => {}),
      document.fonts.load('800 24px "Nunito Sans"').catch(() => {}),
      document.fonts.load('700 24px "Nunito Sans"').catch(() => {}),
      document.fonts.load('600 24px "Nunito Sans"').catch(() => {}),
    ]);
  },

  // ---------- Coquille commune à toutes les cartes ----------
  // Dessine fond, perforation, eyebrow et pied de page ; retourne la zone
  // de contenu disponible pour le dessin spécifique à chaque carte.
  // Les coordonnées reprennent exactement celles du prototype HTML
  // (inset 84px/60px sur un cadre 1080x1920), donc pas de recalcul d'échelle.
  _shell(ctx, theme, { eyebrow, accent, background }) {
    const W = this.CARD_W;
    const H = this.CARD_H;

    ctx.fillStyle = background || theme.bg;
    ctx.fillRect(0, 0, W, H);

    // Perforation (haut + bas), 8 pastilles espacées entre 46px de marge
    const dotY = [34, H - 34];
    const dotR = 7;
    const padX = 46;
    const usableW = W - padX * 2 - dotR * 2;
    const gap = usableW / 7;
    ctx.fillStyle = "rgba(10,10,16,0.55)";
    dotY.forEach((y) => {
      for (let i = 0; i < 8; i++) {
        const x = padX + dotR + gap * i;
        ctx.beginPath();
        ctx.arc(x, y, dotR, 0, Math.PI * 2);
        ctx.fill();
      }
    });

    const innerX = 60;
    const innerY = 84;
    const innerW = W - 120;
    const innerBottom = H - 84;

    // Eyebrow
    ctx.fillStyle = accent || theme.mustard;
    ctx.font = '800 26px "Nunito Sans", sans-serif';
    ctx.textAlign = "left";
    ctx.fillText(eyebrow.toUpperCase(), innerX, innerY + 26);

    // Pied de page (marque + tag), séparé par une ligne pointillée
    const footerBorderY = innerBottom - 74;
    ctx.strokeStyle = theme.border;
    ctx.lineWidth = 2;
    ctx.setLineDash([10, 10]);
    ctx.beginPath();
    ctx.moveTo(innerX, footerBorderY);
    ctx.lineTo(innerX + innerW, footerBorderY);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = theme.cream;
    ctx.font = '700 28px "Unbounded", sans-serif';
    ctx.textAlign = "left";
    ctx.fillText("Time To Binge", innerX, footerBorderY + 46);

    // La largeur d'un emoji mesurée par Canvas2D n'est pas fiable sur
    // iOS/Safari (surtout avec un sélecteur de variation comme sur 🎟️) —
    // ça poussait/écrasait le bloc selon comment on s'en servait pour le
    // positionner. On aligne le texte ASCII (mesure fiable), puis on place
    // l'emoji à une distance FIXE de son bord gauche, sans jamais utiliser
    // sa propre largeur mesurée. Valeurs validées manuellement sur iPhone.
    ctx.fillStyle = theme.muted;
    ctx.font = '600 22px "Nunito Sans", sans-serif';
    const tagText = "#TTBWrapped";
    const tagRightEdge = innerX + innerW;
    ctx.textAlign = "right";
    ctx.fillText(tagText, tagRightEdge, footerBorderY + 44);
    const tagW = ctx.measureText(tagText).width;
    const textLeftEdge = tagRightEdge - tagW;
    const EMOJI_SLOT = 20;
    const GAP_EMOJI_TEXTE = 12;
    ctx.textAlign = "left";
    ctx.fillText("🎟️", textLeftEdge - GAP_EMOJI_TEXTE - EMOJI_SLOT, footerBorderY + 44);
    ctx.textAlign = "left";

    // Zone de contenu disponible entre l'eyebrow et le pied de page
    const contentTop = innerY + 74;
    const contentBottom = footerBorderY - 30;
    return { x: innerX, y: contentTop, w: innerW, h: contentBottom - contentTop, bottom: contentBottom };
  },

  _newCanvas() {
    const canvas = document.createElement("canvas");
    canvas.width = this.CARD_W;
    canvas.height = this.CARD_H;
    return { canvas, ctx: canvas.getContext("2d") };
  },

  // Équivalent canvas de radial-gradient(circle at Xfrac Yfrac, highlight 0%,
  // theme.bg stopFrac%) — repris tel quel du prototype HTML (cartes 1 et 4).
  _radialHalo(ctx, theme, cxFrac, cyFrac, highlight, stopFrac = 0.55) {
    const w = this.CARD_W;
    const h = this.CARD_H;
    const cx = w * cxFrac;
    const cy = h * cyFrac;
    const corners = [[0, 0], [w, 0], [0, h], [w, h]];
    const r = Math.max(...corners.map(([x, y]) => Math.hypot(x - cx, y - cy)));
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    grad.addColorStop(0, highlight);
    grad.addColorStop(stopFrac, theme.bg);
    return grad;
  },

  // Équivalent canvas de linear-gradient(angleDeg, ...stops) — même
  // convention d'angle que CSS (0deg = vers le haut, sens horaire).
  _linearHalo(ctx, angleDeg, stops) {
    const w = this.CARD_W;
    const h = this.CARD_H;
    const rad = (angleDeg * Math.PI) / 180;
    const dx = Math.sin(rad);
    const dy = -Math.cos(rad);
    const cx = w / 2;
    const cy = h / 2;
    const len = Math.hypot(w, h);
    const grad = ctx.createLinearGradient(cx - (dx * len) / 2, cy - (dy * len) / 2, cx + (dx * len) / 2, cy + (dy * len) / 2);
    stops.forEach(([offset, color]) => grad.addColorStop(offset, color));
    return grad;
  },

  // ---------- Carte 1 — Cover ----------
  async _cardCover(stats, profile) {
    const theme = this._theme();
    const { canvas, ctx } = this._newCanvas();
    const background = this._radialHalo(ctx, theme, 0.3, 0.15, "#2a2d42");
    const content = this._shell(ctx, theme, { eyebrow: "Récap annuel", background });

    // Bandeau de pellicule décoratif à droite, très discret
    ctx.save();
    ctx.globalAlpha = 0.1;
    ctx.fillStyle = theme.mustard;
    for (let i = 0; i < 5; i++) {
      roundRectPath(ctx, this.CARD_W - 170, 120 + i * 330, 160, 260, 14);
      ctx.fill();
    }
    ctx.restore();

    const yearStr = String(stats.year);
    const y1 = yearStr.slice(0, 2);
    const y2 = yearStr.slice(2);

    let y = content.y + 620;
    ctx.font = '900 210px "Unbounded", sans-serif';
    ctx.fillStyle = theme.cream;
    const w1 = ctx.measureText(y1).width;
    ctx.fillText(y1, content.x, y);
    ctx.fillStyle = theme.mustard;
    ctx.fillText(y2, content.x + w1, y);

    y += 70;
    ctx.fillStyle = theme.cream;
    ctx.font = '600 46px "Unbounded", sans-serif';
    y = wrapText(ctx, "Ton année au cinéma, ou sur le canapé", content.x, y, 780, 56, 2);

    y += 90;
    ctx.fillStyle = theme.cream;
    ctx.font = '300 40px "Unbounded", sans-serif';
    y = wrapText(ctx, "On rewind ensemble : film après film, épisode par épisode ?", content.x, y, 780, 56, 3);

    // Avatar + pseudo, ancrés en bas de la zone de contenu
    const avatarY = content.bottom - 42;
    const avatarR = 42;
    ctx.save();
    const grad = ctx.createLinearGradient(content.x, avatarY - avatarR, content.x + avatarR * 2, avatarY + avatarR);
    grad.addColorStop(0, theme.coral);
    grad.addColorStop(1, theme.mustard);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(content.x + avatarR, avatarY, avatarR, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = theme.cream;
    ctx.lineWidth = 3;
    ctx.stroke();
    if (profile.avatarUrl) {
      try {
        const img = await loadImageCORS(profile.avatarUrl);
        ctx.save();
        ctx.beginPath();
        ctx.arc(content.x + avatarR, avatarY, avatarR - 2, 0, Math.PI * 2);
        ctx.clip();
        ctx.drawImage(img, content.x, avatarY - avatarR, avatarR * 2, avatarR * 2);
        ctx.restore();
      } catch {
        // fallback : garde le dégradé déjà dessiné
      }
    }
    ctx.restore();

    ctx.fillStyle = theme.cream;
    ctx.font = '700 30px "Nunito Sans", sans-serif';
    ctx.fillText(profile.username || "Toi", content.x + avatarR * 2 + 24, avatarY + 10);

    return canvas;
  },

  // ---------- Carte 2 — Le chiffre choc ----------
  async _cardBigNumber(stats) {
    const theme = this._theme();
    const { canvas, ctx } = this._newCanvas();
    const background = this._linearHalo(ctx, 165, [[0, theme.bg], [0.6, "#241826"], [1, theme.bg]]);
    const content = this._shell(ctx, theme, { eyebrow: "Le chiffre de l'année", accent: theme.coral, background });

    const totalHours = Math.round(stats.totalMinutes / 60);

    let y = content.y + 620;
    ctx.fillStyle = theme.coral;
    ctx.font = '900 260px "Unbounded", sans-serif';
    ctx.fillText(String(totalHours), content.x, y);

    y += 70;
    ctx.fillStyle = theme.cream;
    ctx.font = '700 54px "Unbounded", sans-serif';
    // wrapText plutôt que fillText direct : un texte plus long que prévu
    // (après une retouche éditoriale) doit revenir à la ligne au lieu de
    // sortir du cadre de la carte.
    y = wrapText(ctx, "heures passées devant des films et des séries", content.x, y, content.w, 60, 2);

    // Comparaison absurde — réutilise ABSURD_MOVIE_REFERENCES (utils.js).
    // Simplification assumée : on compare le total combiné films+séries à
    // une référence "film", ce qui reste lisible même si ce n'est pas
    // rigoureusement homogène (comme les easter eggs existants sur les stats).
    y += 60;
    const boxTop = y;
    const boxH = 170;
    ctx.fillStyle = theme.bgElevated;
    roundRectPath(ctx, content.x, boxTop, content.w, boxH, 20);
    ctx.fill();
    ctx.strokeStyle = theme.border;
    ctx.lineWidth = 2;
    roundRectPath(ctx, content.x, boxTop, content.w, boxH, 20);
    ctx.stroke();

    if (stats.totalMinutes > 0) {
      const ref = ABSURD_MOVIE_REFERENCES[Math.floor(Math.random() * ABSURD_MOVIE_REFERENCES.length)];
      const ratio = stats.totalMinutes / ref.minutes;
      const ratioText = formatAbsurdRatio(ratio);
      ctx.fillStyle = theme.cream;
      ctx.font = '400 30px "Albert Sans", sans-serif';
      wrapText(ctx, "Soit assez de temps pour regarder", content.x + 36, boxTop + 56, content.w - 72, 40, 1);
      ctx.fillStyle = theme.sage;
      ctx.font = '700 34px "Albert Sans", sans-serif';
      wrapText(ctx, `${ref.title} en intégrale ${ratioText} fois d'affilée.`, content.x + 36, boxTop + 102, content.w - 72, 42, 2);
    }

    // Pastilles films / épisodes / séries terminées
    const pillY = boxTop + boxH + 44;
    const pillH = 150;
    const gap = 20;
    const pillW = (content.w - gap * 2) / 3;
    const pills = [
      { n: stats.moviesCount, l: "films" },
      { n: stats.episodesCount, l: "épisodes" },
      { n: stats.showsCompletedInYear, l: "séries finies" },
    ];
    pills.forEach((p, i) => {
      const px = content.x + i * (pillW + gap);
      ctx.fillStyle = theme.bgElevated;
      roundRectPath(ctx, px, pillY, pillW, pillH, 18);
      ctx.fill();
      ctx.fillStyle = theme.mustard;
      ctx.font = '800 52px "Unbounded", sans-serif';
      ctx.textAlign = "center";
      ctx.fillText(String(p.n), px + pillW / 2, pillY + 76);
      ctx.fillStyle = theme.muted;
      ctx.font = '600 22px "Nunito Sans", sans-serif';
      ctx.fillText(p.l, px + pillW / 2, pillY + 112);
      ctx.textAlign = "left";
    });

    return canvas;
  },

  // ---------- Carte 3 — Pépite mieux notée ----------
  async _cardTopRated(stats) {
    const theme = this._theme();
    const { canvas, ctx } = this._newCanvas();
    const content = this._shell(ctx, theme, { eyebrow: "Ta pépite de l'année" });

    const top = stats.topRated?.[0] || null;
    const posterW = 420, posterH = 630;
    const posterX = content.x + (content.w - posterW) / 2;
    const posterY = content.y + 320;

    ctx.save();
    roundRectPath(ctx, posterX, posterY, posterW, posterH, 22);
    ctx.clip();
    let drewImage = false;
    if (top?.posterPath) {
      try {
        const img = await loadImageCORS(tmdbImageProxyUrl(TMDB.posterUrl(top.posterPath, "w500")));
        drawImageCover(ctx, img, posterX, posterY, posterW, posterH);
        drewImage = true;
      } catch {
        drewImage = false;
      }
    }
    if (!drewImage) {
      const grad = ctx.createLinearGradient(posterX, posterY, posterX + posterW, posterY + posterH);
      grad.addColorStop(0, "#3a3550");
      grad.addColorStop(1, "#211c30");
      ctx.fillStyle = grad;
      ctx.fillRect(posterX, posterY, posterW, posterH);
      ctx.globalAlpha = 0.35;
      ctx.font = "90px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("🎬", posterX + posterW / 2, posterY + posterH / 2 + 30);
      ctx.textAlign = "left";
      ctx.globalAlpha = 1;
    }
    ctx.restore();
    ctx.strokeStyle = theme.border;
    ctx.lineWidth = 3;
    roundRectPath(ctx, posterX, posterY, posterW, posterH, 22);
    ctx.stroke();

    let y = posterY + posterH + 80;
    ctx.fillStyle = theme.cream;
    ctx.font = '700 52px "Unbounded", sans-serif';
    ctx.textAlign = "center";
    if (top) {
      y = wrapText(
        ctx,
        top.title,
        content.x + content.w / 2,
        y,
        content.w - 80,
        58,
        2
      );
    } else {
      ctx.fillText("Pas encore de coup de cœur", content.x + content.w / 2, y);
    }

    y += 70;
    if (top?.rating != null) {
      const filled = Math.round((top.rating / 10) * 5);
      ctx.font = "42px sans-serif";
      const starsWidth = 5 * 56;
      let sx = content.x + content.w / 2 - starsWidth / 2;
      for (let i = 0; i < 5; i++) {
        ctx.fillStyle = i < filled ? theme.mustard : theme.border;
        ctx.fillText("★", sx, y);
        sx += 56;
      }
      y += 50;
      ctx.fillStyle = theme.muted;
      ctx.font = '600 26px "Nunito Sans", sans-serif';
      ctx.fillText(`${(top.rating / 2).toFixed(1)} / 5 : ta meilleure note de l'année`, content.x + content.w / 2, y);
    }
    ctx.textAlign = "left";

    return canvas;
  },
  // ---------- Carte 4 — Genre de l'année ----------
  async _cardGenre(stats) {
    const theme = this._theme();
    const { canvas, ctx } = this._newCanvas();
    const background = this._radialHalo(ctx, theme, 0.75, 0.85, "#1e2e28");
    const content = this._shell(ctx, theme, { eyebrow: "Ton genre de l'année", accent: theme.sage, background });

    const top = stats.topGenre;
    let y = content.y + 520;
    ctx.fillStyle = theme.sage;
    ctx.font = '900 118px "Unbounded", sans-serif';
    y = wrapText(ctx, top ? top.label : "—", content.x, y, content.w, 118, 1);

    y += 56;
    ctx.fillStyle = theme.muted;
    ctx.font = '400 32px "Albert Sans", sans-serif';
    const lead = top
      ? `${top.count} œuvre${top.count > 1 ? "s" : ""} regardée${top.count > 1 ? "s" : ""} dans ce genre cette année, devant tout le reste.`
      : "Pas encore assez de genres suivis cette année.";
    y = wrapText(ctx, lead, content.x, y, content.w - 200, 42, 2);

    // Classement des genres (jusqu'à 4)
    y += 60;
    const rowH = 78;
    const maxCount = Math.max(...(stats.topGenres || []).map(([, c]) => c), 1);
    (stats.topGenres || []).forEach(([label, count], i) => {
      const rowY = y + i * rowH;
      ctx.fillStyle = theme.muted;
      ctx.font = '800 24px "Nunito Sans", sans-serif';
      ctx.fillText(String(i + 1).padStart(2, "0"), content.x, rowY + 8);

      ctx.fillStyle = i === 0 ? theme.sage : theme.cream;
      ctx.font = '600 30px "Unbounded", sans-serif';
      ctx.fillText(label, content.x + 70, rowY + 10);

      const trackX = content.x + 320;
      const trackW = content.w - 320 - 70;
      ctx.fillStyle = theme.bgElevated;
      roundRectPath(ctx, trackX, rowY - 10, trackW, 20, 10);
      ctx.fill();
      ctx.fillStyle = theme.sage;
      roundRectPath(ctx, trackX, rowY - 10, trackW * (count / maxCount), 20, 10);
      ctx.fill();

      ctx.fillStyle = theme.muted;
      ctx.font = '600 24px "Nunito Sans", sans-serif';
      ctx.textAlign = "right";
      ctx.fillText(String(count), content.x + content.w, rowY + 8);
      ctx.textAlign = "left";
    });

    return canvas;
  },

  // ---------- Carte 5 — Mois le plus intense ----------
  async _cardMonth(stats) {
    const theme = this._theme();
    const { canvas, ctx } = this._newCanvas();
    const background = this._linearHalo(ctx, 180, [[0, theme.bg], [0.65, "#241c14"], [1, theme.bg]]);
    const content = this._shell(ctx, theme, { eyebrow: "Ton mois le plus intense", background });

    const peak = stats.peakMonth;
    let y = content.y + 520;
    ctx.fillStyle = theme.mustard;
    ctx.font = '900 136px "Unbounded", sans-serif';
    ctx.fillText(peak ? capitalize(peak.label) : "—", content.x, y);

    y += 66;
    ctx.fillStyle = theme.cream;
    ctx.font = '400 32px "Albert Sans", sans-serif';
    const lead = peak && peak.value > 0
      ? `Avec ${peak.value} visionnage${peak.value > 1 ? "s" : ""}, ce mois a explosé tous les autres.`
      : "Pas encore assez de visionnages pour dégager une tendance.";
    y = wrapText(ctx, lead, content.x, y, content.w - 100, 42, 2);

    // Graphique à barres — un seul mois (le pic) ressort en couleur,
    // exactement comme validé sur le prototype.
    y += 50;
    const chartH = 340;
    const cols = 12;
    const gap = 12;
    const colW = (content.w - gap * (cols - 1)) / cols;
    const maxVal = Math.max(...stats.monthly.map((m) => m.value), 1);
    const baseline = y + chartH;

    stats.monthly.forEach((m, i) => {
      const x = content.x + i * (colW + gap);
      const isPeak = peak && m.key === peak.key;
      const barH = Math.max((m.value / maxVal) * chartH, 8);
      ctx.fillStyle = isPeak ? theme.mustard : theme.bgElevated;
      roundRectPath(ctx, x, baseline - barH, colW, barH, [6, 6, 0, 0]);
      ctx.fill();

      ctx.fillStyle = isPeak ? theme.mustard : theme.muted;
      ctx.font = `${isPeak ? "800" : "600"} 18px "Nunito Sans", sans-serif`;
      ctx.textAlign = "center";
      // slice(0,3) confondait juin/juillet ("JUI" pour les deux) — table dédiée
      ctx.fillText(MONTH_ABBR[i], x + colW / 2, baseline + 34);
      ctx.textAlign = "left";
    });

    return canvas;
  },

  // ---------- Carte 6 — Finale mosaïque + partage ----------
  async _cardFinal(stats) {
    const theme = this._theme();
    const { canvas, ctx } = this._newCanvas();
    const content = this._shell(ctx, theme, { eyebrow: "Rideau", accent: theme.coral });

    let y = content.y + 60;
    ctx.fillStyle = theme.cream;
    ctx.font = '800 56px "Unbounded", sans-serif';
    const posterCount = stats.posterPool?.length || 0;
    const headline =
      posterCount > 0
        ? `${posterCount} affiche${posterCount > 1 ? "s" : ""}, une seule année de folie.`
        : "Une année de folie, résumée en un clin d'œil.";
    y = wrapText(ctx, headline, content.x, y, content.w, 64, 2);

    // Mosaïque 4x3
    y += 40;
    const cols = 4, rows = 3, gap = 12;
    const tileW = (content.w - gap * (cols - 1)) / cols;
    const mosaicH = content.bottom - y - 180; // laisse la place au message + logo en dessous
    const tileH = (mosaicH - gap * (rows - 1)) / rows;
    const fallbackGradients = [
      ["#3a3550", "#211c30"],
      ["#4a3040", "#251522"],
      ["#2e3d38", "#182420"],
    ];
    const pool = stats.posterPool || [];

    for (let i = 0; i < cols * rows; i++) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const tx = content.x + col * (tileW + gap);
      const ty = y + row * (tileH + gap);
      const item = pool[i];

      ctx.save();
      roundRectPath(ctx, tx, ty, tileW, tileH, 14);
      ctx.clip();
      let drew = false;
      if (item?.posterPath) {
        try {
          const img = await loadImageCORS(tmdbImageProxyUrl(TMDB.posterUrl(item.posterPath, "w342")));
          drawImageCover(ctx, img, tx, ty, tileW, tileH);
          drew = true;
        } catch {
          drew = false;
        }
      }
      if (!drew) {
        const [c1, c2] = fallbackGradients[i % fallbackGradients.length];
        const grad = ctx.createLinearGradient(tx, ty, tx + tileW, ty + tileH);
        grad.addColorStop(0, c1);
        grad.addColorStop(1, c2);
        ctx.fillStyle = grad;
        ctx.fillRect(tx, ty, tileW, tileH);
      }
      ctx.restore();
      ctx.strokeStyle = theme.border;
      ctx.lineWidth = 2;
      roundRectPath(ctx, tx, ty, tileW, tileH, 14);
      ctx.stroke();
    }

    // CTA décoratif — le vrai bouton de partage vit dans l'UI (hors image),
    // celui-ci ne fait que reproduire fidèlement le prototype validé.
    // Message de clôture + logo — les vrais boutons partager/télécharger
    // vivent dans l'UI (hors image, voir wrapped-ui.js), donc plus besoin
    // d'un CTA dessiné en dur ici.
    const closingY = y + mosaicH + gap + 56;
    ctx.fillStyle = theme.cream;
    ctx.font = '600 36px "Unbounded", sans-serif';
    ctx.textAlign = "center";
    ctx.fillText("Merci pour cette année ensemble", content.x + content.w / 2, closingY);
    ctx.textAlign = "left";

    try {
      const logo = await loadImageCORS("ttb-logo-ticket.png");
      const logoW = 170;
      const logoH = (logoW * logo.height) / logo.width;
      ctx.drawImage(logo, content.x + (content.w - logoW) / 2, closingY + 34, logoW, logoH);
    } catch {
      // Logo optionnel : la carte reste correcte même s'il ne charge pas.
    }

    return canvas;
  },
};

const MONTH_ABBR = ["JAN", "FÉV", "MAR", "AVR", "MAI", "JUIN", "JUIL", "AOÛ", "SEP", "OCT", "NOV", "DÉC"];

function capitalize(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

// Équivalent canvas de CSS object-fit:cover — rogne l'image plutôt que de
// l'étirer pour remplir exactement la zone (x, y, w, h). Sans ça, une
// affiche dont le ratio ne correspond pas pile à la case (mosaïque de la
// carte 6 notamment) ressort aplatie ou étirée.
function drawImageCover(ctx, img, x, y, w, h) {
  const imgRatio = img.width / img.height;
  const boxRatio = w / h;
  let sx, sy, sw, sh;
  if (imgRatio > boxRatio) {
    sh = img.height;
    sw = sh * boxRatio;
    sx = (img.width - sw) / 2;
    sy = 0;
  } else {
    sw = img.width;
    sh = sw / boxRatio;
    sx = 0;
    sy = (img.height - sh) / 2;
  }
  ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h);
}