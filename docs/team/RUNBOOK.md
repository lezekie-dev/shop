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
5. [Restauration backup DB](#5-restauration-backup-db)
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

# 2. L'app répond ?
curl -fsS https://shop.example.com/api/health | jq .

# 3. La DB accepte les connexions ?
docker exec -it shop-postgres pg_isready -U shop

# 4. Les webhooks Stripe ont-ils été reçus dans la nuit ?
# (à automatiser via Dashboard Stripe → Events, ou SQL)
docker exec shop-postgres psql -U shop -d shop \
  -c "SELECT type, COUNT(*) FROM \"WebhookEvent\" WHERE \"receivedAt\" > now() - interval '24 hours' GROUP BY type;"

# 5. Les commandes en PENDING_PAYMENT depuis trop longtemps ?
docker exec shop-postgres psql -U shop -d shop \
  -c "SELECT id, \"placedAt\", \"paymentRef\" FROM \"Order\" WHERE status = 'PENDING_PAYMENT' AND \"placedAt\" < now() - interval '30 minutes';"

# 6. Espace disque et mémoire
df -h /var/lib/docker
free -h
```

### Critères "tout va bien"

- ✅ `Status` du conteneur = `Up (healthy)`.
- ✅ `/api/health` retourne `{ ok: true, db: "ok" }`.
- ✅ Aucun `WebhookEvent` en `error` non nul.
- ✅ Aucune commande en `PENDING_PAYMENT` depuis > 30 min (hors nuit).
- ✅ Disque < 80 %, mémoire < 80 %.

### Critères "alerte"

- ❌ Conteneur en `restarting` → §4 (rollback ou fix).
- ❌ `/api/health` retourne 5xx → §4.
- ❌ Plus de 5 commandes bloquées en `PENDING_PAYMENT` → §3.
- ❌ Disque > 90 % →扩容 immédiat ou purge vieux logs.

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

## 5. Restauration backup DB

> Procédure à automatiser en S4 (cron quotidien + rétention 30 j).

### Stratégie cible

- Dump PostgreSQL quotidien via `pg_dump` compressé, stocké sur le
  VPS (`/var/backups/shop/YYYY-MM-DD.sql.gz`).
- Rétention 30 jours glissants. Purge automatique.
- Vérification d'intégrité : `pg_restore --list` une fois par semaine
  sur un dump aléatoire.
- En cas de VPS perdu → backup off-site (S3 / Backblaze B2) à mettre
  en place en S4 (cf. PO-BRIEF §7 Sprint 4 livrable "sauvegardes DB
  configurées").

### Étapes de restauration

```bash
# 1. Lister les backups disponibles
ls -lh /var/backups/shop/

# 2. STOPPER l'application pour éviter les écritures concurrentes
# (via Coolify UI ou docker stop)

# 3. Recréer la DB à partir du dump
gunzip -c /var/backups/shop/2026-09-17.sql.gz | \
  docker exec -i shop-postgres pg_restore \
    -U shop -d shop --clean --if-exists --no-owner

# 4. Vérifier la cohérence
docker exec shop-postgres psql -U shop -d shop -c "
  SELECT
    (SELECT COUNT(*) FROM \"Order\") AS orders,
    (SELECT COUNT(*) FROM \"Customer\") AS customers,
    (SELECT COUNT(*) FROM \"Product\") AS products;
"

# 5. Relancer l'application
# (via Coolify UI ou docker start)
```

### Cas où on restaure

- Corruption DB (improbable avec Postgres mais possible : disque
  plein, crash).
- Migration destructive accidentelle (`prisma migrate` avec
  `dropColumn`).
- Perte de VPS (VPS down, données irrécupérables).

### Cas où on NE restaure PAS

- Bug applicatif : on patche le code, on ne touche pas à la DB.
- Données "sales" (doublons) : on nettoie via SQL après investigation.

---

## 4bis. Migration échouée en prod (cf. ADR-0007)

> Procédure ajoutée en Sprint 1 carte S1-014, sur la base d'ADR-0007.
> Le healthcheck applicatif ne suffit pas (cf. ADR-0007 §2 — faux
> positifs possibles). On triple la détection : init container,
> healthcheck applicatif, cron quotidien.

### Symptômes typiques

- `/api/health` répond `503 { ok: false, drift: true }` ou
  `{ db: "ok" mais drift: "constraint_missing" }`.
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
- [ ] **S4** : configurer backups §5 (cron + off-site).
- [ ] **S4** : configurer rollback §4 dans Coolify.
- [ ] **S4** : alertes Telegram sur erreurs paiement (cf. ADR-0005).
- [ ] **S4** : monitoring uptime (UptimeRobot ou équivalent).

---

*Squelette Sprint 1. À enrichir au fil des incidents réels et des
procédures automatisées.*
