// src/workflows/gh-news-processor.ts
import { WorkflowEntrypoint, WorkflowStep, WorkflowEvent } from 'cloudflare:workers';
import { Env, ProcessorParams } from '../types';
import { summarizeArticle, sendTelegramMessage, buildTelegramCaption } from '../utils';

export class GHNewsProcessorWorkflow extends WorkflowEntrypoint<Env, ProcessorParams> {
	// Prefix for cache keys
	private readonly CACHE_KEY_PREFIX = 'article:';

	async run(event: WorkflowEvent<ProcessorParams>, step: WorkflowStep) {
		// Extract parameters
		const { article, reprocess = false } = event.payload;

		// Step 1: Check if article has already been processed (if reprocessing isn't forced)
		if (!reprocess) {
			const isProcessed = await step.do('check_if_processed', async () => {
				// ✅ Ensuring our step is idempotent by performing a read-only check
				// This pattern ensures that even if this step is retried, we won't cause side effects
				const cacheKey = `${this.CACHE_KEY_PREFIX}${article.url}`;
				return (await this.env.GH_NEWS_CACHE.get(cacheKey)) !== null;
			});

			if (isProcessed) {
				return {
					success: true,
					skipped: true,
					reason: 'Article already processed',
					url: article.url,
				};
			}
		}

		// Step 2: Generate summary using OpenAI
		const summary = await step.do(
			'generate_summary',
			{
				retries: {
					limit: 3,
					delay: '5 second',
					backoff: 'exponential',
				},
				timeout: '1 minute',
			},
			async () => {
				return await summarizeArticle(article.content);
			}
		);

		if (!summary) {
			throw new Error(`Failed to generate summary for article: ${article.url}`);
		}

		// Step 3: Create the message for Telegram
		// Escapes HTML and truncates to Telegram's 1024-char caption limit —
		// oversized/unescaped captions are rejected with a 400 that no retry fixes
		const telegramMessage = await step.do('create_message', async () => {
			return buildTelegramCaption(article.title, summary);
		});

		// Step 4: Send message to Telegram
		const sendResult = await step.do(
			'send_telegram_message',
			{
				retries: {
					limit: 5, // More retries for external API
					delay: '10 second',
					backoff: 'exponential',
				},
				timeout: '2 minutes',
			},
			async () => {
				// Just use the image URL from the article or empty string if null/undefined
				const imageUrl = article.image_url || '';

				// Let the sendTelegramMessage function handle fallback images
				return await sendTelegramMessage(this.env.TELEGRAM_BOT_TOKEN, this.env.TELEGRAM_CHANNEL_ID, telegramMessage, imageUrl, article.url);
			}
		);

		if (!sendResult) {
			throw new Error(`Failed to send Telegram message for article: ${article.url}`);
		}

		// Step 5: Mark article as processed in KV with TTL (30 days)
		await step.do(
			'mark_as_processed',
			{
				retries: {
					limit: 3,
					delay: '3 second',
					backoff: 'exponential',
				},
			},
			async () => {
				// Create metadata
				const metadata = {
					processed_at: new Date().toISOString(),
					title: article.title,
					url: article.url,
					summary: summary,
				};

				// Calculate TTL (30 days in seconds) — must outlast how long an
				// article can linger on the homepage/feed, or it gets reprocessed
				const ttl = 30 * 86400;

				// Store in KV with TTL for automatic expiration
				// We've already checked if it exists in step 1, so no need to check again
				const cacheKey = `${this.CACHE_KEY_PREFIX}${article.url}`;
				await this.env.GH_NEWS_CACHE.put(cacheKey, JSON.stringify(metadata), { expirationTtl: ttl });

				return { success: true };
			}
		);

		return {
			success: true,
			url: article.url,
			title: article.title,
			summary: summary,
			telegramSent: true,
			processedAt: new Date().toISOString(),
		};
	}
}
