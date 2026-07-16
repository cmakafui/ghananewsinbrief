// src/types.ts
export interface Env {
	// KV Storage bindings
	GH_NEWS_CACHE: KVNamespace;
	// QStash / Upstash Workflow (QSTASH_URL is region-specific, e.g. EU)
	QSTASH_URL: string;
	QSTASH_TOKEN: string;
	QSTASH_CURRENT_SIGNING_KEY: string;
	QSTASH_NEXT_SIGNING_KEY: string;
	// API keys
	GOOGLE_GENERATIVE_AI_API_KEY: string;
	OPENAI_API_KEY: string;
	TELEGRAM_BOT_TOKEN: string;
	TELEGRAM_CHANNEL_ID: string;
	// Optional: personal chat for permanent-failure alerts
	TELEGRAM_ADMIN_CHAT_ID?: string;
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
