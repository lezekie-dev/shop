import Link from "next/link";

import { requireCustomer } from "@/lib/customer-auth";
import { listCustomerAddresses } from "@/server/customer-account";
import { AddressBook } from "@/ui/components/customer/address-book";

export const dynamic = "force-dynamic";

/**
 * Carnet d'adresses du client connecté.
 *
 * Lecture faite côté serveur (donc sous le `customerId` de la session) et
 * mutations déléguées au composant client, qui rappelle l'API — la page ne
 * fournit que l'état initial, ce qui garde un premier rendu utile même sans
 * JavaScript.
 */
export default async function AccountAddressesPage() {
  const customer = await requireCustomer("/compte/adresses");
  const addresses = await listCustomerAddresses(customer.id);

  return (
    <div className="page">
      <div className="page__head enter enter-1">
        <div>
          <p className="eyebrow">Mon compte</p>
          <h1 className="page__title">Mon carnet d&apos;adresses</h1>
          <p className="page__sub">
            {addresses.length === 0
              ? "Aucune adresse enregistrée pour le moment."
              : `${addresses.length} adresse${addresses.length > 1 ? "s" : ""} enregistrée${addresses.length > 1 ? "s" : ""}.`}
          </p>
        </div>
      </div>

      <AddressBook initialAddresses={addresses} />

      <p className="note enter enter-3">
        Une adresse utilisée par une commande ne peut pas être supprimée : la commande doit garder
        l&apos;adresse où elle a été livrée. Modifiez-la si elle n&apos;est plus à jour.{" "}
        <Link href="/compte">Retour à mes commandes</Link>
      </p>
    </div>
  );
}
