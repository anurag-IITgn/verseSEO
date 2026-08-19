import http from 'node:http';

function html(title: string, links: string[], meta: { description?: string; canonical?: string; robots?: string } = {}): string {
  const metaTags = [
    meta.description ? `<meta name="description" content="${meta.description}">` : '',
    meta.canonical ? `<link rel="canonical" href="${meta.canonical}">` : '',
    meta.robots ? `<meta name="robots" content="${meta.robots}">` : '',
  ].join('');
  const linksHtml = links.map((link) => `<a href="${link}">${link}</a>`).join('');
  return `<!doctype html><html><head><title>${title}</title>${metaTags}</head><body><h1>${title}</h1>${linksHtml}</body></html>`;
}

export interface FixtureSite {
  server: http.Server;
  baseUrl: string;
}

export async function startFixtureServer(): Promise<FixtureSite> {
  let baseUrl = '';

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
        send(200, 'User-agent: *\nDisallow: /forbidden\nSitemap: /sitemap.xml\n', 'text/plain; charset=utf-8');
        return;
      case '/sitemap.xml':
        send(
          200,
          `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${baseUrl}/sitemap-page</loc></url><url><loc>https://example.com/outside</loc></url></urlset>`,
          'application/xml',
        );
        return;
      case '/':
        send(
          200,
          html('Home', ['/about', '/contact', '/missing', '/redirect', '/offsite-redirect', '/forbidden', '/slow'], {
            description: 'home description',
            canonical: '/',
            robots: 'index,follow',
          }),
        );
        return;
      case '/about':
        send(200, html('About', ['/']));
        return;
      case '/contact':
        send(200, html('Contact', []));
        return;
      case '/sitemap-page':
        send(200, html('Sitemap Page', []));
        return;
      case '/forbidden':
        send(200, html('Forbidden', []));
        return;
      case '/missing':
        send(404, 'Not found', 'text/plain; charset=utf-8');
        return;
      case '/redirect':
        res.writeHead(302, { location: `${baseUrl}/about` });
        res.end();
        return;
      case '/offsite-redirect':
        res.writeHead(302, { location: 'https://example.com/outside' });
        res.end();
        return;
      case '/slow':
        setTimeout(() => {
          if (!res.destroyed && !res.writableEnded) {
            res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
            res.end(html('Slow', []));
          }
        }, 2500);
        return;
      default:
        send(404, 'Not found', 'text/plain; charset=utf-8');
    }
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as { port: number };
  baseUrl = `http://127.0.0.1:${address.port}`;

  return { server, baseUrl };
}

export async function closeFixtureServer(server: http.Server): Promise<void> {
  await new Promise<void>((resolve) => server.close(() => resolve()));
}