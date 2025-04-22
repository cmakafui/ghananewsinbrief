// src/index.ts
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { prettyJSON } from 'hono/pretty-json';
import { Env, ScraperParams } from './types';
import { JoyNewsScraperWorkflow } from './workflows/joy-news-scraper';
import { GHNewsProcessorWorkflow } from './workflows/gh-news-processor';

// Export the workflows for Cloudflare Workers
export { JoyNewsScraperWorkflow, GHNewsProcessorWorkflow };

const app = new Hono<{ Bindings: Env }>();

// Middleware
app.use('*', cors());
app.use('*', prettyJSON());
app.use('*', logger());

// Root endpoint
app.get('/', (c) => c.text('GHNewsInBrief Workflows Service'));

// Health check endpoint
app.get('/health', (c) => c.text('GHNewsInBrief Workflows service ready'));

// Start scraper workflow
app.post('/api/workflows/scraper', async (c) => {
	try {
		const body = await c.req.json<ScraperParams>().catch(() => ({}));

		const instance = await c.env.JOY_NEWS_SCRAPER_WORKFLOW.create({
			id: crypto.randomUUID(),
			params: body,
		});

		return c.json({
			success: true,
			workflow_id: instance.id,
			message: 'News scraper workflow started',
		});
	} catch (error) {
		console.error('Error starting scraper workflow:', error);
		return c.json(
			{
				success: false,
				error: error instanceof Error ? error.message : 'Unknown error',
			},
			500
		);
	}
});

// Manually process a single article
app.post('/api/workflows/processor', async (c) => {
	try {
		const {
			url,
			title,
			content,
			image_url,
			reprocess = false,
		} = await c.req.json<{
			url: string;
			title: string;
			content: string;
			image_url?: string;
			reprocess?: boolean;
		}>();

		if (!url || !title || !content) {
			return c.json(
				{
					success: false,
					error: 'Missing required parameters: url, title, and content are required',
				},
				400
			);
		}

		const article = {
			url,
			title,
			content,
			image_url: image_url || '',
			date_published: new Date().toISOString(),
		};

		const instance = await c.env.GH_NEWS_PROCESSOR_WORKFLOW.create({
			id: crypto.randomUUID(),
			params: { article, reprocess },
		});

		return c.json({
			success: true,
			workflow_id: instance.id,
			message: 'News processor workflow started',
			reprocessing: reprocess ? true : false,
		});
	} catch (error) {
		console.error('Error starting processor workflow:', error);
		return c.json(
			{
				success: false,
				error: error instanceof Error ? error.message : 'Unknown error',
			},
			500
		);
	}
});

// Get workflow status
app.get('/api/workflows/:type/:id', async (c) => {
	try {
		const type = c.req.param('type');
		const id = c.req.param('id');

		let instance;

		if (type === 'scraper') {
			instance = await c.env.JOY_NEWS_SCRAPER_WORKFLOW.get(id);
		} else if (type === 'processor') {
			instance = await c.env.GH_NEWS_PROCESSOR_WORKFLOW.get(id);
		} else {
			return c.json(
				{
					success: false,
					error: 'Invalid workflow type. Use "scraper" or "processor"',
				},
				400
			);
		}

		if (!instance) {
			return c.json(
				{
					success: false,
					error: 'Workflow instance not found',
				},
				404
			);
		}

		const status = await instance.status();

		return c.json({
			success: true,
			workflow_id: id,
			workflow_type: type,
			status,
		});
	} catch (error) {
		console.error('Error getting workflow status:', error);
		return c.json(
			{
				success: false,
				error: error instanceof Error ? error.message : 'Unknown error',
			},
			500
		);
	}
});

// Default export for Cloudflare Workers
export default {
	fetch: app.fetch,

	// Run scraper every 3 hours
	async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
		try {
			const instance = await env.JOY_NEWS_SCRAPER_WORKFLOW.create({
				id: crypto.randomUUID(),
			});
			console.log('Scheduled news scraping started:', {
				instanceId: instance.id,
				timestamp: new Date().toISOString(),
			});
		} catch (error) {
			console.error('Error in scheduled scraping:', error);
		}
	},
};
