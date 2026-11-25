# Git scan ingestion

Commit and full scans transport the root `.titvoignore.yml` independently of
changed-file selection. An unchanged policy is checked with `downloadFile` at
the scan revision and added once to the existing ETL batch. A missing policy
(`ENOENT`) preserves legacy ingestion; other policy read errors fail the scan.
Policy bytes are not parsed or applied by this service.

Source selection, storage prefixes, revision selection, cleanup and result
events retain their existing contracts.
