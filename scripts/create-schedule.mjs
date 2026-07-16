// Creates (or overwrites) the QStash schedule that drives the scraper.
// Usage: node scripts/create-schedule.mjs https://gh-news-worker.<subdomain>.workers.dev
// Reads QSTASH_TOKEN from .env or the environment.
import { readFileSync } from 'node:fs';

const baseUrl = process.argv[2];
if (!baseUrl) {
	console.error('Usage: node scripts/create-schedule.mjs <worker-base-url>');
	process.exit(1);
}

function readEnvVar(name) {
	if (process.env[name]) return process.env[name];
	try {
		const env = readFileSync(new URL('../.env', import.meta.url), 'utf8');
		// Strip surrounding quotes, if any
		return env
			.match(new RegExp(`^${name}=(.+)$`, 'm'))?.[1]
			?.trim()
			.replace(/^["']|["']$/g, '');
	} catch {
		return undefined;
	}
}

const token = readEnvVar('QSTASH_TOKEN');
const qstashUrl = (readEnvVar('QSTASH_URL') || 'https://qstash.upstash.io').replace(/\/$/, '');
if (!token) {
	console.error('QSTASH_TOKEN not found in environment or .env');
	process.exit(1);
}

const destination = `${baseUrl.replace(/\/$/, '')}/qstash/scrape`;

// Stable scheduleId makes this idempotent: re-running updates in place
const res = await fetch(`${qstashUrl}/v2/schedules/${destination}`, {
	method: 'POST',
	headers: {
		Authorization: `Bearer ${token}`,
		'Upstash-Cron': '0 */3 * * *',
		'Upstash-Schedule-Id': 'gh-news-scrape',
		'Upstash-Retries': '3',
	},
});

const bodyText = await res.text();
if (!res.ok) {
	console.error(`Failed (${res.status}): ${bodyText}`);
	process.exit(1);
}
console.log(`Schedule gh-news-scrape -> ${destination} every 3h:`, bodyText);
