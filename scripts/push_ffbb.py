"""
Dépose depuis TON PC les pages des poules FFBB dans Supabase (table ffbb_poule_cache).

Pourquoi : competitions.ffbb.com bloque les serveurs Vercel (HTTP 403) mais pas ton PC.
Ce programme lit les pages (comme ton navigateur) et les envoie à Supabase ; ensuite, dans
l'appli, le bouton « Synchroniser FFBB » de l'onglet Basket les utilise.

Deux façons de l'utiliser :
  - version « programme » (MiseAJourFFBB.exe) : double-clic, rien à installer ;
  - version script : `python push_ffbb.py` (nécessite Python + `pip install requests`).

Au premier lancement, l'e-mail et le mot de passe du compte de l'appli sont demandés,
puis mémorisés dans le dossier personnel de l'utilisateur (~/.multisports-ffbb/config.json)
pour que les lancements suivants soient sans question. Supprime ce fichier pour les oublier.
"""
import getpass
import json
import os
import re
import sys
from pathlib import Path
from datetime import datetime, timezone
from urllib.parse import parse_qs, urlparse, urlencode

import requests

SUPABASE_URL = "https://khhwqaqjzfthytxuvsgf.supabase.co"        # ex. https://xxxxxxxxxxxx.supabase.co
SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtoaHdxYXFqemZ0aHl0eHV2c2dmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc4MTc2NzEsImV4cCI6MjEwMzM5MzY3MX0.kuffyiL80ONhtpy5dZKX9dGAHakFNgmF-6EK1re5AJU"   # ex. eyJ...

HEADERS_SITE = {
    "User-Agent": ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                   "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"),
    "Accept": "text/html,application/xhtml+xml",
    "Accept-Language": "fr-FR,fr;q=0.9",
}
JOURNEES_A_LIRE = (1, 2)   # une page contient normalement toute la poule ; la 2e = sécurité


def saison_en_cours():
    now = datetime.now()
    fin = now.year + 1 if now.month >= 9 else now.year
    return f"{fin - 1}-{fin}"


def sb_headers(token=None, profile="multisports", write=False):
    h = {"apikey": SUPABASE_ANON_KEY, "Authorization": f"Bearer {token or SUPABASE_ANON_KEY}"}
    h["Content-Profile" if write else "Accept-Profile"] = profile
    return h


class ConnexionRefusee(Exception):
    """E-mail ou mot de passe refusé par Supabase."""


CONFIG = Path.home() / ".multisports-ffbb" / "config.json"


def charger_config():
    try:
        return json.loads(CONFIG.read_text(encoding="utf-8"))
    except Exception:
        return {}


def sauver_config(email, mot_de_passe):
    try:
        CONFIG.parent.mkdir(parents=True, exist_ok=True)
        CONFIG.write_text(json.dumps({"email": email, "password": mot_de_passe}), encoding="utf-8")
        try:
            os.chmod(CONFIG, 0o600)   # lisible par l'utilisateur seul (Mac/Linux)
        except Exception:
            pass
    except Exception:
        print("(Impossible de mémoriser les identifiants : ils seront redemandés la prochaine fois.)")


def oublier_config():
    try:
        CONFIG.unlink()
    except Exception:
        pass


def connexion(email, mot_de_passe):
    r = requests.post(f"{SUPABASE_URL}/auth/v1/token?grant_type=password",
                      headers={"apikey": SUPABASE_ANON_KEY, "Content-Type": "application/json"},
                      json={"email": email, "password": mot_de_passe}, timeout=30)
    if r.status_code in (400, 401):
        raise ConnexionRefusee()
    if r.status_code != 200:
        raise RuntimeError(f"Connexion à l'appli impossible ({r.status_code}) : {r.text[:200]}")
    return r.json()["access_token"]


def obtenir_token():
    """Identifiants mémorisés si possibles, sinon on les demande (3 essais)."""
    cfg = charger_config()
    if cfg.get("email") and cfg.get("password"):
        try:
            return connexion(cfg["email"], cfg["password"])
        except ConnexionRefusee:
            print("Les identifiants mémorisés ne fonctionnent plus : merci de les saisir à nouveau.")
            oublier_config()
    for _ in range(3):
        email = input("E-mail du compte de l'appli : ").strip()
        mot_de_passe = getpass.getpass("Mot de passe (rien ne s'affiche en tapant, c'est normal) : ")
        try:
            token = connexion(email, mot_de_passe)
        except ConnexionRefusee:
            print("E-mail ou mot de passe incorrect, réessaie.\n")
            continue
        sauver_config(email, mot_de_passe)
        return token
    raise RuntimeError("Trois essais incorrects. Demande les identifiants à la personne qui gère l'appli.")


def lire_phases(token):
    params = {"select": "phase_name,competition_url,poule_id", "season": f"eq.{saison_en_cours()}",
              "phase_type": "eq.ffbb"}
    r = requests.get(f"{SUPABASE_URL}/rest/v1/basketball_phases", params=params,
                     headers=sb_headers(token), timeout=30)
    if r.status_code != 200:
        raise RuntimeError(f"Lecture des phases impossible ({r.status_code}) : {r.text[:200]}")
    return r.json()


def lire_pages(competition_url, poule_stockee):
    """Télécharge la page de la poule (journées 1 et 2). Renvoie (poule_id, [html...])."""
    poule_id, phase_id, base = poule_stockee, None, None
    if competition_url:
        u = urlparse(competition_url.strip())
        q = parse_qs(u.query)
        poule_id = (q.get("poule") or [poule_id])[0]
        phase_id = (q.get("phase") or [None])[0]
        m = re.match(r"^(.*/competitions/[^/]+)", u.path)
        if m:
            base = f"{u.scheme}://{u.netloc}{m.group(1)}"
    if not base or not poule_id:
        raise RuntimeError("lien de poule incomplet (il faut ...?poule=...&phase=...)")
    pages = []
    for n in JOURNEES_A_LIRE:
        params = {"poule": poule_id}
        if phase_id:
            params["phase"] = phase_id
        params["journee"] = n
        r = requests.get(f"{base}?{urlencode(params)}", headers=HEADERS_SITE, timeout=30)
        if r.status_code != 200:
            raise RuntimeError(f"le site répond HTTP {r.status_code} (journée {n})")
        pages.append(r.text)
    html = pages[0]
    nb = len(re.findall(r'\\?"nomEquipe1\\?"', html))
    if str(poule_id) not in html or nb == 0:
        raise RuntimeError("la page ne contient pas les données de la poule (lien incorrect ou page protégée)")
    return str(poule_id), pages, nb


def deposer(token, poule_id, pages):
    corps = {"poule_id": poule_id, "data": {"pages": pages},
             "fetched_at": datetime.now(timezone.utc).isoformat()}
    h = sb_headers(token, write=True)
    h.update({"Content-Type": "application/json", "Prefer": "resolution=merge-duplicates,return=minimal"})
    r = requests.post(f"{SUPABASE_URL}/rest/v1/ffbb_poule_cache?on_conflict=poule_id",
                      headers=h, json=corps, timeout=120)
    if r.status_code not in (200, 201, 204):
        raise RuntimeError(f"écriture Supabase ({r.status_code}) : {r.text[:200]}")


def main():
    if not SUPABASE_URL or not SUPABASE_ANON_KEY:
        raise RuntimeError("Renseigne SUPABASE_URL et SUPABASE_ANON_KEY en haut du fichier.")
    token = obtenir_token()

    phases = [p for p in lire_phases(token) if p.get("competition_url") or p.get("poule_id")]
    if not phases:
        print(f"Aucune phase FFBB avec un lien de poule pour la saison {saison_en_cours()}.")
        return
    deja = set()
    erreurs = 0
    for p in phases:
        try:
            poule_id, pages, nb = lire_pages(p.get("competition_url"), p.get("poule_id"))
            if poule_id in deja:
                continue
            deja.add(poule_id)
            deposer(token, poule_id, pages)
            print(f"OK  {p['phase_name']} (poule {poule_id}) : {len(pages)} pages déposées "
                  f"({sum(len(x) for x in pages) // 1024} Ko, ~{nb} mentions de matchs)")
        except Exception as e:
            erreurs += 1
            print(f"ERREUR  {p['phase_name']} : {e}")
    print("Terminé avec des erreurs." if erreurs else "Terminé. Dans l'appli, clique sur « Synchroniser FFBB ».")


def lancer():
    code = 0
    try:
        main()
    except requests.exceptions.RequestException:
        print("\nERREUR : pas de connexion Internet (ou service injoignable). Vérifie ta connexion et recommence.")
        code = 1
    except KeyboardInterrupt:
        code = 1
    except Exception as e:
        print(f"\nERREUR : {e}")
        code = 1
    # Programme double-cliqué : on garde la fenêtre ouverte pour lire le résultat.
    if getattr(sys, "frozen", False):
        try:
            input("\nAppuie sur Entrée pour fermer cette fenêtre...")
        except EOFError:
            pass
    sys.exit(code)


if __name__ == "__main__":
    lancer()
