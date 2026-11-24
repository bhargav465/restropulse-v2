/** Minimal request helper: real HTTP against the app on an ephemeral port (lets us set Host). */
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Express } from 'express';

export interface TestResponse {
    status: number;
    headers: http.IncomingHttpHeaders;
    text: string;
    type: string;
}

export async function get(app: Express, path: string, headers: Record<string, string> = {}): Promise<TestResponse> {
    const server = app.listen(0);
    await new Promise<void>((r) => server.once('listening', () => r()));
    const { port } = server.address() as AddressInfo;
    try {
        return await new Promise<TestResponse>((resolve, reject) => {
            const req = http.request({ host: '127.0.0.1', port, path, method: 'GET', headers: { host: `127.0.0.1:${port}`, ...headers } }, (res) => {
                let text = '';
                res.setEncoding('utf8');
                res.on('data', (c) => (text += c));
                res.on('end', () => resolve({
                    status: res.statusCode ?? 0,
                    headers: res.headers,
                    text,
                    type: String(res.headers['content-type'] ?? '').split(';')[0],
                }));
            });
            req.on('error', reject);
            req.end();
        });
    } finally {
        await new Promise((r) => server.close(r));
    }
}
