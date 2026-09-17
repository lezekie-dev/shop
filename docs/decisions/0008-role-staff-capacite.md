# ADR-0008 — `Role.STAFF` + autorisation par capacité (pas par rôle en dur)

- **Statut** : Acceptée (Sprint 1), introduite carte S1-015 (audit D6, arbitré 22:29 chef)
- **Date** : 2026-09-17
- **Décideurs** : équipe architecture + PO + chef
- **Référence DAT** : §2 (schéma Prisma, `enum Role`), §4 (routes API admin), §11 ADR-0008

## Contexte

L'enum `Role` du schéma Prisma initial (DAT §2) ne porte qu'une seule valeur
`ADMIN`. La persona **P4 — Jules, l'opérateur préparation/SAV** du PO-BRIEF
doit pourtant accéder au back-office pour **préparer les commandes** :
voir la liste, passer une commande de `PAID` → `PREPARING` → `SHIPPED`,
saisir un numéro de suivi — sans toucher au catalogue, sans gérer
les utilisateurs, sans rembourser.

Le périmètre MVP (S1) n'implémente pas l'UI back-office (c'est S4), mais
**le schéma et la matrice de droits doivent être prêts** : sans eux,
chaque future route admin réinventerait son propre contrôle d'accès.

Deux trous identifiés :

1. **L'enum n'a qu'une valeur.** Le code applicatif (lorsqu'il arrivera)
   n'a aucun moyen de distinguer un admin d'un opérateur. Conséquence
   immédiate : toute vérification sera nécessairement `role === 'ADMIN'`,
   c'est-à-dire **codée en dur dans chaque route**. Au troisième rôle
   (comptable, partenaire marketplace, intégrateur logistique), on
   ré-ouvre 30 fichiers pour ajouter des `|| role === '…'`.
2. **« ADMIN par défaut » pour les nouveaux comptes** : le `User.role`
   a `@default(ADMIN)`. Conséquence : le seed crée un admin, mais tout
   nouvel utilisateur créé par script sera admin par défaut. Pour un
   MVP qui démarre avec un seul marchand, c'est un non-sujet ; mais
   dès qu'on ouvre la création de comptes staff (S4), un bug applicatif
   qui oublie `role: "STAFF"` élève silencieusement le nouvel utilisateur
   au rang admin.

## Décision

### 1. Enum `Role` étendue

```prisma
enum Role { ADMIN STAFF }
```

- `ADMIN` : accès total. Valeur historique du seed, conservée.
- `STAFF` : opérateur back-office au périmètre limité (cf. matrice §3).
- Le `@default(ADMIN)` du modèle `User` est **supprimé** : tout
  nouvel utilisateur doit avoir son rôle **défini explicitement** à la
  création. Le seed reste `ADMIN` (le marchand fondateur). La création
  de compte `STAFF` (S4) posera `role: "STAFF"` de manière obligatoire.

### 2. Autorisation par capacité, jamais par rôle en dur

**Règle d'or** (cf. CONVENTIONS §11) : les routes admin s'autorisent
**par capacité** (`can:orders:read`, `can:orders:transition:shipped`,
`can:products:write`, …), **jamais** par `user.role === 'ADMIN'` en dur.

Architecture cible (S4) :

```ts
// src/lib/auth.ts — pseudo-code
const CAPABILITIES: Record<Role, Capability[]> = {
  ADMIN: [/* toutes */],
  STAFF: [
    "auth:login", "dashboard:view",
    "orders:read",
    "orders:transition:preparing",
    "orders:transition:shipped",
    "orders:transition:delivered",
    "customers:read",
  ],
};

export function can(user: User, capability: Capability): boolean {
  return CAPABILITIES[user.role].includes(capability);
}
```

```ts
// src/lib/api.ts — extension de withApi (S4)
export const POST = withApi({
  requireAdmin: true,                    // présent → pas de rôle client
  capability: "orders:transition:shipped", // granularité réelle
  schema: ShipOrderSchema,
}, handler);
```

La capacité est **testée à un seul endroit** (le `withApi` helper). Le
mapping rôle → capacités vit dans une constante unique
(`CAPABILITIES`). Ajouter un rôle futur (comptable, partenaire) = ajouter
une ligne dans `CAPABILITIES` ; **aucune** route n'est touchée.

### 3. Matrice MVP (source de vérité : CONVENTIONS §11)

| Capacité                          | ADMIN | STAFF |
|-----------------------------------|:-----:|:-----:|
| `auth:login`                      | ✅    | ✅    |
| `dashboard:view`                  | ✅    | ✅    |
| `products:read`                   | ✅    | ❌    |
| `products:write`                  | ✅    | ❌    |
| `categories:write`                | ✅    | ❌    |
| `orders:read`                     | ✅    | ✅    |
| `orders:transition:preparing`     | ✅    | ✅    |
| `orders:transition:shipped`       | ✅    | ✅    |
| `orders:transition:delivered`     | ✅    | ✅    |
| `orders:transition:cancelled`     | ✅    | ❌    |
| `orders:refund`                   | ✅    | ❌    |
| `customers:read`                  | ✅    | ✅    |
| `customers:write`                 | ✅    | ❌    |
| `users:read`                      | ✅    | ❌    |
| `users:write`                     | ✅    | ❌    |
| `settings:write`                  | ✅    | ❌    |
| `audit-log:read`                  | ✅    | ❌    |

### 4. Note auth — séparation `requireAdmin` vs `requireCapability`

L'existant `withApi({ requireAdmin: true })` du DAT §4 (note middleware)
**reste valide** pour S1 : il vérifie que la session pointe vers un
utilisateur **interne** (ni client, ni guest). C'est un **filtre
d'authentification**, pas une autorisation fine. La granularité
« cette route exige cette capacité » est portée par un futur
`requireCapability(...)` (S4). S1 se contente du filtre grossier
« session interne valide ».

## Conséquence

**Positives**

- Le périmètre MVP peut être codé sans connaître le détail des
  permissions S4 : la matrice est posée, l'enum permet la distinction,
  le `withApi` reste l'unique point d'extension.
- L'audit de sécurité futur (post-MVP) lit la matrice dans
  `CONVENTIONS §11`, pas dans 30 fichiers.
- Aucun `if (role === 'ADMIN')` ne peut s'introduire silencieusement :
  c'est une règle bloquante en code review (cf. CONVENTIONS §10
  checklist reviewer).

**Négatives / risques**

- L'enum à deux valeurs peut sembler surdimensionnée pour S1 (un seul
  utilisateur, le marchand, est créé). Mais l'**attendre** pour
  l'ajouter = imposer une migration `enum` au moment où l'app est en
  prod. Mieux vaut poser l'enum maintenant, à coût nul.
- Le mapping rôle → capacités dans `CAPABILITIES` est en double
  (code + CONVENTIONS §11). Risque de désynchronisation. **Atténué**
  par la règle de revue : toute modification de la matrice impose
  une PR qui touche les deux endroits.

**Surface de code touchée**

- `prisma/schema.prisma` (Sprint 2, carte S1-005) — `enum Role { ADMIN STAFF }`,
  suppression `@default(ADMIN)` sur `User.role`.
- `src/lib/auth.ts` (Sprint 4) — constante `CAPABILITIES` + helper `can`.
- `src/lib/api.ts` (Sprint 4) — extension `withApi({ capability })`.
- `docs/team/CONVENTIONS.md` §11 — matrice source de vérité (ajouté
  par carte S1-015).
- `docs/team/ARCHITECTURE.md` §2 — enum + note capacité (carte S1-015).
- `docs/team/ARCHITECTURE.md` §11 — présent ADR (carte S1-015).

## Alternatives écartées

| Alternative | Pourquoi écartée |
|-------------|------------------|
| **Enum `Role` à une valeur, ajouter `STAFF` plus tard** | Migration `ALTER TYPE … ADD VALUE` en prod sur Postgres est faisable mais ajoute du risque (verrou de table, ordre de déploiement vs backend) pour une économie d'une ligne de schéma. Mieux vaut poser maintenant. |
| **Autorisation par rôle directement : `if (role === 'ADMIN') …`** | Marche pour 1 ou 2 rôles ; au 3ᵉ, c'est 30 fichiers à modifier. Refus catégorique. |
| **Bibliothèque tierce type CASL / oso** | Pour deux rôles et 17 capacités au MVP, c'est 200 ko de dépendances et une couche d'indirection pour rien. `CAPABILITIES` + `can()` en 15 lignes couvre 100 % du besoin. |
| **`Role[]` (tableau de rôles) au lieu d'enum unaire** | Un utilisateur ne peut pas être à la fois `ADMIN` et `STAFF` dans le modèle MVP. Si un jour on a besoin d'utilisateurs multi-rôles, c'est une migration `User.roles Role[]` + `CAPABILITIES` aplatie — le changement est local. Pas justifié maintenant. |
| **Garder `@default(ADMIN)` sur `User.role`** | Un bug applicatif qui oublie `role: "STAFF"` à la création élève l'opérateur au rang admin. Risque sécurité pour une économie d'un argument. |