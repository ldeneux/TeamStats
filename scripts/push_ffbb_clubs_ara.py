"""
MiseAJourFFBB_ClubsARA : relève sur competitions.ffbb.com TOUS les clubs de la région
Auvergne-Rhône-Alpes (les 12 comités) et leurs équipes, puis les dépose dans Supabase
(table ffbb_clubs_cache). Dans l'appli, le bouton « Importer les clubs & équipes » (onglet Basket)
les range ensuite dans la liste des clubs (logo, nom) et dans la liste des équipes.

Même principe que MiseAJourFFBB_Club (calendriers) : le site bloque les serveurs, pas ton PC.
Mêmes identifiants (mémorisés dans ~/.multisports-ffbb/config.json).
Écrit aussi dans ~/.multisports-ffbb/ :
  - MiseAJourFFBB_ClubsARA_rapport.csv : une ligne par club (nombre d'équipes, résultat) ;
  - diagnostic/ : copies des pages FFBB lues quand quelque chose n'a pas pu être trouvé.
Version script : `python push_ffbb_clubs_ara.py` (Python + `pip install requests`).
Principe : la page de chaque comité (competitions.ffbb.com/ligues/ara/comites/<code>) contient la liste COMPLÈTE de
ses clubs (code, nom exact, logo) : une seule page par comité. Le programme lit ces 11 pages, puis la page de chaque
club pour en relever les équipes (une page par club), avec une cadence douce et des pauses automatiques si le site
ralentit les requêtes (HTTP 403). Si la liste d'un comité est introuvable, il retombe sur l'ancienne méthode
(essai des numéros ARA<comité>001, 002...). Reprise possible : un club déjà déposé n'est pas relu.
"""
import csv
from concurrent.futures import ThreadPoolExecutor
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



# ----------------------------------------------------------------------------- la région
SITE = "https://competitions.ffbb.com"
DOSSIER = CONFIG.parent
PAUSE = 1.0            # secondes entre deux pages (on reste poli avec le site ; augmente seule si le site ralentit)
FRAICHEUR_H = 12       # un club déposé il y a moins de 12 h n'est pas relu (reprise après interruption)
LOT = 25               # nombre de clubs déposés d'un coup
TRAVAILLEURS = 2       # pages lues en parallèle
LOT_NUMEROS = 12       # numéros de club essayés à chaque tour
GAP_MAX = 100          # on s'arrête après 100 numéros de suite sans club
ATTENTE_BLOCAGE = 90   # secondes d'attente quand le site bloque (HTTP 403/429), doublées à chaque nouvel essai
ESSAIS_BLOCAGE = 4     # nombre de pauses avant d'abandonner (la progression est conservée)

# Comités de la ligue Auvergne-Rhône-Alpes, tels que listés sur competitions.ffbb.com/ligues/ara
# (Drôme et Ardèche forment un seul comité : 2607).
COMITES = {
    "0001": "Ain", "0003": "Allier", "0015": "Cantal", "2607": "Drôme-Ardèche", "0038": "Isère",
    "0042": "Loire", "0043": "Haute-Loire", "0063": "Puy-de-Dôme", "0069": "Rhône et Métropole de Lyon",
    "0073": "Savoie", "0074": "Haute-Savoie",
}

RE_CLUB = re.compile(r"clubs/(ara\d{7})(?![0-9A-Za-z])", re.I)
RE_LOGO = re.compile(r'"logo"\s*:\s*\{\s*"id"\s*:\s*"([0-9a-fA-F-]{36})"')


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


def sans_balises(s):
    return re.sub(r"\s+", " ", unescape(re.sub(r"<[^>]+>", " ", s))).strip()


# ----------------------------------------------------------------------------- un club et ses équipes
def analyser_club(code, html):
    """Nom, logo et équipes d'un club, lus dans sa page."""
    comite = code[3:7]
    url = f"{SITE}/ligues/ara/comites/{comite}/clubs/{code.lower()}"
    txt = decoder(html)

    nom = ""
    for motif in (r'"nom"\s*:\s*"([^"]{3,80})"[^{}]{0,400}?"code"\s*:\s*"' + code + '"',
                  r'"code"\s*:\s*"' + code + r'"[^{}]{0,400}?"nom"\s*:\s*"([^"]{3,80})"'):
        m = re.search(motif, txt, re.I)
        if m:
            nom = m.group(1)
            break
    if not nom:
        nom = re.split(r"\s+[|–-]\s+", titre(html))[0].strip()

    logo = None
    for m in re.finditer(code, txt, re.I):
        w = txt[max(0, m.start() - 800): m.end() + 800]
        lm = RE_LOGO.search(w)
        if lm:
            logo = lm.group(1)
            break

    equipes = []
    for eid in dict.fromkeys(re.findall(r"clubs/" + code.lower() + r"/equipes/(\d{6,})", txt, re.I)):
        nom_eq = ""
        m = re.search(r"equipes/" + eid + r'["\'][^>]*>(.*?)</a>', html, re.S | re.I)
        if m:
            nom_eq = sans_balises(m.group(1))
        if not nom_eq:
            m = re.search(r'"id"\s*:\s*"?' + eid + r'"?[^{}]{0,300}?"nom"\s*:\s*"([^"]{2,80})"', txt)
            if m:
                nom_eq = m.group(1)
        equipes.append({"engagement_id": eid, "nom": nom_eq})
    return {"nom": nom or code, "url": url, "logo_asset": logo, "equipes": equipes}


def lire_club(code):
    """Une page de club (utilisé pour les tests) : lève une erreur si elle n'existe pas."""
    html = telecharger(f"{SITE}/ligues/ara/comites/{code[3:7]}/clubs/{code.lower()}")
    return analyser_club(code, html), html


def sonder(code):
    """Essaie le club de ce code. Renvoie ('club', data, html), ('absent',) ou ('erreur', message)."""
    url = f"{SITE}/ligues/ara/comites/{code[3:7]}/clubs/{code.lower()}"
    try:
        time.sleep(PAUSE)
        r = requests.get(url, headers=HEADERS_SITE, timeout=30)
    except Exception as e:
        return ("erreur", f"connexion : {e}")
    if r.status_code == 404:
        return ("absent",)
    if r.status_code in (403, 429, 503):
        return ("bloque", f"HTTP {r.status_code} (le site limite les requêtes)")
    if r.status_code != 200:
        return ("erreur", f"HTTP {r.status_code}")
    # Garde-fou : si le site répondait 200 pour un numéro qui n'existe pas, la page ne contiendrait pas le code du club.
    if code.lower() not in decoder(r.text).lower():
        return ("sans_code", r.text)
    try:
        return ("club", analyser_club(code, r.text), r.text)
    except Exception as e:
        return ("erreur", f"lecture : {e}")


def sonder_lot(codes):
    """Sonde plusieurs codes en parallèle ; si le site bloque (403/429), on attend puis on réessaie en ralentissant."""
    global PAUSE
    reponses, restants = {}, list(codes)
    for essai in range(ESSAIS_BLOCAGE + 1):
        if not restants:
            break
        with ThreadPoolExecutor(max_workers=TRAVAILLEURS) as pool:
            reponses.update(zip(restants, pool.map(sonder, restants)))
        restants = [c for c in restants if reponses[c][0] == "bloque"]
        if restants and essai < ESSAIS_BLOCAGE:
            attente = ATTENTE_BLOCAGE * (2 ** essai)
            PAUSE = min(PAUSE * 1.5, 5)
            print(f"\n  Le site limite les requêtes : pause de {attente} s puis on reprend plus doucement ...")
            time.sleep(attente)
    return reponses


def graines_du_comite(comite):
    """Codes de clubs visibles sur la page du comité (aide à ne pas s'arrêter trop tôt) ; page absente = aucune graine."""
    try:
        txt = decoder(telecharger(f"{SITE}/ligues/ara/comites/{comite}"))
    except Exception:
        return []
    return sorted({int(m) for m in re.findall(r"ara" + comite + r"(\d{3})(?![0-9A-Za-z])", txt, re.I)})


RE_ORGANISME = re.compile(
    r'\{"code":"(ARA\d{7})","nom":"((?:[^"\\]|\\.)*)","nom_simple":(?:null|"(?:[^"\\]|\\.)*"),"type":"[A-Z]","logo":(?:null|\{"id":"([0-9a-fA-F-]{36})")'
)


def clubs_du_comite_page(comite):
    """Clubs d'un comité, lus sur SA page : {code: {"nom": ..., "logo": ...}}. Page illisible -> {}."""
    try:
        html = telecharger(f"{SITE}/ligues/ara/comites/{comite}")
    except Exception as e:
        print(f"    page du comité illisible : {e}")
        return {}, None
    txt = decoder(html)
    clubs = {}
    for m in RE_ORGANISME.finditer(txt):
        code, nom_brut, logo = m.group(1).upper(), m.group(2), m.group(3)
        if not code.startswith("ARA" + comite):
            continue
        try:
            nom = json.loads('"' + nom_brut + '"')
        except ValueError:
            nom = nom_brut
        clubs.setdefault(code, {"nom": nom.strip(), "logo": logo})
    mt = re.search(r'"total"\s*:\s*(\d+)\s*\}\s*\]', txt) or re.search(r'"title":"Les clubs :","total":(\d+)', txt)
    return clubs, (int(mt.group(1)) if mt else None)


def lire_absents():
    try:
        return set(json.loads((DOSSIER / "clubs_absents.json").read_text(encoding="utf-8")))
    except Exception:
        return set()


def sauver_absents(absents):
    try:
        DOSSIER.mkdir(parents=True, exist_ok=True)
        (DOSSIER / "clubs_absents.json").write_text(json.dumps(sorted(absents)), encoding="utf-8")
    except Exception:
        pass


def deja_deposes(token):
    """Clubs déposés récemment (pour ne pas tout relire après une interruption)."""
    limite = datetime.now(timezone.utc).timestamp() - FRAICHEUR_H * 3600
    res = set()
    try:
        r = requests.get(f"{SUPABASE_URL}/rest/v1/ffbb_clubs_cache",
                         params={"select": "club_code,fetched_at,v:data->>v", "limit": 5000},
                         headers=sb_headers(token), timeout=30)
        if r.status_code == 200:
            for x in r.json():
                try:
                    t = datetime.fromisoformat(x["fetched_at"].replace("Z", "+00:00")).timestamp()
                except Exception:
                    continue
                if t >= limite and str(x.get("v")) == "2":   # v2 = nom exact + logo issus de la page du comité
                    res.add(x["club_code"])
        elif r.status_code in (404, 400):
            raise RuntimeError("La table ffbb_clubs_cache n'existe pas : exécute supabase/12-clubs-region.sql dans Supabase.")
    except requests.exceptions.RequestException:
        raise
    return res


def deposer(etat, lignes):
    if not lignes:
        return
    h = sb_headers(etat["token"], write=True)
    h.update({"Content-Type": "application/json", "Prefer": "resolution=merge-duplicates,return=minimal"})
    url = f"{SUPABASE_URL}/rest/v1/ffbb_clubs_cache?on_conflict=club_code"
    r = requests.post(url, headers=h, json=lignes, timeout=120)
    if r.status_code == 401:   # jeton expiré : on se reconnecte (identifiants mémorisés)
        etat["token"] = obtenir_token()
        h = sb_headers(etat["token"], write=True)
        h.update({"Content-Type": "application/json", "Prefer": "resolution=merge-duplicates,return=minimal"})
        r = requests.post(url, headers=h, json=lignes, timeout=120)
    if r.status_code in (404, 400) and "ffbb_clubs_cache" in r.text:
        raise RuntimeError("La table ffbb_clubs_cache n'existe pas : exécute supabase/12-clubs-region.sql dans Supabase.")
    if r.status_code not in (200, 201, 204):
        raise RuntimeError(f"écriture Supabase ({r.status_code}) : {r.text[:200]}")


def main():
    if not SUPABASE_URL or not SUPABASE_ANON_KEY:
        raise RuntimeError("Renseigne SUPABASE_URL et SUPABASE_ANON_KEY en haut du fichier.")
    etat = {"token": obtenir_token()}
    recents = deja_deposes(etat["token"])
    absents = lire_absents()
    print(f"\nRégion Auvergne-Rhône-Alpes - {len(COMITES)} comités")
    if recents:
        print(f"{len(recents)} club(s) déjà déposé(s) récemment : ils ne sont pas relus.")

    # --- 1) La liste des clubs : une page par comité --------------------------------------------
    print("\n1/2  Liste des clubs de chaque comité ...")
    tous = {}          # code -> {"nom", "logo", "comite"}
    a_balayer = []     # comités dont la page n'a pas donné la liste
    for comite, nom_comite in COMITES.items():
        clubs, total = clubs_du_comite_page(comite)
        if not clubs:
            print(f"  {comite} {nom_comite} : liste introuvable sur la page (balayage des numéros ensuite)")
            a_balayer.append(comite)
            continue
        for code, c in clubs.items():
            tous[code] = {**c, "comite": comite}
        note = f" (la page annonce {total})" if total and total != len(clubs) else ""
        print(f"  {comite} {nom_comite} : {len(clubs)} club(s){note}")
    print(f"  Total : {len(tous)} club(s).")

    # --- 2) Chaque club : ses équipes --------------------------------------------------------------
    print("\n2/2  Lecture des équipes de chaque club ...")
    rapport, lot = [], []
    abandon = None
    diag_faite = False
    try:
        a_lire = [c for c in sorted(tous) if c not in recents]
        for code in sorted(tous):
            if code in recents:
                rapport.append({"code": code, "comite": tous[code]["comite"], "nom": tous[code]["nom"], "equipes": "", "statut": "OK (déjà déposé)"})
        total = len(a_lire)
        for debut in range(0, total, LOT_NUMEROS):
            codes = a_lire[debut: debut + LOT_NUMEROS]
            reponses = sonder_lot(codes)
            for code in codes:
                rep = reponses[code]
                info = tous[code]
                ligne = {"code": code, "comite": info["comite"], "nom": info["nom"], "equipes": "", "statut": ""}
                if rep[0] == "club":
                    data = rep[1]
                    data["nom"] = info["nom"] or data["nom"]          # nom exact de la page du comité
                    data["logo_asset"] = info["logo"] or data.get("logo_asset")
                    data["v"] = 2
                    if not data["equipes"] and not diag_faite and len(rapport) % 7 == 0:
                        sauver_diag(f"page_club_{code}.html", rep[2])
                        diag_faite = True
                    lot.append({"club_code": code, "comite_code": info["comite"], "data": data,
                                "fetched_at": datetime.now(timezone.utc).isoformat()})
                    ligne.update(equipes=len(data["equipes"]), statut="OK")
                elif rep[0] == "absent":
                    # Page du club absente : on dépose quand même le club (nom, logo), sans équipe.
                    lot.append({"club_code": code, "comite_code": info["comite"],
                                "data": {"nom": info["nom"], "url": f"{SITE}/ligues/ara/comites/{info['comite']}/clubs/{code.lower()}",
                                         "logo_asset": info["logo"], "equipes": [], "v": 2},
                                "fetched_at": datetime.now(timezone.utc).isoformat()})
                    ligne.update(equipes=0, statut="OK (page du club absente)")
                elif rep[0] == "sans_code":
                    ligne["statut"] = "ERREUR : page sans le code du club"
                else:
                    ligne["statut"] = f"ERREUR : {rep[1]}"
                    if rep[0] == "bloque":
                        abandon = rep[1]
                rapport.append(ligne)
            if len(lot) >= LOT:
                deposer(etat, lot)
                lot = []
            print(f"  [{min(debut + LOT_NUMEROS, total)}/{total}]", end="\r")
            if abandon:
                break
    finally:
        try:
            deposer(etat, lot)   # dépose ce qui reste, même en cas d'interruption
        except Exception as e:
            print(f"  (dernier lot non déposé : {e})")

    # --- Repli : comités sans liste -> balayage des numéros (ancienne méthode) -------------------
    if a_balayer and not abandon:
        print("\nBalayage des numéros pour : " + ", ".join(a_balayer) + " ...")
        # (rare) : on conserve l'ancienne logique simplifiée
        for comite in a_balayer:
            trouves, derniere, n = 0, 0, 1
            while n <= 999 and n - derniere <= GAP_MAX and not abandon:
                codes = [f"ARA{comite}{k:03d}" for k in range(n, min(n + LOT_NUMEROS, 1000))]
                a_sonder = [c for c in codes if c not in absents]
                reponses = sonder_lot(a_sonder)
                lot = []
                for k, code in zip(range(n, n + len(codes)), codes):
                    rep = reponses.get(code)
                    if rep is None or rep[0] == "absent":
                        if rep is not None:
                            absents.add(code)
                        continue
                    if rep[0] == "club":
                        trouves += 1
                        derniere = k
                        rep[1]["v"] = 2
                        lot.append({"club_code": code, "comite_code": comite, "data": rep[1],
                                    "fetched_at": datetime.now(timezone.utc).isoformat()})
                        rapport.append({"code": code, "comite": comite, "nom": rep[1]["nom"],
                                        "equipes": len(rep[1]["equipes"]), "statut": "OK (balayage)"})
                    elif rep[0] == "bloque":
                        abandon = rep[1]
                if lot:
                    deposer(etat, lot)
                n += LOT_NUMEROS
            print(f"  {comite} : {trouves} club(s) trouvé(s) par balayage")
        sauver_absents(absents)

    if abandon:
        print(f"\nArrêt : le site bloque encore après plusieurs pauses ({abandon}).")
        print("Rien n'est perdu : les clubs déjà lus sont déposés. Relance le programme dans une heure environ (ou demain) :")
        print("il reprend là où il s'est arrêté.")

    # --- Bilan ---------------------------------------------------------------------------
    ok = sum(1 for r in rapport if r["statut"].startswith("OK"))
    erreurs = len(rapport) - ok
    nb_equipes = sum(int(r["equipes"] or 0) for r in rapport if r["statut"].startswith("OK") and r["equipes"] != "")
    try:
        DOSSIER.mkdir(parents=True, exist_ok=True)
        chemin = DOSSIER / "MiseAJourFFBB_ClubsARA_rapport.csv"
        with open(chemin, "w", newline="", encoding="utf-8-sig") as f:
            w = csv.DictWriter(f, fieldnames=["code", "comite", "nom", "equipes", "statut"])
            w.writeheader()
            w.writerows(rapport)
        print(f"\nRapport : {chemin}")
    except Exception:
        pass
    print(f"\n{ok} club(s) déposé(s) ({nb_equipes} équipe(s) lue(s) cette fois), {erreurs} en erreur.")
    if ok == 0 or erreurs:
        print(f"En cas de problème, envoie le contenu du dossier {DOSSIER} à la personne qui gère l'appli.")
    else:
        print("Terminé. Dans l'appli (onglet Basket), clique sur « Importer les clubs & équipes ».")


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
