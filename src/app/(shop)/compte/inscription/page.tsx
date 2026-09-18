import { redirect } from "next/navigation";

import { getCurrentCustomer } from "@/lib/customer-auth";
import { CustomerRegisterForm } from "@/ui/components/customer/customer-register-form";

export const dynamic = "force-dynamic";

/**
 * Création de compte client.
 *
 * Le cas « client déjà venu en invité » est expliqué dans la page : c'est la
 * question que se pose tout visiteur qui a déjà commandé ici, et y répondre
 * évite qu'il crée un second compte avec une autre adresse email.
 */
export default async function CustomerRegisterPage() {
  const customer = await getCurrentCustomer();
  if (customer) redirect("/compte");

  return (
    <div className="page page--slim">
      <div className="page__head enter enter-1">
        <div>
          <p className="eyebrow">Mon compte</p>
          <h1 className="page__title">Créer mon compte</h1>
          <p className="page__sub">
            Suivi de vos commandes et adresses de livraison au même endroit.
          </p>
        </div>
      </div>

      <div className="notice enter enter-2">
        <p className="notice__title">Vous avez déjà commandé sans compte ?</p>
        <p>
          Indiquez le <strong>même email</strong> qu&apos;au moment de la commande : votre compte
          est rattaché à votre fiche client, et votre historique de commandes reste intact. Aucun
          nouveau fichier n&apos;est créé.
        </p>
      </div>

      <div className="section enter enter-3">
        <CustomerRegisterForm />
      </div>
    </div>
  );
}
