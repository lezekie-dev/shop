import Link from "next/link";

import { requireCapability } from "@/server/guards";
import {
  emailTemplateLabel,
  getOutboxEmail,
  listOutboxEmails,
} from "@/server/admin-products";
import { DataTable } from "@/ui/components/admin/data-table";
import { formatDateTime } from "@/ui/format";
import {
  IconEmails,
} from "@/ui/components/icons";

export const dynamic = "force-dynamic";

type SearchParams = { email?: string };

/**
 * Boîte d'envoi des emails transactionnels (table `EmailOutbox`).
 *
 * Aucun SMTP n'est configuré : chaque email « envoyé » est écrit en base et
 * consultable ici. La liste montre l'envoi, `?email=<id>` en affiche le corps
 * texte complet, tel que le client l'aurait reçu.
 */
export default async function AdminEmailsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  // Boîte d'envoi des emails de commande : même niveau d'information que la
  // liste des commandes, donc `orders:read` (ADMIN et STAFF).
  await requireCapability("orders:read");

  const emails = await listOutboxEmails();
  const selectedId = typeof searchParams.email === "string" ? searchParams.email : null;
  const selected = selectedId ? await getOutboxEmail(selectedId) : null;

  return (
    <div className="admin-page">
      <div className="admin-page__head enter enter-1">
        <div>
          <h1 className="admin-page__title">Emails envoyés</h1>
          <p className="admin-page__sub">
            {emails.length} email{emails.length > 1 ? "s" : ""} dans la boîte d&apos;envoi ·
            aucun SMTP configuré, tout est consultable ici.
          </p>
        </div>
        <Link href="/admin/orders" className="btn btn-secondary">
          Voir les commandes
        </Link>
      </div>

      {selected ? (
        <section className="card enter enter-2">
          <div className="admin-section__head">
            <h2 className="card__title">{selected.subject}</h2>
            <Link href="/admin/emails">Fermer le détail</Link>
          </div>
          <div className="kv">
            <div className="kv__row">
              <span className="kv__label">Destinataire</span>
              <span className="kv__value kv__value--num">{selected.to}</span>
            </div>
            <div className="kv__row">
              <span className="kv__label">Modèle</span>
              <span className="kv__value">{emailTemplateLabel(selected.template)}</span>
            </div>
            <div className="kv__row">
              <span className="kv__label">Envoyé le</span>
              <span className="kv__value kv__value--num">{formatDateTime(selected.sentAt)}</span>
            </div>
            <div className="kv__row">
              <span className="kv__label">Canal</span>
              <span className="kv__value">
                <span className="badge badge-neutral">
                  <span aria-hidden>✉</span>
                  {selected.provider}
                </span>
              </span>
            </div>
            {selected.orderId ? (
              <div className="kv__row">
                <span className="kv__label">Commande liée</span>
                <span className="kv__value">
                  <Link href={`/admin/orders/${selected.orderId}`}>Ouvrir la commande →</Link>
                </span>
              </div>
            ) : null}
          </div>
          <h3 style={{ marginTop: "var(--sp-5)", marginBottom: "var(--sp-3)" }}>
            Contenu reçu par le client
          </h3>
          <pre className="mail-body">{selected.bodyText}</pre>
        </section>
      ) : null}

      <div className="enter enter-3">
        <DataTable
          caption="Emails transactionnels de la boîte d'envoi, du plus récent au plus ancien"
          rows={emails}
          getRowKey={(row) => row.id}
          rowHref={(row) => `/admin/emails?email=${row.id}`}
          rowLabel={(row) => `Lire l'email « ${row.subject} »`}
          emptyState={
            <div className="empty-state">
              <IconEmails className="empty-state__icon" />
              <p className="empty-state__title">Aucun email envoyé</p>
              <p className="empty-state__text">
                La boîte d&apos;envoi est vide. Un email de confirmation part dès qu&apos;une
                commande est payée, et un email d&apos;expédition dès qu&apos;elle est marquée
                expédiée.
              </p>
              <div className="empty-state__actions">
                <Link href="/admin/orders" className="btn btn-primary">
                  Voir les commandes
                </Link>
              </div>
            </div>
          }
          columns={[
            {
              key: "sentAt",
              header: "Date",
              nowrap: true,
              render: (row) => <span className="num">{formatDateTime(row.sentAt)}</span>,
            },
            {
              key: "to",
              header: "Destinataire",
              nowrap: true,
              render: (row) => <span className="num">{row.to}</span>,
            },
            {
              key: "subject",
              header: "Sujet",
              render: (row) => <span>{row.subject}</span>,
            },
            {
              key: "template",
              header: "Modèle",
              render: (row) => (
                <span className="badge badge-neutral">
                  <span aria-hidden>✉</span>
                  {emailTemplateLabel(row.template)}
                </span>
              ),
            },
            {
              key: "action",
              header: "Action",
              align: "right",
              nowrap: true,
              render: (row) => <Link href={`/admin/emails?email=${row.id}`}>Lire →</Link>,
            },
          ]}
        />
      </div>
    </div>
  );
}
