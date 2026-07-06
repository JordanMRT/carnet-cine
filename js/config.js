// ============================================
// CONFIGURATION — à remplir avant utilisation
// ============================================
//
// 1) TMDB : crée un compte sur https://www.themoviedb.org/settings/api
//    (gratuit) et récupère ta clé "API Key (v3 auth)".
//
// 2) SUPABASE : crée un projet sur https://supabase.com (gratuit),
//    puis Settings > API pour récupérer l'URL et la clé "anon public".
//    N'utilise QUE la clé "anon" ici, jamais la clé "service_role"
//    (celle-ci ne doit jamais apparaître côté client).
//
// 3) Exécute le fichier schema.sql dans l'éditeur SQL de ton projet
//    Supabase (SQL Editor > New query) avant de te connecter.

const CONFIG = {
  TMDB_API_KEY: "405dcb9aa0ca7fce4da80491561da9c5",
  TMDB_IMG_BASE: "https://image.tmdb.org/t/p/",
  SUPABASE_URL: "https://zhlhmoafhlidixwhynxi.supabase.co/",
  SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpobGhtb2FmaGxpZGl4d2h5bnhpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMwNjQ4NjgsImV4cCI6MjA5ODY0MDg2OH0.zH0RftbT1rZmtlU_RdN3BzICbZR9fnUNgalBU03Y5tI",
};
