// ============================================
// SUPABASE — client + accès aux données
// ============================================

const supabaseClient = window.supabase.createClient(
  CONFIG.SUPABASE_URL,
  CONFIG.SUPABASE_ANON_KEY
);

const DB = {
  // ---------- AUTH (lien magique, sans mot de passe) ----------
  async sendMagicLink(email, username) {
    const { error } = await supabaseClient.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: window.location.origin + window.location.pathname,
        ...(username ? { data: { username } } : {}),
      },
    });
    if (error) throw error;
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
    const { data, error } = await supabaseClient
      .from("library")
      .select("*")
      .eq("user_id", userId)
      .order("updated_at", { ascending: false });
    if (error) throw error;
    return data;
  },

  async updateDiaryEntryRuntime(id, runtimeMinutes) {
    const { error } = await supabaseClient
      .from("diary_entries")
      .update({ runtime_minutes: runtimeMinutes })
      .eq("id", id);
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
    const { data, error } = await supabaseClient
      .from("diary_entries")
      .select("*")
      .eq("user_id", userId)
      .order("watched_date", { ascending: false });
    if (error) throw error;
    return data;
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
};
