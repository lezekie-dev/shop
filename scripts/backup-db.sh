#!/usr/bin/env bash
#
# Sauvegarde de la boutique (base PostgreSQL + dossier des téléversements).
#
# ─── POURQUOI CE SCRIPT ───────────────────────────────────────────────
# « Une sauvegarde qui n'a jamais été restaurée n'est pas une sauvegarde »
# (PO, lot J). Ce script produit une sauvegarde VÉRIFIÉE (le dump est relu par
# `pg_restore --list` avant d'être conservé), la PURGE au-delà de la rétention,
# et laisse une TRACE visible dans le back-office. La restauration est pratiquée
# par `scripts/restore-db.sh` et la procédure testée est décrite dans
# `docs/team/RUNBOOK.md` §5.
#
# ─── CONTRAINTES DU PROJET ────────────────────────────────────────────
# Aucun service tiers (pas de S3, pas de compte à créer) : la sauvegarde vit
# dans un répertoire LOCAL, en dehors du conteneur applicatif. La contrepartie
# est assumée et écrite dans le runbook : un VPS perdu = sauvegardes perdues,
# il faut déposer les fichiers ailleurs (disque externe, autre machine) si
# cette perte devient inacceptable — c'est une décision d'exploitation, pas
# une décision de code.
#
# ─── TRACE : JobRun ET fichier de log ─────────────────────────────────
# Les DEUX, parce qu'ils ne servent pas les mêmes personnes :
#   - une ligne `JobRun` (name = "backup-db") rend l'exécution visible dans
#     `/admin/taches`, sans SSH — c'est ce que demande K10 ;
#   - une ligne horodatée dans `backup.log` reste lisible si la BASE est
#     justement le problème (le cas où l'on a le plus besoin de savoir si le
#     dump a échoué), et c'est ce que lit `cron` quand il envoie un mail.
#
# ─── PLANIFICATION (crontab, utilisateur root) ────────────────────────
#   # Sauvegarde quotidienne à 03:15, trace dans un log dédié
#   15 3 * * * /root/work/shop/scripts/backup-db.sh >> /var/log/shop-backup.log 2>&1
#
# ─── VARIABLES (toutes optionnelles, valeurs par défaut entre parenthèses) ──
#   BACKUP_DIR      répertoire de destination   (/var/backups/shop)
#   RETENTION_DAYS  rétention en jours          (7)
#   DB_CONTAINER    conteneur Postgres          (shop-db)
#   DB_USER         utilisateur Postgres        (shop)
#   DB_NAME         base à sauvegarder          (shop)
#   MEDIA_DIRS      dossiers de fichiers, séparés par des espaces,
#                   relatifs à APP_DIR           (public/uploads)
#   APP_DIR         racine de l'application     (dossier parent du script)
#
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="${APP_DIR:-$(cd "$SCRIPT_DIR/.." && pwd)}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/shop}"
RETENTION_DAYS="${RETENTION_DAYS:-7}"
DB_CONTAINER="${DB_CONTAINER:-shop-db}"
DB_USER="${DB_USER:-shop}"
DB_NAME="${DB_NAME:-shop}"
MEDIA_DIRS="${MEDIA_DIRS:-public/uploads}"
JOB_NAME="${JOB_NAME:-backup-db}"
LOG_FILE="${LOG_FILE:-$BACKUP_DIR/backup.log}"

# Les dumps contiennent des données clients (commandes, adresses, emails) : ils
# ne doivent être lisibles que par le propriétaire. `umask 077` garantit que
# chaque fichier créé naît en 600/700, sans dépendre de la config du shell.
umask 077

mkdir -p "$BACKUP_DIR"

STAMP="$(date +%Y%m%d-%H%M%S)"
START_EPOCH="$(date +%s)"
DUMP_FILE="$BACKUP_DIR/shop-$STAMP.dump.gz"
MEDIA_FILE="$BACKUP_DIR/media-$STAMP.tar.gz"

# ─────────────────────────────────────────────────────────────────────
# Outillage
# ─────────────────────────────────────────────────────────────────────

log() {
  printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"
  printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" >> "$LOG_FILE" 2>/dev/null || true
}

# Échappe une valeur pour un littéral SQL (une apostrophe se double).
sql_escape() {
  printf '%s' "$1" | sed "s/'/''/g"
}

# Écrit la trace d'exécution dans `JobRun` (lu par /admin/taches).
# Ne fait JAMAIS échouer la sauvegarde : si la base est injoignable, la trace
# ne peut pas être écrite — c'est le fichier de log qui prend le relais.
record_job_run() {
  local status="$1" error="$2" meta="$3"
  local id error_sql meta_sql
  id="bkp$(date +%Y%m%d%H%M%S)$$"
  error_sql="NULL"
  [ -n "$error" ] && error_sql="'$(sql_escape "${error:0:2000}")'"
  [ -n "$meta" ] || meta="{}"
  meta_sql="'$(sql_escape "$meta")'::jsonb"

  if ! docker exec -i "$DB_CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -q -v ON_ERROR_STOP=1 -c \
    "INSERT INTO \"JobRun\" (id, name, status, \"startedAt\", \"finishedAt\", error, meta)
     VALUES ('$id', '$JOB_NAME', '$status', to_timestamp($START_EPOCH), now(), $error_sql, $meta_sql);" \
    > /dev/null 2>&1; then
    log "AVERTISSEMENT : trace JobRun impossible (base injoignable ?) — voir ce log."
    return 0
  fi
  log "Trace JobRun écrite (id=$id, status=$status)."
}

# Arrêt sur erreur : on trace l'échec AVANT de sortir en code ≠ 0, sinon un cron
# silencieux est exactement le problème qu'on cherche à supprimer.
REPORTED=0
fail() {
  local message="$1"
  trap - ERR
  if [ "$REPORTED" -eq 0 ]; then
    REPORTED=1
    log "ÉCHEC : $message"
    record_job_run FAILED "$message" "{\"dump\":\"$DUMP_FILE\"}"
  fi
  exit 1
}
trap 'fail "erreur inattendue (ligne $LINENO)"' ERR

# ─────────────────────────────────────────────────────────────────────
# 1. Dump de la base (format custom, compressé)
# ─────────────────────────────────────────────────────────────────────
# Format `custom` et non SQL brut : c'est le seul format que `pg_restore` sait
# relire sélectivement, et c'est ce qui permet de VÉRIFIER le dump juste après
# sa création (étape 2). Le gzip par-dessus réduit encore la taille des données
# textuelles ; le coût est un `gunzip` à la restauration, négligeable.
log "Début de sauvegarde : base=$DB_NAME conteneur=$DB_CONTAINER destination=$BACKUP_DIR"

if ! docker exec "$DB_CONTAINER" pg_dump -U "$DB_USER" -d "$DB_NAME" \
  --format=custom --no-owner --no-privileges | gzip -c > "$DUMP_FILE.tmp"; then
  fail "pg_dump a échoué (conteneur $DB_CONTAINER, base $DB_NAME)"
fi

if [ ! -s "$DUMP_FILE.tmp" ]; then
  fail "dump vide ($DUMP_FILE.tmp) — pg_dump n'a rien produit"
fi

# ─────────────────────────────────────────────────────────────────────
# 2. Vérification d'intégrité — AVANT de considérer la sauvegarde comme bonne
# ─────────────────────────────────────────────────────────────────────
# Le risque réel n'est pas « le dump a échoué » (ça se voit), c'est « le dump
# existe et est inutilisable » (tronqué par un disque plein, écriture coupée).
# `pg_restore --list` lit le sommaire du dump : s'il le lit, la structure du
# fichier est saine. Ce n'est pas une restauration complète — c'est le test que
# `RUNBOOK.md` §5 impose à chaque sauvegarde, la restauration réelle étant
# exercée manuellement et datée dans le runbook.
if ! gunzip -c "$DUMP_FILE.tmp" | docker exec -i "$DB_CONTAINER" pg_restore --list > /dev/null; then
  rm -f "$DUMP_FILE.tmp"
  fail "dump illisible (pg_restore --list en échec) : $DUMP_FILE.tmp supprimé pour ne pas laisser croire à une sauvegarde valide"
fi

DUMP_BYTES="$(stat -c %s "$DUMP_FILE.tmp")"
# Renommage seulement après validation : un fichier présent dans BACKUP_DIR est
# un fichier utilisable. Aucun dump partiel ne traîne.
mv "$DUMP_FILE.tmp" "$DUMP_FILE"
log "Dump validé : $DUMP_FILE ($(numfmt --to=iec-i --suffix=B "$DUMP_BYTES" 2>/dev/null || echo "${DUMP_BYTES} octets"))"

# ─────────────────────────────────────────────────────────────────────
# 3. Fichiers téléversés (lot H) — indissociables de la base
# ─────────────────────────────────────────────────────────────────────
# Restaurer la base sans les images produit des fiches produit pointant vers
# des fichiers inexistants : la boutique paraît cassée alors que la base est
# saine. C'est un critère du PO, donc les deux partent dans le même exercice,
# sous le même horodatage.
MEDIA_BYTES=0
INCLUDED_DIRS=()
for dir in $MEDIA_DIRS; do
  if [ -d "$APP_DIR/$dir" ]; then
    INCLUDED_DIRS+=("$dir")
  else
    log "Dossier de fichiers absent, ignoré : $APP_DIR/$dir"
  fi
done

if [ "${#INCLUDED_DIRS[@]}" -gt 0 ]; then
  # `-C APP_DIR` + chemins relatifs : l'archive se réextrait à la racine de
  # l'application, sans dépendre d'un chemin absolu du serveur.
  if ! tar -czf "$MEDIA_FILE.tmp" -C "$APP_DIR" "${INCLUDED_DIRS[@]}"; then
    fail "archivage des fichiers téléversés impossible (${INCLUDED_DIRS[*]})"
  fi
  mv "$MEDIA_FILE.tmp" "$MEDIA_FILE"
  MEDIA_BYTES="$(stat -c %s "$MEDIA_FILE")"
  log "Fichiers archivés : $MEDIA_FILE (${INCLUDED_DIRS[*]}) — $MEDIA_BYTES octets"
else
  # Cas honnête : le lot H n'est pas encore livré, aucun fichier n'a été
  # téléversé via l'application. On le dit au lieu d'écrire une archive vide
  # qui laisserait croire que des images sont sauvegardées.
  log "Aucun dossier de téléversement à archiver (aucun des dossiers suivants n'existe : $MEDIA_DIRS)."
fi

# ─────────────────────────────────────────────────────────────────────
# 4. Purge au-delà de la rétention
# ─────────────────────────────────────────────────────────────────────
# Rétention par ÂGE (`-mtime +N`) et non « les N derniers fichiers » : avec un
# cron quotidien les deux reviennent au même, mais si le cron est manuel ou
# relancé plusieurs fois, la règle par âge ne supprime jamais une sauvegarde du
# jour. On garde donc 7 jours glissants de sauvegardes, même si elles sont
# multiples (AC J2 : « rétention 7 jours »).
PURGED=0
while IFS= read -r old; do
  [ -n "$old" ] || continue
  rm -f "$old"
  PURGED=$((PURGED + 1))
  log "Purge (> $RETENTION_DAYS jours) : $(basename "$old")"
done < <(find "$BACKUP_DIR" -maxdepth 1 -type f \
  \( -name 'shop-*.dump.gz' -o -name 'media-*.tar.gz' \) -mtime "+$RETENTION_DAYS")
log "Purge terminée : $PURGED fichier(s) supprimé(s), rétention $RETENTION_DAYS jours."

# ─────────────────────────────────────────────────────────────────────
# 5. Trace finale
# ─────────────────────────────────────────────────────────────────────
ELAPSED="$(( $(date +%s) - START_EPOCH ))"
record_job_run SUCCEEDED "" "{\"dump\":\"$(basename "$DUMP_FILE")\",\"dumpBytes\":$DUMP_BYTES,\"mediaBytes\":$MEDIA_BYTES,\"purged\":$PURGED,\"retentionDays\":$RETENTION_DAYS,\"durationSeconds\":$ELAPSED}"

log "Sauvegarde terminée en ${ELAPSED}s."
log "Rappel : la restauration se pratique avec scripts/restore-db.sh (procédure RUNBOOK §5)."
