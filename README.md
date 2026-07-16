# Ghana News InBrief

A serverless news pipeline that scrapes MyJoyOnline, summarizes new articles with OpenAI, and posts them to a Telegram channel. Compute runs on a Cloudflare Worker; all orchestration (scheduling, retries, durable multi-step execution) lives in Upstash QStash / Upstash Workflow.

## How It Works

1. **Schedule**: A QStash schedule POSTs `/qstash/scrape` every 3 hours (see `scripts/create-schedule.mjs`). There are no Cloudflare cron triggers — the empty `triggers.crons` list in `wrangler.jsonc` is deliberate and load-bearing.
2. **Scrape** (`worker/scraper.ts`, runs inline in the request):
   - Extracts article links from the MyJoyOnline homepage using Cloudflare's HTMLRewriter
   - Parses the RSS feed with fast-xml-parser to get titles, summaries, and images
   - Filters out already-processed articles via a bulk KV read (`article:` key prefix)
   - Triggers one Upstash Workflow run per new article in a single batched QStash call
3. **Process** (`worker/workflows/process-article.ts`, an Upstash Workflow): each step is a checkpointed `context.run` — QStash drives the steps via signed HTTP callbacks, so a retry resumes at the failed step instead of rerunning the whole pipeline:
   - `check_if_processed`: idempotency re-check against KV (skippable with `reprocess: true`)
   - `generate_summary`: two-paragraph summary via OpenAI `gpt-4.1-mini` (Vercel AI SDK, `generateObject`)
   - `create_message`: builds the Telegram HTML caption — decodes WordPress-double-encoded entities, escapes HTML, and truncates to Telegram's 1024-char caption limit
   - `send_telegram_message`: posts the photo + caption + "Read more" button to the channel, falling back to a stock image if the article image is rejected
   - `mark_as_processed`: writes article metadata to KV with a 30-day TTL (must outlast how long an article can linger on the homepage, or it gets reposted)

A shared flow-control key (`gh-news-openai`, parallelism 2) caps concurrent OpenAI calls across **all** runs, so a burst of new articles doesn't stampede the API.

If a run exhausts its retries, a `failureFunction` logs the failure and DMs `TELEGRAM_ADMIN_CHAT_ID` (if configured); the run also lands in the QStash dead-letter queue.

## Key Technologies

- **Cloudflare Workers + Hono**: stateless HTTP host for the pipeline
- **Upstash QStash / Workflow**: scheduling, retries, flow control, durable step execution, DLQ
- **Cloudflare KV**: processed-article dedupe with TTL auto-expiration
- **OpenAI (`gpt-4.1-mini`)** via the Vercel AI SDK: article summarization
- **HTMLRewriter + fast-xml-parser + ky**: lightweight scraping stack

## File Structure

- `worker/index.ts`: Hono app — health endpoints and the two QStash-only routes
- `worker/scraper.ts`: homepage + RSS scraping, KV dedupe, workflow fan-out
- `worker/workflows/process-article.ts`: per-article Upstash Workflow (summarize → format → send → mark processed)
- `worker/utils.ts`: OpenAI summarization, Telegram caption building/escaping, Telegram send with image fallback
- `worker/types.ts`: `Env` bindings and workflow parameter types
- `scripts/create-schedule.mjs`: creates/updates the QStash scrape schedule (idempotent via a stable schedule ID)
- `wrangler.jsonc`: Cloudflare Workers configuration

## Endpoints

- `GET /`: service name
- `GET /health`: health check
- `POST /qstash/scrape`: scrape entry point — **requires a valid QStash signature** (invoked by the schedule, or by a manual signed publish)
- `POST /qstash/process-article`: Upstash Workflow endpoint for the per-article processor — `serve()` verifies QStash signatures itself

Nothing mutating is publicly triggerable; both POST routes only accept signed QStash deliveries.

## Configuration

Environment (Wrangler secrets):

```
wrangler secret put OPENAI_API_KEY
wrangler secret put TELEGRAM_BOT_TOKEN
wrangler secret put TELEGRAM_CHANNEL_ID
wrangler secret put QSTASH_URL                  # region endpoint, e.g. https://qstash.upstash.io
wrangler secret put QSTASH_TOKEN
wrangler secret put QSTASH_CURRENT_SIGNING_KEY
wrangler secret put QSTASH_NEXT_SIGNING_KEY
wrangler secret put TELEGRAM_ADMIN_CHAT_ID      # optional: DM target for permanent-failure alerts
```

KV: update the `GH_NEWS_CACHE` namespace ID in `wrangler.jsonc` to your own.

## Deployment

1. Set the secrets above and the KV namespace ID
2. Deploy the worker: `npm run deploy`
3. Create the scrape schedule (re-runnable; updates in place):
   ```
   node scripts/create-schedule.mjs https://gh-news-worker.<subdomain>.workers.dev
   ```
