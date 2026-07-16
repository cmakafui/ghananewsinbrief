// src/workflows/process-article.ts
import { serve } from '@upstash/workflow/hono';
import { Env, ProcessorParams } from '../types';
import { summarizeArticle, sendTelegramMessage, buildTelegramCaption } from '../utils';

const CACHE_KEY_PREFIX = 'article:';

// Concurrency cap shared by every run of this workflow, so a burst of new
// articles doesn't fan out into parallel OpenAI calls
export const OPENAI_FLOW_CONTROL = { key: 'gh-news-openai', parallelism: 2 };

/**
 * Per-article processor as an Upstash Workflow. QStash drives each step via
 * signed HTTP calls back into this endpoint; serve() verifies signatures
 * automatically when QSTASH_CURRENT_SIGNING_KEY / QSTASH_NEXT_SIGNING_KEY are
 * present in the worker env, and talks to the region endpoint in QSTASH_URL.
 */
export const processArticleWorkflow = serve<ProcessorParams, Env>(
	async (context) => {
		const env = context.env as unknown as Env;
		const { article, reprocess = false } = context.requestPayload;

		if (!reprocess) {
			const isProcessed = await context.run('check_if_processed', async () => {
				const cacheKey = `${CACHE_KEY_PREFIX}${article.url}`;
				return (await env.GH_NEWS_CACHE.get(cacheKey)) !== null;
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

		const summary = await context.run('generate_summary', async () => {
			return await summarizeArticle(article.content);
		});

		if (!summary) {
			throw new Error(`Failed to generate summary for article: ${article.url}`);
		}

		// Escapes HTML and truncates to Telegram's 1024-char caption limit —
		// oversized/unescaped captions are rejected with a 400 that no retry fixes
		const telegramMessage = await context.run('create_message', async () => {
			return buildTelegramCaption(article.title, summary);
		});

		const sendResult = await context.run('send_telegram_message', async () => {
			const imageUrl = article.image_url || '';
			return await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, env.TELEGRAM_CHANNEL_ID, telegramMessage, imageUrl, article.url);
		});

		if (!sendResult) {
			throw new Error(`Failed to send Telegram message for article: ${article.url}`);
		}

		await context.run('mark_as_processed', async () => {
			const metadata = {
				processed_at: new Date().toISOString(),
				title: article.title,
				url: article.url,
				summary: summary,
			};

			// TTL must outlast how long an article can linger on the
			// homepage/feed, or it gets reprocessed
			const ttl = 30 * 86400;

			const cacheKey = `${CACHE_KEY_PREFIX}${article.url}`;
			await env.GH_NEWS_CACHE.put(cacheKey, JSON.stringify(metadata), { expirationTtl: ttl });

			return { success: true };
		});

		return {
			success: true,
			url: article.url,
			title: article.title,
			summary: summary,
			telegramSent: true,
			processedAt: new Date().toISOString(),
		};
	},
	{
		// Retries and flowControl are set where runs are triggered (scraper.ts)
		failureFunction: async ({ context, failStatus, failResponse }) => {
			const article = (context.requestPayload as ProcessorParams | undefined)?.article;
			console.error('Article processing permanently failed', {
				url: article?.url,
				status: failStatus,
				response: failResponse,
			});

			// DM the admin chat if one is configured; the run also lands in the
			// QStash DLQ either way
			const env = context.env as unknown as Env;
			if (env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_ADMIN_CHAT_ID) {
				await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({
						chat_id: env.TELEGRAM_ADMIN_CHAT_ID,
						text: `⚠️ gh-news processor failed permanently\n${article?.url ?? 'unknown article'}\nstatus: ${failStatus}\n${failResponse}`.slice(0, 4000),
					}),
				}).catch((err) => console.error('Failed to notify admin chat:', err));
			}
		},
	}
);
