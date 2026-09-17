import { config } from "dotenv";

// .env.test en priorité (peut surcharger DATABASE_URL pour pointer vers shop_test),
// puis .env par défaut.
config({ path: ".env.test" });
config({ path: ".env" });
