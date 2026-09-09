/**
 * Import des niveaux restants directement via l'API Management Supabase.
 * Aucune dépendance — utilise le module `https` de Node.js.
 *
 * Usage :
 *   SUPABASE_TOKEN=<personal-access-token> node tools/import-levels-direct.mjs
 *
 * Le token se génère sur https://supabase.com/dashboard/account/tokens
 * (Access Tokens → "Generate new token", n'importe quel nom).
 *
 * Le script est idempotent : il peut être relancé sans risque si interrompu.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import https from 'node:https';

const ROOT     = join(dirname(fileURLToPath(import.meta.url)), '..');
const BATCHES  = join(ROOT, 'supabase', 'seed', 'batches');
const PROJECT  = 'vwriqaufkrihmxrvykec';
const TOKEN    = process.env.SUPABASE_TOKEN;

if (!TOKEN) {
  console.error('SUPABASE_TOKEN manquant. Exemple :');
  console.error('  SUPABASE_TOKEN=sbp_xxx node tools/import-levels-direct.mjs');
  process.exit(1);
}

function sqlRequest(query) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ query });
    const req = https.request({
      hostname: 'api.supabase.com',
      path:     `/v1/projects/${PROJECT}/database/query`,
      method:   'POST',
      headers: {
        'Authorization': `Bearer ${TOKEN}`,
        'Content-Type':  'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(JSON.parse(data));
        } else {
          reject(new Error(`HTTP ${res.statusCode} : ${data}`));
        }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// Lit les fichiers de lots dans l'ordre alphabétique (realm-03-batch-0, …)
const fichiers = readdirSync(BATCHES)
  .filter((f) => f.endsWith('.sql'))
  .sort();

// On n'importe que les mondes pas encore en base (0, 1, 2 déjà faits)
const restants = fichiers.filter((f) => {
  const match = f.match(/^realm-(\d+)-/);
  return match && parseInt(match[1], 10) >= 3;
});

console.log(`${restants.length} fichiers à importer (mondes 3–29).\n`);

let ok = 0;
let erreurs = 0;

for (const fichier of restants) {
  const sql = readFileSync(join(BATCHES, fichier), 'utf8');
  process.stdout.write(`  ${fichier} … `);
  try {
    await sqlRequest(sql);
    console.log('✓');
    ok++;
  } catch (e) {
    console.log(`✗  ${e.message.slice(0, 120)}`);
    erreurs++;
  }
}

console.log(`\nTerminé : ${ok} lots importés, ${erreurs} erreur(s).`);
if (erreurs === 0) console.log('La base contient maintenant les 600 niveaux.');
