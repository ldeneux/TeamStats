// Aide commune aux routes /api/admin/* : identifie l'appelant à partir de son jeton Supabase et lit son rôle.
// Les requêtes passent avec LE JETON DE L'APPELANT : les règles RLS de la base s'appliquent donc comme
// dans le navigateur. Seule la gestion des comptes (création, mot de passe) utilise la clé « service ».
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

export type DB = SupabaseClient<any, any, any, any, any>;
export type Role = 'superadmin' | 'admin' | 'coach' | 'consultant';

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export interface Caller {
  token: string;
  userId: string;
  email: string;
  role: Role;
  db: DB; // client avec le jeton de l'appelant (RLS appliquée)
}

export async function authenticate(req: Request, allowed: Role[] = ['admin', 'superadmin']): Promise<Caller> {
  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (!token) throw new HttpError(401, 'Connexion requise.');
  if (!URL_ || !ANON) throw new HttpError(500, 'NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY manquantes côté serveur.');
  const db = createClient(URL_, ANON, {
    db: { schema: 'multisports' },
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: u, error } = await db.auth.getUser(token);
  if (error || !u?.user) throw new HttpError(401, 'Session invalide ou expirée : reconnectez-vous.');
  const { data: prof, error: pErr } = await db.from('app_profiles').select('role').eq('user_id', u.user.id).maybeSingle();
  if (pErr) throw new HttpError(500, `Profil illisible : ${pErr.message}`);
  const role = prof?.role as Role | undefined;
  if (!role || !allowed.includes(role)) throw new HttpError(403, 'Accès réservé aux administrateurs.');
  return { token, userId: u.user.id, email: u.user.email || '', role, db };
}

// Client « service » (contourne la RLS, accès à auth.admin) : uniquement côté serveur.
export function serviceClient(): DB {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) {
    throw new HttpError(
      500,
      'SUPABASE_SERVICE_ROLE_KEY n\'est pas définie sur le serveur (Vercel > Settings > Environment Variables). Elle est nécessaire pour lister et créer des comptes.'
    );
  }
  return createClient(URL_, key, { db: { schema: 'multisports' }, auth: { persistSession: false, autoRefreshToken: false } });
}

export function fail(e: unknown) {
  if (e instanceof HttpError) return NextResponse.json({ error: e.message }, { status: e.status });
  const message = e instanceof Error ? e.message : String(e);
  return NextResponse.json({ error: message }, { status: 500 });
}
