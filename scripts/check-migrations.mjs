import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const migrationsDir = resolve('supabase/migrations');
const rawFiles = readdirSync(migrationsDir)
  .filter((name) => name.endsWith('.sql'));

const versionPattern = /^(\d+)_/;
const versions = new Map();
const normalizedVersions = new Map();
const errors = [];
const migrations = [];

const normalizeVersion = (version) => {
  // Aquaspin has two legacy day-level migration IDs (`YYYYMMDD`) in the
  // production ledger alongside normal Supabase timestamp IDs
  // (`YYYYMMDDHHMMSS`). Treat day-level IDs as midnight on that day so
  // chronological ordering remains correct without changing the remote IDs.
  if (/^\d{8}$/.test(version)) return `${version}000000`;
  if (/^\d{14}$/.test(version)) return version;

  errors.push(
    `migration version ${version} must use YYYYMMDD or YYYYMMDDHHMMSS format`,
  );
  return null;
};

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

  const normalizedVersion = normalizeVersion(version);
  if (normalizedVersion === null) continue;

  const normalizedExisting = normalizedVersions.get(normalizedVersion);
  if (normalizedExisting) {
    errors.push(
      `migration versions collide at normalized timestamp ${normalizedVersion}: ${normalizedExisting} and ${file}`,
    );
  } else {
    normalizedVersions.set(normalizedVersion, file);
  }

  migrations.push({
    file,
    version,
    normalizedVersion,
    numericVersion: BigInt(normalizedVersion),
  });
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

// These versions are the exact migration IDs currently recorded in the
// Aquaspin production Supabase ledger. Keeping them represented locally is
// required before `migration list` / `db push` can ever become deterministic.
const productionLedgerVersions = [
  '20260915',
  '20260915174106',
  '20260915180704',
  '20260915181029',
  '20260915181129',
  '20260915190757',
  '20260915191400',
  '20260915191412',
  '20260915192554',
  '20260915192604',
  '20260916',
  '20260916015627',
  '20260916024806',
  '20260916031013',
  '20260916032655',
  '20260916125702',
];

for (const version of productionLedgerVersions) {
  if (!versions.has(version)) {
    errors.push(`missing production-ledger migration version ${version}`);
  }
}

if (errors.length > 0) {
  console.error('Migration history check failed:');
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(
  `Migration history check passed (${migrations.length} migration files, unique normalized versions, canonical base present, production ledger represented).`,
);
