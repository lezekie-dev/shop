import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts", "tests/integration/**/*.test.ts"],
    testTimeout: 30_000,
    // Les hooks `beforeEach` font un TRUNCATE de toutes les tables. Quand un
    // second process (agent, run parallèle, CI) travaille sur la même
    // DATABASE_URL, le TRUNCATE attend les verrous et dépasse le défaut de
    // 10 s → échec « Hook timed out » sans rapport avec le test lui-même.
    hookTimeout: 60_000,
    // Les tests d'intégration partagent la même DB Postgres et truncent
    // toutes les tables en beforeEach. Si deux fichiers s'exécutent en
    // parallèle, le TRUNCATE d'un fichier interrompt les requêtes de
    // l'autre → 10s hook timeouts et "Argument `where` ... needs at least
    // one of id or number" (sur des rows déjà effacées).
    // On force donc l'exécution série : un fichier à la fois.
    fileParallelism: false,
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
    // Charge .env.test (prioritaire) puis .env, avant tout import applicatif.
    // Sans ça, `src/lib/env.ts` jette au premier import parce que zod ne
    // trouve ni DATABASE_URL ni SESSION_SECRET.
    setupFiles: ["./tests/helpers/setup-env.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  // Le tsconfig est en `"jsx": "preserve"` (Next compile le JSX lui-même), donc
  // esbuild retombe par défaut sur le runtime JSX « classique », qui exige un
  // `React` global — absent en test. On aligne explicitement Vitest sur le
  // runtime AUTOMATIQUE (celui qu'utilise Next en production) pour qu'un test
  // puisse importer un composant `.tsx` (page serveur, badge, icône) sans
  // bricolage de global. Sans ça : « ReferenceError: React is not defined ».
  esbuild: {
    jsx: "automatic",
  },
});
