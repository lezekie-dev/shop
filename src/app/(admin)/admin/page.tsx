import { requireAdmin } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function AdminDashboardPage() {
  const user = await requireAdmin();
  return (
    <section>
      <h1 style={{ marginTop: "1.5rem" }}>Bienvenue admin</h1>
      <p style={{ color: "#555" }}>Connecté en tant que {user.email}.</p>
      <p style={{ color: "#777" }}>
        Le tableau de bord complet (commandes, produits, statistiques) arrive aux
        sprints 3 et 4.
      </p>
      <form action="/api/admin/logout" method="post" style={{ marginTop: "1rem" }}>
        <button
          type="submit"
          style={{
            padding: "0.4rem 0.75rem",
            background: "#fff",
            border: "1px solid #ccc",
            borderRadius: 6,
            cursor: "pointer",
          }}
        >
          Se déconnecter
        </button>
      </form>
    </section>
  );
}
