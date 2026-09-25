import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';

/** Parse a CSV line, handling quoted fields with embedded commas/newlines. */
function parseCsvLine(line: string): string[] {
    const fields: string[] = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
            if (inQuotes && line[i + 1] === '"') {
                current += '"';
                i++;
            } else {
                inQuotes = !inQuotes;
            }
        } else if (ch === ',' && !inQuotes) {
            fields.push(current.trim());
            current = '';
        } else {
            current += ch;
        }
    }
    fields.push(current.trim());
    return fields;
}

export async function parseCsvFile(
    filePath: string,
    onRow: (row: Record<string, string>) => void,
    onProgress?: (count: number) => void,
): Promise<number> {
    return new Promise((resolve, reject) => {
        const stream = createReadStream(filePath, { encoding: 'utf8' });
        const rl = createInterface({ input: stream, crlfDelay: Infinity });

        let headers: string[] = [];
        let rowCount = 0;
        let isFirst = true;

        rl.on('line', (line) => {
            if (!line.trim()) return;

            if (isFirst) {
                headers = parseCsvLine(line);
                isFirst = false;
                return;
            }

            const values = parseCsvLine(line);
            const row: Record<string, string> = {};
            headers.forEach((h, i) => { row[h] = values[i] ?? ''; });
            onRow(row);
            rowCount++;
            if (onProgress && rowCount % 1000 === 0) onProgress(rowCount);
        });

        rl.on('close', () => resolve(rowCount));
        rl.on('error', reject);
        stream.on('error', reject);
    });
}
