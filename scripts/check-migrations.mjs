import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const migrationsDir = resolve('supabase/migrations');
const rawFiles = readdirSync(migrationsDir)
  .filter((name) => name.endsWith('.sql'));

const versionPattern = /^(\d+)_/;
const versions = new Map();
const errors = [];
const migrations = [];

for (const file of rawFiles) {
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

  migrations.push({ file, version, numericVersion: BigInt(version) });
}

migrations.sort((a, b) => {
  if (a.numericVersion < b.numericVersion) return -1;
  if (a.numericVersion > b.numericVersion) return 1;
  return a.file.localeCompare(b.file);
});

const requireBefore = (firstSuffix, secondSuffix) => {
  const first = migrations.find((migration) => migration.file.endsWith(firstSuffix));
  const second = migrations.find((migration) => migration.file.endsWith(secondSuffix));
  if (!first || !second) return;

  if (first.numericVersion >= second.numericVersion) {
    errors.push(`${first.file} must have an earlier migration version than ${second.file}`);
  }
};

const baseMigration = '20260914000000_base_schema.sql';
if (migrations[0]?.file !== baseMigration) {
  errors.push(`${baseMigration} must be the first migration on a clean rebuild`);
}

try {
  const schema = readFileSync(resolve('supabase/schema.sql'), 'utf8');
  const versionedBase = readFileSync(resolve('supabase/migrations', baseMigration), 'utf8');
  if (schema !== versionedBase) {
    errors.push(`${baseMigration} must byte-match supabase/schema.sql`);
  }
} catch (error) {
  errors.push(`unable to compare base schema: ${error.message}`);
}

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

console.log(`Migration history check passed (${migrations.length} migration files, unique numeric versions, canonical base present).`);
