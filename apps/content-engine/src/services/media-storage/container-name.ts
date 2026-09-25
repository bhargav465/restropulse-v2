/**
 * Media containers are tied to the database: one container per MongoDB
 * database name, so a database and the blobs its posts point at always travel
 * together (prod DB -> prod account, staging/dev DBs -> non-prod account).
 *
 * Azure container names: 3-63 chars, lowercase letters/digits/hyphens, must
 * start and end with a letter or digit, no consecutive hyphens.
 */
export function containerNameForDatabase(dbName: string): string {
  let name = dbName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 63)
    .replace(/-+$/g, '');
  if (name.length === 0) name = 'restropulse';
  if (name.length < 3) name = `${name}-media`;
  return name;
}
