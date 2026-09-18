import { z } from "zod";

/**
 * Schéma d'adresse du carnet client.
 *
 * Partagé par les routes de création et d'édition : deux schémas divergents
 * finiraient par accepter une adresse à la création et la refuser à l'édition.
 * Il vit dans `lib/` et non dans une `route.ts` — Next.js refuse tout export
 * qui n'est pas un handler ou une option de route dans ces fichiers.
 *
 * Les bornes reprennent celles du checkout : une adresse saisie ici doit
 * pouvoir repartir telle quelle dans une commande.
 */
export const addressBodySchema = z.object({
  label: z.string().trim().max(40).optional(),
  line1: z.string().trim().min(1, "Adresse requise").max(200),
  line2: z.string().trim().max(200).optional(),
  city: z.string().trim().min(1, "Ville requise").max(120),
  postalCode: z.string().trim().min(1, "Code postal requis").max(20),
  country: z
    .string()
    .trim()
    .length(2, "Code pays à deux lettres")
    .transform((value) => value.toUpperCase()),
  phone: z.string().trim().min(1).max(40).optional(),
  isDefault: z.boolean().optional(),
});

export type AddressBody = z.infer<typeof addressBodySchema>;
