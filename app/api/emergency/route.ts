// ACCÈS DE SECOURS : rétablit le compte superadmin du propriétaire si l'accès a été perdu (compte supprimé, profil retiré, mot de passe oublié...).
//
// Ce n'est PAS une porte dérobée dans les données : on ne contourne rien côté appli. La procédure RECRÉE ou RÉPARE uniquement
// le compte du propriétaire (adresse fixée dans EMERGENCY_SUPERADMIN_EMAIL), lui donne le profil superadmin et fixe son mot de passe ;
// il se connecte ensuite normalement.
//
// Protection : il faut connaître EMERGENCY_ACCESS_SECRET, qui n'existe QUE dans les variables d'environnement du serveur (Vercel),
// jamais dans le code ni dans le navigateur. Sans ces deux variables (secret de 24 caractères minimum), la route est désactivée.
// Comparaison à temps constant, pause d'une seconde par essai, messages volontairement génériques, chaque usage journalisé.
import { createHash, timingSafeEqual } from 'crypto';
import { NextResponse } from 'next/server';
import { fail, HttpError, serviceClient } from '@/lib/serverAuth';

export const dynamic = 'force-dynamic';

const sha = (s: string) => createHash('sha256').update(s).digest();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function POST(req: Request) {
  try {
    const secret = process.env.EMERGENCY_ACCESS_SECRET || '';
    const email = (process.env.EMERGENCY_SUPERADMIN_EMAIL || '').trim().toLowerCase();
    if (secret.length < 24 || !email) throw new HttpError(503, "Accès de secours non configuré sur le serveur.");

    const b = await req.json().catch(() => ({}));
    await sleep(1000);                                     // freine les essais répétés
    if (!timingSafeEqual(sha(String(b.secret || '')), sha(secret))) {
      console.warn('[emergency] essai refusé');
      throw new HttpError(401, 'Refusé.');
    }
    const password = String(b.password || '');
    if (!password) throw new HttpError(400, 'Choisissez un mot de passe.');

    const svc = serviceClient();
    let userId: string | null = null;
    for (let page = 1; page <= 20 && !userId; page++) {
      const { data, error } = await svc.auth.admin.listUsers({ page, perPage: 200 });
      if (error) throw new HttpError(500, error.message);
      userId = data.users.find((u) => (u.email || '').toLowerCase() === email)?.id ?? null;
      if (data.users.length < 200) break;
    }
    if (userId) {
      const { error } = await svc.auth.admin.updateUserById(userId, { password, ban_duration: 'none', email_confirm: true });
      if (error) throw new HttpError(400, error.message);
    } else {
      const { data, error } = await svc.auth.admin.createUser({ email, password, email_confirm: true });
      if (error || !data.user) throw new HttpError(400, error?.message || 'Création du compte impossible.');
      userId = data.user.id;
    }
    const { error: pErr } = await svc.from('app_profiles').upsert({ user_id: userId, role: 'superadmin' });
    if (pErr) throw new HttpError(500, `Profil non rétabli : ${pErr.message} (sql/admin_06_last_superadmin.sql exécuté ?)`);

    console.warn(`[emergency] accès rétabli pour ${email}`);
    return NextResponse.json({ ok: true, email });
  } catch (e) {
    return fail(e);
  }
}
