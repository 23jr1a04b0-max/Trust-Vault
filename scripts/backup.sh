#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

: "${RESTIC_REPOSITORY:?Set RESTIC_REPOSITORY to an encrypted off-host Restic repository}"
: "${RESTIC_PASSWORD_FILE:?Set RESTIC_PASSWORD_FILE to a root-readable secret file}"
command -v docker >/dev/null || { echo "docker is required" >&2; exit 1; }
command -v restic >/dev/null || { echo "restic is required" >&2; exit 1; }
[[ -r "$RESTIC_PASSWORD_FILE" ]] || { echo "RESTIC_PASSWORD_FILE is not readable" >&2; exit 1; }

backup_dir="$(mktemp -d "${TMPDIR:-/tmp}/trustvault-backup.XXXXXXXX")"
app_stopped=0
cleanup() {
  status=$?
  if [[ "$app_stopped" == 1 ]]; then
    docker compose start trustvault || echo "WARNING: could not restart TrustVault automatically" >&2
  fi
  rm -rf -- "$backup_dir"
  exit "$status"
}
trap cleanup EXIT INT TERM

# Stop writes so the SQLite database and private-files archive are consistent.
docker compose stop trustvault
app_stopped=1

# Use the app image only as a read-only archive helper. Exclude the local audit
# HMAC key; it must be recoverable from the separate secret manager, not this backup.
docker compose run --rm --no-deps \
  -v "$backup_dir:/backup" \
  --entrypoint sh trustvault -ec \
  'tar --exclude=./audit-hmac.key -czf /backup/trustvault-data.tar.gz -C /app/data . &&
   tar -czf /backup/trustvault-private-files.tar.gz -C /app/private-files .'

docker compose start trustvault
app_stopped=0

# Restic encrypts and authenticates the archives before storing them remotely.
restic backup "$backup_dir/trustvault-data.tar.gz" "$backup_dir/trustvault-private-files.tar.gz" \
  --tag trustvault --tag automated

# Keep a bounded history. Configure repository access controls and object-lock
# retention independently at the remote provider where supported.
restic forget --tag trustvault --keep-daily 7 --keep-weekly 4 --keep-monthly 12 --prune

echo "TrustVault backup completed at $(date -u +%FT%TZ)"
