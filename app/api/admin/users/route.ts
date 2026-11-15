// « Gestion des accès » : liste, création et modification des comptes de l'application.
// Réservé aux profils admin et superadmin. Règles :
//   - un admin gère les comptes « analyst » et « admin » ; seul le superadmin crée / modifie / donne le rôle superadmin ;
//   - personne ne peut changer son propre rôle, se désactiver ou se supprimer.
// Les affectations d'équipes (team_access) se font directement depuis le navigateur (RLS admin).
import { NextResponse } from 'next/server';
import { authenticate, fail, HttpError, serviceClient, type Caller, type Role } from '@/lib/serverAuth';

export const dynamic = 'force-dynamic';

const ROLES: Role[] = ['superadmin', 'admin', 'analyst'];
const isRole = (r: unknown): r is Role => typeof r === 'string' && (ROLES as string[]).includes(r);

async function targetRole(svc: ReturnType<typeof serviceClient>, userId: string): Promise<Role | null> {
  const { data } = await svc.from('app_profiles').select('role').eq('user_id', userId).maybeSingle();
  return isRole(data?.role) ? data.role : null;
}
// Un admin agit sur analyst, admin ou compte sans profil (jamais sur un superadmin) ; le superadmin sur tous.
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
    const [{ data: profiles }, { data: access }] = await Promise.all([
      svc.from('app_profiles').select('user_id, role, display_name'),
      svc.from('team_access').select('user_id, team_id'),
    ]);
    const prof = new Map<string, any>((profiles ?? []).map((p: any) => [p.user_id, p]));
    return NextResponse.json({
      callerRole: caller.role,
      callerId: caller.userId,
      users: users
        .map((u) => ({
          id: u.id, email: u.email, created_at: u.created_at, last_sign_in_at: u.last_sign_in_at,
          banned: !!u.banned_until && new Date(u.banned_until) > new Date(),
          role: prof.get(u.id)?.role ?? null, display_name: prof.get(u.id)?.display_name ?? null,
        }))
        .sort((a, b) => String(a.email).localeCompare(String(b.email))),
      access: access ?? [],
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
    const role: Role = isRole(b.role) ? b.role : 'analyst';
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new HttpError(400, 'Adresse e-mail invalide.');
    if (password.length < 8) throw new HttpError(400, 'Mot de passe : 8 caractères minimum.');
    assertCanManage(caller, null, role);

    const { data, error } = await svc.auth.admin.createUser({ email, password, email_confirm: true });
    if (error || !data.user) throw new HttpError(400, error?.message || 'Création du compte impossible.');
    const { error: pErr } = await svc.from('app_profiles').upsert({
      user_id: data.user.id, role, display_name: String(b.display_name || '').trim() || email,
    });
    if (pErr) throw new HttpError(500, `Compte créé mais profil non enregistré : ${pErr.message}`);
    return NextResponse.json({ ok: true, id: data.user.id });
  } catch (e) {
    return fail(e);
  }
}

export async function PATCH(req: Request) {
  try {
    const caller = await authenticate(req);
    const svc = serviceClient();
    const b = await req.json().catch(() => ({}));
    const userId = String(b.user_id || '');
    if (!userId) throw new HttpError(400, 'Compte manquant.');
    const self = userId === caller.userId;
    const current = await targetRole(svc, userId);
    const roleChange = b.role !== undefined;
    const newRole: Role | null | undefined = roleChange ? (b.role === null ? null : isRole(b.role) ? b.role : undefined) : undefined;
    if (roleChange && newRole === undefined) throw new HttpError(400, 'Rôle inconnu.');
    assertCanManage(caller, current, newRole ?? null);
    if (self && (roleChange || b.banned === true)) throw new HttpError(400, 'Vous ne pouvez pas changer votre propre rôle ni vous désactiver.');

    if (roleChange) {
      if (newRole === null) {
        const { error } = await svc.from('app_profiles').delete().eq('user_id', userId);
        if (error) throw new HttpError(500, error.message);
      } else {
        const { error } = await svc.from('app_profiles').upsert({ user_id: userId, role: newRole });
        if (error) throw new HttpError(500, error.message);
      }
    }
    if (typeof b.display_name === 'string') {
      const { error } = await svc.from('app_profiles').update({ display_name: b.display_name.trim() || null }).eq('user_id', userId);
      if (error) throw new HttpError(500, error.message);
    }
    const attrs: Record<string, unknown> = {};
    if (typeof b.password === 'string' && b.password) {
      if (b.password.length < 8) throw new HttpError(400, 'Mot de passe : 8 caractères minimum.');
      attrs.password = b.password;
    }
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
    assertCanManage(caller, await targetRole(svc, userId));
    const { error } = await svc.auth.admin.deleteUser(userId);
    if (error) throw new HttpError(400, error.message);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return fail(e);
  }
}
