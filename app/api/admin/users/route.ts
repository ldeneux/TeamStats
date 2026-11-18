// « Gestion des accès » : liste, création et modification des comptes de l'application.
// Réservé aux profils admin et superadmin. Règles :
//   - un admin gère les comptes « coach » et « admin » ; seul le superadmin crée / modifie / donne le rôle superadmin ;
//   - personne ne peut changer son propre rôle, se désactiver ou se supprimer.
// Les profils (app_profiles) et affectations (team_access) sont lus et écrits AVEC LE JETON DE L'APPELANT : les règles
// de la base (RLS) s'appliquent donc, et aucun droit particulier n'est nécessaire sur le schéma « multisports ».
// La clé « service » ne sert qu'à la partie comptes d'authentification (liste, création, mot de passe, suppression).
import { NextResponse } from 'next/server';
import { authenticate, fail, HttpError, serviceClient, type Caller, type Role } from '@/lib/serverAuth';

export const dynamic = 'force-dynamic';

const ROLES: Role[] = ['superadmin', 'admin', 'coach', 'consultant'];
// L'ancien nom « analyst » est lu comme « coach » (le temps que la base soit migrée : sql/admin_04_role_coach.sql).
const asRole = (r: unknown): Role | null => (r === 'analyst' ? 'coach' : typeof r === 'string' && (ROLES as string[]).includes(r) ? (r as Role) : null);

async function targetRole(caller: Caller, userId: string): Promise<Role | null> {
  const { data, error } = await caller.db.from('app_profiles').select('role').eq('user_id', userId).maybeSingle();
  if (error) throw new HttpError(500, `Lecture du profil : ${error.message}`);
  return asRole(data?.role);
}
// Un admin agit sur coach, admin ou compte sans profil (jamais sur un superadmin) ; le superadmin sur tous.
function assertCanManage(caller: Caller, current: Role | null, wanted?: Role | null) {
  if (caller.role === 'superadmin') return;
  if (current === 'superadmin') throw new HttpError(403, 'Seul un superadmin peut modifier un compte superadmin.');
  if (wanted === 'superadmin') throw new HttpError(403, 'Seul un superadmin peut donner le rôle superadmin.');
}

export async function GET(req: Request) {
  try {
    const caller = await authenticate(req);
    const svc = serviceClient();
    const users: any[] = [];
    for (let page = 1; page <= 20; page++) {
      const { data, error } = await svc.auth.admin.listUsers({ page, perPage: 200 });
      if (error) throw new HttpError(500, error.message);
      users.push(...data.users);
      if (data.users.length < 200) break;
    }
    const [prof, acc] = await Promise.all([
      caller.db.from('app_profiles').select('user_id, role, display_name'),
      caller.db.from('team_access').select('user_id, team_id'),
    ]);
    if (prof.error) throw new HttpError(500, `Lecture des profils : ${prof.error.message}`);
    if (acc.error) throw new HttpError(500, `Lecture des accès : ${acc.error.message}`);
    const byUser = new Map<string, any>((prof.data ?? []).map((p: any) => [p.user_id, p]));
    // Un admin ne voit pas les comptes superadmin : ils sont retirés ICI, côté serveur (ils n'arrivent jamais au navigateur).
    const hidden = new Set<string>();
    if (caller.role === 'admin') {
      for (const p of prof.data ?? []) if (asRole((p as any).role) === 'superadmin') hidden.add((p as any).user_id);
      const { data: ids } = await caller.db.rpc('superadmin_user_ids');   // renfort base (sql/admin_07_hide_superadmin.sql)
      for (const id of (ids ?? []) as string[]) hidden.add(id);
    }
    return NextResponse.json({
      callerRole: caller.role,
      callerId: caller.userId,
      users: users
        .filter((u) => !hidden.has(u.id))
        .map((u) => ({
          id: u.id, email: u.email, created_at: u.created_at, last_sign_in_at: u.last_sign_in_at,
          banned: !!u.banned_until && new Date(u.banned_until) > new Date(),
          role: asRole(byUser.get(u.id)?.role), display_name: byUser.get(u.id)?.display_name ?? null,
        }))
        .sort((a, b) => String(a.email).localeCompare(String(b.email))),
      access: (acc.data ?? []).filter((a: any) => !hidden.has(a.user_id)),
    });
  } catch (e) {
    return fail(e);
  }
}

export async function POST(req: Request) {
  try {
    const caller = await authenticate(req);
    const svc = serviceClient();
    const b = await req.json().catch(() => ({}));
    const email = String(b.email || '').trim().toLowerCase();
    const password = String(b.password || '');
    const role: Role = asRole(b.role) ?? 'coach';
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new HttpError(400, 'Adresse e-mail invalide.');
    if (!password) throw new HttpError(400, 'Mot de passe manquant.');
    assertCanManage(caller, null, role);

    const { data, error } = await svc.auth.admin.createUser({ email, password, email_confirm: true });
    if (error || !data.user) throw new HttpError(400, error?.message || 'Création du compte impossible.');
    const { error: pErr } = await caller.db.from('app_profiles').upsert({
      user_id: data.user.id, role, display_name: String(b.display_name || '').trim() || email,
    });
    if (pErr) throw new HttpError(500, `Compte créé mais profil non enregistré : ${pErr.message}`);
    return NextResponse.json({ ok: true, id: data.user.id });
  } catch (e) {
    return fail(e);
  }
}

// Un seul appel pour tout enregistrer : nom, rôle, mot de passe, activation. Seuls les champs envoyés changent.
export async function PATCH(req: Request) {
  try {
    const caller = await authenticate(req);
    const svc = serviceClient();
    const b = await req.json().catch(() => ({}));
    const userId = String(b.user_id || '');
    if (!userId) throw new HttpError(400, 'Compte manquant.');
    const self = userId === caller.userId;
    const current = await targetRole(caller, userId);
    const roleChange = b.role !== undefined;
    const newRole: Role | null = roleChange ? (b.role === null || b.role === '' ? null : asRole(b.role)) : null;
    if (roleChange && b.role !== null && b.role !== '' && newRole === null) throw new HttpError(400, 'Rôle inconnu.');
    assertCanManage(caller, current, newRole);
    if (self && ((roleChange && newRole !== current) || b.banned === true)) throw new HttpError(400, 'Vous ne pouvez pas changer votre propre rôle ni vous désactiver.');

    if (roleChange && newRole !== current) {
      if (newRole === null) {
        const { error } = await caller.db.from('app_profiles').delete().eq('user_id', userId);
        if (error) throw new HttpError(500, error.message);
      } else {
        const display = typeof b.display_name === 'string' ? b.display_name.trim() || null : undefined;
        const { error } = await caller.db.from('app_profiles').upsert({ user_id: userId, role: newRole, ...(display !== undefined ? { display_name: display } : {}) });
        if (error) throw new HttpError(500, error.message);
      }
    } else if (typeof b.display_name === 'string' && current !== null) {
      const { error } = await caller.db.from('app_profiles').update({ display_name: b.display_name.trim() || null }).eq('user_id', userId);
      if (error) throw new HttpError(500, error.message);
    }
    const attrs: Record<string, unknown> = {};
    if (typeof b.password === 'string' && b.password) attrs.password = b.password;
    if (typeof b.banned === 'boolean') attrs.ban_duration = b.banned ? '876000h' : 'none';
    if (Object.keys(attrs).length > 0) {
      const { error } = await svc.auth.admin.updateUserById(userId, attrs);
      if (error) throw new HttpError(400, error.message);
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return fail(e);
  }
}

export async function DELETE(req: Request) {
  try {
    const caller = await authenticate(req);
    const svc = serviceClient();
    const b = await req.json().catch(() => ({}));
    const userId = String(b.user_id || '');
    if (!userId) throw new HttpError(400, 'Compte manquant.');
    if (userId === caller.userId) throw new HttpError(400, 'Vous ne pouvez pas supprimer votre propre compte.');
    assertCanManage(caller, await targetRole(caller, userId));
    // on retire d'abord ses affectations et son profil (les liens vers le compte empêcheraient sa suppression)
    const a = await caller.db.from('team_access').delete().eq('user_id', userId);
    if (a.error) throw new HttpError(500, a.error.message);
    const p = await caller.db.from('app_profiles').delete().eq('user_id', userId);
    if (p.error) throw new HttpError(500, p.error.message);
    const { error } = await svc.auth.admin.deleteUser(userId);
    if (error) throw new HttpError(400, error.message);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return fail(e);
  }
}
