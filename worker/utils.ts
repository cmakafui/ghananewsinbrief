// src/utils.ts
import { google } from '@ai-sdk/google';
import { generateObject } from 'ai';
import { z } from 'zod';
import ky from 'ky';

// Define schema for article summary
const ArticleSummarySchema = z.object({
	summary: z.string().describe('A concise two-paragraph summary of the article'),
});

/**
 * Uses Google Gemini to summarize an article
 */
export async function summarizeArticle(content: string): Promise<string | null> {
	try {
		// Configure the Google Gemini model
		const model = google('gemini-2.5-flash-preview-04-17');

		// Generate a summary of the article
		const { object } = await generateObject({
			model,
			schema: ArticleSummarySchema,
			prompt: `Provide 2 paragraphs summarizing the following article:\n\n${content}`,
		});

		return object.summary;
	} catch (error) {
		console.error('Summarization failed:', error);
		return null;
	}
}

/**
 * Sends a message to a Telegram channel using ky
 */
export async function sendTelegramMessage(
	botToken: string,
	channelId: string,
	message: string,
	imageUrl: string,
	articleUrl: string
): Promise<boolean> {
	try {
		// Simply use encodeURI to properly handle spaces and special characters
		const encodedImageUrl = encodeURI(imageUrl);

		// Create inline keyboard with article link
		const inlineKeyboard = {
			inline_keyboard: [[{ text: 'Read more', url: articleUrl }]],
		};

		// Prepare the request to Telegram API using ky
		const result = await ky
			.post(`https://api.telegram.org/bot${botToken}/sendPhoto`, {
				json: {
					chat_id: channelId,
					photo: encodedImageUrl,
					caption: message,
					parse_mode: 'HTML',
					reply_markup: inlineKeyboard,
				},
				timeout: 30000,
				retry: {
					limit: 3,
					methods: ['POST'],
				},
			})
			.json<{ ok: boolean; description?: string }>();

		if (!result.ok) {
			console.error('Telegram API error:', result.description);
			return false;
		}

		return true;
	} catch (error) {
		console.error('Error sending Telegram message:', error);
		return false;
	}
}

/**
 * Gets current date/time in UTC format
 */
export function getCurrentUTCDate(): Date {
	return new Date();
}

/**
 * Gets TTL date by adding days to current date
 */
export function getTTLDate(days: number = 1): Date {
	const date = getCurrentUTCDate();
	date.setDate(date.getDate() + days);
	return date;
}
