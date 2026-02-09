/**
 * Webhookテンプレートレンダリング・スケジュール計算ユーティリティ
 */

/**
 * テンプレート文字列中の {{variableName}} を variables の値で置換する
 * ネストされたキー（例: expense.amount）にも対応
 *
 * @param template テンプレート文字列
 * @param variables 変数のキーと値のマップ
 * @returns 置換後の文字列
 */
export function renderTemplate(
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

/**
 * スケジュール種別
 */
export type ScheduleType = 'hourly' | 'daily' | 'weekly' | 'monthly';

/**
 * スケジュール設定
 */
export interface ScheduleConfig {
  scheduleType: ScheduleType;
  minute?: number;    // 0-59 (hourly/daily/weekly/monthly)
  hour?: number;      // 0-23 (daily/weekly/monthly)
  dayOfWeek?: number; // 0-6, 0=Sunday (weekly)
  dayOfMonth?: number; // 1-31 (monthly)
}

/**
 * スケジュールの次回実行時刻を計算する
 *
 * @param config スケジュール設定
 * @param now 現在時刻（テスト用、省略時は現在日時）
 * @returns 次回実行のDate
 */
export function calculateNextExecution(
  config: ScheduleConfig,
  now: Date = new Date()
): Date {
  const next = new Date(now);

  switch (config.scheduleType) {
    case 'hourly': {
      const minute = config.minute ?? 0;
      next.setUTCMinutes(minute, 0, 0);
      if (next <= now) {
        next.setUTCHours(next.getUTCHours() + 1);
      }
      return next;
    }

    case 'daily': {
      const hour = config.hour ?? 9;
      const minute = config.minute ?? 0;
      next.setUTCHours(hour, minute, 0, 0);
      if (next <= now) {
        next.setUTCDate(next.getUTCDate() + 1);
      }
      return next;
    }

    case 'weekly': {
      const dayOfWeek = config.dayOfWeek ?? 1; // default Monday
      const hour = config.hour ?? 9;
      const minute = config.minute ?? 0;
      next.setUTCHours(hour, minute, 0, 0);
      const currentDay = next.getUTCDay();
      let daysUntil = dayOfWeek - currentDay;
      if (daysUntil < 0) {
        daysUntil += 7;
      }
      if (daysUntil === 0 && next <= now) {
        daysUntil = 7;
      }
      next.setUTCDate(next.getUTCDate() + daysUntil);
      return next;
    }

    case 'monthly': {
      const dayOfMonth = config.dayOfMonth ?? 1;
      const hour = config.hour ?? 9;
      const minute = config.minute ?? 0;
      next.setUTCHours(hour, minute, 0, 0);
      next.setUTCDate(dayOfMonth);
      if (next <= now) {
        next.setUTCMonth(next.getUTCMonth() + 1);
        next.setUTCDate(dayOfMonth);
      }
      return next;
    }
  }
}

/**
 * スケジュールが実行すべきタイミングかどうかを判定する
 *
 * @param nextExecutionAt 次回実行予定時刻（ISO 8601）
 * @param now 現在時刻
 * @returns 実行すべきならtrue
 */
export function isDue(nextExecutionAt: string, now: Date = new Date()): boolean {
  return new Date(nextExecutionAt) <= now;
}

/**
 * スケジュール種別に基づいて集計期間を計算する
 *
 * @param scheduleType スケジュール種別
 * @param now 現在時刻
 * @returns 集計期間の開始日と終了日（YYYY-MM-DD形式）
 */
export function calculatePeriodRange(
  scheduleType: ScheduleType,
  now: Date = new Date()
): { start: string; end: string; month: string } {
  const pad = (n: number) => String(n).padStart(2, '0');
  const formatDate = (d: Date) =>
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  const formatMonth = (d: Date) =>
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;

  switch (scheduleType) {
    case 'hourly': {
      // 直近1時間
      const end = new Date(now);
      const start = new Date(now);
      start.setUTCHours(start.getUTCHours() - 1);
      return {
        start: formatDate(start),
        end: formatDate(end),
        month: formatMonth(now),
      };
    }

    case 'daily': {
      // 前日
      const end = new Date(now);
      end.setUTCDate(end.getUTCDate() - 1);
      return {
        start: formatDate(end),
        end: formatDate(end),
        month: formatMonth(end),
      };
    }

    case 'weekly': {
      // 直近7日間
      const end = new Date(now);
      end.setUTCDate(end.getUTCDate() - 1);
      const start = new Date(end);
      start.setUTCDate(start.getUTCDate() - 6);
      return {
        start: formatDate(start),
        end: formatDate(end),
        month: formatMonth(now),
      };
    }

    case 'monthly': {
      // 前月
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

/**
 * バッチWebhookのデフォルトペイロードを生成する
 *
 * @param data 集計データ
 * @returns JSON文字列
 */
export function buildDefaultBatchPayload(data: {
  scheduleType: ScheduleType;
  periodStart: string;
  periodEnd: string;
  month: string;
  totalSpent: number;
  budget: number | null;
  remaining: number | null;
  expenseCount: number;
}): string {
  return JSON.stringify({
    type: 'batch_summary',
    scheduleType: data.scheduleType,
    period: {
      start: data.periodStart,
      end: data.periodEnd,
    },
    month: data.month,
    summary: {
      totalSpent: data.totalSpent,
      budget: data.budget,
      remaining: data.remaining,
      expenseCount: data.expenseCount,
    },
    generatedAt: new Date().toISOString(),
  });
}

/**
 * テンプレートからバッチペイロードを生成する
 *
 * @param template テンプレート文字列
 * @param data 集計データ
 * @returns レンダリング済み文字列
 */
export function buildBatchPayloadFromTemplate(
  template: string,
  data: {
    scheduleType: ScheduleType;
    periodStart: string;
    periodEnd: string;
    month: string;
    totalSpent: number;
    budget: number | null;
    remaining: number | null;
    expenseCount: number;
  }
): string {
  return renderTemplate(template, {
    scheduleType: data.scheduleType,
    periodStart: data.periodStart,
    periodEnd: data.periodEnd,
    month: data.month,
    totalSpent: data.totalSpent,
    budget: data.budget,
    remaining: data.remaining,
    expenseCount: data.expenseCount,
  });
}

/**
 * イベントWebhookのデフォルトペイロードを生成する
 *
 * @param event イベント種別
 * @param userId ユーザーID
 * @param expense 支出データ
 * @returns JSON文字列
 */
export function buildDefaultEventPayload(
  event: string,
  userId: string,
  expense: {
    id: string;
    amount: number;
    category?: string | null;
    memo?: string | null;
    date: string;
    createdAt: string;
    updatedAt: string;
    deviceId: string;
  }
): string {
  return JSON.stringify({
    event,
    occurredAt: new Date().toISOString(),
    userId,
    expense: {
      id: expense.id,
      amount: expense.amount,
      category: expense.category ?? null,
      memo: expense.memo ?? null,
      date: expense.date,
      createdAt: expense.createdAt,
      updatedAt: expense.updatedAt,
      deviceId: expense.deviceId,
    },
  });
}

/**
 * テンプレートからイベントペイロードを生成する
 *
 * @param template テンプレート文字列
 * @param event イベント種別
 * @param userId ユーザーID
 * @param expense 支出データ
 * @returns レンダリング済み文字列
 */
export function buildEventPayloadFromTemplate(
  template: string,
  event: string,
  userId: string,
  expense: {
    id: string;
    amount: number;
    category?: string | null;
    memo?: string | null;
    date: string;
    createdAt: string;
    updatedAt: string;
    deviceId: string;
  }
): string {
  return renderTemplate(template, {
    event,
    userId,
    'expense.id': expense.id,
    'expense.amount': expense.amount,
    'expense.category': expense.category,
    'expense.memo': expense.memo,
    'expense.date': expense.date,
    'expense.createdAt': expense.createdAt,
    'expense.updatedAt': expense.updatedAt,
    'expense.deviceId': expense.deviceId,
  });
}
