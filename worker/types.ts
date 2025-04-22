// src/types.ts
export interface Env {
	// KV Storage bindings
	GH_NEWS_CACHE: KVNamespace;
	// Workflows bindings
	JOY_NEWS_SCRAPER_WORKFLOW: Workflow;
	GH_NEWS_PROCESSOR_WORKFLOW: Workflow;
	// API keys
	GOOGLE_GENERATIVE_AI_API_KEY: string;
	TELEGRAM_BOT_TOKEN: string;
	TELEGRAM_CHANNEL_ID: string;
}

export interface Article {
	title: string;
	url: string;
	date_published: string;
	content: string;
	image_url?: string;
}

export interface ScraperParams {
	main_url?: string;
	feed_url?: string;
}

export interface ProcessorParams {
	article: Article;
	reprocess?: boolean;
}
