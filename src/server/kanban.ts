import { readFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * Lecture du kanban depuis sa source unique.
 *
 * La page `/team` et le rendu image (`scripts/kanban-render.mjs`) lisent le
 * MÊME fichier : le texte affiché et l'image ne peuvent donc pas diverger.
 * Écrire le board en dur dans le JSX aurait créé deux vérités, dont une
 * oubliée à la première mise à jour.
 *
 * Le fichier est lu à chaque requête (rendu dynamique) : un kanban périmé est
 * pire qu'aucun kanban, puisqu'il affirme un état faux.
 */

export type KanbanColumn = {
  id: string;
  label: string;
  hint: string;
  wip?: string;
};

export type KanbanCard = {
  col: string;
  id: string;
  title: string;
  team: string;
  proof: string;
};

export type KanbanTeamMember = { role: string; who: string; scope: string };
export type KanbanDecision = { id: string; q: string; a: string };

export type KanbanData = {
  updatedAt: string;
  columns: KanbanColumn[];
  team: KanbanTeamMember[];
  cards: KanbanCard[];
  decisions: KanbanDecision[];
};

export async function readKanbanData(): Promise<KanbanData> {
  const path = join(process.cwd(), "docs", "team", "kanban-data.json");
  const raw = await readFile(path, "utf8");
  const parsed = JSON.parse(raw) as Partial<KanbanData>;

  // Garde-fous minimaux : un JSON tronqué afficherait une page vide sans
  // expliquer pourquoi, ce qui est le pire des cas pour un tableau de bord.
  if (!Array.isArray(parsed.columns) || !Array.isArray(parsed.cards)) {
    throw new Error("kanban-data.json : 'columns' et 'cards' sont requis");
  }

  return {
    updatedAt: parsed.updatedAt ?? "",
    columns: parsed.columns,
    team: parsed.team ?? [],
    cards: parsed.cards,
    decisions: parsed.decisions ?? [],
  };
}
