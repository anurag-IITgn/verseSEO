import http from 'node:http';

function page(meta: { title?: string; description?: string; canonical?: string; robots?: string }, links: string[] = []): string {
  const head = [
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta charset="utf-8">',
    '<link rel="icon" href="/favicon.ico">',
    meta.title ? `<title>${meta.title}</title>` : '',
    meta.description ? `<meta name="description" content="${meta.description}">` : '',
    meta.canonical ? `<link rel="canonical" href="${meta.canonical}">` : '',
    meta.robots ? `<meta name="robots" content="${meta.robots}">` : '',
  ].join('');
  const filler = 'word '.repeat(350);
  const body = links.map((link) => `<a href="${link}">${link}</a>`).join('');
  return `<!doctype html><html lang="en"><head>${head}</head><body><p>${filler}</p>${body}</body></html>`;
}

export interface FixtureSite {
  server: http.Server;
  baseUrl: string;
}

export async function startFixtureAnalysisSite(): Promise<FixtureSite> {
  const server = http.createServer((req, res) => {
    res.on('error', () => {});
    const url = req.url ?? '/';

    const send = (status: number, body: string, contentType = 'text/html; charset=utf-8') => {
      if (res.destroyed || res.writableEnded) return;
      res.writeHead(status, { 'content-type': contentType });
      res.end(body);
    };

    switch (url) {
      case '/robots.txt':
        send(200, 'User-agent: *\nAllow: /\n', 'text/plain; charset=utf-8');
        return;
      case '/':
        send(200, page({ title: 'Analysis Fixture Home Page Title', description: 'A descriptive meta description for the fixture home page', canonical: '/' }, ['/no-title', '/dup', '/dup2', '/broken', '/noindex', '/short']));
        return;
      case '/no-title':
        send(200, page({}));
        return;
      case '/dup':
        send(200, page({ title: 'The Shared Page Title Used By Two Fixture Pages', description: 'A shared meta description that appears on two separate fixture pages' }));
        return;
      case '/dup2':
        send(200, page({ title: 'The Shared Page Title Used By Two Fixture Pages', description: 'A shared meta description that appears on two separate fixture pages' }));
        return;
      case '/noindex':
        send(200, page({ title: 'Noindex Page With Comprehensive Title Text', description: 'A meta description for the noindex page that is long enough', robots: 'noindex, follow' }));
        return;
      case '/short':
        send(200, page({ title: 'Short' }));
        return;
      case '/broken':
        send(404, 'Not found', 'text/plain; charset=utf-8');
        return;
      default:
        send(404, 'Not found', 'text/plain; charset=utf-8');
    }
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as { port: number };
  const baseUrl = `http://127.0.0.1:${address.port}`;

  return { server, baseUrl };
}

export async function closeFixtureAnalysisSite(server: http.Server): Promise<void> {
  await new Promise<void>((resolve) => server.close(() => resolve()));
}