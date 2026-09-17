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

> Procédure détaillée dans cette section (cf. ADR-0007 — stratégie de
> migration Prisma en prod via init container Coolify).

### Architecture de déploiement

```
[Init container] : docker run --rm
   image: <même image Next.js>
   command: ["npx", "prisma", "migrate", "deploy"]
   depends_on: [postgres: service_healthy]
   exit code propagé à Coolify → Coolify ne démarre PAS l'app si exit ≠ 0

[App container] : docker run (long-running)
   image: <même image Next.js>
   command: ["node", "server.js"]
   depends_on: [init container: exit_code = 0]
```

L'init container utilise la **même image** que l'app pour éviter tout
décalage de versions Prisma client / engine.

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
- `/api/readiness` (Sprint 2 — cf. ADR-0007) retourne 503 avec
  `expected ≠ applied`.
- Taux d'erreur paiement > 10 % dans les 15 premières minutes.
- Migration DB échoue au démarrage (init container exit code ≠ 0).
- Smoke test E2E (parcours achat) cassé.

### Critères "on garde et on patch"

- Bug cosmétique, pas d'impact paiement/stock/commande.
- Régression performance < 20 %.
- Erreur 5xx sur endpoint admin (utilisable en workaround).

### Diagnostic pre-rollback

```bash
# 1. Statut Coolify : init container a-t-il réussi ?
# Coolify UI → Service → Logs (init container)

# 2. Dernières migrations appliquées
docker exec shop-postgres psql -U shop -d shop -c "
  SELECT migration_name, finished_at, success
  FROM _prisma_migrations
  ORDER BY started_at DESC
  LIMIT 5;
"

# 3. Drift schema vs schema.prisma (à automatiser en CI, cf. ADR-0007 §4)
npx prisma migrate diff \
  --from-migrations prisma/migrations \
  --to-schema-datamodel prisma/schema.prisma \
  --script

# 4. Logs applicatifs (chercher PrismaClientKnownRequestError)
docker logs --tail 500 shop-app | grep -iE 'Prisma|migration|error'
```

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
