import { describe, it, expect } from 'vitest';
import {
  renderTemplate,
  calculateNextExecution,
  isDue,
  calculatePeriodRange,
  buildDefaultBatchPayload,
  buildBatchPayloadFromTemplate,
  buildDefaultEventPayload,
  buildEventPayloadFromTemplate,
} from '../src/webhook';

describe('renderTemplate', () => {
  it('単一の変数を置換する', () => {
    expect(renderTemplate('Hello {{name}}', { name: 'World' })).toBe(
      'Hello World'
    );
  });

  it('複数の変数を置換する', () => {
    const result = renderTemplate(
      '支出: ¥{{amount}} / カテゴリ: {{category}}',
      { amount: 5000, category: '食費' }
    );
    expect(result).toBe('支出: ¥5000 / カテゴリ: 食費');
  });

  it('ネストされたキーを置換する', () => {
    const result = renderTemplate('金額: {{expense.amount}}', {
      'expense.amount': 3000,
    });
    expect(result).toBe('金額: 3000');
  });

  it('存在しない変数は空文字に置換する', () => {
    expect(renderTemplate('Hello {{name}}', {})).toBe('Hello ');
  });

  it('null値は空文字に置換する', () => {
    expect(renderTemplate('Memo: {{memo}}', { memo: null })).toBe('Memo: ');
  });

  it('undefined値は空文字に置換する', () => {
    expect(renderTemplate('Memo: {{memo}}', { memo: undefined })).toBe(
      'Memo: '
    );
  });

  it('スペース付きの変数名を処理する', () => {
    expect(renderTemplate('{{ name }}', { name: 'test' })).toBe('test');
  });

  it('数値を文字列に変換する', () => {
    expect(renderTemplate('{{amount}}', { amount: 12345 })).toBe('12345');
  });

  it('テンプレートが空文字の場合は空文字を返す', () => {
    expect(renderTemplate('', { name: 'test' })).toBe('');
  });

  it('変数プレースホルダーがない場合はそのまま返す', () => {
    expect(renderTemplate('No variables here', { name: 'test' })).toBe(
      'No variables here'
    );
  });
});

describe('calculateNextExecution', () => {
  describe('hourly', () => {
    it('現在時刻より後の同時間内の分を返す', () => {
      const now = new Date('2026-02-09T10:15:00Z');
      const result = calculateNextExecution(
        { scheduleType: 'hourly', minute: 30 },
        now
      );
      expect(result).toEqual(new Date('2026-02-09T10:30:00Z'));
    });

    it('分が過ぎている場合は次の時間を返す', () => {
      const now = new Date('2026-02-09T10:35:00Z');
      const result = calculateNextExecution(
        { scheduleType: 'hourly', minute: 30 },
        now
      );
      expect(result).toEqual(new Date('2026-02-09T11:30:00Z'));
    });

    it('minuteが省略された場合はデフォルト0分', () => {
      const now = new Date('2026-02-09T10:01:00Z');
      const result = calculateNextExecution(
        { scheduleType: 'hourly' },
        now
      );
      expect(result).toEqual(new Date('2026-02-09T11:00:00Z'));
    });
  });

  describe('daily', () => {
    it('今日のまだ来ていない時刻を返す', () => {
      const now = new Date('2026-02-09T08:00:00Z');
      const result = calculateNextExecution(
        { scheduleType: 'daily', hour: 9, minute: 0 },
        now
      );
      expect(result).toEqual(new Date('2026-02-09T09:00:00Z'));
    });

    it('時刻が過ぎている場合は翌日を返す', () => {
      const now = new Date('2026-02-09T10:00:00Z');
      const result = calculateNextExecution(
        { scheduleType: 'daily', hour: 9, minute: 0 },
        now
      );
      expect(result).toEqual(new Date('2026-02-10T09:00:00Z'));
    });

    it('hourが省略された場合はデフォルト9時', () => {
      const now = new Date('2026-02-09T10:00:00Z');
      const result = calculateNextExecution(
        { scheduleType: 'daily' },
        now
      );
      expect(result).toEqual(new Date('2026-02-10T09:00:00Z'));
    });
  });

  describe('weekly', () => {
    it('今週のまだ来ていない曜日を返す（月曜指定、現在日曜）', () => {
      // 2026-02-08 is Sunday
      const now = new Date('2026-02-08T08:00:00Z');
      const result = calculateNextExecution(
        { scheduleType: 'weekly', dayOfWeek: 1, hour: 9, minute: 0 },
        now
      );
      expect(result).toEqual(new Date('2026-02-09T09:00:00Z'));
    });

    it('曜日が過ぎている場合は来週を返す', () => {
      // 2026-02-10 is Tuesday
      const now = new Date('2026-02-10T10:00:00Z');
      const result = calculateNextExecution(
        { scheduleType: 'weekly', dayOfWeek: 1, hour: 9, minute: 0 },
        now
      );
      expect(result).toEqual(new Date('2026-02-16T09:00:00Z'));
    });

    it('当日の同じ曜日で時刻が過ぎている場合は来週を返す', () => {
      // 2026-02-09 is Monday
      const now = new Date('2026-02-09T10:00:00Z');
      const result = calculateNextExecution(
        { scheduleType: 'weekly', dayOfWeek: 1, hour: 9, minute: 0 },
        now
      );
      expect(result).toEqual(new Date('2026-02-16T09:00:00Z'));
    });

    it('dayOfWeekが省略された場合はデフォルト月曜', () => {
      const now = new Date('2026-02-08T08:00:00Z'); // Sunday
      const result = calculateNextExecution(
        { scheduleType: 'weekly' },
        now
      );
      expect(result.getUTCDay()).toBe(1); // Monday
    });
  });

  describe('monthly', () => {
    it('今月のまだ来ていない日を返す', () => {
      const now = new Date('2026-02-05T08:00:00Z');
      const result = calculateNextExecution(
        { scheduleType: 'monthly', dayOfMonth: 15, hour: 9, minute: 0 },
        now
      );
      expect(result).toEqual(new Date('2026-02-15T09:00:00Z'));
    });

    it('日が過ぎている場合は来月を返す', () => {
      const now = new Date('2026-02-20T10:00:00Z');
      const result = calculateNextExecution(
        { scheduleType: 'monthly', dayOfMonth: 15, hour: 9, minute: 0 },
        now
      );
      expect(result.getUTCMonth()).toBe(2); // March (0-indexed)
      expect(result.getUTCDate()).toBe(15);
    });

    it('dayOfMonthが省略された場合はデフォルト1日', () => {
      const now = new Date('2026-02-05T08:00:00Z');
      const result = calculateNextExecution(
        { scheduleType: 'monthly' },
        now
      );
      expect(result.getUTCMonth()).toBe(2); // March since Feb 1 already passed
      expect(result.getUTCDate()).toBe(1);
    });
  });
});

describe('isDue', () => {
  it('次回実行時刻が現在時刻以前ならtrueを返す', () => {
    const now = new Date('2026-02-09T10:00:00Z');
    expect(isDue('2026-02-09T09:00:00Z', now)).toBe(true);
  });

  it('次回実行時刻が現在時刻と同じならtrueを返す', () => {
    const now = new Date('2026-02-09T10:00:00Z');
    expect(isDue('2026-02-09T10:00:00Z', now)).toBe(true);
  });

  it('次回実行時刻が未来ならfalseを返す', () => {
    const now = new Date('2026-02-09T10:00:00Z');
    expect(isDue('2026-02-09T11:00:00Z', now)).toBe(false);
  });
});

describe('calculatePeriodRange', () => {
  it('hourlyの場合は直近1時間を返す', () => {
    const now = new Date('2026-02-09T10:00:00Z');
    const result = calculatePeriodRange('hourly', now);
    expect(result.start).toBe('2026-02-09');
    expect(result.end).toBe('2026-02-09');
    expect(result.month).toBe('2026-02');
  });

  it('dailyの場合は前日を返す', () => {
    const now = new Date('2026-02-09T10:00:00Z');
    const result = calculatePeriodRange('daily', now);
    expect(result.start).toBe('2026-02-08');
    expect(result.end).toBe('2026-02-08');
  });

  it('weeklyの場合は直近7日間を返す', () => {
    const now = new Date('2026-02-09T10:00:00Z');
    const result = calculatePeriodRange('weekly', now);
    expect(result.start).toBe('2026-02-02');
    expect(result.end).toBe('2026-02-08');
  });

  it('monthlyの場合は前月全体を返す', () => {
    const now = new Date('2026-02-09T10:00:00Z');
    const result = calculatePeriodRange('monthly', now);
    expect(result.start).toBe('2026-01-01');
    expect(result.end).toBe('2026-01-31');
    expect(result.month).toBe('2026-01');
  });

  it('monthlyで3月の場合は2月（28日/29日）を返す', () => {
    const now = new Date('2026-03-05T10:00:00Z');
    const result = calculatePeriodRange('monthly', now);
    expect(result.start).toBe('2026-02-01');
    expect(result.end).toBe('2026-02-28');
  });
});

describe('buildDefaultBatchPayload', () => {
  it('JSON形式のバッチペイロードを生成する', () => {
    const data = {
      scheduleType: 'weekly' as const,
      periodStart: '2026-02-02',
      periodEnd: '2026-02-08',
      month: '2026-02',
      totalSpent: 50000,
      budget: 120000,
      remaining: 70000,
      expenseCount: 15,
    };
    const result = JSON.parse(buildDefaultBatchPayload(data));
    expect(result.type).toBe('batch_summary');
    expect(result.scheduleType).toBe('weekly');
    expect(result.summary.totalSpent).toBe(50000);
    expect(result.summary.budget).toBe(120000);
    expect(result.summary.remaining).toBe(70000);
    expect(result.summary.expenseCount).toBe(15);
    expect(result.period.start).toBe('2026-02-02');
    expect(result.period.end).toBe('2026-02-08');
  });
});

describe('buildBatchPayloadFromTemplate', () => {
  it('テンプレートを変数で置換する', () => {
    const template =
      '{"text": "今週の支出合計: ¥{{totalSpent}} / 予算: ¥{{budget}}"}';
    const data = {
      scheduleType: 'weekly' as const,
      periodStart: '2026-02-02',
      periodEnd: '2026-02-08',
      month: '2026-02',
      totalSpent: 50000,
      budget: 120000,
      remaining: 70000,
      expenseCount: 15,
    };
    const result = buildBatchPayloadFromTemplate(template, data);
    expect(result).toBe(
      '{"text": "今週の支出合計: ¥50000 / 予算: ¥120000"}'
    );
  });
});

describe('buildDefaultEventPayload', () => {
  it('イベントペイロードを生成する', () => {
    const expense = {
      id: 'test-id',
      amount: 3000,
      category: '食費',
      memo: 'ランチ',
      date: '2026-02-09',
      createdAt: '2026-02-09T10:00:00Z',
      updatedAt: '2026-02-09T10:00:00Z',
      deviceId: 'device-1',
    };
    const result = JSON.parse(
      buildDefaultEventPayload('expense.created', 'user-1', expense)
    );
    expect(result.event).toBe('expense.created');
    expect(result.userId).toBe('user-1');
    expect(result.expense.amount).toBe(3000);
    expect(result.expense.category).toBe('食費');
  });

  it('category/memoがundefinedの場合はnullに変換する', () => {
    const expense = {
      id: 'test-id',
      amount: 3000,
      date: '2026-02-09',
      createdAt: '2026-02-09T10:00:00Z',
      updatedAt: '2026-02-09T10:00:00Z',
      deviceId: 'device-1',
    };
    const result = JSON.parse(
      buildDefaultEventPayload('expense.created', 'user-1', expense)
    );
    expect(result.expense.category).toBeNull();
    expect(result.expense.memo).toBeNull();
  });
});

describe('buildEventPayloadFromTemplate', () => {
  it('テンプレートをイベントデータで置換する', () => {
    const template =
      '{"text": "{{event}}: ¥{{expense.amount}} ({{expense.category}})"}';
    const expense = {
      id: 'test-id',
      amount: 3000,
      category: '食費',
      memo: 'ランチ',
      date: '2026-02-09',
      createdAt: '2026-02-09T10:00:00Z',
      updatedAt: '2026-02-09T10:00:00Z',
      deviceId: 'device-1',
    };
    const result = buildEventPayloadFromTemplate(
      template,
      'expense.created',
      'user-1',
      expense
    );
    expect(result).toBe(
      '{"text": "expense.created: ¥3000 (食費)"}'
    );
  });
});
