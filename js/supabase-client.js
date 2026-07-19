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
    await this._syncProfile({ username });
  },

  async updateProfile(fields) {
    const { error } = await supabaseClient.auth.updateUser({ data: fields });
    if (error) throw error;
    // Seuls avatar/bannière concernent la table publique `profiles`
    // (le username a sa propre méthode dédiée ci-dessus).
    const profileFields = {};
    if ("avatar_path" in fields) profileFields.avatar_path = fields.avatar_path;
    if ("avatar_url" in fields) profileFields.avatar_url = fields.avatar_url;
    if ("banner_path" in fields) profileFields.banner_path = fields.banner_path;
    if (Object.keys(profileFields).length) await this._syncProfile(profileFields);
  },

  // Répercute un changement dans la table publique `profiles`, utilisée
  // pour la recherche et les profils consultés par d'autres utilisateurs.
  // Inclut toujours un username de secours : la colonne est NOT NULL, et
  // un utilisateur pourrait en théorie changer son avatar avant d'avoir
  // jamais choisi de pseudo (première ligne du profil pas encore créée).
  async _syncProfile(fields) {
    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) return;
    const fallbackUsername = user.user_metadata?.username || user.email?.split("@")[0] || "user";
    const { error } = await supabaseClient
      .from("profiles")
      .upsert(
        { id: user.id, username: fallbackUsername, ...fields, updated_at: new Date().toISOString() },
        { onConflict: "id" }
      );
    if (error) throw error;
  },

  // ---------- CONFIDENTIALITÉ ----------
  async getMyProfile(userId) {
    const { data, error } = await supabaseClient
      .from("profiles")
      .select("*")
      .eq("id", userId)
      .maybeSingle();
    if (error) throw error;
    return data;
  },

  async updatePrivacySettings(userId, { is_searchable, visibility }) {
    const { data: { user } } = await supabaseClient.auth.getUser();
    const fallbackUsername = user?.user_metadata?.username || user?.email?.split("@")[0] || "user";
    const { error } = await supabaseClient
      .from("profiles")
      .upsert(
        { id: userId, username: fallbackUsername, is_searchable, visibility, updated_at: new Date().toISOString() },
        { onConflict: "id" }
      );
    if (error) throw error;
  },

  async signOut() {
    const { error } = await supabaseClient.auth.signOut();
    if (error) throw error;
  },

  async deleteAccount() {
    const { data, error } = await supabaseClient.functions.invoke("delete-account");
    if (error) throw error;
    if (data?.error) throw new Error(data.error);
  },

  async getSession() {
    const { data } = await supabaseClient.auth.getSession();
    return data.session;
  },

  onAuthChange(callback) {
    supabaseClient.auth.onAuthStateChange((_event, session) => callback(session));
  },

  // ---------- SOCIAL ----------
  async searchUsers(query, myId) {
    const { data, error } = await supabaseClient
      .from("profiles")
      .select("id, username, avatar_path, avatar_url")
      .eq("is_searchable", true)
      .neq("id", myId)
      .ilike("username", `%${query}%`)
      .limit(20);
    if (error) throw error;
    return data;
  },

  async getMyFollowing(myId) {
    const { data, error } = await supabaseClient
      .from("follows")
      .select("followed_id, status")
      .eq("follower_id", myId);
    if (error) throw error;
    return data;
  },

  async sendFollowRequest(followerId, followedId) {
    const { error } = await supabaseClient
      .from("follows")
      .insert({ follower_id: followerId, followed_id: followedId, status: "pending" });
    if (error) throw error;
  },

  async getPendingRequests(myId) {
    const { data: requests, error } = await supabaseClient
      .from("follows")
      .select("id, follower_id, created_at")
      .eq("followed_id", myId)
      .eq("status", "pending")
      .order("created_at", { ascending: false });
    if (error) throw error;
    if (!requests.length) return [];
    const ids = requests.map((r) => r.follower_id);
    const { data: profiles, error: pErr } = await supabaseClient
      .from("profiles")
      .select("id, username, avatar_path, avatar_url")
      .in("id", ids);
    if (pErr) throw pErr;
    const byId = Object.fromEntries(profiles.map((p) => [p.id, p]));
    return requests.map((r) => ({ ...r, profile: byId[r.follower_id] || null }));
  },

  async getProfileById(userId) {
    const { data, error } = await supabaseClient
      .from("profiles")
      .select("*")
      .eq("id", userId)
      .maybeSingle();
    if (error) throw error;
    return data;
  },

  async getMyFollowingList(myId) {
    const { data: rows, error } = await supabaseClient
      .from("follows")
      .select("id, followed_id, status, created_at")
      .eq("follower_id", myId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    if (!rows.length) return [];
    const ids = rows.map((r) => r.followed_id);
    const { data: profiles, error: pErr } = await supabaseClient
      .from("profiles")
      .select("id, username, avatar_path, avatar_url")
      .in("id", ids);
    if (pErr) throw pErr;
    const byId = Object.fromEntries(profiles.map((p) => [p.id, p]));
    return rows.map((r) => ({ ...r, profile: byId[r.followed_id] || null }));
  },

  async respondToRequest(requestId, accept) {
    const { data: request, error: reqErr } = await supabaseClient
      .from("follows")
      .select("follower_id, followed_id")
      .eq("id", requestId)
      .single();
    if (reqErr) throw reqErr;

    if (accept) {
      const { error } = await supabaseClient.from("follows").update({ status: "accepted" }).eq("id", requestId);
      if (error) throw error;

      // Suivi mutuel automatique : accepter une demande me fait suivre la
      // personne en retour, sans qu'elle ait besoin de demander à son tour.
      const { error: reciprocalErr } = await supabaseClient
        .from("follows")
        .upsert(
          { follower_id: request.followed_id, followed_id: request.follower_id, status: "accepted" },
          { onConflict: "follower_id,followed_id" }
        );
      if (reciprocalErr) throw reciprocalErr;
    } else {
      const { error } = await supabaseClient.from("follows").delete().eq("id", requestId);
      if (error) throw error;
    }
  },

  async getMyFollowers(myId) {
    const { data: rows, error } = await supabaseClient
      .from("follows")
      .select("id, follower_id, status, created_at")
      .eq("followed_id", myId)
      .eq("status", "accepted")
      .order("created_at", { ascending: false });
    if (error) throw error;
    if (!rows.length) return [];
    const ids = rows.map((r) => r.follower_id);
    const { data: profiles, error: pErr } = await supabaseClient
      .from("profiles")
      .select("id, username, avatar_path, avatar_url")
      .in("id", ids);
    if (pErr) throw pErr;
    const byId = Object.fromEntries(profiles.map((p) => [p.id, p]));
    return rows.map((r) => ({ ...r, profile: byId[r.follower_id] || null }));
  },

// ---------- FRIENDS ACTIVITY ----------

  async getFriendsActivityForWork(friendIds, tmdbId, mediaType) {
    if (!friendIds.length) return [];
    const { data: rows, error } = await supabaseClient
      .from("library")
      .select("user_id, status, avg_rating")
      .eq("tmdb_id", tmdbId)
      .eq("media_type", mediaType)
      .in("user_id", friendIds)
      .in("status", ["watching", "completed"]);
    if (error) throw error;
    if (!rows.length) return [];
    const ids = rows.map((r) => r.user_id);
    const { data: profiles, error: pErr } = await supabaseClient
      .from("profiles")
      .select("id, username, avatar_path, avatar_url")
      .in("id", ids);
    if (pErr) throw pErr;
    const byId = Object.fromEntries(profiles.map((p) => [p.id, p]));
    return rows.map((r) => ({ ...r, profile: byId[r.user_id] || null }));
  },

  // ---------- UNFOLLOW ----------

  async unfollow(followId) {
    const { error } = await supabaseClient.from("follows").delete().eq("id", followId);
    if (error) throw error;
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

  // Note un épisode précis (contrairement à setWorkRating qui note toute
  // l'œuvre) — s'applique à toutes les entrées de cet épisode précis
  // (utile en cas de rewatch du même épisode).
  async setEpisodeRating(userId, tmdbId, season, episode, rating) {
    const { error } = await supabaseClient
      .from("diary_entries")
      .update({ rating })
      .eq("user_id", userId)
      .eq("tmdb_id", tmdbId)
      .eq("media_type", "tv")
      .eq("season", season)
      .eq("episode", episode);
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
