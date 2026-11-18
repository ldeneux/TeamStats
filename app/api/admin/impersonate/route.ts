// « Voir comme un coach » : permet à un admin / superadmin de tester ce que voit un compte coach, SANS son mot de passe.
//  - GET  : liste des comptes coach testables.
//  - POST : renvoie un jeton à usage unique (lien magique, aucun e-mail envoyé) que le navigateur échange contre une
//           vraie session de ce coach : les droits (RLS) appliqués sont donc exactement les siens.
// Garde-fous : réservé aux admin / superadmin ; seuls les comptes COACH et CONSULTANT sont ciblables (jamais un admin / superadmin) ;
// l'administrateur garde sa propre session (mise de côté dans l'onglet) pour revenir à son compte.
import { NextResponse } from 'next/server';
import { authenticate, fail, HttpError, serviceClient } from '@/lib/serverAuth';

export const dynamic = 'force-dynamic';

// Comptes testables : coach et consultant (jamais admin / superadmin).
const isCoach = (r: unknown) => r === 'coach' || r === 'analyst' || r === 'consultant';

async function coachProfiles(caller: Awaited<ReturnType<typeof authenticate>>) {
  const { data, error } = await caller.db.from('app_profiles').select('user_id, role, display_name');
  if (error) throw new HttpError(500, `Lecture des profils : ${error.message}`);
  return (data ?? []).filter((p: any) => isCoach(p.role));
}

export async function GET(req: Request) {
  try {
    const caller = await authenticate(req);
    const svc = serviceClient();
    const coaches = await coachProfiles(caller);
    const emails = new Map<string, string>();
    for (let page = 1; page <= 20; page++) {
      const { data, error } = await svc.auth.admin.listUsers({ page, perPage: 200 });
      if (error) throw new HttpError(500, error.message);
      for (const u of data.users) emails.set(u.id, u.email || '');
      if (data.users.length < 200) break;
    }
    return NextResponse.json({
      coaches: coaches
        .map((p: any) => ({ id: p.user_id as string, email: emails.get(p.user_id) || '', display_name: (p.display_name as string | null) ?? null, role: (p.role === 'analyst' ? 'coach' : p.role) as string }))
        .sort((a, b) => (a.display_name || a.email).localeCompare(b.display_name || b.email)),
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
    const userId = String(b.user_id || '');
    if (!userId) throw new HttpError(400, 'Compte manquant.');
    const target = (await coachProfiles(caller)).find((p: any) => p.user_id === userId);
    if (!target) throw new HttpError(403, 'Seul un compte coach ou consultant peut être testé.');
    const { data: u, error: uErr } = await svc.auth.admin.getUserById(userId);
    if (uErr || !u?.user?.email) throw new HttpError(404, uErr?.message || 'Compte introuvable.');
    const { data, error } = await svc.auth.admin.generateLink({ type: 'magiclink', email: u.user.email });
    const token = data?.properties?.hashed_token;
    if (error || !token) throw new HttpError(500, error?.message || 'Jeton non généré.');
    console.warn(`[impersonate] ${caller.email} (${caller.role}) teste le compte coach ${u.user.email}`);
    return NextResponse.json({ token_hash: token, email: u.user.email, display_name: (target as any).display_name ?? null });
  } catch (e) {
    return fail(e);
  }
}
