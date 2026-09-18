-- Ajoute un jeton d'accès non devinable sur Order.
--
-- Pourquoi : la page et l'API `/orders/[id]` étaient accessibles par simple
-- connaissance de l'id technique (cuid), ce qui exposait email, téléphone et
-- adresse complète du client à quiconque obtenait l'URL. L'id n'est pas
-- énumérable, mais « l'URL est le secret » ne tient pas dès qu'un lien fuit.
--
-- Le backfill est nécessaire : la colonne est NOT NULL et des commandes
-- existent déjà en base. On génère 32 octets aléatoires encodés en hex
-- (64 caractères) via gen_random_bytes de pgcrypto.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE "Order" ADD COLUMN "accessToken" TEXT;

UPDATE "Order"
SET "accessToken" = encode(gen_random_bytes(32), 'hex')
WHERE "accessToken" IS NULL;

ALTER TABLE "Order" ALTER COLUMN "accessToken" SET NOT NULL;

CREATE UNIQUE INDEX "Order_accessToken_key" ON "Order"("accessToken");
