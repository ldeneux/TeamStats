# Checklist TeamStats (à jour au 16/11/2026)

| # | Sujet | État |
|---|-------|------|
| 2 | Phases manquantes (ex. U13 F : 1 phase alors que le site en montre 2) | **Corrigé côté script** : `MiseAJourFFBB_Club.exe` cherche maintenant les autres phases de la compétition (à tester ; si une phase manque encore, envoyer le dossier `diagnostic` du programme) |
| 2 bis | Erreur « HTTP 404 » sur une compétition régionale (RM2) | **Corrigé** : chemin du lien lu tel quel (comité ou ligue), repli sur plusieurs adresses |
| 3 | Affichage de la compétition : « Phase 2 : Départementale féminine U15 - poule B » (étiquette jaune conservée) | **Fait** (le suffixe « - Phase N » est retiré ; la division est ajoutée depuis le code quand il se termine par -N) |
| 5 | Chrono : en changeant de période avec +, repartir au temps max si la période est vierge, sinon temps restant d'après les stats | **Fait** |
| 1 | Mode d'emploi : aucune donnée réelle de licenciée | **Fait** (prénoms seuls, licences et dates fictives) |
| 4 | Historiser les saisons + consultation ; données verrouillées (seul le superadmin modifie, directement en base) | À faire |
| 6 | Connexion : changer son mot de passe ; admin / superadmin peut se connecter « en tant que coach » (test de profil, sans mot de passe) | À faire |
| 7 | Accès de secours « quoi qu'il arrive » (superadmin supprimé de la base) | À faire — à cadrer (voir notes) |

## Notes pour 6 et 7
- 6 : « voir comme un coach » = bascule d'affichage côté appli (les droits réels restent ceux de l'admin) ; pour tester les droits RLS réels il faut un vrai compte coach.
- 7 : on évite un jeton secret codé en dur dans l'appli (n'importe qui le retrouverait). Piste : récupération par la clé `service_role` côté serveur (variable Vercel) protégée par un secret d'urgence, ou simple procédure SQL documentée pour se redonner le profil superadmin.
