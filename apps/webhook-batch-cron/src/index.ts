/**
 * Webhookバッチ配信用Cronワーカー
 *
 * 毎時0分に実行され、実行予定のバッチスケジュールを処理する。
 * - スケジュール設定に基づいて集計データを取得
 * - テンプレートを使用してペイロードを生成
 * - 対象のWebhookエンドポイントに配信
 */

interface Env {
	DB: D1Database;
	WEBHOOK_SECRET_KEY?: string;
}

interface WebhookBatchScheduleRow {
	id: string;
	user_id: string;
	webhook_id: string;
	schedule_type: string;
	minute: number;
	hour: number | null;
	day_of_week: number | null;
	day_of_month: number | null;
	body_template: string | null;
	custom_headers: string | null;
	is_active: number;
	last_executed_at: string | null;
	next_execution_at: string;
	created_at: string;
	updated_at: string;
}

interface WebhookRow {
	id: string;
	user_id: string;
	url: string;
	secret_encrypted: string | null;
	secret_iv: string | null;
	custom_headers: string | null;
	body_template: string | null;
}

interface BudgetRow {
	amount: number;
}

interface ExpenseSummaryRow {
	total_spent: number;
	expense_count: number;
}

type ScheduleType = 'hourly' | 'daily' | 'weekly' | 'monthly';

// --- テンプレートレンダリング（軽量版、domainパッケージと同じロジック） ---

function renderTemplate(
	template: string,
	variables: Record<string, string | number | null | undefined>
): string {
	return template.replace(/\{\{(\s*[\w.]+\s*)\}\}/g, (_match, key: string) => {
		const trimmedKey = key.trim();
		const value = variables[trimmedKey];
		if (value === null || value === undefined) {
			return '';
		}
		return String(value);
	});
}

// --- スケジュール計算（軽量版） ---

function calculateNextExecution(
	scheduleType: ScheduleType,
	minute: number,
	hour: number | null,
	dayOfWeek: number | null,
	dayOfMonth: number | null,
	now: Date
): Date {
	const next = new Date(now);

	switch (scheduleType) {
		case 'hourly': {
			next.setUTCMinutes(minute, 0, 0);
			if (next <= now) {
				next.setUTCHours(next.getUTCHours() + 1);
			}
			return next;
		}
		case 'daily': {
			next.setUTCHours(hour ?? 9, minute, 0, 0);
			if (next <= now) {
				next.setUTCDate(next.getUTCDate() + 1);
			}
			return next;
		}
		case 'weekly': {
			const targetDay = dayOfWeek ?? 1;
			next.setUTCHours(hour ?? 9, minute, 0, 0);
			const currentDay = next.getUTCDay();
			let daysUntil = targetDay - currentDay;
			if (daysUntil < 0) daysUntil += 7;
			if (daysUntil === 0 && next <= now) daysUntil = 7;
			next.setUTCDate(next.getUTCDate() + daysUntil);
			return next;
		}
		case 'monthly': {
			const targetDate = dayOfMonth ?? 1;
			next.setUTCHours(hour ?? 9, minute, 0, 0);
			next.setUTCDate(targetDate);
			if (next <= now) {
				next.setUTCMonth(next.getUTCMonth() + 1);
				next.setUTCDate(targetDate);
			}
			return next;
		}
	}
}

function calculatePeriodRange(
	scheduleType: ScheduleType,
	now: Date
): { start: string; end: string; month: string } {
	const pad = (n: number) => String(n).padStart(2, '0');
	const formatDate = (d: Date) =>
		`${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
	const formatMonth = (d: Date) =>
		`${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;

	switch (scheduleType) {
		case 'hourly': {
			const end = new Date(now);
			const start = new Date(now);
			start.setUTCHours(start.getUTCHours() - 1);
			return { start: formatDate(start), end: formatDate(end), month: formatMonth(now) };
		}
		case 'daily': {
			const end = new Date(now);
			end.setUTCDate(end.getUTCDate() - 1);
			return { start: formatDate(end), end: formatDate(end), month: formatMonth(end) };
		}
		case 'weekly': {
			const end = new Date(now);
			end.setUTCDate(end.getUTCDate() - 1);
			const start = new Date(end);
			start.setUTCDate(start.getUTCDate() - 6);
			return { start: formatDate(start), end: formatDate(end), month: formatMonth(now) };
		}
		case 'monthly': {
			const prev = new Date(now);
			prev.setUTCMonth(prev.getUTCMonth() - 1);
			const year = prev.getUTCFullYear();
			const month = prev.getUTCMonth() + 1;
			const lastDay = new Date(year, month, 0).getDate();
			return {
				start: `${year}-${pad(month)}-01`,
				end: `${year}-${pad(month)}-${pad(lastDay)}`,
				month: `${year}-${pad(month)}`,
			};
		}
	}
}

// --- HMAC署名 ---

function toHex(buffer: ArrayBuffer): string {
	return Array.from(new Uint8Array(buffer))
		.map((byte) => byte.toString(16).padStart(2, '0'))
		.join('');
}

async function createWebhookSignature(
	secret: string,
	payload: string
): Promise<string> {
	const encoder = new TextEncoder();
	const key = await crypto.subtle.importKey(
		'raw',
		encoder.encode(secret),
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		['sign']
	);
	const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
	return `sha256=${toHex(signature)}`;
}

// --- シークレット復号 ---

async function decryptWebhookSecret(
	encrypted: string,
	iv: string,
	secretKey: string
): Promise<string> {
	const encoder = new TextEncoder();
	const keyMaterial = encoder.encode(secretKey);
	const hash = await crypto.subtle.digest('SHA-256', keyMaterial);
	const key = await crypto.subtle.importKey(
		'raw',
		hash,
		{ name: 'AES-GCM' },
		false,
		['decrypt']
	);

	const decodeBs64 = (value: string): ArrayBuffer => {
		const binary = atob(value);
		const bytes = new Uint8Array(binary.length);
		for (let i = 0; i < binary.length; i++) {
			bytes[i] = binary.charCodeAt(i);
		}
		return bytes.buffer;
	};

	const decrypted = await crypto.subtle.decrypt(
		{ name: 'AES-GCM', iv: decodeBs64(iv) },
		key,
		decodeBs64(encrypted)
	);

	return new TextDecoder().decode(decrypted);
}

// --- メイン処理 ---

async function processDueSchedules(db: D1Database, env: Env): Promise<number> {
	const now = new Date();
	const nowStr = now.toISOString();

	console.log(`[webhook-batch] Processing due schedules at ${nowStr}`);

	// 実行予定のアクティブなスケジュールを取得
	const dueSchedules = await db
		.prepare(
			`SELECT s.*, w.url, w.secret_encrypted, w.secret_iv, w.custom_headers AS webhook_custom_headers, w.body_template AS webhook_body_template
			 FROM webhook_batch_schedules s
			 JOIN webhooks w ON s.webhook_id = w.id
			 WHERE s.is_active = 1
			   AND s.next_execution_at <= ?`
		)
		.bind(nowStr)
		.all<WebhookBatchScheduleRow & {
			url: string;
			secret_encrypted: string | null;
			secret_iv: string | null;
			webhook_custom_headers: string | null;
			webhook_body_template: string | null;
		}>();

	if (!dueSchedules.results || dueSchedules.results.length === 0) {
		console.log('[webhook-batch] No due schedules found');
		return 0;
	}

	console.log(`[webhook-batch] Found ${dueSchedules.results.length} due schedule(s)`);

	let processedCount = 0;

	for (const schedule of dueSchedules.results) {
		try {
			await processSchedule(db, env, schedule, now);
			processedCount++;
		} catch (error) {
			console.error(`[webhook-batch] Failed to process schedule ${schedule.id}:`, error);
		}
	}

	return processedCount;
}

async function processSchedule(
	db: D1Database,
	env: Env,
	schedule: WebhookBatchScheduleRow & {
		url: string;
		secret_encrypted: string | null;
		secret_iv: string | null;
		webhook_custom_headers: string | null;
		webhook_body_template: string | null;
	},
	now: Date
): Promise<void> {
	const scheduleType = schedule.schedule_type as ScheduleType;
	const period = calculatePeriodRange(scheduleType, now);

	// 集計データを取得
	const expenseSummary = await db
		.prepare(
			`SELECT COALESCE(SUM(amount), 0) AS total_spent, COUNT(*) AS expense_count
			 FROM expenses
			 WHERE user_id = ? AND date >= ? AND date <= ?`
		)
		.bind(schedule.user_id, period.start, period.end)
		.first<ExpenseSummaryRow>();

	const totalSpent = expenseSummary?.total_spent ?? 0;
	const expenseCount = expenseSummary?.expense_count ?? 0;

	// 予算を取得
	const budget = await db
		.prepare(
			`SELECT amount FROM budgets
			 WHERE user_id = ? AND month = ?
			 ORDER BY updated_at DESC LIMIT 1`
		)
		.bind(schedule.user_id, period.month)
		.first<BudgetRow>();

	// 予算がなければ最新の予算を取得
	let budgetAmount: number | null = budget?.amount ?? null;
	if (budgetAmount === null) {
		const latestBudget = await db
			.prepare(
				`SELECT amount FROM budgets
				 WHERE user_id = ?
				 ORDER BY month DESC LIMIT 1`
			)
			.bind(schedule.user_id)
			.first<BudgetRow>();
		budgetAmount = latestBudget?.amount ?? null;
	}

	const remaining = budgetAmount !== null ? budgetAmount - totalSpent : null;

	// ペイロードを生成
	const templateData = {
		scheduleType,
		periodStart: period.start,
		periodEnd: period.end,
		month: period.month,
		totalSpent,
		budget: budgetAmount,
		remaining,
		expenseCount,
	};

	// テンプレートの優先順位: スケジュール > webhook > デフォルト
	const template = schedule.body_template ?? schedule.webhook_body_template;

	let payload: string;
	if (template) {
		payload = renderTemplate(template, templateData);
	} else {
		payload = JSON.stringify({
			type: 'batch_summary',
			scheduleType,
			period: { start: period.start, end: period.end },
			month: period.month,
			summary: {
				totalSpent,
				budget: budgetAmount,
				remaining,
				expenseCount,
			},
			generatedAt: now.toISOString(),
		});
	}

	// ヘッダーを構築
	const headers: Record<string, string> = {
		'Content-Type': 'application/json',
		'X-Household-Webhook-Event': 'batch.summary',
		'X-Household-Webhook-Id': schedule.webhook_id,
		'X-Household-Webhook-Schedule-Id': schedule.id,
	};

	// Webhookのカスタムヘッダーをマージ
	if (schedule.webhook_custom_headers) {
		const webhookHeaders = JSON.parse(schedule.webhook_custom_headers) as Record<string, string>;
		Object.assign(headers, webhookHeaders);
	}

	// スケジュールのカスタムヘッダーで上書き
	if (schedule.custom_headers) {
		const scheduleHeaders = JSON.parse(schedule.custom_headers) as Record<string, string>;
		Object.assign(headers, scheduleHeaders);
	}

	// HMAC署名
	if (schedule.secret_encrypted && schedule.secret_iv && env.WEBHOOK_SECRET_KEY) {
		const secret = await decryptWebhookSecret(
			schedule.secret_encrypted,
			schedule.secret_iv,
			env.WEBHOOK_SECRET_KEY
		);
		const signature = await createWebhookSignature(secret, payload);
		headers['X-Household-Webhook-Signature'] = signature;
	}

	// 配信
	const response = await fetch(schedule.url, {
		method: 'POST',
		headers,
		body: payload,
	});

	if (!response.ok) {
		console.error('[webhook-batch] Delivery failed', {
			url: schedule.url,
			status: response.status,
			statusText: response.statusText,
			scheduleId: schedule.id,
		});
	} else {
		console.log(`[webhook-batch] Delivered to ${schedule.url} (schedule: ${schedule.id})`);
	}

	// 次回実行時刻を計算して更新
	const nextExecution = calculateNextExecution(
		scheduleType,
		schedule.minute,
		schedule.hour,
		schedule.day_of_week,
		schedule.day_of_month,
		now
	);

	await db
		.prepare(
			`UPDATE webhook_batch_schedules
			 SET last_executed_at = ?, next_execution_at = ?, updated_at = ?
			 WHERE id = ?`
		)
		.bind(now.toISOString(), nextExecution.toISOString(), now.toISOString(), schedule.id)
		.run();
}

export default {
	async fetch(req: Request, env: Env): Promise<Response> {
		const url = new URL(req.url);
		url.pathname = '/__scheduled';
		url.searchParams.append('cron', '0 * * * *');
		return new Response(
			`This is a scheduled worker that runs every hour at :00.\n` +
			`To test the scheduled handler locally, run:\n` +
			`curl "${url.href}"`
		);
	},

	async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
		console.log(
			`[scheduled] Cron triggered at ${controller.cron} (scheduled time: ${new Date(controller.scheduledTime).toISOString()})`
		);

		if (!env.DB) {
			console.error('[scheduled] D1 database binding (DB) is not configured');
			return;
		}

		const processedCount = await processDueSchedules(env.DB, env);
		console.log(`[scheduled] Processed ${processedCount} batch schedule(s)`);
	},
} satisfies ExportedHandler<Env>;
