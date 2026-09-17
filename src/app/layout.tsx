import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Shop",
  description: "Boutique en ligne — catalogue de produits physiques",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="fr">
      <body
        style={{
          margin: 0,
          fontFamily:
            "system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
          background: "#fafafa",
          color: "#111",
          lineHeight: 1.5,
        }}
      >
        <header
          style={{
            background: "#fff",
            borderBottom: "1px solid #e5e5e5",
            padding: "0.75rem 1rem",
            display: "flex",
            gap: "1rem",
            alignItems: "center",
          }}
        >
          <a href="/" style={{ fontWeight: 700, textDecoration: "none", color: "#111" }}>
            Shop
          </a>
          <nav style={{ display: "flex", gap: "0.75rem", fontSize: "0.95rem" }}>
            <a href="/products">Catalogue</a>
            <a href="/admin/login" style={{ marginLeft: "auto", color: "#666" }}>
            Admin
            </a>
          </nav>
        </header>
        <main style={{ maxWidth: 960, margin: "0 auto", padding: "1rem" }}>{children}</main>
      </body>
    </html>
  );
}
