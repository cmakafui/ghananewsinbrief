// src/workflows/joy-news-scraper.ts
import { WorkflowEntrypoint, WorkflowStep, WorkflowEvent } from 'cloudflare:workers';
import ky from 'ky';
import { XMLParser } from 'fast-xml-parser';
import { Env, ScraperParams, Article } from '../types';
import { getCurrentUTCDate } from '../utils';

export class JoyNewsScraperWorkflow extends WorkflowEntrypoint<Env, ScraperParams> {
	// Prefix for cache keys
	private readonly CACHE_KEY_PREFIX = 'article:';
	private readonly DEFAULT_MAIN_URL = 'https://www.myjoyonline.com/';
	private readonly DEFAULT_FEED_URL = 'https://www.myjoyonline.com/feed/';

	/**
	 * Parse RSS feed using fast-xml-parser
	 */
	private parseRSSFeed(xml: string): Record<string, any> {
		try {
			const parser = new XMLParser({
				ignoreAttributes: false,
				attributeNamePrefix: '@_',
				isArray: (name) => name === 'item',
			});

			const result = parser.parse(xml);
			const entries: Record<string, any> = {};

			// Map items to a dictionary with URL as key for easier lookup
			if (result.rss?.channel?.item && Array.isArray(result.rss.channel.item)) {
				for (const item of result.rss.channel.item) {
					if (item.link) {
						entries[item.link] = {
							title: item.title || '',
							link: item.link,
							published: item.pubDate || '',
							summary: item.description || '',
							media_content: item['media:content'] ? [{ url: item['media:content']['@_url'] || '' }] : [],
						};
					}
				}
			}

			return entries;
		} catch (error) {
			console.error('Error parsing RSS feed:', error);
			return {};
		}
	}

	/**
	 * Fetches and parses the main news page
	 */
	private async scrapeMainPage(url: string): Promise<string[]> {
		const links: string[] = [];

		try {
			const response = await ky.get(url, {
				timeout: 10000,
				retry: 2,
			});

			const html = await response.text();

			// Create a Response to use with HTMLRewriter
			const htmlResponse = new Response(html);

			// Use HTMLRewriter to extract article links
			await new HTMLRewriter()
				.on('div.home-post-list-title a', {
					element(element) {
						const href = element.getAttribute('href');
						if (href) {
							links.push(href);
						}
					},
				})
				.transform(htmlResponse)
				.arrayBuffer();

			return links;
		} catch (error) {
			console.error(`Failed to fetch or parse ${url}:`, error);
			return [];
		}
	}

	/**
	 * Fetches and parses the RSS feed
	 */
	private async scrapeFeed(url: string): Promise<Record<string, any>> {
		try {
			const response = await ky.get(url, {
				timeout: 10000,
				retry: 2,
			});

			const xml = await response.text();
			return this.parseRSSFeed(xml);
		} catch (error) {
			console.error(`Failed to fetch or parse feed ${url}:`, error);
			return {};
		}
	}

	/**
	 * Main workflow execution
	 */
	async run(event: WorkflowEvent<ScraperParams>, step: WorkflowStep) {
		// Get URLs from parameters or use defaults
		const mainUrl = event.payload?.main_url || this.DEFAULT_MAIN_URL;
		const feedUrl = event.payload?.feed_url || this.DEFAULT_FEED_URL;

		// Step 1: Fetch article links from the main page
		const articleLinks = await step.do(
			'fetch_article_links',
			{
				retries: {
					limit: 3,
					delay: '5 second',
					backoff: 'exponential',
				},
			},
			async () => {
				return await this.scrapeMainPage(mainUrl);
			}
		);

		// Step 2: Fetch and parse the RSS feed
		const feedEntries = await step.do(
			'fetch_feed_entries',
			{
				retries: {
					limit: 3,
					delay: '5 second',
					backoff: 'exponential',
				},
			},
			async () => {
				return await this.scrapeFeed(feedUrl);
			}
		);

		// Step 3: Check which articles have already been processed using bulk read
		const processedArticles = await step.do('check_processed_articles', async () => {
			const processed: Record<string, boolean> = {};

			if (articleLinks.length === 0) {
				return processed;
			}

			// Create array of cache keys with prefix
			const cacheKeys = articleLinks.map((link) => `${this.CACHE_KEY_PREFIX}${link}`);

			// Use bulk read to get all values at once (up to 100 keys)
			const cachedValues = await this.env.GH_NEWS_CACHE.get(cacheKeys);

			// Map results back to the original article links
			for (const link of articleLinks) {
				const cacheKey = `${this.CACHE_KEY_PREFIX}${link}`;
				processed[link] = cachedValues.get(cacheKey) !== null;
			}

			return processed;
		});

		// Step 4: Prepare articles for processing
		const articlesToProcess = await step.do('prepare_articles', async () => {
			const articles: Article[] = [];

			for (const link of articleLinks) {
				// Skip already processed articles
				if (processedArticles[link]) {
					console.log(`Skipping already processed article: ${link}`);
					continue;
				}

				// Get article data from feed
				const entry = feedEntries[link];
				if (!entry) {
					console.log(`Article not found in feed: ${link}`);
					continue;
				}

				// Convert date
				const datePublished = entry.published ? new Date(entry.published).toISOString() : getCurrentUTCDate().toISOString();

				// Create article object
				articles.push({
					title: entry.title || '',
					url: link,
					date_published: datePublished,
					content: entry.summary || '',
					image_url: entry.media_content?.[0]?.url || '',
				});
			}

			return articles;
		});

		// Step 5: Trigger processing workflow for each article - using batch processing
		const processorResults = await step.do('trigger_processors', async () => {
			// No articles to process
			if (articlesToProcess.length === 0) {
				return [];
			}

			// Prepare batch data
			const batchData = articlesToProcess.map((article) => ({
				id: crypto.randomUUID(),
				params: { article },
			}));

			// Create workflows in batch
			const instances = await this.env.GH_NEWS_PROCESSOR_WORKFLOW.createBatch(batchData);

			// Map results to match original format
			return instances.map((instance, index) => ({
				url: articlesToProcess[index].url,
				processor_id: instance.id,
				status: 'triggered',
			}));
		});

		return {
			success: true,
			total_links: articleLinks.length,
			total_processed: articlesToProcess.length,
			processors: processorResults,
			timestamp: getCurrentUTCDate().toISOString(),
		};
	}
}
