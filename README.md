# Ghana News InBrief - Cloudflare Workflows Implementation

This implementation uses Cloudflare Workflows to create a durable, multi-step news aggregation system while keeping dependencies lightweight.

## Core Components

### 1. Workflow Structure

Two primary workflows handle the news processing pipeline:

- **JoyNewsScraperWorkflow**: Scrapes the MyJoyOnline website and RSS feeds, identifies new articles, and triggers the processor workflow for each new article.
- **GHNewsProcessorWorkflow**: Processes individual articles, generates summaries using Google Gemini, and sends them to Telegram.

### 2. Key Technologies Used

- **Cloudflare HTMLRewriter**: Used for HTML parsing on the main page
- **fast-xml-parser**: A lightweight XML parser for RSS feed processing
- **ky**: A lightweight HTTP client for fetching content
- **Cloudflare KV**: For storing processed article information with TTL (auto-expiration)
- **Google Gemini API**: For AI-powered article summarization
- **Cloudflare Workflows**: For durable, multi-step execution with automatic retries

### 3. How It Works

1. **Scraper Workflow**:

   - Fetches article links from the MyJoyOnline page using HTMLRewriter
   - Parses the RSS feed using fast-xml-parser
   - Identifies unprocessed articles by checking KV storage with prefixed keys
   - Triggers processor workflows for new articles using efficient batch processing

2. **Processor Workflow**:
   - Generates a summary for each article using Google Gemini
   - Sends the article to Telegram with an image, summary, and link
   - Stores the article in KV with prefixed keys and TTL for automatic expiration (1 day)

### 4. Key Improvements

- **Batch Processing**: Efficient creation of multiple processor workflows in a single API call
- **Improved Caching**: KV storage with prefixed keys (`article:`) for better organization
- **Idempotent Operations**: Enhanced checks to prevent duplicate processing
- **Proper URL Encoding**: Using `encodeURI()` to handle spaces and special characters in image URLs
- **Durability**: Reliable execution with automated retries for any failed steps
- **Auto-expiring Storage**: KV with TTL instead of manual database cleanup
- **Lightweight Dependencies**: Native APIs and small dependencies
- **Scheduled Execution**: Built-in cron triggers for periodic scraping (every 10 minutes)

## File Structure

1. **src/types.ts**: Type definitions for environment variables and workflow parameters
2. **src/utils.ts**: Utility functions for article summarization, Telegram messaging, and date handling
3. **src/workflows/joy-news-scraper.ts**: Implementation of the news scraper workflow with RSS parsing
4. **src/workflows/gh-news-processor.ts**: Implementation of the article processor workflow
5. **src/index.ts**: HTTP endpoints and scheduled triggers
6. **wrangler.toml**: Cloudflare Workers configuration
7. **package.json**: Project dependencies

## API Endpoints

(Current endpoints do not support authentication, but this can be added as needed)

- `GET /`: Root endpoint displaying service name
- `GET /health`: Health check endpoint
- `POST /api/workflows/scraper`: Manually trigger the news scraper workflow
- `POST /api/workflows/processor`: Manually process a single article
- `GET /api/workflows/:type/:id`: Get workflow status by type and ID

## Deployment Steps

1. Update the KV namespace ID in wrangler.jsonc
2. Set your API keys using Wrangler secrets:
   ```
   wrangler secret put GOOGLE_GENERATIVE_AI_API_KEY
   wrangler secret put TELEGRAM_BOT_TOKEN
   wrangler secret put TELEGRAM_CHANNEL_ID
   ```
3. Deploy with `npm run deploy` (make sure to have wrangler installed and configured)

This implementation leverages Cloudflare Workflows' architecture and built-in features for a robust, serverless solution that automatically aggregates news, generates AI summaries, and distributes content to Telegram.
