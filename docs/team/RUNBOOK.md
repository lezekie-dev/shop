# RUNBOOK — Opérations & incidents

> **Squelette Sprint 1**. Les procédures détaillées seront remplies en
> **Sprint 3** (paiements réels) et **Sprint 4** (déploiement prod).
> Ce document liste **où** on agit, **qui** alerte, **quoi** vérifier
> en premier. Les cases vides sont des TODO assignés dans le backlog.

---

## Table des matières

1. [Contacts & ownership](#1-contacts--ownership)
2. [Vérification santé quotidienne](#2-vérification-santé-quotidienne)
3. [Incident paiement](#3-incident-paiement)
4. [Rollback déploiement](#4-rollback-déploiement)
5. [Sauvegarde et restauration](#5-sauvegarde-et-restauration)
6. [Post-mortem](#6-post-mortem)
7. [Liens utiles](#7-liens-utiles)

---

## 1. Contacts & ownership

| Rôle                        | Personne / canal             | Disponible |
|-----------------------------|------------------------------|------------|
| **Tech lead** (escalade)    | _à compléter en S4_         | heures ouvrées |
| **Dev ops / hébergeur**     | Coolify UI (VPS Contabo)     | 24/7 (UI) |
| **Stripe support**          | https://support.stripe.com   | 24/7 (chat) |
| **Opérateur télécom** (Mobile Money) | _à compléter S3_  | — |
| **Client final**            | email + page contact         | heures ouvrées |

> **Règle** : un incident P1 (paiement bloqué ou DB down) déclenche
> un message **dans la carte WAR ROOM `t_b0886788`** du kanban dans
> les 15 premières minutes, même sans solution.

---

## 2. Vérification santé quotidienne

> Procédure à automatiser en S4 (cron `*/15 min` → notification Telegram).

### Checklist manuelle (lundi matin, 9 h)

```bash
# 1. Le conteneur tourne ?
docker ps --filter "name=shop" --format "table {{.Names}}\t{{.Status}}"

# 2. L'app répond ET la base répond ?
#    Contrat : 200 { ok: true, version, db: "up", durationMs } quand tout va bien,
#    503 { ok: false, ... db: "down" } quand la base ne répond pas.
#    (Avant le lot J, la route répondait 200 même base morte : une sonde qui
#    dit « ok » quand la base est morte ne sert à rien.)
curl -fsS https://shop.app-lezekie.dev/api/health | jq .
#    curl -f échoue (code 22) sur un 503 : c'est le signal attendu.

# 3. Les tâches planifiées ont-elles tourné cette nuit ?
#    Visible SANS SSH via /admin/taches (ADMIN et STAFF). En ligne de commande :
docker exec shop-db psql -U shop -d shop -c \
  "SELECT name, status, \"startedAt\", error FROM \"JobRun\" ORDER BY \"startedAt\" DESC LIMIT 10;"

# 4. La DB accepte les connexions ?
docker exec -it shop-db pg_isready -U shop

# 5. Les webhooks Stripe ont-ils été reçus dans la nuit ?
# (à automatiser via Dashboard Stripe → Events, ou SQL)
docker exec shop-db psql -U shop -d shop \
  -c "SELECT type, COUNT(*) FROM \"WebhookEvent\" WHERE \"receivedAt\" > now() - interval '24 hours' GROUP BY type;"

# 6. Les commandes en PENDING_PAYMENT depuis trop longtemps ?
docker exec shop-db psql -U shop -d shop \
  -c "SELECT id, \"placedAt\", \"paymentRef\" FROM \"Order\" WHERE status = 'PENDING_PAYMENT' AND \"placedAt\" < now() - interval '30 minutes';"

# 7. Espace disque et mémoire
df -h /var/lib/docker /var/backups
free -h
```

### Critères "tout va bien"

- ✅ `Status` du conteneur = `Up (healthy)`.
- ✅ `/api/health` retourne **200** avec `{ ok: true, db: "up" }` et un `durationMs` faible.
- ✅ `/admin/taches` ne montre aucun `JobRun` en `FAILED` récent, et le dashboard
  affiche « Aucune alerte » (section Alertes).
- ✅ Aucun `WebhookEvent` en `error` non nul.
- ✅ Aucune commande en `PENDING_PAYMENT` depuis > 30 min (hors nuit).
- ✅ Disque < 80 %, mémoire < 80 %.

### Critères "alerte"

- ❌ Conteneur en `restarting` → §4 (rollback ou fix).
- ❌ `/api/health` retourne **503** (`db: "down"`) → la base ne répond pas : §3 puis §5.
- ❌ Un job a 3 `FAILED` consécutifs (visible sur `/admin/taches` et dans la
  section « Alertes » du dashboard) → ouvrir la page, lire le message d'erreur,
  corriger — un job cassé depuis 3 nuits est une panne silencieuse.
- ❌ Plus de 5 commandes bloquées en `PENDING_PAYMENT` → §3.
- ❌ Disque > 90 % →扩容 immédiat ou purge vieux logs (penser à
  `RETENTION_DAYS` des sauvegardes, §5.2).

---

## 3. Incident paiement

### Symptômes typiques

- Clients qui voient "Erreur lors du paiement" sur la page checkout.
- Webhooks Stripe qui ne sont pas traités (`WebhookEvent.error` non
  nul, ou `WebhookEvent.processedAt` null).
- Commandes coincées en `PENDING_PAYMENT` > 30 min.
- `Stripe Dashboard → Events` montre des `delivery_failed`.

### Première réponse (15 premières minutes)

1. **Vérifier l'état du PSP**
   - Stripe Dashboard → https://dashboard.stripe.com/status
   - NotchPay / Flutterwave (selon le provider actif) → page status
2. **Vérifier que le conteneur tourne**
   ```bash
   docker ps --filter "name=shop"
   docker logs --tail 200 shop-app
   ```
3. **Vérifier la table `WebhookEvent`**
   ```bash
   docker exec shop-postgres psql -U shop -d shop \
     -c "SELECT id, type, error, \"receivedAt\", \"processedAt\" FROM \"WebhookEvent\" ORDER BY \"receivedAt\" DESC LIMIT 20;"
   ```
4. **Si Stripe a un incident global**
   - Pas d'action côté code. Communication client via page status.
   - **NE PAS** désactiver la vérification signature webhook.
5. **Si le code semble fautif**
   - Rollback → §4.
   - Si c'est un bug logique identifié (pas de corruption DB) → hotfix
     en fast-track.

### Commandes de diagnostic

```bash
# Voir les dernières erreurs serveur
docker logs --tail 500 shop-app | grep -i error

# Compter les commandes en PENDING_PAYMENT par âge
docker exec shop-postgres psql -U shop -d shop -c "
  SELECT
    CASE
      WHEN \"placedAt\" < now() - interval '1 hour' THEN '> 1h'
      WHEN \"placedAt\" < now() - interval '30 minutes' THEN '30min-1h'
      ELSE '< 30min'
    END AS bucket,
    COUNT(*)
  FROM \"Order\"
  WHERE status = 'PENDING_PAYMENT'
  GROUP BY bucket;
"

# Forcer un retry manuel d'un webhook Stripe (via Dashboard Stripe, pas en CLI)
# https://dashboard.stripe.com/events → evt_… → "Resend webhook"

# Tuer les sessions BDD orphelines qui bloquent les locks
docker exec shop-postgres psql -U shop -d shop -c "
  SELECT pid, query, state FROM pg_stat_activity
  WHERE state != 'idle' AND datname = 'shop';
"
```

### Communication client

- _Procédure à détailler en S3_ (qui envoie le mail, template,
  fréquence, seuil de décision "proactif vs réactif").

### Escalade

- P1 (paiements bloqués > 30 min) : tech lead notifié immédiatement,
  même nuit/week-end.
- P2 (paiement lent mais pas bloqué) : heures ouvrées.
- P3 (événement isolé, résolu sans intervention) : post-mortem léger.

---

## 4. Rollback déploiement

> Procédure détaillée en S4, une fois Coolify configuré.

### Stratégie cible

- **Image Docker** : chaque PR mergée = une nouvelle image taguée
  `shop:<sha>`. Coolify déploie le tag pointé par une variable
  d'env `IMAGE_TAG`.
- **Rollback** = changer `IMAGE_TAG` vers le dernier SHA connu bon,
  redéployer. **Pas de reconstruction d'image**.
- **DB migrations** : `prisma migrate deploy` est lancé avant chaque
  démarrage. Une migration **ne se rollback jamais automatiquement**.
  Si une migration est fautive → rollback code + migration manuelle
  (cf. §5).

### Étapes (à automatiser via Coolify UI)

1. Identifier le dernier déploiement "vert" (CI vert + smoke test OK).
2. Dans Coolify → Application → "Rollback to previous deployment".
3. Vérifier `/api/health` 5 minutes après.
4. Vérifier qu'aucune commande n'a été perdue entre les deux versions
   (`Order.placedAt` couvre la fenêtre).
5. **NE PAS** oublier d'investiguer la cause racine et d'ouvrir un
   post-mortem (§6).

### Critères "il faut rollback"

- `/api/health` retourne 5xx après le déploiement.
- Taux d'erreur paiement > 10 % dans les 15 premières minutes.
- Migration DB échoue au démarrage.
- Smoke test E2E (parcours achat) cassé.

### Critères "on garde et on patch"

- Bug cosmétique, pas d'impact paiement/stock/commande.
- Régression performance < 20 %.
- Erreur 5xx sur endpoint admin (utilisable en workaround).

---

## 5. Sauvegarde et restauration

> **Section réécrite et EXERCÉE au lot J (vague 2), le 18/09/2026.**
> La restauration n'est plus une procédure théorique : elle a été exécutée sur
> une base jetable et la sortie des commandes est collée ci-dessous (§5.5).
> Toute modification des scripts doit être suivie d'une nouvelle preuve datée —
> c'est la valeur de cette section, pas la prose.

### 5.1 Ce qui est sauvegardé, ce qui ne l'est pas

| Élément | Sauvegardé ? | Où / pourquoi |
|---|---|---|
| Base PostgreSQL `shop` | ✅ **oui** | `pg_dump --format=custom` compressé (gzip), une fois par jour |
| Visuels produit `public/products` | ✅ **oui** | Ce sont les fichiers référencés par `ProductImage` (`SELECT url FROM "ProductImage"`) |
| Téléversements `public/uploads` (lot H) | ✅ **oui, dès qu'ils existent** | Le script détecte le dossier et l'inclut automatiquement ; il n'existe pas encore au 18/09/2026 |
| Code source | ❌ non | Il vit dans git (`master`), pas dans la sauvegarde |
| `.env` (secrets, `SESSION_SECRET`, IBAN) | ❌ non | Volontairement **hors** sauvegarde : un dump fuit plus facilement qu'un `.env` lu par systemd. À sauvegarder séparément, à la main, dans un coffre |
| Emails de l'outbox (`EmailOutbox`) | ✅ oui | Ils sont **en base** (aucun SMTP) : ils reviennent avec le dump |
| Sessions admin, tentatives de connexion | ✅ oui (mais inutiles) | Tables `Session`, `LoginAttempt`, `JobRun`, `AuditLog` : réelles, simplement peu utiles après restauration |
| Sauvegardes des **autres** bases | ❌ non | `shop_test`, `shop_shadow` sont jetables par construction |
| Sauvegardes hors du VPS | ❌ **non — limite connue** | Contrainte projet : aucun service tiers. **Un VPS perdu = les sauvegardes perdues.** Copier `/var/backups/shop` sur un disque externe ou une autre machine est une décision d'exploitation, à prendre explicitement (§5.6) |

### 5.2 Commande de sauvegarde

```bash
/root/work/shop/scripts/backup-db.sh
```

Ce que fait le script, dans l'ordre :

1. `pg_dump --format=custom --no-owner --no-privileges` de la base `shop`
   depuis le conteneur `shop-db`, compressé en gzip → `/var/backups/shop/shop-<AAAAMMJJ-HHMMSS>.dump.gz` ;
2. **vérifie le dump** avec `pg_restore --list` **avant** de le considérer comme
   valide ; un dump illisible est supprimé et l'exécution sort en erreur
   (un dump tronqué conservé est le piège classique : il existe, donc on croit
   être protégé) ;
3. archive les fichiers (`media-<AAAAMMJJ-HHMMSS>.tar.gz`, `public/uploads` +
   `public/products`) ;
4. purge les fichiers de plus de **7 jours** (`RETENTION_DAYS`, surchargeable) ;
5. écrit la trace de l'exécution : une ligne `JobRun` (`name = "backup-db"`)
   **visible sur `/admin/taches`** et une ligne dans `/var/backups/shop/backup.log`.
   Code retour `0` en succès, `1` en échec — le cron saura le dire.

Création du répertoire de destination, hors du conteneur applicatif :

```bash
sudo mkdir -p /var/backups/shop && sudo chmod 700 /var/backups/shop
```

### 5.3 Planification (crontab)

Ligne exacte à installer avec `crontab -e` (utilisateur `root`) :

```cron
# Sauvegarde quotidienne de la boutique à 03:15 — lot J, chantier « sauvegardes »
15 3 * * * /root/work/shop/scripts/backup-db.sh >> /var/log/shop-backup.log 2>&1
```

- Tourne chaque nuit **sans compte tiers** (pas de S3, pas de service externe) ;
- rétention **7 jours** de sauvegardes quotidiennes ;
- destination **hors du conteneur applicatif** (`/var/backups/shop`, pas de
  montage dans le conteneur Next) ;
- la sortie du script part aussi dans `/var/log/shop-backup.log` (doublon
  volontaire : si la base est le problème, c'est ce fichier qu'on lit).

### 5.4 Procédure de restauration, pas à pas

> **Durée mesurée au 18/09/2026 : 16 s** pour la base + les fichiers de
> démonstration (19 commandes, 4 produits, 12 fichiers image). L'objectif du PO
> (« repartir en moins d'une heure ») tient avec une marge très large ; le
> facteur limitant d'une vraie restauration n'est pas le dump, c'est la
> décision de restaurer et l'accès au serveur.

```bash
# 0. Depuis le serveur, se placer dans l'application
cd /root/work/shop

# 1. Lister les sauvegardes disponibles (la plus récente en haut)
ls -lh /var/backups/shop/

# 2. RÉPÉTITION À BLANC OBLIGATOIRE — restaurer dans une base jetable
#    et vérifier les compteurs AVANT de toucher à la production.
#    Refuse de viser la base de production sans --allow-live.
scripts/restore-db.sh /var/backups/shop/shop-AAAAMMJJ-HHMMSS.dump.gz shop_restore_test --create

# 3. Si le résultat est « RESTAURATION VÉRIFIÉE », supprimer la base de contrôle
docker exec shop-db psql -U shop -d postgres -c 'DROP DATABASE "shop_restore_test";'

# 4. Restauration RÉELLE (perte de données confirmée)
#    a. Stopper l'écriture applicative : sans ça, des commandes arrivent
#       pendant la restauration et sont écrasées au commit.
systemctl stop shop-app.service
#    b. Restaurer par-dessus la base de production — geste irréversible :
#       les commandes créées APRÈS la sauvegarde sont perdues. C'est la
#       raison du --allow-live explicite.
scripts/restore-db.sh /var/backups/shop/shop-AAAAMMJJ-HHMMSS.dump.gz shop --allow-live
#    c. Fichiers (uniquement si le dossier des téléversements est perdu)
tar -xzf /var/backups/shop/media-AAAAMMJJ-HHMMSS.tar.gz -C /root/work/shop
#    d. Relancer et vérifier
systemctl start shop-app.service
curl -fsS https://shop.app-lezekie.dev/api/health      # doit répondre 200 db:"up"
#    e. Contrôle métier : la dernière commande d'hier est bien là
docker exec shop-db psql -U shop -d shop -c \
  'SELECT number, status, "totalCents", "placedAt" FROM "Order" ORDER BY "placedAt" DESC LIMIT 5;'
```

**Migrations après restauration** : le dump contient `_prisma_migrations` (vérifié :
7 migrations appliquées dans la base restaurée). `prisma migrate deploy` au
redémarrage est donc un no-op — pas de risque de rejouer une migration.

**Cas où on restaure** : corruption de la base, migration destructive
accidentelle, suppression de données par erreur (photos, produits), perte du
VPS (**et seulement si** les sauvegardes ont été copiées ailleurs).
**Cas où on ne restaure PAS** : bug applicatif (on patche), données « sales »
(on nettoie en SQL), migration en échec non destructive (cf. §4bis).

### 5.5 Preuve : restauration réellement exécutée le 18/09/2026

Sauvegarde (03 h 15 en production, ici lancée à la main à 14:47 CEST) :

```text
[2026-09-18 14:47:24] Début de sauvegarde : base=shop conteneur=shop-db destination=/var/backups/shop
[2026-09-18 14:47:26] Dump validé : /var/backups/shop/shop-20260918-144724.dump.gz (29KiB)
[2026-09-18 14:47:26] Dossier de fichiers absent, ignoré : /root/work/shop/public/uploads
[2026-09-18 14:47:27] Fichiers archivés : /var/backups/shop/media-20260918-144724.tar.gz (public/products) — 825857 octets
[2026-09-18 14:47:27] Purge terminée : 0 fichier(s) supprimé(s), rétention 7 jours.
[2026-09-18 14:47:27] Trace JobRun écrite (id=bkp2026091814472771840, status=SUCCEEDED).
[2026-09-18 14:47:27] Sauvegarde terminée en 3s.
```

Restauration dans la base jetable `shop_restore_test` :

```text
[2026-09-18 14:48:17] Vérification du sommaire du dump…
[2026-09-18 14:48:18] Dump lisible.
[2026-09-18 14:48:18] Restauration de shop-20260918-144724.dump.gz dans 'shop_restore_test'…
[2026-09-18 14:48:24] Restauration terminée en 7s (code 0).
[2026-09-18 14:48:24] Comparaison des compteurs (source shop → cible shop_restore_test) :
    TABLE              SOURCE  RESTAURÉ ÉTAT
    Order                  19         19 OK
    OrderItem              19         19 OK
    Product                 4          4 OK
    Customer               18         18 OK
    ProductImage            4          4 OK
    Payment                19         19 OK
    JobRun                  1          0 journal (non comparé)
[2026-09-18 14:48:33] Vérification des visuels produit référencés par la base restaurée :
    ✓ /products/casquette-noir.png
    ✓ /products/tote-naturel.png
    ✓ /products/tshirt-blanc.png
    ✓ /products/tshirt-noir.png
[2026-09-18 14:48:33] Vérification terminée : 4 visuel(s), 0 manquant(s), 0 écart(s) de compteur.
[2026-09-18 14:48:33] Durée totale de la restauration de contrôle : 16s (objectif du PO : < 1 h).
[2026-09-18 14:48:33] Résultat : RESTAURATION VÉRIFIÉE (compteurs identiques, visuels présents).
```

Contrôle indépendant des scripts (requête SQL directe sur la base restaurée,
pour ne pas se contenter de la parole de l'outil) :

```text
 commandes | lignes_commande | produits | clients | visuels
-----------+-----------------+----------+---------+---------
        19 |              19 |        4 |      18 |       4
migrations Prisma appliquees dans la base restauree : 7
3 dernieres commandes : ORD-2026-000019 | PAID | 2080
3 dernieres commandes : ORD-2026-000018 | PAID | 3570
3 dernieres commandes : ORD-2026-000017 | PAID | 2080
```

Fichiers image : l'archive média a été extraite dans un répertoire jetable et
comparée à l'application, fichier par fichier (`md5sum`) :

```text
12 fichiers extraits (public/products/*.png et *.svg)
IDENTIQUE : les visuels restaurés sont bit pour bit ceux de l'application
```

Garde-fous vérifiés le même jour (aucun n'est une intention, tous ont été
exécutés) :

```text
# Cible = base de production → refus
REFUS : la cible 'shop' est la base de PRODUCTION. Restaurez dans une base jetable, ou passez --allow-live…
# Dump corrompu → refus AVANT toute écriture
pg_restore: error: could not read from input file: end of file
REFUS : dump illisible (/tmp/dump-corrompu.dump.gz) — sauvegarde inutilisable, essayez la précédente
# Dump absent → refus
REFUS : fichier de sauvegarde introuvable : /tmp/inexistant.dump.gz
# Base de production intacte après ces essais
19 commandes, 4 produits
```

Purge de rétention vérifiée (fichiers datés de 10 jours dans un répertoire de test) :

```text
--- avant ---            --- après ---
media-20260901-030000.tar.gz   → supprimé
shop-20260901-030000.dump.gz   → supprimé
shop-du-jour.dump.gz           → conservé
[2026-09-18 14:50:28] Purge (> 7 jours) : media-20260901-030000.tar.gz
[2026-09-18 14:50:28] Purge (> 7 jours) : shop-20260901-030000.dump.gz
[2026-09-18 14:50:28] Purge terminée : 2 fichier(s) supprimé(s), rétention 7 jours.
```

La base de contrôle `shop_restore_test` a été supprimée après l'exercice
(`DROP DATABASE`), la base de production n'a jamais été touchée.

### 5.6 Limites connues (à lire avant de se croire protégé)

1. **Pas de copie hors du VPS** (contrainte « aucun compte tiers »). Un disque
   perdu = tout perdu. À traiter par une copie manuelle régulière
   (`rsync /var/backups/shop/ user@autre-machine:/var/backups/shop/`) — décision
   d'exploitation, hors périmètre code.
2. **La vérification automatique du dump est structurelle, pas fonctionnelle** :
   `pg_restore --list` prouve que le fichier est lisible, pas que les données
   sont complètes. C'est la restauration de contrôle (§5.4 étape 2) qui le
   prouve — à refaire **au moins une fois par mois** (KPI K10 : « dernière
   restauration réussie < 30 jours »), et après toute modification des scripts.
3. **La rétention est mesurée en jours, pas en nombre** : 7 jours glissants.
   Deux sauvegardes le même jour → deux fichiers conservés. Un disque de VPS
   à 800 Mo de sauvegardes par jour n'est pas un problème à cette échelle
   (dump mesuré : 29 Ko pour 19 commandes).
4. **La restauration n'est pas testée sur un volume réaliste** : à 19 commandes
   elle prend 16 s. La projection (temps linéaire sur le volume de données)
   reste une projection — à re-mesurer quand la boutique aura 10 000 commandes.

---

## 4bis. Migration échouée en prod (cf. ADR-0007)

> Procédure ajoutée en Sprint 1 carte S1-014, sur la base d'ADR-0007.
> Le healthcheck applicatif ne suffit pas (cf. ADR-0007 §2 — faux
> positifs possibles). On triple la détection : init container,
> healthcheck applicatif, cron quotidien.

### Symptômes typiques

- `/api/health` répond `503` (`db: "down"`) : la sonde de santé (lot J) teste la
  connexion à la base, **pas** le drift de schéma.
  ⚠️ La détection de drift décrite dans ADR-0007 §2 (`migrate-check.mjs` dans
  `/api/health`) **n'est pas implémentée** au 18/09/2026 : la route vérifie
  `SELECT 1` et renvoie `{ ok, version, db: "up" | "down", durationMs }`. En
  attendant, la détection de migration fautive repose sur l'init container et
  sur les tâches (`/admin/taches`).
- `docker logs shop-migrate` montre une erreur `prisma migrate
  deploy` (code retour ≠ 0).
- Le cron quotidien (`migrate-check.mjs`) envoie une alerte Telegram
  « schema drift detected ».
- L'app ne démarre pas du tout après un déploiement (le
  `depends_on: { migrate: condition: service_completed_successfully }`
  du compose bloque).

### Première réponse (dans l'ordre)

1. **Ne PAS paniquer-rollback tout de suite.** Identifier d'abord
   **le niveau** du problème :

   | Niveau         | Signal                                          | Action immédiate |
   |----------------|-------------------------------------------------|------------------|
   | **Code seul**  | Init container OK, app démarre, mais bug métier | Rollback `IMAGE_TAG` au SHA précédent via Coolify UI |
   | **Migration réversible fautive** | Init container sort en erreur sur une migration **non destructive** | Rollback `IMAGE_TAG` + `prisma migrate resolve --rolled-back <name>` |
   | **Migration destructive fautive** | Init container sort en erreur sur une migration destructive (DROP/ALTER dangereux) | Restaurer le backup DB (cf. §5) + rollback code |

2. **Moins de 30 min après le déploiement** : on suppose que c'est
   le nouveau code → `Coolify UI → Application → Rollback to
   previous deployment`. Investiguer après coup.
3. **Plus de 30 min après** : on suppose que des clients ont utilisé
   la nouvelle version → rollback code **plus** investigation base.
4. **Communication** (cf. RUNBOOK §1) : downtime > 5 min = message
   dans WAR ROOM `t_b0886788`.

### Diagnostic

```bash
# 1. Voir les logs de l'init container de migration
docker logs shop-migrate --tail 200

# 2. État de la table _prisma_migrations
docker exec shop-postgres psql -U shop -d shop -c "
  SELECT id, migration_name, finished_at, applied_steps_count
  FROM _prisma_migrations
  ORDER BY started_at DESC
  LIMIT 10;
"

# 3. Migration pending (started_at non null mais finished_at null)
docker exec shop-postgres psql -U shop -d shop -c "
  SELECT * FROM _prisma_migrations WHERE finished_at IS NULL;
"

# 4. Lancer le check de drift à la main (le script de prod)
docker exec shop-app node scripts/migrate-check.mjs
# → code 0 = sain, code != 0 = drift détecté, lire stderr

# 5. Voir les contraintes CHECK sur Stock (si CHECK manquante → migration initiale incomplète)
docker exec shop-postgres psql -U shop -d shop -c "
  SELECT conname, pg_get_constraintdef(oid)
  FROM pg_constraint
  WHERE conrelid = '\"Stock\"'::regclass;
"
```

### Décisions par type d'incident

#### a. Migration pending

`finished_at IS NULL` sur une ligne → la migration a planté au
milieu. Ne **jamais** supprimer la ligne manuellement (risque de
laisser la base dans un état partiel non documenté). Procédure :

```bash
# Marquer la migration comme rolled-back (autorise prisma à réessayer)
docker exec shop-app npx prisma migrate resolve --rolled-back <migration_name>
# Puis re-déclencher la migration
docker exec shop-app npx prisma migrate deploy
```

Si la migration est idempotente (ajout de colonne, contrainte
conditionnelle), le replay passe. Si elle ne l'est pas (ALTER
destructif), passer en niveau « destructive fautive » ci-dessus.

#### b. Drift schéma

Le check de drift a détecté un objet en base non présent dans
`schema.prisma` (ou inversement). Causes possibles :

- Manip SQL manuelle hors Prisma → ajouter l'objet au schema,
  `prisma migrate dev` pour générer une migration de réconciliation.
- Bug d'une migration précédente qui a appliqué un objet
  partiellement → cf. (a).

#### c. Contrainte manquante (ex : `stock_nonneg`)

La contrainte `CHECK (quantity >= 0 AND reserved >= 0)` est
**non-négociable** (cf. CONVENTIONS §12). Si elle manque, c'est
que la migration initiale a été bypassée ou altérée. Procédure :

```bash
# Ré-appliquer la contrainte à la main (idempotent grâce au IF NOT EXISTS wrapper)
docker exec shop-app node scripts/ensure-stock-check.mjs
# → faire un commit dédié + ouvrir un ticket post-mortem
```

### Rollback complet (niveau base)

Si la migration a corrompu des données **et** qu'on a un backup
sain antérieur :

1. STOPPER l'app (`docker stop shop-app`).
2. Restaurer le backup (cf. §5) → la base revient à l'état
   pré-migration.
3. **Décider** : rollback code seul (si la migration fautive est
   réversible) ou rollback code + nouvelle migration de
   réparation (si la migration fautive a déjà eu des effets
   visibles en prod).
4. Relancer l'app.

### Communication

Tout incident migration > 5 min déclenche :

- Message dans WAR ROOM `t_b0886788` (cf. §1).
- Post-mortem obligatoire (cf. §6) dans les 48 h.
- Mise à jour d'ADR-0007 si la procédure a révélé un cas non
  couvert (et c'est arrivé → la procédure est vivante).

---

## 6. Post-mortem

> **Obligatoire** après tout incident P1 ou rollback prod.

### Template

À remplir dans `docs/post-mortems/YYYY-MM-DD-<slug>.md` :

```markdown
# Post-mortem — <titre court>

## Résumé
1 phrase : ce qui s'est passé, l'impact, le délai de résolution.

## Timeline
- HH:MM — événement déclencheur
- HH:MM — première détection
- HH:MM — escalade
- HH:MM — mitigation
- HH:MM — résolution

## Cause racine
3-5 phrases. Pas de blâme, que des faits.

## Impact
- Nombre de clients affectés
- Nombre de commandes perdues / mal traitées
- Perte financière estimée (si applicable)

## Ce qui a bien marché
3 bullets max.

## Ce qui a coincé
3 bullets max.

## Actions correctives
- [ ] Action 1 — owner — deadline
- [ ] Action 2 — owner — deadline

## Leçons apprises
1 phrase qui résume ce qu'on retient collectivement.
```

---

## 7. Liens utiles

| Ressource | URL |
|-----------|-----|
| Repo code | _à compléter_ |
| DAT | `docs/team/ARCHITECTURE.md` |
| Conventions | `docs/team/CONVENTIONS.md` |
| PO brief | `docs/team/PO-BRIEF.md` |
| Kanban board | (board `shop`, carte WAR ROOM `t_b0886788`) |
| Stripe Dashboard | https://dashboard.stripe.com |
| Stripe logs | https://dashboard.stripe.com/logs |
| Coolify UI | _à compléter en S4_ |
| VPS monitoring | _à compléter en S4_ |

---

## Annexe — TODO pour les sprints suivants

- [ ] **S3** : procédure détaillée incident paiement Mobile Money
      (qui appelle l'opérateur, comment réconcilier les transactions
      async, timeout et annulation auto > 30 min).
- [ ] **S3** : procédure de refund (Stripe Dashboard + impact stock +
      email client).
- [ ] **S4** : automatiser §2 (cron + alerte Telegram).
- [x] **V2 / lot J** : sauvegarde §5 scriptée (`scripts/backup-db.sh`),
      vérifiée (`pg_restore --list`), purgée (7 jours) et **restauration
      exercée** le 18/09/2026 vers une base jetable (§5.5).
- [ ] **V2 / lot J** : installer la ligne de crontab §5.3 sur le VPS
      (**non installée** au 18/09/2026 : le script est prêt et testé, la
      planification est un geste d'exploitation à faire une fois).
- [ ] **V2 / lot J** : copie des sauvegardes **hors du VPS** (§5.6 limite 1) —
      bloqué par la contrainte « aucun service tiers », à trancher.
- [ ] **V2 / lot J** : refaire une restauration de contrôle chaque mois
      (KPI K10) et coller la sortie dans §5.5.
- [ ] **S4** : configurer rollback §4 dans Coolify.
- [ ] **S4** : alertes Telegram sur erreurs paiement (cf. ADR-0005).
- [ ] **S4** : monitoring uptime (UptimeRobot ou équivalent).

---

*Squelette Sprint 1. À enrichir au fil des incidents réels et des
procédures automatisées.*
