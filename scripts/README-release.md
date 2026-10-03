# Complete-source candidate and database startup checks

The old three-file backend upload recipe is retired. `index.ts` now depends on
other modules, policy declarations and invoice fonts. A partial copy is not a release.

Run from the repository root (Python 3 and the existing Node dependencies are required):

```sh
python3 scripts/release-bundle.py create --root "$PWD" --project internal --output /absolute/path/new-internal-candidate
python3 scripts/release-bundle.py verify --bundle /absolute/path/new-internal-candidate --against-source "$PWD"
```

The script inventories all server/src/scripts/public sources, both dependency
manifests, config and fonts. It excludes secrets, databases, uploads, dependencies,
old archives and build output. A sha256/mode manifest, extracted source and
`source.tar.gz` are generated. Any missing local import, incomplete inventory,
source drift or tamper fails verification. Build dependencies are never installed.
The full check names the frontend app and node projects and the whole server
project explicitly, using strict server checking; root `tsc --noEmit` is not a gate.

`--source-only` creates an explicitly UNAPPROVED candidate for review; it does not
claim types, builds or runtime acceptance. A failed normal mandatory check exits
nonzero while preserving the complete source candidate and literal check outputs.
This release tool never deploys and never sets deployment_approved=true.

Before deployment: fix all failed checks, build on the target OS/Node ABI from the
locked manifests, inspect runtime resources, run a fresh isolated startup/HTTP
smoke, and rehearse database + attachment restoration. Verify the source once more
against the final candidate. Never copy local node_modules/native SQLite binaries
onto a server with a different OS/ABI. Keep a previous complete code release and
verified data snapshot; code rollback does not undo DB migrations.

## One database configuration before import

`src/lib/runtime-config.cjs` uses Next's @next/env, including Next's env precedence,
before direct getDb/backup access. Next runs at the deployed project cwd; direct
tools should also run at this root or explicitly set INTERNAL_APP_ROOT. DB_PATH
resolves from that root. The backup script changes into its project root first.

Production rejects missing, empty, corrupt or different-business DBs before writes.
Only verified FIRST installation uses ALLOW_EMPTY_DB=1 for explicit initialization;
remove the switch afterwards. It never bypasses wrong-business identity checks.
Only explicit NODE_ENV=test permits automatic fresh synthetic DB creation.
First development startup (including an unset NODE_ENV) also needs
ALLOW_EMPTY_DB=1, then remove it. Legitimate old
core schemas are accepted for normal migrations; a failed initialization closes
the handle and never publishes it to the process cache. Existing seed and business
workflow semantics remain. Identity checks recognize the application shape, not
which of two valid tenant backups is intended, so verify data and mounts too.

## Backups

The source is checked read-only before creating the backup directory. Online
SQLite backup (not copying an open DB) is followed by restored-file integrity and
core-table validation. Database metadata is recorded without exporting rows.
Source counts are explicitly labelled before-snapshot, not a claim of a cross-file
atomic snapshot on a live writer. Database and attachment archives are not one
transaction; schedule a quiescent restore rehearsal when their exact consistency
matters. Internal attachments now include uploads/, files/, and TMP_UPLOADS (explicitly
set TMP_UPLOADS to an isolated path during tests). BACKUP_DIR, UPLOADS_DIR and
FILES_DIR may also be set. Failure of any snapshot/archive aborts before retention
cleanup. The old live-file cp fallback and ignored tar failures are removed.
Client OSS retain-on-failure behavior remains a separate script responsibility.
