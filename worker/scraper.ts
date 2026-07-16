// src/scraper.ts
import ky from 'ky';
import { XMLParser } from 'fast-xml-parser';
import { Env, ScraperParams, Article } from './types';
import { getCurrentUTCDate } from './utils';

const CACHE_KEY_PREFIX = 'article:';
const DEFAULT_MAIN_URL = 'https://www.myjoyonline.com/';
const DEFAULT_FEED_URL = 'https://www.myjoyonline.com/feed/';

export interface ScrapeResult {
	success: boolean;
	total_links: number;
	total_processed: number;
	processors: { url: string; processor_id: string; status: string }[];
	timestamp: string;
}

/**
 * Parse RSS feed using fast-xml-parser
 */
function parseRSSFeed(xml: string): Record<string, any> {
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
async function scrapeMainPage(url: string): Promise<string[]> {
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
async function scrapeFeed(url: string): Promise<Record<string, any>> {
	try {
		const response = await ky.get(url, {
			timeout: 10000,
			retry: 2,
		});

		const xml = await response.text();
		return parseRSSFeed(xml);
	} catch (error) {
		console.error(`Failed to fetch or parse feed ${url}:`, error);
		return {};
	}
}

/**
 * Scrapes Joy News, filters out already-processed articles via KV,
 * and spawns a processor workflow per new article.
 */
export async function runScraper(env: Env, params: ScraperParams = {}): Promise<ScrapeResult> {
	const mainUrl = params.main_url || DEFAULT_MAIN_URL;
	const feedUrl = params.feed_url || DEFAULT_FEED_URL;

	const [articleLinks, feedEntries] = await Promise.all([scrapeMainPage(mainUrl), scrapeFeed(feedUrl)]);

	// Check which articles have already been processed using bulk read
	const processed: Record<string, boolean> = {};
	if (articleLinks.length > 0) {
		const cacheKeys = articleLinks.map((link) => `${CACHE_KEY_PREFIX}${link}`);
		const cachedValues = await env.GH_NEWS_CACHE.get(cacheKeys);
		for (const link of articleLinks) {
			processed[link] = cachedValues.get(`${CACHE_KEY_PREFIX}${link}`) !== null;
		}
	}

	// Prepare articles for processing
	const articlesToProcess: Article[] = [];
	for (const link of articleLinks) {
		if (processed[link]) {
			continue;
		}

		const entry = feedEntries[link];
		if (!entry) {
			console.log(`Article not found in feed: ${link}`);
			continue;
		}

		const datePublished = entry.published ? new Date(entry.published).toISOString() : getCurrentUTCDate().toISOString();

		articlesToProcess.push({
			title: entry.title || '',
			url: link,
			date_published: datePublished,
			content: entry.summary || '',
			image_url: entry.media_content?.[0]?.url || '',
		});
	}

	// Trigger processing workflow for each new article
	let processors: ScrapeResult['processors'] = [];
	if (articlesToProcess.length > 0) {
		const batchData = articlesToProcess.map((article) => ({
			id: crypto.randomUUID(),
			params: { article },
		}));

		const instances = await env.GH_NEWS_PROCESSOR_WORKFLOW.createBatch(batchData);

		processors = instances.map((instance, index) => ({
			url: articlesToProcess[index].url,
			processor_id: instance.id,
			status: 'triggered',
		}));
	}

	return {
		success: true,
		total_links: articleLinks.length,
		total_processed: articlesToProcess.length,
		processors,
		timestamp: getCurrentUTCDate().toISOString(),
	};
}
