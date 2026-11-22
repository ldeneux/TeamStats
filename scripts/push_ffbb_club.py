"""
MiseAJourFFBB_Club : dépose dans Supabase (table ffbb_poule_cache) les pages des poules de
TOUTES les équipes du club, pour toutes les phases de la saison en cours.

Contrairement à MiseAJourFFBB (qui part des phases saisies dans l'appli), celui-ci sert aussi
d'INITIALISATION : il part de la page du club sur competitions.ffbb.com, y relève la liste des
équipes (une par niveau et par phase), ouvre la page de chaque équipe pour trouver sa poule,
puis dépose les pages de la poule comme le fait MiseAJourFFBB. Les phases déjà saisies dans
l'appli (avec un lien de poule) sont reprises en complément.

Il écrit aussi, dans ~/.multisports-ffbb/ :
  - MiseAJourFFBB_Club_rapport.csv : une ligne par équipe (résultat, poule, lien) ;
  - diagnostic/ : copies des pages FFBB lues quand quelque chose n'a pas pu être trouvé.

Mêmes identifiants que MiseAJourFFBB (mémorisés dans ~/.multisports-ffbb/config.json).
Version script : `python push_ffbb_club.py` (Python + `pip install requests`).
"""
import csv
import getpass
import json
import os
import re
import sys
import time
from html import unescape
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




# ----------------------------------------------------------------------------- le club
SITE = "https://competitions.ffbb.com"
CLUB_NOM = "OLYMPIC SATHONAY"
CLUB_CODE = "ARA0069106"                      # code FFBB du club (ligue ARA, comité 0069)
CLUB_URL = f"{SITE}/ligues/ara/comites/0069/clubs/{CLUB_CODE.lower()}"
# Les compétitions départementales sont sous …/comites/0069/competitions/<code>, les compétitions
# régionales (RM2, coupes régionales…) directement sous …/ligues/ara/competitions/<code>.
PREFIXES = ["/ligues/ara/comites/0069", "/ligues/ara"]
BASE_COMPETITIONS = f"{SITE}{PREFIXES[0]}/competitions"
DOSSIER = CONFIG.parent
PAUSE = 0.4   # secondes entre deux pages (on reste poli avec le site)

RE_LIEN = re.compile(r"((?:/ligues/[A-Za-z0-9_-]+)?(?:/comites/[A-Za-z0-9_-]+)?)/competitions/([A-Za-z0-9_.~%-]+)\?([^\"'\\\s<>]*)")
RE_POULE = re.compile(r'"(?:idPoule|id_poule|pouleId|poule_id)"\s*:\s*(?:\{\s*"id"\s*:\s*)?"?(\d{9,})')
# Poule d'une rencontre de l'équipe, telle qu'elle figure dans les données de sa page : "idPoule":{"id":"…"}
RE_POULE_STRICT = re.compile(r'"idPoule"\s*:\s*\{\s*"id"\s*:\s*"(\d{9,})"')
RE_PHASE = re.compile(r'"(?:idCompetition|id_competition|competitionId|competition_id|idPhase|phaseId)"\s*:\s*(?:\{\s*"id"\s*:\s*)?"?(\d{9,})')
RE_ENG_JSON = re.compile(r'"(?:idEngagement|engagementId|id_engagement)"\s*:\s*(?:\{\s*"id"\s*:\s*)?"?(\d{12,})')


def telecharger(url):
    time.sleep(PAUSE)
    r = requests.get(url, headers=HEADERS_SITE, timeout=30)
    if r.status_code != 200:
        blocage = " (blocage anti-robot du site, réessaie plus tard)" if r.status_code in (403, 429, 503) else ""
        raise RuntimeError(f"le site répond HTTP {r.status_code}{blocage}")
    return r.text


def decoder(html):
    """Texte de la page + flux Next.js décodé (où les guillemets du JSON ne sont plus échappés)."""
    flux = []
    for m in re.finditer(r'self\.__next_f\.push\(\[\d+,\s*("(?:[^"\\]|\\.)*")\]\)', html):
        try:
            flux.append(json.loads(m.group(1)))
        except ValueError:
            pass
    txt = html + "\n" + "\n".join(flux)
    return txt.replace("\\/", "/").replace("&amp;", "&").replace("\\u0026", "&")


def titre(html):
    m = re.search(r"<title[^>]*>(.*?)</title>", html, re.S | re.I)
    return re.sub(r"\s+", " ", unescape(m.group(1))).strip() if m else ""


def sauver_diag(nom, contenu):
    try:
        d = DOSSIER / "diagnostic"
        d.mkdir(parents=True, exist_ok=True)
        (d / nom).write_text(contenu, encoding="utf-8")
    except Exception:
        pass


def engagements_du_club(txt):
    """Identifiants des équipes (engagements) listées sur la page du club."""
    ids = list(dict.fromkeys(re.findall(
        r"clubs/" + re.escape(CLUB_CODE.lower()) + r"/equipes/(\d{6,})", txt, re.I)))
    if ids:
        return ids
    # Secours : identifiants d'engagement présents dans les données de la page.
    return list(dict.fromkeys(RE_ENG_JSON.findall(txt)))


def candidats_equipe(txt):
    """Poules possibles pour une équipe : d'abord les liens …/competitions/<code>?poule=…&phase=…
    de sa page (avec LEUR chemin : départemental ou régional) ; à défaut, les identifiants de poule /
    compétition présents dans ses données. Pour chaque poule, les autres chemins possibles sont
    ajoutés en variantes, essayées seulement si les premiers essais échouent (404 notamment)."""
    vus, primaires, variantes, liens_phase = set(), [], [], []

    def ajouter(prefixe, slug, poule, phase, via):
        cle = (prefixe, slug, poule, phase)
        if cle in vus:
            return
        vus.add(cle)
        c = {"base": f"{SITE}{prefixe}/competitions/{slug}", "poule": poule, "phase": phase, "via": via}
        (primaires if via != "variante" else variantes).append(c)

    for m in RE_LIEN.finditer(txt):
        q = parse_qs(m.group(3))
        poule = (q.get("poule") or [""])[0]
        phase = (q.get("phase") or [""])[0] or None
        if re.fullmatch(r"\d{9,}", poule):
            ajouter(m.group(1) or PREFIXES[0], m.group(2), poule, phase, "lien")
            for pre in PREFIXES:
                ajouter(pre, m.group(2), poule, phase, "variante")
        elif phase and re.fullmatch(r"\d{9,}", phase):
            # Lien de compétition sans poule (ex. coupes) : …/competitions/crmlsm?phase=…
            # La poule de l'équipe se lit alors dans les données de la page.
            liens_phase.append((m.group(1) or PREFIXES[0], m.group(2), phase))
    if not primaires and liens_phase:
        poules_page = list(dict.fromkeys(RE_POULE_STRICT.findall(txt)))[:4]
        for prefixe, slug, phase in dict.fromkeys(liens_phase):
            for poule in poules_page:
                ajouter(prefixe, slug, poule, phase, "lien-phase")
                for pre in PREFIXES:
                    ajouter(pre, slug, poule, phase, "variante")
    if not primaires:
        poules = list(dict.fromkeys(RE_POULE_STRICT.findall(txt) + RE_POULE.findall(txt)))[:4]
        phases = list(dict.fromkeys(RE_PHASE.findall(txt)))[:3] or [None]
        for p in poules:
            for ph in phases:
                for pre in PREFIXES:
                    ajouter(pre, ph or "x", p, ph, "identifiants")
    return primaires + variantes


def candidat_depuis_lien(competition_url, poule_stockee):
    """Même lecture que MiseAJourFFBB pour une phase saisie dans l'appli."""
    poule, phase, base = poule_stockee, None, None
    if competition_url:
        u = urlparse(competition_url.strip())
        q = parse_qs(u.query)
        poule = (q.get("poule") or [poule])[0]
        phase = (q.get("phase") or [None])[0]
        m = re.match(r"^(.*/competitions/[^/]+)", u.path)
        if m:
            base = f"{u.scheme}://{u.netloc}{m.group(1)}"
    if not base or not poule:
        raise RuntimeError("lien de poule incomplet (il faut ...?poule=...&phase=...)")
    return {"base": base, "poule": str(poule), "phase": phase, "via": "appli"}


def lire_poule(c, engagement=None):
    """Télécharge les journées 1 et 2 de la poule. Si `engagement` est donné, la poule doit
    contenir cette équipe (sinon ce n'est pas la bonne). Renvoie (pages, nb_matchs)."""
    pages = []
    for n in JOURNEES_A_LIRE:
        params = {"poule": c["poule"]}
        if c["phase"]:
            params["phase"] = c["phase"]
        params["journee"] = n
        pages.append(telecharger(f"{c['base']}?{urlencode(params)}"))
    nb = len(re.findall(r'\\?"nomEquipe1\\?"', pages[0]))
    if c["poule"] not in pages[0] or nb == 0:
        raise RuntimeError("la page ne contient pas les données de la poule")
    if engagement and not any(engagement in p for p in pages):
        raise RuntimeError("notre équipe n'apparaît pas dans cette poule")
    return pages, nb


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
    print(f"\nClub : {CLUB_NOM} ({CLUB_CODE}) - saison {saison_en_cours()}")

    rapport = []        # une ligne par équipe / phase
    deposees = set()    # poules déjà déposées pendant ce lancement

    # --- 1) La liste des équipes, depuis la page du club -----------------------------------
    print("\n1/3  Recherche des équipes du club sur competitions.ffbb.com ...")
    engagements, html_club = [], None
    try:
        html_club = telecharger(CLUB_URL)
        engagements = engagements_du_club(decoder(html_club))
    except Exception as e:
        print(f"  Page du club illisible : {e}")
    if html_club is not None and not engagements:
        sauver_diag("page_club.html", html_club)
        print("  Aucune équipe repérée dans la page du club (copie enregistrée dans le dossier diagnostic).")
    print(f"  {len(engagements)} équipe(s) trouvée(s).")

    # --- 2) La poule de chaque équipe ------------------------------------------------------
    print("\n2/3  Lecture de la poule de chaque équipe ...")
    diag_faite = False
    for i, eng in enumerate(engagements, 1):
        ligne = {"engagement": eng, "equipe": "", "poule": "", "phase": "", "lien": "", "matchs": "", "statut": ""}
        html_eq = None
        try:
            html_eq = telecharger(f"{CLUB_URL}/equipes/{eng}")
            ligne["equipe"] = titre(html_eq)
            candidats = candidats_equipe(decoder(html_eq))
            if not candidats:
                raise RuntimeError("aucun lien de poule trouvé dans la page de l'équipe")
            derniere = "poule introuvable"
            for c in candidats:
                try:
                    pages, nb = lire_poule(c, eng)
                except Exception as e:
                    derniere = str(e)
                    continue
                ligne.update(poule=c["poule"], phase=c["phase"] or "", matchs=nb,
                             lien=f"{c['base']}?poule={c['poule']}" + (f"&phase={c['phase']}" if c["phase"] else ""))
                if c["poule"] in deposees:
                    ligne["statut"] = "OK (poule déjà déposée)"
                else:
                    deposer(token, c["poule"], pages)
                    deposees.add(c["poule"])
                    ligne["statut"] = f"OK ({c['via']})"
                break
            else:
                raise RuntimeError(derniere)
        except Exception as e:
            ligne["statut"] = f"ERREUR : {e}"
            if html_eq and not diag_faite:
                sauver_diag(f"page_equipe_{eng}.html", html_eq)
                diag_faite = True
        rapport.append(ligne)
        marque = "OK " if ligne["statut"].startswith("OK") else "ERR"
        print(f"  [{i}/{len(engagements)}] {marque} {ligne['equipe'] or eng} - {ligne['statut']}")

    # --- 3) Les phases déjà saisies dans l'appli (complément) -------------------------------
    print("\n3/3  Phases déjà saisies dans l'appli ...")
    try:
        phases = [p for p in lire_phases(token) if p.get("competition_url") or p.get("poule_id")]
    except Exception as e:
        phases = []
        print(f"  Lecture impossible : {e}")
    ajoutees = 0
    for p in phases:
        ligne = {"engagement": "", "equipe": p.get("phase_name") or "", "poule": "", "phase": "", "lien": "", "matchs": "", "statut": ""}
        try:
            c = candidat_depuis_lien(p.get("competition_url"), p.get("poule_id"))
            ligne.update(poule=c["poule"], phase=c["phase"] or "", lien=p.get("competition_url") or "")
            if c["poule"] in deposees:
                continue
            pages, nb = lire_poule(c)
            deposer(token, c["poule"], pages)
            deposees.add(c["poule"])
            ligne.update(matchs=nb, statut="OK (appli)")
            ajoutees += 1
            print(f"  OK  {ligne['equipe']} (poule {c['poule']})")
        except Exception as e:
            ligne["statut"] = f"ERREUR : {e}"
            print(f"  ERR {ligne['equipe']} - {e}")
        rapport.append(ligne)
    if not ajoutees:
        print("  Rien à ajouter.")

    # --- Bilan ---------------------------------------------------------------------------
    ok = sum(1 for r in rapport if r["statut"].startswith("OK"))
    erreurs = len(rapport) - ok
    try:
        DOSSIER.mkdir(parents=True, exist_ok=True)
        chemin = DOSSIER / "MiseAJourFFBB_Club_rapport.csv"
        with open(chemin, "w", newline="", encoding="utf-8-sig") as f:
            w = csv.DictWriter(f, fieldnames=["engagement", "equipe", "poule", "phase", "matchs", "statut", "lien"])
            w.writeheader()
            w.writerows(rapport)
        print(f"\nRapport : {chemin}")
    except Exception:
        pass
    print(f"\n{len(deposees)} poule(s) déposée(s), {erreurs} équipe(s) en erreur.")
    if erreurs or not engagements:
        print(f"En cas de problème, envoie le contenu du dossier {DOSSIER} à la personne qui gère l'appli.")
    else:
        print("Terminé. Dans l'appli, clique sur « Synchroniser FFBB ».")


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