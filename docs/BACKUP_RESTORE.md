# Backup and Restore Runbook

TrustVault is not production-ready until backups are automated, stored independently, and restore-tested. This runbook is an operator checklist, not proof that a backup system is configured.

## What must be protected

- SQLite database and local audit checkpoint in the `trustvault_data` volume.
- Uploaded documents in the `trustvault_private_files` volume.
- The production `AUDIT_HMAC_KEY`, stored separately in a secret manager. Do not put it in the same archive as the database.
- The exact deployed image/version, configuration (excluding secret values), and trusted-origin settings.

A database backup without the private-files volume is incomplete. A files backup without the database is also incomplete.

## Create a consistent manual backup

Run from the directory containing `compose.yaml` on the Docker host. Schedule a maintenance window because the application will be stopped.

1. Create a restricted backup directory on a separate, protected disk. Encrypt backups at rest and copy them to a separately administered location.
2. Stop TrustVault so SQLite and document writes are quiescent:

   ```sh
   docker compose stop trustvault
   ```

3. Create an archive of each named volume. The helper image must already be available locally or be pulled from a trusted registry before the maintenance window.

   ```sh
   mkdir -p backups
   chmod 700 backups
   docker run --rm -v trustvault_data:/source:ro -v "$PWD/backups:/backup" alpine:3.20 sh -c 'cd /source && tar -czf /backup/trustvault-data.tar.gz .'
   docker run --rm -v trustvault_private_files:/source:ro -v "$PWD/backups:/backup" alpine:3.20 sh -c 'cd /source && tar -czf /backup/trustvault-private-files.tar.gz .'
   sha256sum backups/*.tar.gz > backups/SHA256SUMS
   ```

   If Compose prefixes volume names with a project name, discover the actual names using `docker volume ls` and substitute those exact names. Do not accidentally archive a different project's volumes.

4. Restart the application and verify health:

   ```sh
   docker compose start trustvault
   docker compose ps
   curl --fail http://127.0.0.1:3000/api/health
   ```

5. Move the archives and checksum file to encrypted, access-controlled storage outside this host. Protect access logs and define retention. Do not commit backups to Git or leave them in a public web directory.

## Restore drill (use an isolated staging environment)

Never restore over the only production copy during a test.

1. Create isolated staging volumes and a staging Compose project with network access restricted. Use a separate, securely stored test HMAC key and the staging HTTPS origin.
2. Verify archive integrity before extraction:

   ```sh
   sha256sum --check backups/SHA256SUMS
   ```

3. Stop the staging application and extract the two archives into the corresponding staging volumes. Confirm the volume names before running any destructive command. Never use the production volume names for a drill.
4. Start the staging application using the same compatible application version and configuration shape. Confirm health and sign in with a controlled test account.
5. As an Administrator, call the audit verification endpoint from the authenticated UI or API and confirm the chain/checkpoint is valid. If the audit HMAC key is missing or different, verification may fail; do not disable verification to make the restore appear successful.
6. Verify document counts and open/download a synthetic test document under the intended owner/grant roles. Confirm private files exist and no unauthorised role can access them.
7. Record the restore duration, data-loss window, failures, and corrective actions. Delete staging copies securely when the drill is complete.

## Required operational controls

- Automate backups and alert on missed or failed jobs.
- Keep at least one encrypted copy off-host and separately administered.
- Define retention and deletion rules, and periodically test recovery from the oldest retained backup.
- Define and test recovery point and recovery time objectives before accepting real data.
- Preserve the HMAC key in a secret manager with access controls and a recovery procedure; do not store it beside the database archive.
- Store independent, append-only audit checkpoints outside the application host. The local checkpoint only detects certain database-only tail deletion when the checkpoint itself remains intact.
- Backups and restore drills do not replace malware scanning, monitoring, incident response, or an independent security review.
