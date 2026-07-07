# Carnet Ciné 🎟️

Journal de séries et de films façon TV Time — recherche TMDB, bibliothèque,
journal de visionnage en tickets de cinéma, statistiques et badges.
100% vanilla JS, pas de build, déployable gratuitement sur GitHub Pages.

## Arborescence

```
tvtime-clone/
├── index.html
├── schema.sql              # à exécuter dans Supabase
├── css/
│   └── style.css
├── js/
│   ├── config.js           # ⚠️ clés API à renseigner
│   ├── utils.js
│   ├── tmdb.js
│   ├── supabase-client.js
│   ├── badges.js
│   ├── stats.js
│   ├── import.js           # ⚠️ mapping à adapter à ton export TV Time
│   └── app.js
└── assets/
    └── poster-placeholder.svg
```

## Note sur `package.json` / `vite.config.ts`

Ces deux fichiers sont présents dans le dossier mais **ne sont pas
utilisés actuellement** : `index.html` charge toujours les scripts un
par un (`<script src="js/...">`), pas de build. Ils semblent être un
début de migration vers Vite + React + PWA installable, jamais
branché. Je les ai laissés de côté pour ne rien casser — dis-moi si tu
veux qu'on aille au bout de cette migration (ça permettrait une vraie
appli installable hors-ligne), sinon tu peux les supprimer sans risque.

## 1. Configurer TMDB

1. Crée un compte gratuit sur https://www.themoviedb.org
2. Settings → API → demande une clé "Developer" (gratuit, instantané)
3. Colle ta clé dans `js/config.js` → `TMDB_API_KEY`

## 2. Configurer Supabase

1. Crée un projet gratuit sur https://supabase.com
2. Dans **SQL Editor**, colle et exécute le contenu de `schema.sql`
   (si tu avais déjà une table `library` d'une version précédente, le
   fichier contient aussi les `alter table` nécessaires pour ajouter les
   colonnes de progression sans rien casser).
3. Dans **Settings → API**, récupère :
   - **Project URL** → `js/config.js` → `SUPABASE_URL`
   - **anon public key** → `js/config.js` → `SUPABASE_ANON_KEY`
   (⚠️ jamais la clé `service_role`, elle ne doit jamais être exposée côté client)
4. Dans **Authentication → URL Configuration**, ajoute dans **Redirect URLs**
   l'adresse que ton navigateur affichera pendant les tests (ex :
   `http://127.0.0.1:5500` ou `http://localhost:5500` pour Live Server —
   regarde l'URL exacte dans la barre d'adresse) et plus tard l'URL de ton
   site GitHub Pages (`https://TON_PSEUDO.github.io/carnet-cine/`). Sans
   ça, Supabase refusera de rediriger après le clic sur le lien magique.
   Renseigne aussi la même adresse en **Site URL**.

La connexion se fait par **lien magique** (pas de mot de passe) : tu
entres ton email, tu reçois un lien, tu cliques dessus et tu es connecté.
Le champ "Pseudo" n'est utile qu'à la toute première connexion (il est
ignoré ensuite) ; tu peux le changer à tout moment en cliquant sur ton
pseudo en haut de l'appli.

## 3. Tester en local

Comme le site charge des fichiers JS séparément, ouvrir `index.html`
directement dans le navigateur (`file://`) posera des soucis de CORS.
Lance un petit serveur local, par exemple :

```bash
cd tvtime-clone
python3 -m http.server 8000
```

Puis ouvre `http://localhost:8000`.

## 4. Déployer sur GitHub Pages (gratuit)

```bash
cd tvtime-clone
git init
git add .
git commit -m "Carnet Ciné"
git branch -M main
git remote add origin https://github.com/TON_PSEUDO/carnet-cine.git
git push -u origin main
```

Puis sur GitHub : **Settings → Pages → Source : branch `main`, dossier `/`**.
Ton site sera en ligne sur `https://TON_PSEUDO.github.io/carnet-cine/`.

⚠️ Tes clés `TMDB_API_KEY` et `SUPABASE_ANON_KEY` seront visibles dans le
code source côté client — c'est normal et attendu pour ce type de clés
publiques (elles sont conçues pour ça), à condition d'avoir bien activé
le Row Level Security sur Supabase (déjà fait dans `schema.sql`). Ne mets
en revanche **jamais** une clé `service_role` dans un repo public.

## 5. Importer ton export TV Time

Deux boutons en haut à droite une fois connecté : **Importer séries** et
**Importer films**. Ils correspondent aux deux structures réelles de ton
export TV Time :

- **Séries** : fichier avec un tableau d'objets `{ uuid, id: { tvdb, imdb },
  seasons: [...] }`. Le nom de la série n'étant pas présent dans cette
  structure, l'appli interroge automatiquement TMDB (`/find`) pour
  convertir chaque id TheTVDB en fiche TMDB (titre, poster, genres).
- **Films** : fichier avec un tableau d'objets `{ id: { tvdb, imdb },
  title, watched_at, rating, ... }`. Même principe, mais via l'id IMDb.

Seuls les épisodes/films avec `"is_watched": true` sont importés. La
résolution TMDB se fait avec une petite pause entre chaque appel, donc un
import de plusieurs centaines de séries peut prendre 1 à 2 minutes — les
messages en bas de l'écran te tiennent au courant de la progression.

**Titres non reconnus** : si TMDB n'a pas d'équivalent pour un id TheTVDB
ou IMDb (série trop obscure, id `-1`, mauvais matching…), l'entrée est
quand même importée mais avec un titre générique et sans affiche. La
liste des titres non reconnus s'affiche dans la console du navigateur
(clic droit → Inspecter → Console) juste après l'import, pour que tu
puisses vérifier ou corriger à la main dans Supabase si besoin.

---

## Nouveautés de cette version

**Coche rapide** — chaque épisode a maintenant un rond à droite : un
clic le marque vu (ou non vu) instantanément, sans ouvrir de modale, et
met à jour la bibliothèque/progress bar dans la foulée. Cliquer sur le
reste de la ligne ouvre toujours la modale détaillée (note, date
précise). Décocher un épisode supprime toutes ses entrées, y compris
d'éventuels revisionnages.

**Revisionnages (rewatch)** — un bouton ↻ apparaît une fois l'épisode
vu : chaque clic ajoute un nouveau visionnage, affiché en badge "×2",
"×3"… Même logique pour les films sur leur fiche (bouton qui devient
"Revoir" une fois vu une première fois). Les temps de visionnage dans
les stats comptent bien chaque revisionnage (donc un épisode vu 3 fois
compte 3 fois sa durée).

**Confirmation à la complétion** — passer une série sur "Terminé"
propose de marquer tous les épisodes de toutes les saisons comme vus
d'un coup (utile pour une série que tu as déjà vue avant d'utiliser
l'appli). Si tu réponds non, seul le statut change.


**Navigation saisons/épisodes complète** — la fiche série propose
maintenant un sélecteur de saison (toutes les saisons, plus seulement
la 1ère). Les épisodes déjà enregistrés dans ton journal sont marqués
d'un ✓ vert.

**Progression automatique** — après chaque ajout/suppression au
journal ou chaque import, l'appli recalcule automatiquement pour
chaque série : nombre d'épisodes vus, total d'épisodes (via TMDB),
et % de progression. Ça alimente une barre de progression sur la
fiche série et sur les cartes de la bibliothèque. Le statut
"Abandonné" que tu choisis à la main n'est jamais écrasé par ce
recalcul ; les autres statuts (à voir/en cours/terminé) se mettent à
jour tout seuls selon ton activité.

**Durées de visionnage enrichies** — après chargement, l'appli va
chercher en tâche de fond (sans bloquer l'interface) les durées TMDB
manquantes sur les entrées du journal (utile surtout pour les entrées
importées). Les stats affichent maintenant le temps total **séries**
et **films** séparément.

**Genres favoris en %** — la page stats affiche désormais le
pourcentage de chaque genre plutôt qu'un chiffre brut, et résout les
noms de genre correctement (avant, les entrées importées affichaient
parfois un id numérique à la place du nom).

## À venir (noté, pas encore implémenté)

**Un seul ticket par film/série complet** — actuellement, chaque
épisode génère son propre ticket dans le journal (nécessaire pour la
coche rapide et la progress bar). L'idée d'un ticket unique par
visionnage complet (1 film vu = 1 ticket, 1 série terminée = 1 ticket)
plutôt qu'un ticket par épisode est un changement de logique
d'affichage assez important — noté pour un prochain chantier, pas
traité dans cette passe de correctifs.

## Ce qui n'est PAS inclus / à faire toi-même

Je te liste honnêtement les limites de cette V1, pour que tu saches
exactement où compléter :

1. **Titres non reconnus sur TMDB** — voir section 5 ci-dessus. Une
   poignée d'entrées peut nécessiter une correction manuelle si l'id
   TheTVDB/IMDb ne matche rien côté TMDB.

2. **Durées introuvables sur TMDB** — l'enrichissement automatique
   dépend de ce que TMDB connaît. Certains épisodes (surtout sur de
   vieilles séries ou des séries peu documentées) n'ont pas de durée
   renseignée côté TMDB : ces entrées resteront sans `runtime_minutes`
   et n'entreront pas dans le total, même après enrichissement.

3. **Rebuild de la bibliothèque = appels TMDB** — la première synchro
   après un gros import (des dizaines de séries) peut prendre quelques
   secondes le temps de récupérer le nombre total d'épisodes de chaque
   série ; les fois suivantes sont plus rapides grâce au cache mémoire
   de la session.

4. **Redirect URL mal configurée** — si le lien magique t'amène sur une
   page d'erreur Supabase au lieu de ton appli, retourne en section 2 :
   l'URL affichée dans ton navigateur doit être dans la liste des
   Redirect URLs de ton projet Supabase.

5. **Pas de mode hors-ligne / PWA** — contrairement à MonPass, ce n'est
   pas une PWA installable pour l'instant. Ajoutable facilement si tu
   veux (manifest.json + service worker), dis-moi.

6. **Photo de profil / réglages de compte** — non implémentés, juste
   l'auth email/mot de passe minimale.

Tout le reste (recherche, ajout bibliothèque, journal en tickets, notes,
rewatch, 12 badges, stats avec graphique mensuel et genres favoris) est
fonctionnel une fois les clés API renseignées.
