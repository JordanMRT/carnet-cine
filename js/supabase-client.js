// ============================================
// SUPABASE — client + accès aux données
// ============================================

const supabaseClient = window.supabase.createClient(
  CONFIG.SUPABASE_URL,
  CONFIG.SUPABASE_ANON_KEY
);

const DB = {
   // ---------- AUTH (lien magique, sans mot de passe) ----------
  async sendOtp(email, username) {
  const { error } = await supabaseClient.auth.signInWithOtp({
    email,
    options: {
      shouldCreateUser: true,
      data: username ? { username } : undefined,
    },
  });

  if (error) throw error;
},

async verifyOtp(email, code) {
  const { data, error } = await supabaseClient.auth.verifyOtp({
    email,
    token: code,
    type: 'email',
  });

  if (error) throw error;
  return data;
},

  async updateUsername(username) {
    const { error } = await supabaseClient.auth.updateUser({ data: { username } });
    if (error) throw error;
  },

  async signOut() {
    const { error } = await supabaseClient.auth.signOut();
    if (error) throw error;
  },

  async getSession() {
    const { data } = await supabaseClient.auth.getSession();
    return data.session;
  },

  onAuthChange(callback) {
    supabaseClient.auth.onAuthStateChange((_event, session) => callback(session));
  },

  // ---------- LIBRARY (bibliothèque : à voir / en cours / terminé) ----------
  async getLibrary(userId) {
    return this._getAllPages("library", userId, { column: "updated_at", ascending: false });
  },

  async updateDiaryEntryRuntime(id, runtimeMinutes) {
    const { error } = await supabaseClient
      .from("diary_entries")
      .update({ runtime_minutes: runtimeMinutes })
      .eq("id", id);
    if (error) throw error;
  },

  // Applique une note à TOUS les visionnages enregistrés d'un film/série
  // (note globale par œuvre, pas par épisode).
  async setWorkRating(userId, tmdbId, mediaType, rating) {
    const { error } = await supabaseClient
      .from("diary_entries")
      .update({ rating })
      .eq("user_id", userId)
      .eq("tmdb_id", tmdbId)
      .eq("media_type", mediaType);
    if (error) throw error;
  },

async clearLibrary(userId) {
  const { error } = await supabaseClient
    .from("library")
    .delete()
    .eq("user_id", userId);

  if (error) throw error;
},

async upsertLibraryItems(items) {
  if (!items.length) return;

  const { error } = await supabaseClient
    .from("library")
    .upsert(items, {
      onConflict: "user_id,tmdb_id,media_type",
    });

  if (error) throw error;
},

  async upsertLibraryItem(item) {
    const { data, error } = await supabaseClient
      .from("library")
      .upsert(item, { onConflict: "user_id,tmdb_id,media_type" })
      .select();
    if (error) throw error;
    return data[0];
  },

  async removeLibraryItem(id) {
    const { error } = await supabaseClient.from("library").delete().eq("id", id);
    if (error) throw error;
  },

  // ---------- DIARY (journal de visionnage) ----------
  async getDiary(userId) {
    return this._getAllPages("diary_entries", userId, [
      { column: "watched_date", ascending: false },
      { column: "created_at", ascending: false },
    ]);
  },

  // Récupère TOUTES les lignes en paginant par lots de 1000, car
  // Supabase/PostgREST plafonne les réponses à 1000 lignes par défaut —
  // sans ça, un gros historique importé se fait tronquer silencieusement
  // et certaines entrées "disparaissent" au rechargement.
  async _getAllPages(table, userId, orderSpec) {
    const orders = Array.isArray(orderSpec) ? orderSpec : [orderSpec];
    const pageSize = 1000;
    let all = [];
    let from = 0;
    while (true) {
      let query = supabaseClient.from(table).select("*").eq("user_id", userId);
      orders.forEach((o) => (query = query.order(o.column, { ascending: o.ascending })));
      const { data, error } = await query.range(from, from + pageSize - 1);
      if (error) throw error;
      all = all.concat(data);
      if (data.length < pageSize) break;
      from += pageSize;
    }
    return all;
  },

  async addDiaryEntry(entry) {
    const { data, error } = await supabaseClient
      .from("diary_entries")
      .insert(entry)
      .select();
    if (error) throw error;
    return data[0];
  },

  async deleteDiaryEntry(id) {
    const { error } = await supabaseClient.from("diary_entries").delete().eq("id", id);
    if (error) throw error;
  },

  async deleteDiaryEntries(ids) {
    if (!ids.length) return;
    const { error } = await supabaseClient.from("diary_entries").delete().in("id", ids);
    if (error) throw error;
  },

  async deleteAllEntriesForWork(userId, tmdbId, mediaType) {
    const { error } = await supabaseClient
      .from("diary_entries")
      .delete()
      .eq("user_id", userId)
      .eq("tmdb_id", tmdbId)
      .eq("media_type", mediaType);
    if (error) throw error;
  },

  async bulkInsertDiary(entries) {
    // Insère par lots de 500 pour éviter les limites de payload
    const chunks = [];
    for (let i = 0; i < entries.length; i += 500) {
      chunks.push(entries.slice(i, i + 500));
    }
    let inserted = 0;
    for (const chunk of chunks) {
      const { error } = await supabaseClient.from("diary_entries").insert(chunk);
      if (error) throw error;
      inserted += chunk.length;
    }
    return inserted;
  },

  // ---------- BADGES ----------
  async getEarnedBadges(userId) {
    const { data, error } = await supabaseClient
      .from("badges")
      .select("*")
      .eq("user_id", userId);
    if (error) throw error;
    return data;
  },

  async awardBadge(userId, badgeKey) {
    const { error } = await supabaseClient
      .from("badges")
      .upsert(
        { user_id: userId, badge_key: badgeKey },
        { onConflict: "user_id,badge_key", ignoreDuplicates: true }
      );
    if (error) throw error;
  },

  // Pour les badges à paliers : met à jour le niveau à chaque évaluation
  // (contrairement à awardBadge, qui ignore les doublons).
  async awardBadgeTier(userId, badgeKey, tier) {
    const { error } = await supabaseClient
      .from("badges")
      .upsert(
        { user_id: userId, badge_key: badgeKey, tier },
        { onConflict: "user_id,badge_key" }
      );
    if (error) throw error;
  },
};
