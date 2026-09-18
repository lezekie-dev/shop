import Link from "next/link";
import { redirect } from "next/navigation";

import { getCurrentCustomer } from "@/lib/customer-auth";
import { CustomerLoginForm } from "@/ui/components/customer/customer-login-form";

export const dynamic = "force-dynamic";

/** Connexion client. */
export default async function CustomerLoginPage() {
  // Déjà connecté : la page de connexion n'a plus rien à proposer.
  const customer = await getCurrentCustomer();
  if (customer) redirect("/compte");

  return (
    <div className="page page--slim">
      <div className="page__head enter enter-1">
        <div>
          <p className="eyebrow">Mon compte</p>
          <h1 className="page__title">Me connecter</h1>
          <p className="page__sub">
            Retrouvez vos commandes, leur suivi d&apos;expédition et votre carnet d&apos;adresses.
          </p>
        </div>
      </div>

      <div className="section enter enter-2">
        <CustomerLoginForm />
      </div>

      <p className="note enter enter-3">
        Commande passée en invité ? Votre lien de suivi reste valable :{" "}
        <Link href="/products">aucun compte n&apos;est nécessaire</Link> pour suivre une commande
        déjà passée.
      </p>
    </div>
  );
}
