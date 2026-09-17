# Architecture Technique — MVP Shop E-commerce

> Document d'architecture technique (DAT) pour le MVP shop.
> **Cible** : un développeur doit pouvoir démarrer le code immédiatement après lecture.
> **Stack imposée** : Next.js 14+ App Router · TypeScript strict · Prisma · PostgreSQL 16 · Stripe (abstraction `PaymentProvider`) · Vitest · Playwright · Docker (Coolify VPS).

---

## Table des matières

1. [Arborescence du projet](#1-arborescence-du-projet)
2. [Schéma Prisma](#2-schéma-prisma)
3. [Pattern `PaymentProvider`](#3-pattern-paymentprovider)
4. [Routes API](#4-routes-api)
5. [Pages Next.js (App Router)](#5-pages-nextjs-app-router)
6. [Stack technique — dépendances et versions](#6-stack-technique--dépendances-et-versions)
7. [Dockerfile multi-stage](#7-dockerfile-multi-stage)
8. [docker-compose pour dev local](#8-docker-compose-pour-dev-local)
9. [Stratégie de tests](#9-stratégie-de-tests)
10. [Variables d'environnement](#10-variables-denvironnement)
11. [Décisions architecturales clés (ADR)](#11-décisions-architecturales-clés-adr)

---

## 1. Arborescence du projet

```
shop/
├── .env.example                  # variables d'env documentées (commit-safe)
├── .gitignore
├── .dockerignore
├── docker-compose.yml            # dev local (Next + Postgres)
├── docker-compose.prod.yml       # prod (image Coolify)
├── Dockerfile                    # multi-stage, runtime bookworm-slim
├── package.json
├── pnpm-lock.yaml                # ou package-lock.json si npm
├── tsconfig.json                 # strict: true, paths: { "@/*": ["./src/*"] }
├── next.config.mjs               # output: "standalone", images, headers
├── vitest.config.ts
├── playwright.config.ts
├── prisma/
│   ├── schema.prisma
│   ├── seed.ts                   # seed catégories + produit démo
│   └── migrations/                # générées par prisma migrate dev
├── src/
│   ├── app/                      # App Router
│   │   ├── layout.tsx            # root layout, html lang, fonts, providers
│   │   ├── page.tsx              # home (hero + catégories)
│   │   ├── (shop)/               # groupement routes publiques boutique
│   │   │   ├── products/
│   │   │   │   ├── page.tsx      # catalogue (filtres catégorie, prix)
│   │   │   │   └── [slug]/page.tsx
│   │   │   ├── cart/page.tsx
│   │   │   ├── checkout/
│   │   │   │   ├── page.tsx
│   │   │   │   └── success/page.tsx
│   │   │   └── orders/[id]/page.tsx
│   │   ├── (admin)/admin/        # groupement routes admin (auth requise)
│   │   │   ├── layout.tsx        # vérif cookie admin, redirect /login
│   │   │   ├── page.tsx          # dashboard (KPI simples)
│   │   │   ├── products/         # CRUD produits + variantes + stock
│   │   │   ├── orders/           # liste + détail + transition statut
│   │   │   └── login/page.tsx    # formulaire login admin
│   │   ├── api/                  # routes API (voir §4)
│   │   │   ├── health/route.ts
│   │   │   ├── products/...
│   │   │   ├── cart/...
│   │   │   ├── checkout/...
│   │   │   ├── webhooks/
│   │   │   │   └── stripe/route.ts
│   │   │   └── admin/...
│   │   └── middleware.ts         # protection routes /admin/*
│   ├── domain/                   # logique métier pure, aucune dépendance Next/Prisma
│   │   ├── pricing.ts            # calcul totaux depuis minor units (Int)
│   │   ├── stock.ts              # règles disponibilité/décrément
│   │   ├── order.ts              # transitions de statut
│   │   └── payment/
│   │       ├── provider.ts       # interface PaymentProvider (deep module)
│   │       ├── stripe.ts         # adaptateur Stripe
│   │       ├── mobile-money.ts   # placeholder, à brancher plus tard
│   │       └── registry.ts       # sélection du provider depuis env
│   ├── lib/                      # adapters techniques (DB, http, log)
│   │   ├── db.ts                 # singleton PrismaClient
│   │   ├── auth.ts               # hash bcrypt, cookie httpOnly, verifySession
│   │   ├── env.ts                # parsing/validation runtime (zod)
│   │   ├── logger.ts             # pino logger
│   │   ├── api.ts                # helpers route handlers (errors, json, auth)
│   │   └── ids.ts                # génération id (cuid2)
│   ├── server/                   # server actions / services applicatifs
│   │   ├── cart.ts
│   │   ├── checkout.ts           # orchestration checkout → payment intent
│   │   ├── order.ts
│   │   └── webhook-handlers.ts
│   ├── ui/                       # composants partagés client + server
│   │   ├── components/
│   │   │   ├── cart-button.tsx
│   │   │   ├── product-card.tsx
│   │   │   ├── variant-picker.tsx
│   │   │   └── money.tsx         # format minor units → affichage
│   │   └── styles/
│   │       └── globals.css
│   └── types/
│       └── domain.ts             # types partagés
├── tests/
│   ├── unit/                     # vitest, pas de DB
│   │   ├── pricing.test.ts
│   │   ├── stock.test.ts
│   │   └── payment-interface.test.ts
│   ├── integration/              # vitest + Prisma sur Postgres jetable
│   │   ├── cart.test.ts
│   │   ├── checkout.test.ts
│   │   └── webhook.test.ts
│   ├── e2e/                      # playwright
│   │   ├── browse-buy.spec.ts
│   │   ├── admin-login.spec.ts
│   │   └── fixtures/
│   └── helpers/
│       ├── prisma-test.ts        # truncate DB entre tests
│       ├── stripe-mock.ts        # mock PaymentProvider
│       └── factories.ts          # faker-like pour fixtures
└── docs/
    ├── team/
    │   ├── ARCHITECTURE.md       # ce document
    │   ├── CONVENTIONS.md
    │   └── RUNBOOK.md
    └── decisions/                # ADR (voir §11)
```

**Règles d'organisation** :

- `src/domain/` est **pur TypeScript** : pas d'import depuis `next/*`, pas de `PrismaClient` direct. Il prend des structures de données, renvoie des structures de données.
- `src/server/` orchestre : importe `domain/` + `lib/db.ts`. C'est le seul endroit qui appelle Prisma pour les écritures transactionnelles.
- `src/app/api/*/route.ts` est fin : il parse, appelle un service de `src/server/`, renvoie une réponse. Pas de logique métier dans la route.

---

## 2. Schéma Prisma

Fichier : `prisma/schema.prisma`.

```prisma
generator client {
  provider        = "prisma-client-js"
  previewFeatures = []
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

// ─────────────────────────────────────────────────────────────────────
// Identité & accès
// ─────────────────────────────────────────────────────────────────────

model User {
  id           String   @id @default(cuid())
  email        String   @unique
  passwordHash String
  role         Role     @default(ADMIN)
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
  sessions     Session[]
  auditLogs    AuditLog[]
  @@index([email])
}

enum Role { ADMIN }

model Session {
  id        String   @id @default(cuid())
  userId    String
  token     String   @unique           // random 256 bits, hashé en cookie
  expiresAt DateTime
  createdAt DateTime @default(now())
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@index([userId])
  @@index([expiresAt])
}

// ─────────────────────────────────────────────────────────────────────
// Clients finaux (guest + identifiés)
// ─────────────────────────────────────────────────────────────────────

model Customer {
  id        String   @id @default(cuid())
  email     String   @unique
  firstName String?
  lastName  String?
  phone     String?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  addresses Address[]
  carts     Cart[]
  orders    Order[]
  @@index([email])
}

model Address {
  id         String   @id @default(cuid())
  customerId String
  line1      String
  line2      String?
  city       String
  postalCode String
  country    String   @default("FR")
  isDefault  Boolean  @default(false)
  customer   Customer @relation(fields: [customerId], references: [id], onDelete: Cascade)
  orders     Order[]
  @@index([customerId])
}

// ─────────────────────────────────────────────────────────────────────
// Catalogue
// ─────────────────────────────────────────────────────────────────────

model Category {
  id        String    @id @default(cuid())
  slug      String    @unique
  name      String
  products  Product[]
}

model Product {
  id          String     @id @default(cuid())
  slug        String     @unique
  name        String
  description String     @db.Text
  categoryId  String
  active      Boolean    @default(true)
  createdAt   DateTime   @default(now())
  updatedAt   DateTime   @updatedAt
  category    Category   @relation(fields: [categoryId], references: [id])
  variants    Variant[]
  @@index([categoryId])
  @@index([active])
}

model Variant {
  id           String        @id @default(cuid())
  productId    String
  sku          String        @unique
  name         String        // ex: "Rouge / M"
  priceMinor   Int           // prix de base, en minor units (ISO 4217) de la devise du variant
  attributes   Json          // { color: "red", size: "M" }
  weightGrams  Int?
  active       Boolean       @default(true)
  product      Product       @relation(fields: [productId], references: [id], onDelete: Cascade)
  stock        Stock?
  cartItems    CartItem[]
  orderItems   OrderItem[]
  @@index([productId])
}

model Stock {
  variantId String  @id
  quantity  Int     @default(0)
  reserved  Int     @default(0)    // mis de côté en checkout non encore confirmé
  variant   Variant @relation(fields: [variantId], references: [id], onDelete: Cascade)
  @@index([variantId])
}

// ─────────────────────────────────────────────────────────────────────
// Panier & commande
// ─────────────────────────────────────────────────────────────────────

enum CartStatus { ACTIVE CONVERTED ABANDONED }

model Cart {
  id         String     @id @default(cuid())
  customerId String?
  sessionKey String?    @unique        // cookie guest, hash du fingerprint
  status     CartStatus @default(ACTIVE)
  currency   String                          // ISO-4217, affectée à la création depuis SHOP_CURRENCY (DAT §10)
  createdAt  DateTime   @default(now())
  updatedAt  DateTime   @updatedAt
  customer   Customer?  @relation(fields: [customerId], references: [id])
  items      CartItem[]
  @@index([customerId])
  @@index([status])
}

model CartItem {
  id          String  @id @default(cuid())
  cartId      String
  variantId   String
  quantity    Int
  unitPriceMinor Int   // snapshot prix au moment de l'ajout (anti-surpricing), minor units ISO-4217
  cart        Cart    @relation(fields: [cartId], references: [id], onDelete: Cascade)
  variant     Variant @relation(fields: [variantId], references: [id])
  @@unique([cartId, variantId])
  @@index([cartId])
}

enum OrderStatus {
  PENDING_PAYMENT
  PAID
  PREPARING
  SHIPPED
  DELIVERED
  CANCELLED
  REFUNDED
}

model Order {
  id              String      @id @default(cuid())
  number          String      @unique        // ex: "ORD-2026-000123"
  customerId      String
  addressId       String
  status          OrderStatus @default(PENDING_PAYMENT)
  subtotalMinor   Int
  shippingMinor   Int
  totalMinor      Int
  currency        String                          // ISO-4217, copiée depuis Cart.currency à la conversion (DAT §10)
  paymentProvider String                       // "stripe" | "mobile_money"
  paymentRef      String?                     // PaymentIntent id / tx ref
  placedAt        DateTime    @default(now())
  paidAt          DateTime?
  shippedAt       DateTime?
  cancelledAt     DateTime?
  customer        Customer    @relation(fields: [customerId], references: [id])
  address         Address     @relation(fields: [addressId], references: [id])
  items           OrderItem[]
  payments        Payment[]
  shipments       Shipment[]
  @@index([customerId])
  @@index([status])
  @@index([placedAt])
}

model OrderItem {
  id            String  @id @default(cuid())
  orderId       String
  variantId     String
  quantity      Int
  unitPriceMinor Int
  productNameSnapshot String
  variantNameSnapshot String
  order         Order   @relation(fields: [orderId], references: [id], onDelete: Cascade)
  variant       Variant @relation(fields: [variantId], references: [id])
  @@index([orderId])
}

// ─────────────────────────────────────────────────────────────────────
// Paiements & logistique
// ─────────────────────────────────────────────────────────────────────

enum PaymentStatus { PENDING SUCCEEDED FAILED REFUNDED }

model Payment {
  id            String        @id @default(cuid())
  orderId       String
  provider      String
  providerRef   String        // Stripe PaymentIntent id, etc.
  amountMinor   Int                              // minor units ISO-4217 (cf. ADR-0003)
  currency      String
  status        PaymentStatus
  rawPayload    Json?
  createdAt     DateTime      @default(now())
  updatedAt     DateTime      @updatedAt
  order         Order         @relation(fields: [orderId], references: [id], onDelete: Cascade)
  @@unique([provider, providerRef])     // idempotence côté DB
  @@index([orderId])
}

enum ShipmentStatus { PENDING IN_TRANSIT DELIVERED RETURNED }

model Shipment {
  id          String         @id @default(cuid())
  orderId     String
  carrier     String?
  trackingNo  String?
  status      ShipmentStatus @default(PENDING)
  shippedAt   DateTime?
  deliveredAt DateTime?
  order       Order          @relation(fields: [orderId], references: [id], onDelete: Cascade)
  @@index([orderId])
}

// ─────────────────────────────────────────────────────────────────────
// Webhooks idempotents + audit
// ─────────────────────────────────────────────────────────────────────

model WebhookEvent {
  id          String   @id @default(cuid())
  provider    String                       // "stripe"
  eventKey    String                       // stripe event id (evt_…)
  type        String                       // "payment_intent.succeeded"
  receivedAt  DateTime @default(now())
  processedAt DateTime?
  payload     Json
  error       String?
  @@unique([provider, eventKey])           // ← clé d'idempotence
  @@index([provider, type])
}

model AuditLog {
  id         String   @id @default(cuid())
  userId     String?
  action     String                       // "product.update", "order.ship"
  entity     String
  entityId   String
  diff       Json?
  createdAt  DateTime @default(now())
  user       User?    @relation(fields: [userId], references: [id])
  @@index([entity, entityId])
  @@index([createdAt])
}
```

**Décisions encodées dans le schéma** :

- **Prix en `Int` minor units ISO-4217** : aucun `Float` dans le modèle. La devise vit dans `currency` (string ISO-4217) sur chaque ligne qui porte un prix.
- **Stock décrémenté à la confirmation** : `Stock.reserved` monte au checkout (`PENDING_PAYMENT`), descend + `Stock.quantity` descend au webhook `payment_intent.succeeded`. La décrément finale est transactionnelle (`prisma.$transaction`).
- **Idempotence webhooks** : `WebhookEvent @@unique([provider, eventKey])` + `Payment @@unique([provider, providerRef])`. Une seconde insertion échoue → on renvoie 200 à Stripe et on ne rejoue pas la logique.
- **Snapshot prix/nom sur `OrderItem`** : même si le `Variant` est modifié/supprimé ensuite, la commande reste fidèle.
- **Soft delete non utilisé** : on préfère `Variant.active = false` pour préserver l'historique de commande. Pas de `deletedAt`.

---

## 3. Pattern `PaymentProvider`

**Pourquoi une interface unique** : Stripe est branché en premier, mais le client cible opère en zone où Mobile Money (Orange Money, Wave, MTN MoMo) est dominant. Le contrat métier ne change pas (`createIntent`, `capture`, `refund`, `verifyWebhook`), seul l'adaptateur change. C'est un *deep module* : une interface étroite avec un comportement riche en arrière-plan.

### Interface — `src/domain/payment/provider.ts`

```ts
import type { JsonValue } from "@prisma/client/runtime/library";

export type Money = { amountMinor: number; currency: string };

export type CreateIntentInput = {
  orderId: string;
  amount: Money;
  customer: { email: string; name?: string };
  metadata: Record<string, string>;   // on y met orderId, items count, etc.
  returnUrl: string;
};

export type CreateIntentResult = {
  providerRef: string;                // ex: "pi_…"
  clientToken?: string;               // pour Stripe Elements côté front
  redirectUrl?: string;               // pour Mobile Money (page PSP)
  expiresAt?: Date;
};

export type VerifyWebhookInput = {
  headers: Record<string, string>;
  rawBody: string;
};

export type VerifiedWebhook = {
  provider: string;                   // "stripe"
  eventKey: string;                   // idempotence key
  type: string;                       // "payment_intent.succeeded"
  data: JsonValue;
};

export interface PaymentProvider {
  readonly name: string;              // "stripe" | "mobile_money"

  createIntent(input: CreateIntentInput): Promise<CreateIntentResult>;
  capture(providerRef: string): Promise<{ status: "succeeded" | "pending" | "failed" }>;
  refund(providerRef: string, amount?: Money): Promise<{ refundRef: string; status: "succeeded" | "pending" }>;

  verifyWebhook(input: VerifyWebhookInput): Promise<VerifiedWebhook>;
}
```

### Adaptateur Stripe — `src/domain/payment/stripe.ts`

```ts
import Stripe from "stripe";
import type {
  PaymentProvider, CreateIntentInput, CreateIntentResult,
  VerifyWebhookInput, VerifiedWebhook,
} from "./provider";

export class StripePaymentProvider implements PaymentProvider {
  readonly name = "stripe";
  private stripe: Stripe;
  private webhookSecret: string;

  constructor(opts: { secretKey: string; webhookSecret: string }) {
    this.stripe = new Stripe(opts.secretKey, { apiVersion: "2024-06-20" });
    this.webhookSecret = opts.webhookSecret;
  }

  async createIntent(input: CreateIntentInput): Promise<CreateIntentResult> {
    const pi = await this.stripe.paymentIntents.create({
      amount: input.amount.amountMinor,
      currency: input.amount.currency.toLowerCase(),
      automatic_payment_methods: { enabled: true },
      receipt_email: input.customer.email,
      metadata: input.metadata,
    });
    return {
      providerRef: pi.id,
      clientToken: pi.client_secret ?? undefined,
      expiresAt: new Date(pi.created * 1000 + 30 * 60_000),
    };
  }

  async capture(ref: string) {
    const pi = await this.stripe.paymentIntents.retrieve(ref);
    const map = { succeeded: "succeeded" as const, processing: "pending" as const,
                  requires_payment_method: "failed" as const, canceled: "failed" as const };
    return { status: map[pi.status as keyof typeof map] ?? "pending" };
  }

  async refund(ref: string, amount?) {
    const r = await this.stripe.refunds.create({
      payment_intent: ref,
      amount: amount?.amountMinor,
    });
    return { refundRef: r.id, status: r.status === "succeeded" ? "succeeded" : "pending" };
  }

  async verifyWebhook(input: VerifyWebhookInput): Promise<VerifiedWebhook> {
    const event = this.stripe.webhooks.constructEvent(
      input.rawBody, input.headers["stripe-signature"] ?? "", this.webhookSecret,
    );
    return {
      provider: "stripe",
      eventKey: event.id,
      type: event.type,
      data: event.data.object as unknown as VerifiedWebhook["data"],
    };
  }
}
```

### Placeholder Mobile Money — `src/domain/payment/mobile-money.ts`

```ts
import type { PaymentProvider, CreateIntentInput, CreateIntentResult, VerifiedWebhook, VerifyWebhookInput } from "./provider";

// À implémenter : Orange Money / Wave / MTN MoMo. Le squelette ci-dessous
// suffit à compiler et permet de tester la bascule via env.
export class MobileMoneyPaymentProvider implements PaymentProvider {
  readonly name = "mobile_money";
  async createIntent(_i: CreateIntentInput): Promise<CreateIntentResult> {
    throw new Error("MobileMoneyProvider not implemented yet");
  }
  async capture(_r: string) { throw new Error("not implemented"); }
  async refund(_r: string)  { throw new Error("not implemented"); }
  async verifyWebhook(_i: VerifyWebhookInput): Promise<VerifiedWebhook> {
    throw new Error("not implemented");
  }
}
```

### Registry — `src/domain/payment/registry.ts`

```ts
import { StripePaymentProvider } from "./stripe";
import { MobileMoneyPaymentProvider } from "./mobile-money";
import type { PaymentProvider } from "./provider";

let cached: PaymentProvider | null = null;

export function getPaymentProvider(): PaymentProvider {
  if (cached) return cached;
  const which = process.env.PAYMENT_PROVIDER ?? "stripe";
  switch (which) {
    case "stripe":
      cached = new StripePaymentProvider({
        secretKey: required("STRIPE_SECRET_KEY"),
        webhookSecret: required("STRIPE_WEBHOOK_SECRET"),
      });
      break;
    case "mobile_money":
      cached = new MobileMoneyPaymentProvider();
      break;
    default:
      throw new Error(`Unknown PAYMENT_PROVIDER=${which}`);
  }
  return cached;
}

function required(k: string) {
  const v = process.env[k];
  if (!v) throw new Error(`Missing env ${k}`);
  return v;
}
```

**Brancher Mobile Money plus tard** : il suffit de remplacer `MobileMoneyPaymentProvider` par une implémentation réelle, sans toucher au code appelant (`src/server/checkout.ts`, `src/app/api/webhooks/*`).

---

## 4. Routes API

Toutes les routes vivent dans `src/app/api/**/route.ts`. Convention : handler exporté `POST`/`GET`/etc., enveloppe dans `withApi()` (logger + auth + parse JSON + erreur uniforme).

### Routes publiques

| Méthode | Path                                   | Params / body                                      | Auth      | Response                                  |
|---------|----------------------------------------|----------------------------------------------------|-----------|-------------------------------------------|
| GET     | `/api/health`                          | —                                                  | non       | `{ ok: true, version }`                   |
| GET     | `/api/products`                        | `?category=&q=&page=&limit=`                       | non       | `{ items: ProductDto[], total }`           |
| GET     | `/api/products/[slug]`                 | path                                               | non       | `ProductDetailDto` (variantes + stock)    |
| POST    | `/api/cart/items`                      | `{ variantId, quantity }`                          | cookie sessionKey | `{ cartId, items }`                  |
| PATCH   | `/api/cart/items/[id]`                 | `{ quantity }`                                     | cookie sessionKey | `{ items }`                          |
| DELETE  | `/api/cart/items/[id]`                 | —                                                  | cookie sessionKey | `{ items }`                          |
| GET     | `/api/cart`                            | —                                                  | cookie sessionKey | `{ id, items, subtotalMinor, totalMinor, currency }` |
| POST    | `/api/checkout`                        | `{ addressId, customer: { email, firstName, lastName, phone } }` | cookie sessionKey | `{ orderId, payment: { clientToken, redirectUrl } }` |
| GET     | `/api/orders/[id]`                     | path                                               | sessionKey OU email | `OrderDto`                            |

### Routes admin (cookie admin requis)

| Méthode | Path                                   | Body                                               | Auth     | Response                                  |
|---------|----------------------------------------|----------------------------------------------------|----------|-------------------------------------------|
| POST    | `/api/admin/auth/login`                | `{ email, password }`                              | non      | `Set-Cookie: admin_session=…; HttpOnly`    |
| POST    | `/api/admin/auth/logout`               | —                                                  | cookie   | `204`                                     |
| GET     | `/api/admin/products`                  | `?q=&page=`                                        | cookie   | `ProductDto[]`                            |
| POST    | `/api/admin/products`                  | `ProductCreateDto`                                 | cookie   | `ProductDto`                              |
| PATCH   | `/api/admin/products/[id]`             | `ProductUpdateDto`                                 | cookie   | `ProductDto`                              |
| DELETE  | `/api/admin/products/[id]`             | —                                                  | cookie   | `204` (soft: `active=false`)              |
| POST    | `/api/admin/products/[id]/variants`    | `VariantCreateDto`                                 | cookie   | `VariantDto`                              |
| PATCH   | `/api/admin/variants/[id]/stock`       | `{ quantity, reserved? }`                          | cookie   | `StockDto`                                |
| GET     | `/api/admin/orders`                    | `?status=&page=`                                   | cookie   | `OrderListDto`                            |
| PATCH   | `/api/admin/orders/[id]`               | `{ status }` (PREPARING/SHIPPED/DELIVERED/CANCELLED) | cookie | `OrderDto`                                |

### Webhooks (auth = signature provider)

| Méthode | Path                          | Auth                | Response                             |
|---------|-------------------------------|---------------------|--------------------------------------|
| POST    | `/api/webhooks/stripe`        | signature `stripe-signature` | `200 { received: true }` ou `400` |

**Note middleware** : `src/middleware.ts` ne protège QUE les pages `/admin/*` (cookie présent + pas expiré). Les routes API admin sont protégées par `withApi({ requireAdmin: true })` dans `src/lib/api.ts` qui re-vérifie la session en base (pas seulement le cookie).

---

## 5. Pages Next.js (App Router)

### Pages publiques

| Route                                    | Fichier                                | Rendu    | Description                                  |
|------------------------------------------|----------------------------------------|----------|----------------------------------------------|
| `/`                                      | `app/page.tsx`                         | SSR      | Hero + catégories + best-sellers             |
| `/products`                              | `app/(shop)/products/page.tsx`         | SSR      | Catalogue (filtre catégorie, recherche)      |
| `/products/[slug]`                       | `app/(shop)/products/[slug]/page.tsx`  | SSR      | Fiche produit, sélecteur variante            |
| `/cart`                                  | `app/(shop)/cart/page.tsx`             | Client   | Panier (state via React Query / SWR)         |
| `/checkout`                              | `app/(shop)/checkout/page.tsx`         | Client   | Adresse + Stripe Elements ou redirect MM     |
| `/checkout/success`                      | `app/(shop)/checkout/success/page.tsx` | SSR      | Confirmation `?orderId=…`                    |
| `/orders/[id]`                           | `app/(shop)/orders/[id]/page.tsx`      | SSR      | Suivi de commande                            |

### Pages admin (toutes derrière middleware)

| Route                                    | Fichier                                | Rendu    | Description                                  |
|------------------------------------------|----------------------------------------|----------|----------------------------------------------|
| `/admin/login`                           | `app/(admin)/admin/login/page.tsx`     | Client   | Formulaire login                             |
| `/admin`                                 | `app/(admin)/admin/page.tsx`           | SSR      | Dashboard (CA jour, commandes à préparer)    |
| `/admin/products`                        | `app/(admin)/admin/products/page.tsx`  | SSR+CSR  | Liste produits (table + actions)             |
| `/admin/products/new`                    | `app/(admin)/admin/products/new/page.tsx` | Client | Création produit                             |
| `/admin/products/[id]`                   | `app/(admin)/admin/products/[id]/page.tsx` | Client | Édition + gestion variantes + stock       |
| `/admin/orders`                          | `app/(admin)/admin/orders/page.tsx`    | SSR      | Liste commandes (filtre statut)              |
| `/admin/orders/[id]`                     | `app/(admin)/admin/orders/[id]/page.tsx` | SSR    | Détail + transition statut                  |

### Layouts

- `app/layout.tsx` : root — `<html lang="fr">`, police, providers (React Query, Toaster).
- `app/(shop)/layout.tsx` : header public + footer + cart-badge.
- `app/(admin)/admin/layout.tsx` : vérifie session, redirige vers `/admin/login` si absent, sidebar admin.

---

## 6. Stack technique — dépendances et versions

Pinning strict : versions exactes pour reproductibilité CI. Mises à jour via Dependabot.

### `dependencies`

```json
{
  "next": "14.2.15",
  "react": "18.3.1",
  "react-dom": "18.3.1",
  "@prisma/client": "5.20.0",
  "stripe": "16.12.0",
  "@stripe/stripe-js": "4.8.0",
  "@stripe/react-stripe-js": "2.8.1",
  "zod": "3.23.8",
  "bcryptjs": "2.4.3",
  "pino": "9.4.0",
  "pino-pretty": "11.2.2",
  "@t3-oss/env-nextjs": "0.11.1",
  "cuid": "3.0.0"
}
```

### `devDependencies`

```json
{
  "typescript": "5.5.4",
  "@types/node": "20.16.5",
  "@types/react": "18.3.5",
  "@types/react-dom": "18.3.0",
  "@types/bcryptjs": "2.4.6",
  "prisma": "5.20.0",
  "vitest": "2.1.1",
  "@vitest/coverage-v8": "2.1.1",
  "@playwright/test": "1.47.2",
  "@testing-library/react": "16.0.1",
  "@testing-library/jest-dom": "6.5.0",
  "happy-dom": "15.7.4",
  "eslint": "8.57.0",
  "eslint-config-next": "14.2.15",
  "prettier": "3.3.3",
  "tsx": "4.19.1",
  "dotenv-cli": "7.4.2"
}
```

### Justification par dépendance

| Package                       | Pourquoi                                                              |
|-------------------------------|-----------------------------------------------------------------------|
| `next` 14.2                   | App Router stable, Server Actions, `output: "standalone"` pour Docker |
| `react` 18.3                  | Concurrent features + Server Components                               |
| `@prisma/client`              | ORM type-safe, migrations versionnées, support Postgres               |
| `stripe` + `@stripe/*`        | SDK serveur (vérification webhook, PaymentIntent) + SDK client Elements |
| `zod`                         | Validation runtime des payloads API + parsing d'env                    |
| `bcryptjs`                    | Hash mots de passe admin (pure JS, pas de binding natif → Coolify OK) |
| `pino`                        | Logger JSON rapide, faible overhead en prod                           |
| `@t3-oss/env-nextjs`          | Validation des env au boot, types générés, fail-fast                  |
| `cuid`                        | Identifiants non-énumérables, plus sûr que `uuid` pour URLs publiques  |
| `vitest`                      | Rapide, même config que la prod Next, support TS natif                |
| `@playwright/test`            | E2E navigateur réel, indispensable pour Stripe Elements               |
| `happy-dom`                   | DOM léger pour tests unitaires composants                             |
| `eslint-config-next`          | Règles Next officielles                                               |

**Pas inclus volontairement** :

- `next-auth` : trop lourd pour MVP, on fait un cookie httpOnly + middleware (cf. ADR).
- `tailwindcss` : choix CSS à trancher dans un ADR séparé (non bloquant pour démarrer).
- `react-query` : pour le MVP on peut se contenter de `useState` + revalidation serveur. À ajouter si l'UX le demande.

---

## 7. Dockerfile multi-stage

```dockerfile
# syntax=docker/dockerfile:1.7
# ─── Stage 1 : deps ────────────────────────────────────────────────
FROM node:20-bookworm-slim AS deps
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends \
    openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
COPY package.json pnpm-lock.yaml* package-lock.json* ./
# Supporte pnpm OU npm ; défaut : pnpm (ajuster si npm choisi)
RUN if [ -f pnpm-lock.yaml ]; then \
      corepack enable && corepack prepare pnpm@9.12.0 --activate && \
      pnpm install --frozen-lockfile; \
    else \
      npm ci; \
    fi

# ─── Stage 2 : build ───────────────────────────────────────────────
FROM node:20-bookworm-slim AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN if [ -f pnpm-lock.yaml ]; then \
      corepack enable && corepack prepare pnpm@9.12.0 --activate && \
      pnpm prisma generate && pnpm build; \
    else \
      npx prisma generate && npm run build; \
    fi

# ─── Stage 3 : runner (image finale) ───────────────────────────────
FROM node:20-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000

RUN apt-get update && apt-get install -y --no-install-recommends \
    openssl ca-certificates curl \
 && rm -rf /var/lib/apt/lists/* \
 && groupadd --system --gid 1001 nodejs \
 && useradd --system --uid 1001 --gid nodejs nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/prisma ./prisma

USER nextjs
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS http://localhost:3000/api/health || exit 1
CMD ["node", "server.js"]
```

**Points clés** :

- `node:20-bookworm-slim` (pas Alpine) — Alpine n'a pas `bash` et certaines dépendances natives (Prisma engines, bcryptjs) y cassent.
- `output: "standalone"` activé dans `next.config.mjs` : ne copie que `node_modules` réellement utilisés (~50 MB au lieu de 350 MB).
- Migration en prod : `CMD` doit lancer `node server.js` après qu'un `prisma migrate deploy` ait été exécuté. Options :
  1. Init container Coolify qui exécute la migration avant de lancer l'app.
  2. Script `entrypoint.sh` qui fait `npx prisma migrate deploy && exec node server.js` (copier le script dans `/docker/entrypoint.sh` et l'invoquer en `CMD`).
  3. **Recommandé pour Coolify** : option 1, c'est ce que Coolify supporte nativement (champ "Command" avant démarrage).
- `HEALTHCHECK` pointe sur `/api/health` (à implémenter : ping DB + retour JSON).
- `USER nextjs` : pas de root dans le conteneur.

### Fichiers annexes

- **`.dockerignore`** : `node_modules`, `.next`, `.git`, `tests/e2e/playwright-report`, `coverage`, `.env*`.
- **`next.config.mjs`** (essentiel) :

```js
/** @type {import('next').NextConfig} */
export default {
  output: "standalone",
  experimental: { serverActions: { allowedOrigins: [process.env.NEXTAUTH_URL ?? "*"] } },
  images: { remotePatterns: [{ protocol: "https", hostname: "**" }] },
  async headers() {
    return [{
      source: "/:path*",
      headers: [
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        { key: "X-Frame-Options", value: "DENY" },
      ],
    }];
  },
};
```

---

## 8. docker-compose pour dev local

```yaml
# docker-compose.yml — dev local (Next + Postgres)
name: shop-dev

services:
  postgres:
    image: postgres:16-alpine
    restart: unless-stopped
    environment:
      POSTGRES_USER: shop
      POSTGRES_PASSWORD: shop
      POSTGRES_DB: shop
    ports:
      - "5432:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U shop -d shop"]
      interval: 5s
      timeout: 3s
      retries: 10

  app:
    build:
      context: .
      dockerfile: Dockerfile
      target: deps          # en dev on monte le code, on évite le stage runner
    command: sh -c "corepack enable && corepack prepare pnpm@9.12.0 --activate && pnpm prisma migrate dev --name init && pnpm dev"
    working_dir: /app
    environment:
      DATABASE_URL: postgresql://shop:shop@postgres:5432/shop
      NODE_ENV: development
      PAYMENT_PROVIDER: stripe
      STRIPE_SECRET_KEY: ${STRIPE_SECRET_KEY:-sk_test_dummy}
      STRIPE_WEBHOOK_SECRET: ${STRIPE_WEBHOOK_SECRET:-whsec_dummy}
      ADMIN_BOOTSTRAP_EMAIL: admin@example.com
      ADMIN_BOOTSTRAP_PASSWORD: changeme
      NEXT_PUBLIC_SITE_URL: http://localhost:3000
      LOG_LEVEL: debug
    ports:
      - "3000:3000"
    volumes:
      - .:/app
      - /app/node_modules
      - /app/.next
    depends_on:
      postgres:
        condition: service_healthy

volumes:
  pgdata:
```

**Notes** :

- L'image Postgres est Alpine ici car **le runtime Next** seulement doit éviter Alpine. Postgres officielle est fine.
- Pour faire tourner Stripe webhooks en local : `stripe listen --forward-to http://localhost:3000/api/webhooks/stripe` (CLI Stripe, hors compose).
- Pour les tests E2E Playwright : second compose `docker-compose.e2e.yml` ou lancement local hors Docker.

---

## 9. Stratégie de tests

### Pyramide

```
       ╱╲
      ╱  ╲       E2E Playwright (2-3 flux critiques)
     ╱ E2E╲      - achat complet (guest → paiement Stripe test)
    ╱──────╲     - login admin
   ╱        ╲
  ╱ Integ.   ╲   Vitest + Prisma sur Postgres jetable (Docker éphémère)
 ╱────────────╲  - checkout orchestrera payment mock
╱              ╲ - webhook idempotent
╱   Unitaires  ╲  Vitest pur (pas de DB)
───────────────── - pricing, stock, transitions order
```

### Quoi tester à quel niveau

| Niveau        | Cible                                                          | Exemples                                          |
|---------------|----------------------------------------------------------------|---------------------------------------------------|
| **Unit**      | `src/domain/**` pur                                            | `pricing.test.ts` : calcul totaux, taxes ; `stock.test.ts` : règles disponibilité ; `order.test.ts` : transitions statut autorisées |
| **Integration**| services applicatifs + Prisma réel                            | `cart.test.ts` : ajout/suppression ; `checkout.test.ts` : création order, décrément stock dans la transaction ; `webhook.test.ts` : 2e appel identique = no-op |
| **E2E**       | 2-3 flux critiques en navigateur réel                         | `browse-buy.spec.ts` (home → produit → cart → checkout Stripe test → success) ; `admin-login.spec.ts` |

### Comment mocker Prisma

Vitest peut utiliser la **vraie** base Postgres via `docker-compose up postgres -d` puis exporter `DATABASE_URL` vers une DB jetable. Entre chaque test : `TRUNCATE` toutes les tables (helper `tests/helpers/prisma-test.ts`). Avantage : aucun mock à maintenir.

Pour les tests qui n'ont pas besoin de la DB, instancier un `PrismaClient` avec une factory :

```ts
// tests/helpers/prisma-test.ts
import { PrismaClient } from "@prisma/client";

export const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DATABASE_URL_TEST } },
});

export async function resetDb() {
  const tables = ["OrderItem","Payment","Shipment","Order","CartItem","Cart",
                  "Stock","Variant","Product","Category","Address","Customer",
                  "Session","User","WebhookEvent","AuditLog"];
  await prisma.$transaction(tables.map((t) => prisma.$executeRawUnsafe(`TRUNCATE "${t}" CASCADE`)));
}
```

### Comment mocker Stripe

**Cible = interface `PaymentProvider`**, jamais Stripe directement. Les services `src/server/**` reçoivent un provider injecté.

```ts
// tests/helpers/stripe-mock.ts
import type { PaymentProvider, CreateIntentInput, CreateIntentResult, VerifiedWebhook, VerifyWebhookInput } from "@/domain/payment/provider";

export function mockPaymentProvider(overrides?: Partial<PaymentProvider>): PaymentProvider {
  return {
    name: "stripe",
    createIntent: async (_i: CreateIntentInput): Promise<CreateIntentResult> => ({
      providerRef: `pi_test_${Math.random().toString(36).slice(2)}`,
      clientToken: "cs_test_dummy",
    }),
    capture: async () => ({ status: "succeeded" }),
    refund: async (ref) => ({ refundRef: `re_test_${ref}`, status: "succeeded" }),
    verifyWebhook: async (i: VerifyWebhookInput): Promise<VerifiedWebhook> => {
      const parsed = JSON.parse(i.rawBody);
      return { provider: "stripe", eventKey: parsed.id, type: parsed.type, data: parsed.data };
    },
    ...overrides,
  };
}
```

Le `registry.ts` expose un override :

```ts
export function setPaymentProviderForTests(p: PaymentProvider) { cached = p; }
```

### Couverture cible

- Unit : > 80 % sur `src/domain/`
- Integration : tous les chemins `src/server/checkout.ts` et `webhook-handlers.ts`
- E2E : 2-3 flux, exécutés dans CI avant merge

### CI (esquisse)

```yaml
# .github/workflows/ci.yml (résumé)
jobs:
  test:
    services: { postgres: { image: postgres:16, env: { POSTGRES_PASSWORD: test }, options: --health-cmd pg_isready } }
    steps:
      - uses: actions/checkout@v4
      - run: npm ci
      - run: npx prisma migrate deploy
      - run: npm run test:unit
      - run: npm run test:integration
  e2e:
    steps:
      - run: npx playwright install --with-deps
      - run: npm run test:e2e
```

---

## 10. Variables d'environnement

Validation au boot via `@t3-oss/env-nextjs` + `zod` dans `src/lib/env.ts`. Une variable manquante ou invalide → crash au démarrage.

### Fichier `.env.example` (commit-safe)

```bash
# ─── App ──────────────────────────────────────────────
NODE_ENV=development
PORT=3000
NEXT_PUBLIC_SITE_URL=http://localhost:3000
LOG_LEVEL=info                   # trace|debug|info|warn|error

# ─── Database ─────────────────────────────────────────
DATABASE_URL=postgresql://shop:shop@localhost:5432/shop?schema=public

# ─── Auth admin ───────────────────────────────────────
ADMIN_BOOTSTRAP_EMAIL=admin@example.com
ADMIN_BOOTSTRAP_PASSWORD=changeme
SESSION_COOKIE_NAME=admin_session
SESSION_TTL_HOURS=24
BCRYPT_ROUNDS=12

# ─── Payment provider ─────────────────────────────────
PAYMENT_PROVIDER=stripe           # stripe | mobile_money
STRIPE_SECRET_KEY=sk_test_xxx
STRIPE_WEBHOOK_SECRET=whsec_xxx
STRIPE_PUBLISHABLE_KEY=pk_test_xxx     # NEXT_PUBLIC_ ci-dessous
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_xxx

# ─── Shipping (placeholder MVP) ───────────────────────
SHIPPING_FLAT_MINOR=590          # 5,90 EUR (minor units ISO-4217)
FREE_SHIPPING_THRESHOLD_MINOR=5000

# ─── Dev only ─────────────────────────────────────────
DATABASE_URL_TEST=postgresql://shop:shop@localhost:5432/shop_test?schema=public
```

### Valeurs par défaut sûres

| Variable                      | Default            | Notes sécurité                                |
|-------------------------------|--------------------|-----------------------------------------------|
| `BCRYPT_ROUNDS`               | `12`               | ~250 ms/hash sur VPS modestes                  |
| `SESSION_TTL_HOURS`           | `24`               | Re-login quotidien côté admin                  |
| `SESSION_COOKIE_NAME`         | `admin_session`    | Cookie non-deviné                             |
| Cookie flags (code)           | `HttpOnly; Secure; SameSite=Lax` | Pas accessible JS, HTTPS-only, OK pour navigations normales |
| `LOG_LEVEL`                   | `info` prod / `debug` dev | Pas de `trace` en prod                   |
| `SHIPPING_FLAT_MINOR`         | `590`              | À ajuster quand l'API transport arrive         |

### Secrets à NE PAS commit

Tout `.env*` sauf `.env.example` doit être dans `.gitignore`. En prod Coolify : variables saisies dans l'UI Coolify, **jamais** dans l'image Docker.

---

## 11. Décisions architecturales clés (ADR)

Format : contexte · décision · conséquence. Gardés dans `docs/decisions/0001-…md` ; ici version courte pour démarrer.

### ADR-001 — Auth admin via cookie httpOnly + middleware, pas NextAuth

**Contexte** : MVP, un seul rôle (`ADMIN`), un seul écran de login.
**Décision** : cookie `admin_session` (HttpOnly, Secure, SameSite=Lax) contenant un token opaque. Validation = lookup `Session` en DB. Middleware Next protège `/admin/*` ; les routes API re-vérifient côté serveur.
**Conséquence** : on évite la complexité et les versions de NextAuth ; pas de providers OAuth à gérer ; tout reste sous contrôle. Si on ajoute "compte client" plus tard, on créera un second cookie `customer_session`.

### ADR-002 — `PaymentProvider` : interface profonde, Stripe en premier adaptateur

**Contexte** : le marché cible utilise Mobile Money, mais Stripe permet de démarrer immédiatement. Le code métier ne doit pas dépendre du provider.
**Décision** : interface `PaymentProvider` (4 méthodes : `createIntent`, `capture`, `refund`, `verifyWebhook`) dans `src/domain/payment/`. Stripe implémenté ; Mobile Money stubbé. Sélection via env `PAYMENT_PROVIDER`.
**Conséquence** : checkout, webhooks et refunds n'importent jamais `stripe` directement → bascule de provider = zéro changement dans `src/server/**`.

### ADR-003 — Prix en minor units ISO-4217 (Int) partout, devise en string ISO-4217

**Contexte** : les `Float` provoquent des erreurs d'arrondi cumulatives sur les totaux ; « centimes » est ambigu pour les devises à 0 décimale (XAF, XOF, JPY, KRW) et constitue une fuite d'implémentation EUR dans le contrat de données.
**Décision** : tous les champs prix sont des `Int` minor units ISO-4217 de la devise portée par la ligne (`Variant`, `Cart`, `Order`, `OrderItem`, `Payment`). Le module `src/domain/money.ts` est l'unique frontière entre forme humaine et forme stockée (cf. ADR dédiée `docs/decisions/0003-prix-minor-units.md`). Affichage = helper `<Money amountMinor={...} currency="EUR" />` qui formate locale.
**Conséquence** : impossibilité de `199.999999` ; formatage cohérent quelle que soit la devise (XAF n'a pas de décimale) ; export comptable simplifié (entier). La devise n'a **pas** de défaut (`Order.currency` et `Cart.currency` sont obligatoires, affectées depuis `SHOP_CURRENCY` à la création — DAT §10) : une boutique qui vend en XAF ne peut pas produire silencieusement une commande en EUR.

### ADR-004 — Stock décrémenté à la confirmation de paiement, pas au panier

**Contexte** : décrémenter au panier = fausse rupture visible. Décrémenter au paiement = pas de stock réservé pour les abandons.
**Décision** : `Stock.reserved` monte au passage en `PENDING_PAYMENT`, descend + `Stock.quantity` descend au webhook `payment_intent.succeeded`. Tout est fait dans une seule `prisma.$transaction` pour éviter les races.
**Conséquence** : un panier peut promettre plus que le stock réel ; on prévient l'utilisateur au checkout si `available < requested` ; on annule la commande si le webhook n'arrive pas dans un délai raisonnable.

### ADR-005 — Webhooks Stripe idempotents via table `WebhookEvent`

**Contexte** : Stripe peut renvoyer le même événement plusieurs fois (retry, replay manuel).
**Décision** : insertion préalable dans `WebhookEvent` avec contrainte unique `(provider, eventKey)`. Si conflit → `200 { received: true }` immédiat, pas de re-traitement.
**Conséquence** : double paiement impossible ; replay manuel d'un opérateur = no-op. La table sert aussi d'audit des événements reçus.

---

## Annexe — checklist "premier commit"

Pour un dev qui démarre lundi matin :

```bash
git clone <repo> shop && cd shop
cp .env.example .env
docker compose up -d postgres
pnpm install                # ou npm install
pnpm prisma migrate dev --name init
pnpm prisma db seed         # crée 1 admin + 3 catégories + 5 produits
pnpm dev                    # http://localhost:3000
# dans un autre terminal :
stripe listen --forward-to http://localhost:3000/api/webhooks/stripe
pnpm test                   # unit + integration
pnpm test:e2e               # playwright
```

**Premier ticket** : implémenter `src/domain/pricing.ts` (test inclus), `src/domain/payment/provider.ts`, l'adaptateur Stripe, puis `POST /api/checkout`. Tout le reste de l'arbo peut rester vide temporairement.