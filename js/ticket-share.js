// ============================================
// TICKET SHARE — génère un ticket au format PNG (partage natif si
// possible, sinon téléchargement direct)
// ============================================

const TicketShare = {
  async generate(item) {
    try {
      toast("Génération du ticket…");
      const canvas = await this._render(item);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
      if (!blob) throw new Error("Impossible de générer l'image.");

      const filename = `carnet-cine-${(item.title || "ticket")
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
          text: `${item.title} — vu sur Carnet Ciné 🎟️`,
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
      if (err?.name !== "AbortError") toast("Impossible de partager ce ticket pour l'instant.", "error");
    }
  },

  async _render(item) {
    const scale = 2;
    const W = 640;
    const H = 320;
    const canvas = document.createElement("canvas");
    canvas.width = W * scale;
    canvas.height = H * scale;
    const ctx = canvas.getContext("2d");
    ctx.scale(scale, scale);

    const bg = "#1b1d2a";
    const elevated = "#23263a";
    const ink = "#0e0f14";
    const cream = "#f2efe9";
    const mustard = "#e8a33d";
    const border = "#34374d";
    const muted = "#8a8ea3";

    ctx.fillStyle = elevated;
    roundRectPath(ctx, 0, 0, W, H, 18);
    ctx.fill();

    // Poster (partie gauche, coins arrondis à gauche seulement)
    const posterW = 200;
    ctx.save();
    roundRectPath(ctx, 0, 0, posterW, H, [18, 0, 0, 18]);
    ctx.clip();
    try {
      const img = await loadImageCORS(TMDB.posterUrl(item.poster_path, "w342"));
      ctx.drawImage(img, 0, 0, posterW, H);
    } catch {
      ctx.fillStyle = ink;
      ctx.fillRect(0, 0, posterW, H);
    }
    ctx.restore();

    // Perforation (ligne pointillée + encoches)
    ctx.strokeStyle = border;
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 6]);
    ctx.beginPath();
    ctx.moveTo(posterW + 14, 10);
    ctx.lineTo(posterW + 14, H - 10);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = bg;
    ctx.beginPath();
    ctx.arc(posterW + 14, 0, 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(posterW + 14, H, 10, 0, Math.PI * 2);
    ctx.fill();

    // Texte
    const textX = posterW + 34;
    const maxTextWidth = W - textX - 24;
    let y = 56;

    await Promise.all([
      document.fonts.load('700 26px "Bricolage Grotesque"').catch(() => {}),
      document.fonts.load('600 15px "IBM Plex Mono"').catch(() => {}),
      document.fonts.load('400 14px "IBM Plex Mono"').catch(() => {}),
    ]);

    ctx.fillStyle = cream;
    ctx.font = '700 26px "Bricolage Grotesque", sans-serif';
    y = wrapText(ctx, item.title || "", textX, y, maxTextWidth, 30, 2);
    y += 18;

    const sub =
      item.media_type === "tv"
        ? `SÉRIE · ${item.total_episodes || item.watched_episodes} ÉPISODES`
        : "FILM";
    ctx.fillStyle = mustard;
    ctx.font = '600 14px "IBM Plex Mono", monospace';
    ctx.fillText(sub, textX, y);
    y += 28;

    ctx.fillStyle = muted;
    ctx.font = '400 14px "IBM Plex Mono", monospace';
    ctx.fillText(formatDate(item.last_watched_date), textX, y);

    if (item.media_type === "movie" && item.watch_count > 1) {
      const label = `×${item.watch_count}`;
      ctx.font = '600 14px "IBM Plex Mono", monospace';
      const lw = ctx.measureText(label).width;
      ctx.fillStyle = mustard;
      ctx.fillText(label, W - 24 - lw, y);
    }
    y += 32;

    if (item.avg_rating != null) {
      const filled = Math.round((item.avg_rating / 10) * 5);
      ctx.font = "18px sans-serif";
      for (let i = 0; i < 5; i++) {
        ctx.fillStyle = i < filled ? mustard : border;
        ctx.fillText("★", textX + i * 22, y);
      }
    }

    ctx.fillStyle = muted;
    ctx.font = '600 11px "IBM Plex Mono", monospace';
    ctx.fillText("CARNET CINÉ 🎟️", textX, H - 20);

    return canvas;
  },
};

function loadImageCORS(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function roundRectPath(ctx, x, y, w, h, r) {
  const radii = Array.isArray(r) ? r : [r, r, r, r];
  ctx.beginPath();
  ctx.moveTo(x + radii[0], y);
  ctx.lineTo(x + w - radii[1], y);
  ctx.arcTo(x + w, y, x + w, y + radii[1], radii[1]);
  ctx.lineTo(x + w, y + h - radii[2]);
  ctx.arcTo(x + w, y + h, x + w - radii[2], y + h, radii[2]);
  ctx.lineTo(x + radii[3], y + h);
  ctx.arcTo(x, y + h, x, y + h - radii[3], radii[3]);
  ctx.lineTo(x, y + radii[0]);
  ctx.arcTo(x, y, x + radii[0], y, radii[0]);
  ctx.closePath();
}

// Retourne la position Y après le texte (pour enchaîner d'autres lignes).
// Tronque avec "…" au-delà de maxLines.
function wrapText(ctx, text, x, y, maxWidth, lineHeight, maxLines = 2) {
  const words = text.split(" ");
  let line = "";
  let lineY = y;
  let lineCount = 1;

  for (let i = 0; i < words.length; i++) {
    const testLine = line ? `${line} ${words[i]}` : words[i];
    if (ctx.measureText(testLine).width > maxWidth && line) {
      if (lineCount >= maxLines) {
        let truncated = line;
        while (ctx.measureText(truncated + "…").width > maxWidth && truncated.length > 1) {
          truncated = truncated.slice(0, -1);
        }
        ctx.fillText(truncated + "…", x, lineY);
        return lineY;
      }
      ctx.fillText(line, x, lineY);
      line = words[i];
      lineY += lineHeight;
      lineCount++;
    } else {
      line = testLine;
    }
  }
  ctx.fillText(line, x, lineY);
  return lineY;
}
