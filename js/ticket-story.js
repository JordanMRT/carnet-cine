// ============================================
// TICKET STORY — génère une version story Instagram (1080x1920) du ticket,
// en réutilisant les helpers globaux de ticket-share.js (roundRectPath,
// loadImageCORS, tmdbImageProxyUrl, wrapText, drawBarcode) et le même
// partage natif / téléchargement que TicketShare.
// ============================================

const TicketStory = {
  async generate(item) {
    try {
      toast("Génération de la story…");
      const canvas = await this._render(item);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
      if (!blob) throw new Error("Impossible de générer l'image.");

      const filename = `carnet-cine-story-${(item.title || "ticket")
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)/g, "")}.png`;
      const file = new File([blob], filename, { type: "image/png" });

      if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({
          files: [file],
          title: item.title,
          text: `${item.title} — vu sur Time To Binge 🎟️`,
        });
      } else {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 3000);
        toast("Image téléchargée 🎟️", "success");
      }
    } catch (err) {
      if (err?.name !== "AbortError") toast("Impossible de partager cette story pour l'instant.", "error");
    }
  },

  async _render(item) {
    const W = 1080;
    const H = 1920;
    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d");

    const ink = "#0e0f14";
    const cream = "#f2efe9";
    const border = "#34374d";
    const muted = "#8a8ea3";
    // Comme ticket-share.js / wrapped.js : le canvas ne peut pas lire les
    // CSS vars directement, on résout au moment du dessin pour hériter du
    // thème actif.
    const rootStyles = getComputedStyle(document.documentElement);
    const bg = rootStyles.getPropertyValue("--bg").trim() || "#1b1d2a";
    const mustard = rootStyles.getPropertyValue("--mustard").trim() || "#e8a33d";
    const coral = rootStyles.getPropertyValue("--coral").trim() || "#e8636b";

    await Promise.all([
      document.fonts.load('700 60px "Unbounded"').catch(() => {}),
      document.fonts.load('700 30px "Unbounded"').catch(() => {}),
      document.fonts.load('700 28px "Unbounded"').catch(() => {}),
      document.fonts.load('800 28px "Nunito Sans"').catch(() => {}),
      document.fonts.load('600 30px "Nunito Sans"').catch(() => {}),
      document.fonts.load('700 30px "Nunito Sans"').catch(() => {}),
      document.fonts.load('600 22px "Nunito Sans"').catch(() => {}),
      document.fonts.load('400 30px "Nunito Sans"').catch(() => {}),
    ]);

    // ---- Fond : halo radial discret teinté, façon carte "cover" du Wrapped ----
    ctx.fillStyle = this._radialHalo(ctx, W, H, 0.5, 0.08, "#2c2a3a", bg, 0.7);
    ctx.fillRect(0, 0, W, H);

    // ---- Perforation haut/bas (même langage visuel que Wrapped) ----
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

    // ---- Eyebrow ----
    const eyebrow =
      item.media_type === "tv"
        ? `SÉRIE · ${item.total_episodes || item.watched_episodes} ÉPISODES`
        : "FILM";
    ctx.fillStyle = mustard;
    ctx.font = '800 28px "Nunito Sans", sans-serif';
    ctx.textAlign = "left";
    ctx.fillText(eyebrow, innerX, innerY + 28);

    // ---- Pied de page ----
    const footerBorderY = innerBottom - 74;
    ctx.strokeStyle = border;
    ctx.lineWidth = 2;
    ctx.setLineDash([10, 10]);
    ctx.beginPath();
    ctx.moveTo(innerX, footerBorderY);
    ctx.lineTo(innerX + innerW, footerBorderY);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = cream;
    ctx.font = '700 30px "Unbounded", sans-serif';
    ctx.fillText("Time To Binge", innerX, footerBorderY + 48);

    ctx.fillStyle = muted;
    ctx.font = '600 22px "Nunito Sans", sans-serif';
    ctx.textAlign = "right";
    ctx.fillText("#TimeToBinge", innerX + innerW, footerBorderY + 46);
    ctx.textAlign = "left";

    const contentTop = innerY + 74;
    const contentW = innerW;

    // ---- Affiche (grande, centrée) ----
    const posterW = 740;
    const posterH = 1110;
    const posterX = innerX + (contentW - posterW) / 2;
    const posterY = contentTop + 16;

    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.5)";
    ctx.shadowBlur = 60;
    ctx.shadowOffsetY = 30;
    ctx.fillStyle = ink;
    roundRectPath(ctx, posterX, posterY, posterW, posterH, 26);
    ctx.fill();
    ctx.restore();

    ctx.save();
    roundRectPath(ctx, posterX, posterY, posterW, posterH, 26);
    ctx.clip();
    try {
      const img = await loadImageCORS(tmdbImageProxyUrl(TMDB.posterUrl(item.poster_path, "w500")));
      drawImageCover(ctx, img, posterX, posterY, posterW, posterH);
    } catch {
      const posterGrad = ctx.createLinearGradient(posterX, posterY, posterX + posterW, posterY + posterH);
      posterGrad.addColorStop(0, "#3a3550");
      posterGrad.addColorStop(1, "#211c30");
      ctx.fillStyle = posterGrad;
      ctx.fillRect(posterX, posterY, posterW, posterH);
      ctx.globalAlpha = 0.35;
      ctx.font = "160px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("🎬", posterX + posterW / 2, posterY + posterH / 2 + 50);
      ctx.textAlign = "left";
      ctx.globalAlpha = 1;
    }
    ctx.restore();
    ctx.strokeStyle = border;
    ctx.lineWidth = 3;
    roundRectPath(ctx, posterX, posterY, posterW, posterH, 26);
    ctx.stroke();

    // ---- Tampon rewatch (repris du ticket) ----
    if (item.media_type === "movie" && item.watch_count > 1) {
      ctx.save();
      ctx.translate(posterX + posterW - 70, posterY + 70);
      ctx.rotate((-11 * Math.PI) / 180);
      ctx.globalAlpha = 0.92;
      ctx.fillStyle = coral;
      ctx.beginPath();
      ctx.arc(0, 0, 58, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = cream;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(0, 0, 58, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = cream;
      ctx.textAlign = "center";
      ctx.font = '700 15px "Nunito Sans", sans-serif';
      ctx.fillText("VISIONNÉ", 0, -6);
      ctx.font = '700 28px "Unbounded", sans-serif';
      ctx.fillText(`${item.watch_count} x`, 0, 24);
      ctx.textAlign = "left";
      ctx.restore();
    }

    // ---- Perforation (rappel du ticket : ligne pointillée + encoches) ----
    const perfY = posterY + posterH + 34;
    ctx.strokeStyle = border;
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 6]);
    ctx.beginPath();
    ctx.moveTo(posterX + 20, perfY);
    ctx.lineTo(posterX + posterW - 20, perfY);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = bg;
    [posterX, posterX + posterW].forEach((nx) => {
      ctx.beginPath();
      ctx.arc(nx, perfY, 11, 0, Math.PI * 2);
      ctx.fill();
    });

    let y = perfY + 78;

    // ---- Titre ----
    ctx.fillStyle = cream;
    ctx.font = '700 60px "Unbounded", sans-serif';
    ctx.textAlign = "center";
    y = wrapText(ctx, item.title || "", innerX + contentW / 2, y, contentW - 60, 66, 2);
    ctx.textAlign = "left";

    y += 56;

    // ---- Pastilles de genres ----
    const genreNames = (item.genres || [])
      .map((id) => (App.genreMaps[item.media_type] || {})[id])
      .filter(Boolean)
      .slice(0, 3);
    if (genreNames.length) {
      ctx.font = '600 26px "Nunito Sans", sans-serif';
      const padPill = 24;
      const pillGap = 16;
      const widths = genreNames.map((g) => ctx.measureText(g.toUpperCase()).width + padPill * 2);
      const totalW = widths.reduce((a, b) => a + b, 0) + pillGap * (genreNames.length - 1);
      let px = innerX + (contentW - totalW) / 2;
      const pillH = 52;
      genreNames.forEach((g, i) => {
        const w = widths[i];
        ctx.strokeStyle = border;
        ctx.lineWidth = 2;
        roundRectPath(ctx, px, y, w, pillH, pillH / 2);
        ctx.stroke();
        ctx.fillStyle = muted;
        ctx.textAlign = "center";
        ctx.fillText(g.toUpperCase(), px + w / 2, y + 34);
        ctx.textAlign = "left";
        px += w + pillGap;
      });
      y += pillH + 54;
    }

    // ---- Étoiles ----
    if (item.avg_rating != null) {
      const filled = Math.round((item.avg_rating / 10) * 5);
      ctx.font = "50px sans-serif";
      const starsWidth = 5 * 60;
      let sx = innerX + (contentW - starsWidth) / 2;
      for (let i = 0; i < 5; i++) {
        ctx.fillStyle = i < filled ? mustard : border;
        ctx.fillText("★", sx, y);
        sx += 60;
      }
      y += 58;
    }

    // ---- Date ----
    ctx.fillStyle = muted;
    ctx.font = '400 30px "Nunito Sans", sans-serif';
    ctx.textAlign = "center";
    ctx.fillText(`Vu le ${formatDate(item.last_watched_date)}`, innerX + contentW / 2, y);
    ctx.textAlign = "left";
    y += 56;

    // ---- Code-barre (centré) ----
    const bcW = 220;
    const bcH = 34;
    drawBarcode(
      ctx,
      `${item.tmdb_id}${item.last_watched_date}`,
      innerX + (contentW - bcW) / 2,
      y,
      bcW,
      bcH,
      muted
    );

    return canvas;
  },

  // Équivalent canvas de radial-gradient(circle at Xfrac Yfrac, highlight
  // stopFrac%, base 100%) — même logique que Wrapped._radialHalo.
  _radialHalo(ctx, w, h, cxFrac, cyFrac, highlight, base, stopFrac = 0.55) {
    const cx = w * cxFrac;
    const cy = h * cyFrac;
    const corners = [[0, 0], [w, 0], [0, h], [w, h]];
    const r = Math.max(...corners.map(([x, y]) => Math.hypot(x - cx, y - cy)));
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    grad.addColorStop(0, highlight);
    grad.addColorStop(stopFrac, base);
    return grad;
  },
};