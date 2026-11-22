// Lit depuis TON PC les pages des poules FFBB (competitions.ffbb.com) de la saison
// en cours et les dépose dans Supabase (table multisports.ffbb_poule_cache).
// Ensuite, dans l'appli : Basket → « Synchroniser FFBB » (ou « Gérer les phases »).
//
// Usage (à la racine du projet, après `npm install`) :
//   node scripts/push-ffbb.mjs
//
// Variables lues dans .env.local :
//   NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY   (déjà présentes)
//   SYNC_EMAIL, SYNC_PASSWORD   = le compte familial de l'appli (login Supabase)
// Ne mets JAMAIS SYNC_EMAIL / SYNC_PASSWORD dans les variables de Vercel.

import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// --- .env.local (sans dépendance supplémentaire) -----------------------------
for (const name of [".env.local", ".env"]) {
  const file = join(root, name);
  if (!existsSync(file)) continue;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const { NEXT_PUBLIC_SUPABASE_URL: url, NEXT_PUBLIC_SUPABASE_ANON_KEY: anon, SYNC_EMAIL, SYNC_PASSWORD } = process.env;
if (!url || !anon || !SYNC_EMAIL || !SYNC_PASSWORD) {
  console.error("Il manque NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SYNC_EMAIL ou SYNC_PASSWORD dans .env.local");
  process.exit(1);
}

// --- le module d'extraction de l'appli (lib/ffbbPage.js), chargé tel quel ----
// (via une URL "data:" : fonctionne quelle que soit la version de Node)
const source = readFileSync(join(root, "lib", "ffbbPage.js"), "utf8");
const { fetchPouleFromPage } = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);

// --- saison en cours (même règle que lib/utils.js : septembre -> saison suivante)
const now = new Date();
const endYear = now.getMonth() + 1 >= 9 ? now.getFullYear() + 1 : now.getFullYear();
const season = `${endYear - 1}-${endYear}`;

const supabase = createClient(url, anon, { db: { schema: "multisports" } });
const { error: authError } = await supabase.auth.signInWithPassword({ email: SYNC_EMAIL, password: SYNC_PASSWORD });
if (authError) {
  console.error("Connexion Supabase refusée :", authError.message);
  process.exit(1);
}

const { data: phases, error } = await supabase
  .from("basketball_phases")
  .select("phase_name, competition_url, poule_id")
  .eq("season", season)
  .eq("phase_type", "ffbb");
if (error) {
  console.error("Lecture des phases impossible :", error.message);
  process.exit(1);
}

// Une poule peut être partagée par plusieurs phases/participantes : on ne la lit qu'une fois.
const jobs = new Map();
for (const p of phases ?? []) {
  if (!p.competition_url && !p.poule_id) continue;
  const key = p.competition_url || p.poule_id;
  if (!jobs.has(key)) jobs.set(key, p);
}
if (jobs.size === 0) {
  console.log(`Aucune phase FFBB avec un lien de poule pour la saison ${season}.`);
  process.exit(0);
}

let failures = 0;
for (const p of jobs.values()) {
  try {
    const poule = await fetchPouleFromPage({ competitionUrl: p.competition_url, storedPouleId: p.poule_id });
    const played = poule.rencontres.filter((r) => r.joue).length;
    const { error: upError } = await supabase
      .from("ffbb_poule_cache")
      .upsert({ poule_id: poule.pouleId, data: poule, fetched_at: new Date().toISOString() }, { onConflict: "poule_id" });
    if (upError) throw new Error(`écriture Supabase : ${upError.message}`);
    console.log(`✔ ${p.phase_name} (poule ${poule.pouleId}) : ${poule.rencontres.length} matchs, ${played} joués, ${poule.classements.length} lignes de classement`);
  } catch (e) {
    failures += 1;
    console.error(`✘ ${p.phase_name} : ${e.message}`);
  }
}
console.log(failures ? "Terminé avec des erreurs." : "Terminé. Dans l'appli, clique sur « Synchroniser FFBB ».");
process.exit(failures ? 1 : 0);
