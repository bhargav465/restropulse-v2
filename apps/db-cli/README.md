# RestroPulse Database CLI

Standalone CLI tool for MongoDB database setup, schema validation, and test data seeding.

## Features

- **Setup**: Create main and test databases with collections, indexes, and validators
- **Validate**: Check schemas and indexes against expected definitions
- **Seed**: Populate test database with sample data
- **Reset**: Drop all collections and recreate an empty database with indexes
- **Atlas Admin**: Inventory users/databases, clone backups, provision env DB roles/users, validate access, and gated legacy cleanup

## Installation

```bash
cd restropulse-pwa-database
npm install
```

## Configuration

This CLI reads MongoDB configuration from the backend project's `.env` file:
`../restropulse-pwa-backend/.env`

Ensure the backend's `.env` file exists with:

```env
MONGODB_URI=mongodb+srv://user:password@cluster.mongodb.net/?retryWrites=true&w=majority
MONGODB_DB_NAME=restropulsev1
```

The test database name is automatically derived as `{MONGODB_DB_NAME}-test`.

## Usage

### Development (with TypeScript)

```bash
# Set up both databases
npm run setup

# Validate schemas
npm run validate

# Seed test database
npm run seed

# Seed with clean (wipe existing data first)
npm run seed:clean

# Reset database (prompts for URI + DB name, then 10s safety delay)
npm run reset
```

### Using the CLI directly

```bash
# Run any command
npm run dev -- <command> [options]

# Examples
npm run dev -- setup --main-only
npm run dev -- validate --fix
npm run dev -- seed --clean
```

### Commands

#### `setup`
Creates databases, collections, indexes, and schema validators.

Options:
- `--main-only` - Set up main database only
- `--test-only` - Set up test database only

#### `validate`
Validates that collections and indexes match the expected schema.

Options:
- `--fix` - Attempt to automatically fix issues

#### `seed`
Seeds the database with test data.

Options:
- `--clean` - Clear existing data before seeding
- `--allow-missing-razorpay` - Bypass Razorpay plan ID completeness check (not recommended)

#### `reset`
Drops all collections and recreates an empty database with schema validators and indexes. This gives you a fresh database as if the application has just started.

Options:
- `--allow-missing-razorpay` - Bypass Razorpay plan ID completeness check (not recommended)

#### `atlas-inventory`
Lists all cluster users/roles and databases into a sanitized JSON report under `reports/atlas/`.

#### `atlas-backup-clone`
Clones non-system/non-target databases into timestamped `backup_*` databases.

Options:
- `--execute` - perform cloning (default is dry-run)

#### `atlas-provision`
Creates target DBs (`restropulse_dev`, `restropulse_staging`, `restropulse_prod`), one role per DB, two scoped users per role, and one super-admin user. Passwords are generated and written only to Azure Key Vault.

Options:
- `--execute` - perform provisioning (default is dry-run)
- `--vault-name <name>` - override key vault name

#### `atlas-validate-access`
Validates that scoped users can only access their assigned DB and that super-admin has full cluster access.

#### `atlas-cleanup-legacy`
Produces a dry-run cleanup report for legacy users/databases; execute mode requires explicit confirmation.

Options:
- `--execute` - perform deletions (default is dry-run)

## Building Executable

To create a standalone Windows executable:

```bash
npm run build:exe
```

This creates `dist/rp-db.exe` which can be run without Node.js installed.

## Schema Definitions

Collections and their schemas are defined in `src/schemas/collections.ts`:

- **users** - User accounts with roles
- **restaurants** - Restaurant profiles and settings
- **posts** - Social media content
- **strategyCycles** - Monthly content strategy cycles
- **contentStrategies** - Content posting strategies
- **sessions** - Authentication sessions (with TTL index)

## Test Data

Sample data is defined in `src/data/seedData.ts` and mirrors the mock data used in the backend for consistency.

## Project Structure

```
restropulse-pwa-database/
  src/
    index.ts           # CLI entry point
    config/
      database.ts      # MongoDB connection
    commands/
      setup.ts         # Setup command
      validate.ts      # Validate command
      seed.ts          # Seed command
      reset.ts         # Reset command
    schemas/
      collections.ts   # Collection definitions
    data/
      seedData.ts      # Test data
  scripts/
    bundle.js          # esbuild bundler
  dist/                # Compiled output
  .env.example         # Environment template
  package.json
  tsconfig.json
  README.md
```
