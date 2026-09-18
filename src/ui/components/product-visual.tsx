import Image from "next/image";

/**
 * Visuel produit.
 *
 * `width`/`height` sont toujours fournis (ceux stockés en base) pour que le
 * navigateur réserve la place AVANT le chargement : sans dimensions, la page
 * saute quand l'image arrive — très visible sur mobile en 3G, où c'est
 * justement la cible.
 *
 * `alt` est obligatoire par signature : un visuel sans alternative textuelle
 * est inaccessible aux lecteurs d'écran, et un catalogue e-commerce en est
 * plein. On ne laisse pas la porte ouverte à un `alt=""` par oubli.
 *
 * Pas d'image ? On rend un cadre avec le nom du produit plutôt qu'un carré
 * cassé : le catalogue reste lisible même si le marchand n'a pas encore
 * téléversé ses photos.
 */
export function ProductVisual({
  url,
  alt,
  productName,
  width = 800,
  height = 800,
  sizes = "(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw",
  priority = false,
  className,
}: {
  url: string | null;
  alt: string;
  productName: string;
  width?: number;
  height?: number;
  sizes?: string;
  priority?: boolean;
  className?: string;
}) {
  if (!url) {
    return (
      <div className={`product-visual product-visual--empty ${className ?? ""}`}>
        <span className="product-visual__placeholder" aria-hidden>
          📦
        </span>
        <span className="sr-only">Aucun visuel pour {productName}</span>
      </div>
    );
  }

  return (
    <div className={`product-visual ${className ?? ""}`}>
      <Image
        src={url}
        alt={alt}
        width={width}
        height={height}
        sizes={sizes}
        priority={priority}
        className="product-visual__img"
      />
    </div>
  );
}
