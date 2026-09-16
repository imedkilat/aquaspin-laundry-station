import { readdirSync } from 'node:fs';
import { basename, resolve } from 'node:path';

const migrationsDir = resolve('supabase/migrations');
const files = readdirSync(migrationsDir)
  .filter((name) => name.endsWith('.sql'))
  .sort((a, b) => a.localeCompare(b));

const versionPattern = /^(\d+)_/;
const versions = new Map();
const errors = [];

for (const file of files) {
  const match = file.match(versionPattern);
  if (!match) {
    errors.push(`${file}: migration filename must start with a numeric version followed by _`);
    continue;
  }

  const version = match[1];
  const existing = versions.get(version);
  if (existing) {
    errors.push(`duplicate migration version ${version}: ${existing} and ${file}`);
  } else {
    versions.set(version, file);
  }
}

const requireBefore = (firstSuffix, secondSuffix) => {
  const first = files.find((name) => name.endsWith(firstSuffix));
  const second = files.find((name) => name.endsWith(secondSuffix));
  if (!first || !second) return;

  if (files.indexOf(first) >= files.indexOf(second)) {
    errors.push(`${first} must sort before ${second}`);
  }
};

// transaction_codes_and_test_cleanup reads gcash_reference, so the GCash
// schema migration must always run first on a clean rebuild.
requireBefore(
  '_add_gcash_reference.sql',
  '_transaction_codes_and_test_cleanup.sql',
);

if (errors.length > 0) {
  console.error('Migration history check failed:');
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(`Migration history check passed (${files.length} migration files, unique ordered versions).`);
