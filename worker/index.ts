// src/index.ts
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { prettyJSON } from 'hono/pretty-json';
import { Receiver } from '@upstash/qstash';
import { Env, ScraperParams } from './types';
import { processArticleWorkflow } from './workflows/process-article';
import { runScraper } from './scraper';

const app = new Hono<{ Bindings: Env }>();

// Middleware
app.use('*', cors());
app.use('*', prettyJSON());
app.use('*', logger());

// Root endpoint
app.get('/', (c) => c.text('GHNewsInBrief Workflows Service'));

// Health check endpoint
app.get('/health', (c) => c.text('GHNewsInBrief Workflows service ready'));

/**
 * Verifies that a request was signed by QStash. Every mutating endpoint is
 * QStash-only: the scrape schedule and workflow step callbacks both arrive
 * as signed QStash deliveries, so nothing here is publicly triggerable.
 */
async function verifyQStashSignature(c: { req: { url: string; header: (name: string) => string | undefined } }, env: Env, body: string): Promise<boolean> {
	const signature = c.req.header('upstash-signature');
	if (!signature) {
		return false;
	}

	const receiver = new Receiver({
		currentSigningKey: env.QSTASH_CURRENT_SIGNING_KEY,
		nextSigningKey: env.QSTASH_NEXT_SIGNING_KEY,
	});

	try {
		return await receiver.verify({ signature, body, url: c.req.url });
	} catch {
		return false;
	}
}

// Scrape entry point, invoked by the QStash schedule (and manual signed publishes).
// Runs the scraper inline and triggers a processor workflow per new article.
app.post('/qstash/scrape', async (c) => {
	const body = await c.req.text();

	if (!(await verifyQStashSignature(c, c.env, body))) {
		return c.json({ success: false, error: 'Invalid QStash signature' }, 401);
	}

	try {
		let params: ScraperParams = {};
		if (body) {
			try {
				params = JSON.parse(body);
			} catch {
				// Schedules may deliver an empty or non-JSON body; scrape defaults apply
			}
		}

		const origin = new URL(c.req.url).origin;
		const result = await runScraper(c.env, origin, params);

		return c.json({
			success: true,
			message: 'News scraper run complete',
			result,
		});
	} catch (error) {
		console.error('Error running scraper:', error);
		return c.json(
			{
				success: false,
				error: error instanceof Error ? error.message : 'Unknown error',
			},
			500
		);
	}
});

// Upstash Workflow endpoint for the per-article processor. serve() handles
// QStash signature verification itself via the signing keys in env.
app.post('/qstash/process-article', processArticleWorkflow);

// Default export for Cloudflare Workers
export default {
	fetch: app.fetch,
};
