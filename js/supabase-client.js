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

  // Comme getSession(), mais force un rafraîchissement explicite du token
  // si celui stocké est expiré ou sur le point de l'être (marge de 60s).
  // Nécessaire au tout premier chargement : le rafraîchissement automatique
  // de Supabase en arrière-plan n'a pas toujours le temps de se faire avant
  // que les premières requêtes ne partent avec un token périmé (→ 401).
  async ensureFreshSession() {
    const { data } = await supabaseClient.auth.getSession();
    const session = data.session;
    if (!session) return null;

    const expiringSoon = !session.expires_at || session.expires_at * 1000 < Date.now() + 60000;
    if (!expiringSoon) return session;

    try {
      const { data: refreshed, error } = await supabaseClient.auth.refreshSession();
      if (error) throw error;
      return refreshed.session;
    } catch {
      // Le rafraîchissement a échoué (réseau capricieux au pire moment,
      // refresh token invalide, etc.) : on repart avec la session existante
      // plutôt que de faire planter le chargement. Si elle est vraiment
      // périmée, les requêtes échoueront comme avant et l'utilisateur
      // retombera sur le bouton "Réessayer" habituel — pas de nouveau mode
      // de plantage introduit.
      return session;
    }
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
      .select("user_id, status, avg_rating, series_rating, last_note")
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

  // Même chose que getFriendsActivityForWork mais au niveau épisode
  // (les notes/commentaires d'épisode vivent dans diary_entries, pas library).
  async getFriendsActivityForEpisode(friendIds, tmdbId, season, episode) {
    if (!friendIds.length) return [];
    const { data: rows, error } = await supabaseClient
      .from("diary_entries")
      .select("user_id, rating, note")
      .eq("tmdb_id", tmdbId)
      .eq("media_type", "tv")
      .eq("season", season)
      .eq("episode", episode)
      .in("user_id", friendIds);
    if (error) throw error;
    if (!rows.length) return [];
    // Un ami peut avoir plusieurs visionnages (rewatch) du même épisode :
    // on garde une seule ligne par ami, en priorité celle qui a un commentaire.
    const byUser = {};
    for (const r of rows) {
      const existing = byUser[r.user_id];
      if (!existing || (!existing.note && r.note)) byUser[r.user_id] = r;
    }
    const activityRows = Object.values(byUser);
    const ids = activityRows.map((r) => r.user_id);
    const { data: profiles, error: pErr } = await supabaseClient
      .from("profiles")
      .select("id, username, avatar_path, avatar_url")
      .in("id", ids);
    if (pErr) throw pErr;
    const byId = Object.fromEntries(profiles.map((p) => [p.id, p]));
    // On renomme rating/note en avg_rating/last_note pour rester compatible
    // avec friendsActivityHTML(), déjà écrite pour la fiche film/série.
    return activityRows.map((r) => ({
      avg_rating: r.rating,
      last_note: r.note,
      profile: byId[r.user_id] || null,
    }));
  },

  // ---------- UNFOLLOW ----------

  async unfollow(followId) {
    const { error } = await supabaseClient.from("follows").delete().eq("id", followId);
    if (error) throw error;
  },

  // ---------- LIBRARY (bibliothèque : à voir / en cours / terminé) ----------
  async getLibrary(userId) {
    return this._getAllPages("library", userId, [
      { column: "updated_at", ascending: false },
      { column: "id", ascending: false },
    ]);
  },

  async updateDiaryEntryRuntime(id, runtimeMinutes) {
    const { error } = await supabaseClient
      .from("diary_entries")
      .update({ runtime_minutes: runtimeMinutes })
      .eq("id", id);
    if (error) throw error;
  },

  // Applique une note à l'œuvre. Pour un film, pas de granularité en
  // dessous à protéger : on écrit sur diary_entries comme avant. Pour une
  // série, on écrit uniquement sur library.series_rating, jamais sur
  // diary_entries, pour ne plus écraser les notes d'épisodes individuelles.
  async setWorkRating(userId, tmdbId, mediaType, rating) {
    if (mediaType === "tv") {
      const { error } = await supabaseClient
        .from("library")
        .update({ series_rating: rating })
        .eq("user_id", userId)
        .eq("tmdb_id", tmdbId)
        .eq("media_type", "tv");
      if (error) throw error;
      return;
    }
    const { error } = await supabaseClient
      .from("diary_entries")
      .update({ rating })
      .eq("user_id", userId)
      .eq("tmdb_id", tmdbId)
      .eq("media_type", mediaType);
    if (error) throw error;
  },

  // Permet de laisser un commentaire
  async setWorkNote(userId, tmdbId, mediaType, note) {
    const { error } = await supabaseClient
      .from("diary_entries")
      .update({ note })
      .eq("user_id", userId)
      .eq("tmdb_id", tmdbId)
      .eq("media_type", mediaType);
    if (error) throw error;
  },

  async setEpisodeNote(userId, tmdbId, season, episode, note) {
    const { error } = await supabaseClient
      .from("diary_entries")
      .update({ note })
      .eq("user_id", userId)
      .eq("tmdb_id", tmdbId)
      .eq("media_type", "tv")
      .eq("season", season)
      .eq("episode", episode);
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

  // ---------- UPDATE DIARY ENTRY WITH AIR DATE ---------- 
  async updateDiaryEntryFields(id, fields) {
    const { error } = await supabaseClient.from("diary_entries").update(fields).eq("id", id);
    if (error) throw error;
  },

  // ---------- DIARY (journal de visionnage) ----------
  async getDiary(userId) {
    return this._getAllPages("diary_entries", userId, [
      { column: "watched_date", ascending: false },
      { column: "created_at", ascending: false },
      { column: "id", ascending: false },
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

  // Retourne aussi les lignes insérées (avec leur id généré par la base) :
  // utile pour que l'appelant puisse mettre à jour App.diary en mémoire
  // sans avoir à tout recharger depuis Supabase.
  // onChunkInserted(rows) est appelé après CHAQUE lot réussi (pas seulement
  // à la fin) : si un lot échoue au milieu d'un gros import, l'appelant a
  // quand même pu synchroniser ce qui est déjà réellement en base avant
  // que l'erreur ne remonte.
  async bulkInsertDiary(entries, onChunkInserted) {
    // Insère par lots de 500 pour éviter les limites de payload
    const chunks = [];
    for (let i = 0; i < entries.length; i += 500) {
      chunks.push(entries.slice(i, i + 500));
    }
    let rows = [];
    for (const chunk of chunks) {
      const { data, error } = await supabaseClient.from("diary_entries").insert(chunk).select();
      if (error) throw error;
      rows = rows.concat(data);
      onChunkInserted?.(data);
    }
    return { inserted: rows.length, rows };
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

  // Ajouter aux favoris
  async addFavorite(userId, tmdbId, mediaType, title, posterPath) {
    const { error } = await supabaseClient
      .from("favorites")
      .insert({ user_id: userId, tmdb_id: tmdbId, media_type: mediaType, title, poster_path: posterPath });
    if (error) throw error;
  },

  // Retirer des favoris
  async removeFavorite(userId, tmdbId, mediaType) {
    const { error } = await supabaseClient
      .from("favorites")
      .delete()
      .eq("user_id", userId)
      .eq("tmdb_id", tmdbId)
      .eq("media_type", mediaType);
    if (error) throw error;
  },

  // Vérifier si un élément est en favori
  async isFavorite(userId, tmdbId, mediaType) {
    const { data, error } = await supabaseClient
      .from("favorites")
      .select("id")
      .eq("user_id", userId)
      .eq("tmdb_id", tmdbId)
      .eq("media_type", mediaType)
      .single();

    if (error && error.code !== "PGRST116") { // PGRST116 = no rows returned
      throw error;
    }
    return !!data;
  },

  // Récupérer tous les favoris d'un utilisateur
  async getFavorites(userId) {
    const { data, error } = await supabaseClient
      .from("favorites")
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

    // ---------- BADGES PAR PALIER OBTENU ---------- 
  async getBadgeTiers(userId) {
    const { data, error } = await supabaseClient
      .from("badges")
      .select("badge_key, tier")
      .eq("user_id", userId);
    if (error) throw error;
    return Object.fromEntries((data || []).map((b) => [b.badge_key, b.tier]));
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

  // ---------- NOTIFICATIONS PUSH ----------
  async savePushSubscription(userId, subscription) {
    const json = subscription.toJSON();
    const { error } = await supabaseClient
      .from("push_subscriptions")
      .upsert(
        { user_id: userId, endpoint: json.endpoint, p256dh: json.keys.p256dh, auth: json.keys.auth },
        { onConflict: "user_id,endpoint" }
      );
    if (error) throw error;
  },

  async deletePushSubscription(endpoint) {
    const { error } = await supabaseClient.from("push_subscriptions").delete().eq("endpoint", endpoint);
    if (error) throw error;
  },

  async hasPushSubscription(userId) {
    const { data, error } = await supabaseClient
      .from("push_subscriptions")
      .select("id")
      .eq("user_id", userId)
      .limit(1);
    if (error) throw error;
    return (data || []).length > 0;
  },
};
