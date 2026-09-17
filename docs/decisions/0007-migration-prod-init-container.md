# ADR-0007 — Stratégie de migration Prisma en production (init container Coolify)

- **Statut** : Acceptée (Sprint 1), introduite post-audit S1-002 (Finding 7/8)
- **Date** : 2026-09-17
- **Décideurs** : équipe architecture + équipe déploiement
- **Référence DAT** : §7 (Dockerfile), §11 ADR-0007

## Contexte

Le DAT §7 recommande explicitement l'**option 1** pour exécuter `prisma migrate deploy` en production :

> *« Recommandé pour Coolify : option 1, c'est ce que Coolify supporte nativement (champ "Command" avant démarrage). »*

Mais cette décision n'apparaît dans **aucun ADR**. Conséquences potentielles non documentées :

- **Migration échoue** : l'app ne démarre pas ; Coolify ne sait pas si l'app est saine parce que `/api/health` répond `200 { db: "down" }` (DAT §4 + scaffold S1-001) sans dépendance au schéma applicatif. **L'orchestrateur croit que tout va bien.**
- **Migration réussit mais avec un drift** (`schema.prisma` ≠ DB) : Prisma refuse les requêtes applicatives ; l'app crash au premier appel DB.
- **Migration en parallèle** de l'app en redémarrage (deux instances lancées avant que l'une ait appliqué la migration) : race possible — Prisma `migrate deploy` n'est pas sérialisable par défaut.
- **Rollback** : aucune procédure documentée pour annuler une migration partielle.

## Décision

On **recommandait déjà** l'option 1 du DAT §7 (init container Coolify). Cet ADR la **fige** et précise les garde-fous.

### 1. Architecture de déploiement Coolify

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

L'init container utilise la **même image Docker** que l'app (pas une image séparée avec uniquement Prisma) pour éviter le décalage de versions Prisma client / engine.

### 2. Santé de l'app ≠ santé de la DB

L'`/api/health` (déjà scaffoldé par S1-001) renvoie **toujours 200** avec `db: "up" | "down"`. C'est **sain** d'un point de vue orchestrateur (Coolify/Docker HEALTHCHECK), mais **insuffisant** pour savoir si le **schéma** est migré.

**Ajout** : un endpoint `/api/readiness` (Sprint 2, carte S1-006) qui :
- Tente un `SELECT * FROM "_prisma_migrations" LIMIT 1` pour vérifier que la table des migrations existe.
- Compare le `migration_name` le plus récent en DB avec celui attendu par le binaire (lu dans le `.next/standalone/.prisma/migrations/migration_lock.toml` ou dérivé).
- Renvoie `200 { ready: true }` si match, `503 { ready: false, expected, applied }` sinon.

Coolify ne devrait pas remplacer `/api/health` par `/api/readiness` dans le HEALTHCHECK (sinon un incident DB fait kill l'app inutilement). `/api/readiness` sert aux **smoke tests post-deploy** uniquement.

### 3. Procédure de rollback

En cas de régression après déploiement :

1. **Symptôme** : `/api/health` répond `200 { db: "down" }` OU logs applicatifs `PrismaClientKnownRequestError` / `Migration failed`.
2. **Vérification** : se connecter en SSH au conteneur Postgres Coolify, `psql -c "SELECT migration_name, finished_at FROM _prisma_migrations ORDER BY started_at DESC LIMIT 5"`.
3. **Rollback** : Coolify → Service app → Rollback vers l'image précédente (Coolify garde N images). L'image précédente a son propre schema figé ; on revient à un état DB cohérent **si on n'a pas appliqué de migration destructive** entre les deux.
4. **Migration destructive** (ALTER TABLE DROP COLUMN, etc.) : ne **jamais** l'appliquer sans avoir un script de rollback testé en pre-prod. Cf. CONVENTIONS §9 — toute migration destructive passe par une ADR dédiée.

### 4. Drift detection — pre-deploy hook CI

Une étape CI (`pnpm prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma --script`) vérifie qu'il n'y a **pas de migration manquante**. Si elle détecte un drift, le build échoue : on refuse de merger une PR qui introduit un changement de schéma sans migration associée.

## Conséquence

**Positives**
- L'app ne démarre **jamais** avec un schéma non migré. Le HEALTHCHECK répond positivement seulement quand l'app est réellement prête.
- Le rollback est une action Coolify standard, pas une procédure manuelle risquée.
- Les migrations destructives ne passent pas sans une ADR — c'est l'invariant qui protège contre les pertes de données.

**Négatives / risques**
- L'init container ajoute ~10 secondes au déploiement (overhead acceptable).
- Si Postgres est down **et** Coolify ne le détecte pas, l'init container peut boucler en retry infini. **À surveiller** dans le RUNBOOK § incidents.
- La procédure de rollback suppose que Coolify garde au moins 2 images en historique (configuration par défaut).

**Surface de code touchée**
- `Dockerfile` (déjà conforme — pas de changement, mais référence explicite dans cet ADR)
- `src/app/api/readiness/route.ts` (à créer en Sprint 2)
- `.github/workflows/ci.yml` (ajout de l'étape `prisma migrate diff`)
- `docs/team/RUNBOOK.md` § rollback déploiement (procédure ci-dessus)
- Configuration Coolify (UI) : champ "Command" sur l'init container

## Alternatives écartées

| Alternative | Pourquoi écartée |
|-------------|------------------|
| **Option 2 du DAT §7** (entrypoint.sh qui fait `migrate deploy && exec node server.js`) | Coupling fort entre migration et démarrage de l'app : si la migration échoue, l'app crash sans avoir démarré ; pas de signal distinct pour Coolify. |
| **Option 3** (pas de migration automatique, run manuel via SSH) | Non reproductible, source d'erreurs humaines, bloque les déploiements automatiques. |
| **Pas d'init container, l'app tente la migration elle-même au boot** | Race avec redémarrages multiples ; pas de signal clair "migration KO vs app KO". |
| **`/api/health` qui dépend du schéma (vérifie l'existence des tables)** | Casse le HEALTHCHECK Docker qui n'accepte que du 2xx. Un incident DB temporaire ferait croire à Coolify que l'app est down alors qu'elle est juste privée de DB. |
| **Pas de détection de drift en CI** | Premier déploiement avec drift = corruption silencieuse ou crash au premier appel DB. Détection précoce = 30 secondes de CI. |
| **Migrations destructives sans ADR** | Le pire risque d'une boutique en prod : un `DROP COLUMN` accidentel sur `Order`. Le coût d'une ADR obligatoire est négligeable. |
