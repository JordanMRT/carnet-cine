// update-sw-version.js
// Met à jour automatiquement SW_VERSION dans sw.js basé sur changelog.json
// À exécuter avant chaque déploiement

const fs = require('fs');
const path = require('path');

// Chemins des fichiers
const swJsPath = path.join(__dirname, 'sw.js');
const changelogPath = path.join(__dirname, 'changelog.json');

// Lecture de changelog.json pour obtenir la date
let changelogData;
try {
  const changelogContent = fs.readFileSync(changelogPath, 'utf8');
  changelogData = JSON.parse(changelogContent);
} catch (err) {
  console.error('Erreur lors de la lecture de changelog.json :', err.message);
  process.exit(1);
}

const dateFromChangelog = changelogData.version; // Format attendu : "YYYY-MM-DD"
if (!dateFromChangelog || !/^\d{4}-\d{2}-\d{2}$/.test(dateFromChangelog)) {
  console.error('Format de version invalide dans changelog.json. Attendu : "YYYY-MM-DD"');
  process.exit(1);
}

// Lecture du contenu actuel de sw.js
let swContent;
try {
  swContent = fs.readFileSync(swJsPath, 'utf8');
} catch (err) {
  console.error('Erreur lors de la lecture de sw.js :', err.message);
  process.exit(1);
}

// Extraction de la version actuelle de SW_VERSION
const versionMatch = swContent.match(/const SW_VERSION = "([^"]+)";/);
let currentRevision = 0;
let currentVersion = null; // Initialize to avoid reference error

if (versionMatch) {
  currentVersion = versionMatch[1];
  // Format attendu : "YYYY-MM-DD-N"
  const parts = currentVersion.split('-');
  if (parts.length >= 4 &&
      parts[0] === dateFromChangelog.split('-')[0] &&
      parts[1] === dateFromChangelog.split('-')[1] &&
      parts[2] === dateFromChangelog.split('-')[2]) {
    // Même date, on extrait le numéro de révision
    currentRevision = parseInt(parts[3], 10) || 0;
  }
  // Si la date ne correspond pas, on commencera à la révision 1 (ci-dessous)
}

// Détermination du nouveau numéro de révision
// Si même date que dans changelog, on incrémente ; sinon on commence à 1
const newRevision = (dateFromChangelog === currentVersion?.split('-').slice(0,3).join('-'))
  ? currentRevision + 1
  : 1;

// Construction de la nouvelle version
const newVersion = `${dateFromChangelog}-${newRevision}`;

// Mise à jour du contenu de sw.js
const updatedContent = swContent.replace(
  /const SW_VERSION = "[^"]+";/,
  `const SW_VERSION = "${newVersion}";`
);

// Écriture dans sw.js
try {
  fs.writeFileSync(swJsPath, updatedContent, 'utf8');
  console.log(`✅ SW_VERSION mis à jour vers : ${newVersion}`);
  console.log(`   (date du changelog : ${dateFromChangelog}, révision : ${newRevision})`);
} catch (err) {
  console.error('Erreur lors de l\'écriture dans sw.js :', err.message);
  process.exit(1);
}