# ADR-0007 — Stratégie de migration prod sur Coolify (init container, détection de drift, rollback)

- **Statut** : Acceptée (Sprint 1) — **créée 2026-09-17 (carte S1-014, audit D6)**
- **Date** : 2026-09-17
- **Décideurs** : équipe architecture + PO + chief (arbitrage post-audit DAT)
- **Référence DAT** : §7 (Dockerfile) ; audit DAT carte S1-002 finding 7

> **But** : répondre à une question précise que le DAT laissait
> ouverte : **si la migration échoue alors que le healthcheck répond
> 200, l'orchestrateur croit que l'app est saine et ne rollback
> pas**. Cette ADR ferme ce trou en figeant la stratégie de
> migration, le mécanisme de détection et le rollback.

---

## Contexte

Sur Coolify, l'application Next.js est déployée dans un conteneur
Docker. Le `HEALTHCHECK` du Dockerfile (DAT §7) cible `GET
/api/health`. **Le healthcheck vérifie que l'application Node
répond, pas que la base est migrée.**

Trois scénarios qu'on veut empêcher :

1. **Migration échouée silencieusement** : `prisma migrate deploy`
   retourne une erreur (lock Postgres, migration cassée, drift
   schéma) mais le code n'a pas encore démarré, donc
   `/api/health` répond 404 ou attend → le healthcheck Docker
   reste "starting", Coolify ne voit pas d'erreur franche.

2. **Migration réussie + healthcheck OK + régression métier** :
   l'app boote, `GET /api/health` répond `200 { ok: true, db: "ok" }`,
   mais une migration a corrompu une contrainte (par exemple un
   `CHECK` manquant → le code applicatif commence à insérer des
   lignes invalides).

3. **Migration partiellement appliquée** : le conteneur a planté
   au milieu de `prisma migrate deploy` (crash réseau,
   SIGKILL Coolify), la table `_prisma_migrations` est dans un
   état intermédiaire. Au prochain démarrage, `prisma migrate
   deploy` refuse d'avancer. L'app peut ne pas démarrer du tout.

Le DAT §7 esquisse 3 options pour la migration (init container
Coolify, entrypoint.sh, recommandé init container) **sans
traiter** la détection de drift ni le rollback explicite.

## Décision

### 1. Choix : **init container Coolify** (recommandation DAT §7 confirmée)

- Coolify supporte nativement un init container qui s'exécute
  **avant** le conteneur applicatif et dont le code de retour
  conditionne le démarrage de l'app.
- Avantages sur l'entrypoint.sh :
  - **Isolation** : l'init container a sa propre image (alpine +
    `node` + `prisma`), pas de risque que la migration tourne
    avec le code applicatif bogué.
  - **Logs séparés** : on peut suivre `docker logs shop-migrate`
    indépendamment de `docker logs shop-app`.
  - **Pas de pid 1 = pas de signal handling piège** : le `CMD
    ["node", "server.js"]` du conteneur applicatif reste simple,
    pas de shell script à débugger.
  - **Échec explicite** : si l'init container sort en code != 0,
    Coolify ne démarre **pas** le conteneur applicatif. Pas
    d'ambiguïté.

Configuration Coolify (à poser en S4 lors du déploiement initial) :

```yaml
# docker-compose.yml (à committer dans le repo)
services:
  migrate:
    image: shop:build-<sha>           # même image que l'app
    command: ["node", "scripts/migrate-deploy.mjs"]
    env_file: .env
    depends_on: []                    # ne dépend de rien
    restart: "no"                     # pas de retry auto Coolify
    healthcheck:
      test: ["CMD", "node", "scripts/migrate-check.mjs"]
      interval: 30s
      timeout: 5s
      retries: 3
  app:
    image: shop:build-<sha>
    command: ["node", "server.js"]
    depends_on:
      migrate:
        condition: service_completed_successfully
    healthcheck:
      test: ["CMD", "curl", "-fsS", "http://localhost:3000/api/health"]
      interval: 30s
      timeout: 5s
      start_period: 20s
      retries: 3
```

`scripts/migrate-deploy.mjs` (à implémenter en S4, contrat ici) :

```js
// 1. prisma migrate deploy
await execFile("npx", ["prisma", "migrate", "deploy"], { stdio: "inherit" });
// 2. Vérification de cohérence (voir §3)
await checkDrift();
process.exit(0);
```

### 2. Le healthcheck applicatif n'est PAS suffisant

`/api/health` répond `200` dans deux cas dangereux :

- DB injoignable (code applicatif attrape l'erreur et renvoie
  `db: "down"` mais `ok: true`). → Coolify voit `200`, croit que
  tout va bien.
- DB OK mais schéma drifté (colonnes manquantes) → la requête
  `/api/health` qui fait un simple `SELECT 1` ne le voit pas.

**Conséquence** : on **double** la vérification.

### 3. Détection de drift schéma ↔ base

Un script `scripts/migrate-check.mjs` (à implémenter en S4, contrat
ici) fait trois vérifications et sort en code != 0 si l'une
échoue :

```js
// a. Migrations pending : aucune migration non appliquée
//    → SELECT * FROM _prisma_migrations WHERE finished_at IS NULL;
// b. Drift schéma : la base ne contient pas d'objet hors schema.prisma
//    → prisma migrate diff (sort en code != 0 si drift)
// c. Sanity check : la table critique (Stock) a la contrainte CHECK
//    → SELECT 1 FROM information_schema.table_constraints
//       WHERE constraint_name = 'stock_nonneg';
```

Ce script tourne :

1. **Dans l'init container** après `migrate deploy` (échec ⇒ l'app
   ne démarre pas).
2. **Dans le healthcheck applicatif** (`/api/health`) en plus du
   simple `SELECT 1` — appelle `migrate-check.mjs` via
   `execFileSync` ; renvoie `503 { ok: false, drift: true }` sinon.
3. **En cron quotidien** (carte S4 observabilité) pour détecter
   une dérive introduite hors déploiement (ex : manipulation
   manuelle de la DB).

### 4. Rollback

Trois niveaux de rollback, du plus au moins chirurgical :

| Niveau         | Quand                                              | Commentaire |
|----------------|----------------------------------------------------|-------------|
| **Code seul**  | Migration appliquée OK, code applicatif régresse   | `IMAGE_TAG` → SHA précédent via Coolify UI. C'est le cas attendu, le plus fréquent. |
| **Code + migration réversible** | Migration OK mais bug détecté en prod dans les 30 min, et la migration est **down-safe** | Rollback code, puis `prisma migrate resolve --rolled-back <name>` pour autoriser la migration inverse. |
| **Code + migration irréversible** | Migration a corrompu des données | Restaurer le backup DB (RUNBOOK §5), redéployer le code du tag précédent. |

**Règle** : aucune migration n'est **destructive** sans être
**down-safe**. Concrètement :

- ❌ `DROP COLUMN` direct → interdit.
- ✅ Ajouter la colonne nullable, déployer le code, backfill, puis
  `DROP COLUMN` dans une migration suivante **après** confirmation
  que plus rien ne lit l'ancienne colonne.
- ❌ `ALTER TABLE … DROP CONSTRAINT` sans avoir vérifié qu'aucun
  insert en cours ne viole la nouvelle absence de contrainte.

### 5. Procédure d'incident « migration échouée »

Le RUNBOOK § « migration échouée » est mis à jour par cette carte
(voir `docs/team/RUNBOOK.md` § « migration échouée ») avec la
procédure suivante :

1. **Détection** : `/api/health` renvoie 503 OU init container
   sort en code != 0 OU cron quotidien remonte un drift.
2. **Moins de 30 min après le déploiement** : on suppose que c'est
   le nouveau code. Rollback `IMAGE_TAG` vers le précédent SHA
   (`Coolify UI → Application → Rollback`). Investiguer après.
3. **Plus de 30 min après** : on suppose que des clients ont
   utilisé la nouvelle version. Rollback code **plus**
   investigation base (cf. niveaux §4).
4. **Communication** : si le downtime > 5 min, message dans
   WAR ROOM `t_b0886788` (cf. RUNBOOK §1).

## Conséquence

**Positives**

- **Pas de faux positif healthcheck** : `/api/health` valide non
  seulement la connexion DB mais aussi la cohérence schéma.
  Coolify peut prendre une décision fiable.
- **Init container = atomicité** : soit la migration réussit et
  l'app démarre, soit l'app ne démarre pas et l'alerte est
  explicite (code != 0 dans les logs Coolify).
- **Drift détectable post-déploiement** : le cron quotidien
  remonte une dérive même introduite hors déploiement
  (manipulation manuelle, script tiers).
- **Migrations down-safe par construction** : la règle
  « pas de DROP COLUMN direct » évite la situation « je rollback
  le code, mais la base a perdu la colonne que le code précédent
  attend ».
- **Procédure d'incident documentée** : un dev de garde à 3 h du
  matin sait quoi faire sans Slack ni IM.

**Négatives / risques**

- **Coût du healthcheck renforcé** : `/api/health` qui appelle
  `migrate-check.mjs` à chaque check (toutes les 30 s). Le script
  est O(1) en introspection Postgres (3 requêtes indexées), mais
  c'est non-trivial. → Acceptable, ~10 ms.
- **Scripts à implémenter** (`migrate-deploy.mjs`,
  `migrate-check.mjs`) : pas avant S4. Le contrat est posé ici,
  l'implémentation suivra.
- **Dépendance à `prisma migrate diff`** : Prisma 5 fournit la
  commande ; si on change de version majeure (cf. ADR-0006), on
  vérifie que `migrate diff` reste supporté.

**Surface de code touchée**

- `docker-compose.yml` : ajout service `migrate`.
- `scripts/migrate-deploy.mjs` (S4).
- `scripts/migrate-check.mjs` (S4).
- `src/app/api/health/route.ts` : intègre l'appel `migrate-check`.
- `docs/team/RUNBOOK.md` : § « migration échouée » mis à jour.

## Alternatives écartées

| Alternative                                                | Pourquoi écartée |
|------------------------------------------------------------|------------------|
| **`entrypoint.sh` dans le conteneur applicatif**           | Mélange migration et démarrage dans le même pid 1. Logs confondus, signal handling piège (PID 1 + node), pas d'isolation si la migration corrompt l'environnement. |
| **Pas d'init container, juste healthcheck applicatif**    | C'est la situation actuelle du DAT §7 — et c'est exactement ce qui crée le trou qu'on ferme. Un healthcheck applicatif qui répond 200 ne dit rien sur l'état de la migration. |
| **Migration manuelle par SSH avant déploiement**           | Opération manuelle = source d'erreur humaine. Refusé par DAT §7 (automatisation). |
| **`SERIALIZABLE` côté Postgres pour parer toute race migration/app** | Sans rapport. La race qu'on traite est migration ↔ code, pas des transactions concurrentes. |
| **Rollback automatique sur 503** (Coolify)                 | Coolify ne sait pas faire la différence entre « migration échouée » et « bug applicatif » → rollback automatique = risque de rollback sur un faux positif. On préfère un humain qui voit l'alerte et décide. |
