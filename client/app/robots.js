// Served by Next as /robots.txt. Corporate URL-filtering appliances and search
// crawlers both look for this file; its absence is one more reason a domain ends
// up unclassified. The public landing page and the two policy pages are open;
// everything behind authentication is disallowed so nothing tries to crawl it.
import { SITE_URL } from '@/lib/site';

export default function robots() {
  return {
    rules: [
      {
        userAgent: '*',
        allow: ['/', '/login', '/privacy', '/terms'],
        disallow: [
          '/admin',
          '/dashboard',
          '/inbox',
          '/search',
          '/skills',
          '/roles',
          '/assessments',
          '/training',
          '/learning-module',
          '/certifications',
          '/mentor',
          '/roadmap',
          '/employees',
          '/profile',
          '/api/',
        ],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
