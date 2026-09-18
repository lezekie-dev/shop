#!/usr/bin/env bash
#
# Restauration d'une sauvegarde produite par `scripts/backup-db.sh`.
#
# ─── POURQUOI CE SCRIPT EXISTE ────────────────────────────────────────
# Une restauration ne se joue pas « à peu près » au moment où la boutique est
# par terre : les commandes sont saisies à la main dans une console à 3 h du
# matin. Ce script rend la procédure EXÉCUTABLE et VÉRIFIÉE : il refuse les
# cibles dangereuses, contrôle l'intégrité du dump avant d'écrire quoi que ce
# soit, restaure, puis COMPARE les compteurs de la base restaurée à ceux de la
# base source et vérifie que les visuels produit existent sur le disque.
#
# ─── GARDE-FOU ────────────────────────────────────────────────────────
# Restaurer par-dessus la base de production (`shop`) écrase les commandes
# passées depuis la sauvegarde. C'est parfois ce qu'on veut (perte de données),
# mais jamais par accident : la cible `shop` est REFUSÉE sauf `--allow-live`.
#
# Usage :
#   scripts/restore-db.sh <dump.dump.gz> <base_cible> [--create] [--media <archive.tar.gz>] [--allow-live]
#
# Exemple (procédure RUNBOOK §5, restauration de contrôle) :
#   scripts/restore-db.sh /var/backups/shop/shop-20260918-150000.dump.gz shop_restore_test --create
#
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="${APP_DIR:-$(cd "$SCRIPT_DIR/.." && pwd)}"
DB_CONTAINER="${DB_CONTAINER:-shop-db}"
DB_USER="${DB_USER:-shop}"
DB_NAME="${DB_NAME:-shop}"
# Tables comparées entre source et restauration : les volumes qui comptent pour
# le marchand (ce qu'il vend, ses clients, ses commandes, ses photos). S'il faut
# en ajouter une, c'est ici — et la sortie du runbook doit être refaite.
VERIFY_TABLES=("Order" "Product" "Customer" "ProductImage" "JobRun")

usage() {
  sed -n '2,30p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
  exit "${1:-1}"
}

DUMP_FILE="${1:-}"
TARGET_DB="${2:-}"
shift 2 2>/dev/null || true

CREATE=0
ALLOW_LIVE=0
MEDIA_ARCHIVE=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --create) CREATE=1 ;;
    --allow-live) ALLOW_LIVE=1 ;;
    --media) MEDIA_ARCHIVE="${2:-}"; shift ;;
    -h|--help) usage 0 ;;
    *) echo "Option inconnue : $1" >&2; usage 1 ;;
  esac
  shift
done

[ -n "$DUMP_FILE" ] && [ -n "$TARGET_DB" ] || usage 1

START_EPOCH="$(date +%s)"
log() { printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"; }
die() { log "REFUS : $*"; exit 1; }

# ─────────────────────────────────────────────────────────────────────
# 1. Contrôles avant toute écriture
# ─────────────────────────────────────────────────────────────────────
[ -f "$DUMP_FILE" ] || die "fichier de sauvegarde introuvable : $DUMP_FILE"
[ -s "$DUMP_FILE" ] || die "fichier de sauvegarde vide : $DUMP_FILE"

if [ "$TARGET_DB" = "$DB_NAME" ] && [ "$ALLOW_LIVE" -eq 0 ]; then
  die "la cible '$TARGET_DB' est la base de PRODUCTION. Restaurez dans une base jetable, ou passez --allow-live en connaissance de cause (les commandes postérieures à la sauvegarde seront perdues)."
fi

docker inspect "$DB_CONTAINER" > /dev/null 2>&1 || die "conteneur Postgres '$DB_CONTAINER' introuvable"

# Intégrité AVANT d'écrire : si le dump est illisible, on veut le savoir avant
# d'avoir vidé la base cible, pas après.
log "Vérification du sommaire du dump…"
if ! gunzip -c "$DUMP_FILE" | docker exec -i "$DB_CONTAINER" pg_restore --list > /dev/null; then
  die "dump illisible ($DUMP_FILE) — sauvegarde inutilisable, essayez la précédente"
fi
log "Dump lisible."

# ─────────────────────────────────────────────────────────────────────
# 2. Base cible
# ─────────────────────────────────────────────────────────────────────
if [ "$CREATE" -eq 1 ]; then
  if docker exec "$DB_CONTAINER" psql -U "$DB_USER" -d postgres -tAc \
    "SELECT 1 FROM pg_database WHERE datname = '$TARGET_DB';" | grep -q 1; then
    log "Base '$TARGET_DB' déjà présente — la restauration écrasera ses objets."
  else
    docker exec "$DB_CONTAINER" psql -U "$DB_USER" -d postgres -q -c \
      "CREATE DATABASE \"$TARGET_DB\" OWNER \"$DB_USER\";"
    log "Base '$TARGET_DB' créée."
  fi
fi

# ─────────────────────────────────────────────────────────────────────
# 3. Restauration
# ─────────────────────────────────────────────────────────────────────
# `--clean --if-exists` : la restauration est REJOUABLE. Sans ça, un second
# essai échoue sur des objets déjà présents et on croit à un dump corrompu.
# `--no-owner --no-privileges` : le dump se restaure quel que soit le rôle
# utilisé, ce qui évite de dépendre des rôles du serveur d'origine.
log "Restauration de $(basename "$DUMP_FILE") dans '$TARGET_DB'…"
set +e
gunzip -c "$DUMP_FILE" | docker exec -i "$DB_CONTAINER" pg_restore \
  -U "$DB_USER" -d "$TARGET_DB" --no-owner --no-privileges --clean --if-exists 2> >(sed 's/^/    pg_restore: /' >&2)
RESTORE_RC=$?
set -e
RESTORE_SECONDS="$(( $(date +%s) - START_EPOCH ))"

if [ "$RESTORE_RC" -ne 0 ]; then
  # pg_restore sort parfois non nul sur des avertissements bénins ; on le dit
  # et on laisse la vérification des données trancher (étapes 4 et 5).
  log "AVERTISSEMENT : pg_restore a terminé avec le code $RESTORE_RC — vérifiez les compteurs ci-dessous."
else
  log "Restauration terminée en ${RESTORE_SECONDS}s (code 0)."
fi

# ─────────────────────────────────────────────────────────────────────
# 4. Vérification : les données sont là, comparées à la base source
# ─────────────────────────────────────────────────────────────────────
count_of() {
  docker exec "$DB_CONTAINER" psql -U "$DB_USER" -d "$1" -tAc "SELECT count(*) FROM \"$2\";" 2>/dev/null || echo "?"
}

log "Comparaison des compteurs (source $DB_NAME → cible $TARGET_DB) :"
printf '    %-14s %10s %10s %s\n' "TABLE" "SOURCE" "RESTAURÉ" "ÉTAT"
MISMATCH=0
for table in "${VERIFY_TABLES[@]}"; do
  source_count="$(count_of "$DB_NAME" "$table")"
  target_count="$(count_of "$TARGET_DB" "$table")"
  state="OK"
  if [ "$source_count" != "$target_count" ]; then
    # Un écart n'est pas forcément une erreur (la production a pu écrire entre
    # la sauvegarde et la restauration) : on le SIGNALE sans bloquer.
    state="ÉCART (production modifiée depuis la sauvegarde ?)"
    MISMATCH=$((MISMATCH + 1))
  fi
  printf '    %-14s %10s %10s %s\n' "$table" "$source_count" "$target_count" "$state"
done

# ─────────────────────────────────────────────────────────────────────
# 5. Vérification : les visuels produit existent bien sur le disque
# ─────────────────────────────────────────────────────────────────────
# Une base restaurée dont les images manquent, c'est une boutique qui paraît
# cassée. On compare chaque `ProductImage.url` à un fichier réel sous
# `public/` : c'est la vérification « présence des fichiers images » du PO.
if [ -n "$MEDIA_ARCHIVE" ]; then
  [ -f "$MEDIA_ARCHIVE" ] || die "archive de fichiers introuvable : $MEDIA_ARCHIVE"
  log "Restauration des fichiers depuis $(basename "$MEDIA_ARCHIVE")…"
  tar -xzf "$MEDIA_ARCHIVE" -C "$APP_DIR"
  log "Fichiers extraits dans $APP_DIR."
fi

log "Vérification des visuels produit référencés par la base restaurée :"
MISSING_IMAGES=0
TOTAL_IMAGES=0
while IFS= read -r url; do
  [ -n "$url" ] || continue
  TOTAL_IMAGES=$((TOTAL_IMAGES + 1))
  # Seules les URL locales (commençant par /) sont vérifiables sur le disque.
  case "$url" in
    /*)
      if [ -f "$APP_DIR/public$url" ]; then
        printf '    ✓ %s\n' "$url"
      else
        printf '    ✗ %s (fichier absent : %s)\n' "$url" "$APP_DIR/public$url"
        MISSING_IMAGES=$((MISSING_IMAGES + 1))
      fi
      ;;
    *) printf '    – %s (URL externe, non vérifiable sur le disque)\n' "$url" ;;
  esac
done < <(docker exec "$DB_CONTAINER" psql -U "$DB_USER" -d "$TARGET_DB" -tAc 'SELECT url FROM "ProductImage" ORDER BY url;' 2>/dev/null)

TOTAL_SECONDS="$(( $(date +%s) - START_EPOCH ))"
log "Vérification terminée : ${TOTAL_IMAGES} visuel(s), ${MISSING_IMAGES} manquant(s), ${MISMATCH} écart(s) de compteur."
log "Durée totale de la restauration de contrôle : ${TOTAL_SECONDS}s (objectif du PO : < 1 h)."

if [ "$MISSING_IMAGES" -gt 0 ] || [ "$MISMATCH" -gt 0 ] || [ "$RESTORE_RC" -ne 0 ]; then
  log "Résultat : À VÉRIFIER — ne déclarez pas la restauration réussie avant d'avoir expliqué les écarts."
  exit 1
fi

log "Résultat : RESTAURATION VÉRIFIÉE (compteurs identiques, visuels présents)."
log "Rappelez-vous de supprimer la base de contrôle si elle était jetable :"
log "  docker exec $DB_CONTAINER psql -U $DB_USER -d postgres -c 'DROP DATABASE \"$TARGET_DB\";'"
