# Prompt de design — Interface de la boutique Shop

> À coller tel quel dans un agent de design (ou à utiliser comme brief pour un
> designer humain). Il décrit l'existant réel, pas un site imaginaire.

---

## Le brief

Conçois l'interface d'une **boutique e-commerce de vêtements et accessoires en toile et coton**, destinée au marché francophone Afrique (Cameroun) et à la diaspora en Europe. L'application existe déjà et fonctionne : **tu redessines une interface en production, tu ne pars pas d'une page blanche**. Toutes les fonctionnalités listées ci-dessous sont implémentées ; ton travail est de les rendre belles et cohérentes.

**Le client type** : Aïcha, 24–38 ans, Douala, smartphone Android milieu de gamme en 3G instable, forfait data limité, paie en Mobile Money. Puis Marc, la diaspora, qui commande depuis la France pour sa famille au pays. **Le mobile n'est pas un cas dégradé, c'est le cas principal.**

**La marchande type** : Fatou, non technicienne, gère seule sa marque. Elle ne doit jamais avoir besoin d'un développeur.

---

## Direction artistique — non négociable

Le propriétaire a rejeté le look « template SaaS générique » et le look « dashboard sombre monospace » (il l'a qualifié de « trop vilain »). Ce qu'il veut :

**Chaleur, pas froideur.** Fond crème, jamais du blanc pur ni du sombre. Accent terracotta, jamais de bleu/cyan ni de dégradé violet. Titres en serif, corps en sans-serif, monospace **uniquement** pour les chiffres alignés.

**Le vocabulaire visuel exact :**

| Élément | Règle |
|---|---|
| Fond de page | `#FBF7F0` (crème) — jamais `#FFFFFF` pur |
| Zones secondaires | `#F4EBD9` (sable), `#F7F1E7` (creusé) |
| Titres | `#2A1810` (brun chaud) — jamais noir pur |
| Corps de texte | `#4A3428` |
| Accent / CTA | `#C2410C` (terracotta), pressé `#9A3412` |
| Succès | `#0F766E` (vert forêt) |
| Attention | `#A16207` (ocre, jamais jaune vif) |
| Erreur | `#A4232B` (rouge brique, pas rouge pompier) |
| Bordures | `1.5px` — jamais `1px` |
| Rayons | cartes **16px**, boutons **999px** (pilule), champs **12px** |
| Ombres | douces : `0 1px 2px rgba(42,24,16,.04), 0 1px 3px rgba(42,24,16,.06)` |
| Transitions | **240ms** `cubic-bezier(0.4, 0, 0.2, 1)` |
| Entrée de page | `fadeUp` 400ms ease-out, décalage en cascade 50/100/150/200ms |
| Survol de carte | `translateY(-2px)` + ombre légèrement renforcée |

**Typographie.** Serif éditorial (Fraunces — police variable, active l'axe `WONK` pour le caractère, `opsz` auto) pour le titrage ; Inter pour le corps. Le titre de hero est le seul à utiliser la très grande taille (`clamp(2.75rem, 7.5vw, 5rem)`) — répété, il ne frappe plus. Interlettrage **négatif** sur le titrage (`-0.02em` à `-0.035em`), **positif** et large (`0.09em`) sur les petits labels en capitales, sinon ils se tassent.

**Ce qu'il faut éviter absolument :**
- Mode sombre par défaut (le produit n'est pas un outil de développeur)
- Monospace pour autre chose que des chiffres
- Les palettes IA génériques : Inter seule, dégradés violets, polices système
- Les grilles de 4 cartes identiques sans hiérarchie
- Les micro-graphiques décoratifs : quand un chiffre suffit, un chiffre suffit
- L'urgence animée (pulsations, mises à l'échelle) — ça angoisse l'acheteur
- Les coins à 6px partout ; préférer 12–20px sur les cartes

**Accessibilité :** un statut ne doit **jamais** reposer sur la couleur seule — toujours forme + libellé (pastille, icône, texte). Le propriétaire est attentif au daltonisme. Anneau de focus visible de 3px.

---

## Les écrans à concevoir (31 au total)

### Parcours d'achat — 8 écrans

| Écran | Ce qu'il doit permettre |
|---|---|
| **Accueil** | Hero avec visuel produit + accroche qui vend. Dernières pièces. Catégories. Bandeau de réassurance (expédition suivie, Mobile Money, retour 14 j, commande sans compte). |
| **Catalogue** `/products` | Grille, filtres par catégorie (pastilles), tri (nouveauté / prix ↑ / prix ↓), pagination 12 produits, compteur de résultats. |
| **Catégorie** `/categorie/[slug]` | Page dédiée avec titre et description. |
| **Recherche** `/products?q=` | Champ dans l'en-tête. **État vide utile** : quand rien ne correspond, proposer de parcourir le catalogue au lieu d'afficher « 0 résultat ». |
| **Fiche produit** | Fil d'Ariane, galerie, variante en **pastilles de couleur** (remplaçant le menu quand elles couvrent toutes les variantes), **sélecteur de quantité −/+** (jamais un champ libre), prix, stock bas signalé, points de réassurance **sous** le bouton d'achat (c'est là que naît l'hésitation), avis clients si approuvés. |
| **Panier** | Lignes modifiables, sous-total, **champ code promo**, remise affichée distinctement, total, CTA. |
| **Checkout** | Formulaire court, adresse de livraison ≠ facturation (cas diaspora), choix du moyen de paiement, récap. **Objectif : 5 écrans maximum.** |
| **Confirmation** | Merci, numéro de commande, récap, et le lien de suivi. |

### Paiement — 2 écrans

| Écran | Particularité |
|---|---|
| **Mobile Money** | Instructions (Orange/MTN), **compte à rebours d'expiration**, bouton de confirmation. Doit inspirer confiance sans promettre ce qui n'arrive pas. |
| **Virement** | Coordonnées bancaires, **référence de virement** (le numéro de commande), instructions claires. La commande reste « à valider » jusqu'à confirmation manuelle du marchand — dis-le. |

### Espace client — 6 écrans

| Écran | Ce qu'il doit permettre |
|---|---|
| **Connexion** / **Inscription** | Courts. L'inscription **rattache** un compte à une commande déjà passée en invité. |
| **Mes commandes** `/compte` | Liste avec statut, date, total. |
| **Détail commande** | Lignes, adresse, paiement, **suivi d'expédition**. |
| **Carnet d'adresses** | Définir une adresse par défaut, supprimer (avec refus si une commande la référence). |
| **Déposer un avis** | Accessible **seulement** sur un produit réellement commandé. Note + texte, pas de photo. |
| **Suivi invité** `/orders/[jeton]` | Suivi sans compte, par lien à jeton. |

### Back-office marchand — 15 écrans

Tableau de bord (CA, panier moyen, à traiter, alertes stock, répartition des paiements) · Erreur 403 dédiée · **Commandes** (filtrable, avec détail et actions : marquer payée, expédiée, **rembourser**) · **Paiements en attente** (à ne pas expédier, compteur > 24 h) · **Produits** (CRUD, variantes, **téléversement d'images** avec réordonnancement) · **Stock** (ajustement, alertes) · **Codes promo** (création, usage consommé / plafond) · **Avis** (file de modération, ancienneté en évidence) · **Tâches planifiées** (les jobs, dont les échecs) · **Emails** (journal) · **Utilisateurs** (rôles ADMIN/STAFF, 2FA) · **Sécurité** (2FA, mot de passe) · Connexion.

> **Deux contraintes fortes sur le back-office.** D'abord il a besoin de **plus de largeur** que la vitrine : un tableau de 7 colonnes réclame ~1360px, pas 1120px — prévois un plafond par zone, pas un plafond global. Ensuite **il doit être utilisable par un opérateur sur un écran modeste** : les écrans denses doivent se replier en cartes sur mobile plutôt que de forcer un défilement horizontal.

---

## Contraintes techniques à respecter

1. **Aucun compte tiers.** Pas de CDN d'images, pas de police distante, pas de service d'hébergement. Tout est local. Les polices sont auto-hébergées.
2. **Prix en centimes entiers** (`Int`), jamais de flottant. L'affichage est formaté par une fonction unique — ne réimplémente pas le formatage monétaire.
3. **Performance mobile 3G.** Les images portent leurs dimensions (`width`/`height`) pour ne provoquer **aucun décalage de mise en page**. Pas de bibliothèque de composants lourde. Budget JS serré sur le parcours d'achat.
4. **Les valeurs existent déjà.** Le projet a un fichier de tokens (`src/ui/styles/tokens.css`) avec toutes les couleurs, espacements, tailles de police et rayons. **Utilise ces variables, n'invente aucune valeur en dur.** Si tu as besoin d'une valeur absente, ajoute-la au fichier de tokens, pas dans ton composant.
5. **Deux polices seulement** : une serif pour le titrage, une sans-serif pour le corps. Le monospace est réservé aux chiffres.

---

## Ce que je veux en retour

1. **Les écrans clés en HTML/CSS statique**, mobile **et** desktop côte à côte, pour : l'accueil, la fiche produit, le panier, le checkout, le tableau de bord marchand, et la liste des commandes.
2. **Un fichier de tokens** rassemblant couleurs, espacements, typographie et rayons — la source unique dont découlent tous les écrans.
3. **Les états que personne ne dessine jamais** et qui font la différence : chargement, vide (avec du caractère : une icône, un titre, une phrase utile, un CTA — pas un « Aucun résultat » sec), erreur, succès, rupture de stock, code promo refusé (en disant **pourquoi**, pas « code invalide »).
4. **Une note honnête** sur ce qui ne marche pas, ce qui est incohérent, ou ce que tu n'as pas réussi à faire. Une liste de limites assumées vaut mieux qu'une promesse tenue à moitié.

**Ne charge pas de skill de design « générique »** pour produire ce travail : le résultat attendu vient du vocabulaire décrit ci-dessus. En cas de doute, ajoute de la chaleur (crème), du contraste typographique (serif contre sans), et de l'espace — jamais plus de composants.
