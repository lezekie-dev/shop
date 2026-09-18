import type { ReactNode } from "react";

import { getCurrentCustomer } from "@/lib/customer-auth";
import { AccountNav } from "@/ui/components/customer/account-nav";

/**
 * Enveloppe de l'espace client.
 *
 * Le layout lit la session pour savoir s'il doit afficher le bouton de
 * déconnexion ; il ne protège RIEN. Chaque page appelle `requireCustomer()`
 * de son côté : un layout n'est pas une garde (Next peut le rendre en parallèle
 * de la page, et une nouvelle page ajoutée dans le dossier n'hériterait
 * d'aucune vérification si la garde vivait ici).
 */
export default async function CompteLayout({ children }: { children: ReactNode }) {
  const customer = await getCurrentCustomer();
  const displayName = customer ? (customer.firstName ?? customer.email) : null;

  return (
    <>
      <AccountNav isAuthenticated={customer !== null} displayName={displayName} />
      {children}
    </>
  );
}
