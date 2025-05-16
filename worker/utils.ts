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
		const model = google('gemini-2.0-flash');

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
		// Properly encode the image URL to handle spaces and special characters
		const encodedImageUrl = encodeURI(imageUrl);

		// Create inline keyboard with article link
		const inlineKeyboard = {
			inline_keyboard: [[{ text: 'Read more', url: articleUrl }]],
		};

		// Try with the provided image
		try {
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
						limit: 2,
						methods: ['POST'],
					},
				})
				.json<{ ok: boolean; description?: string }>();

			if (result.ok) {
				return true;
			}

			console.log('Using fallback image due to error:', result.description);
		} catch (photoError) {
			console.log('Using fallback image due to error:', photoError);
		}

		// If original image fails, try with the fallback image
		const fallbackImageUrl =
			'https://images.unsplash.com/photo-1504711434969-e33886168f5c?ixlib=rb-4.0.3&q=80&fm=jpg&crop=entropy&cs=tinysrgb&w=800&h=400&fit=crop';

		const fallbackResult = await ky
			.post(`https://api.telegram.org/bot${botToken}/sendPhoto`, {
				json: {
					chat_id: channelId,
					photo: fallbackImageUrl,
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

		if (!fallbackResult.ok) {
			console.error('Telegram fallback photo error:', fallbackResult.description);
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
