# Aquaspin demo Preview

This Preview starts from production commit `ae5be39` and contains the production application features, including customer name suggestions, the completed Pay Later guard, customer link corrections, and Owner-only completed-order edits with required reasons and edit history.

The `codex/demo-latest` branch is used to generate a fresh Vercel Preview deployment for demonstrations. Preview database configuration is verified separately against Aquaspin Staging. Production customer cleanup operations are data changes and do not copy live customer records into the demo database.
