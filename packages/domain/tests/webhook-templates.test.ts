import { describe, it, expect } from 'vitest';
import {
  getWebhookTemplatePreset,
  validateWebhookTemplateUrl,
  applyHeaderValues,
  applyBodyTemplateValues,
  listWebhookTemplatePresets,
  WEBHOOK_TEMPLATE_PRESETS,
} from '../src/webhook-templates';

describe('getWebhookTemplatePreset', () => {
  it('LINEテンプレートを取得できる', () => {
    const preset = getWebhookTemplatePreset('line');
    expect(preset).toBeDefined();
    expect(preset!.service).toBe('line');
    expect(preset!.displayName).toBe('LINE');
  });

  it('Slackテンプレートを取得できる', () => {
    const preset = getWebhookTemplatePreset('slack');
    expect(preset).toBeDefined();
    expect(preset!.service).toBe('slack');
    expect(preset!.displayName).toBe('Slack');
  });

  it('Spreadsheetテンプレートを取得できる', () => {
    const preset = getWebhookTemplatePreset('spreadsheet');
    expect(preset).toBeDefined();
    expect(preset!.service).toBe('spreadsheet');
    expect(preset!.displayName).toBe('Google Spreadsheet');
  });

  it('不明なサービスはundefinedを返す', () => {
    expect(getWebhookTemplatePreset('unknown')).toBeUndefined();
  });

  it('customサービスはundefinedを返す', () => {
    expect(getWebhookTemplatePreset('custom')).toBeUndefined();
  });
});

describe('validateWebhookTemplateUrl', () => {
  describe('LINE', () => {
    it('正しいLINE APIのURLを受け入れる', () => {
      const result = validateWebhookTemplateUrl(
        'line',
        'https://api.line.me/v2/bot/message/push'
      );
      expect(result.valid).toBe(true);
    });

    it('不正なURLを拒否する', () => {
      const result = validateWebhookTemplateUrl(
        'line',
        'https://example.com/webhook'
      );
      expect(result.valid).toBe(false);
      expect(result.message).toContain('LINE');
    });
  });

  describe('Slack', () => {
    it('正しいSlack Webhook URLを受け入れる', () => {
      const result = validateWebhookTemplateUrl(
        'slack',
        'https://hooks.slack.com/services/T123/B456/abc'
      );
      expect(result.valid).toBe(true);
    });

    it('不正なURLを拒否する', () => {
      const result = validateWebhookTemplateUrl(
        'slack',
        'https://example.com/webhook'
      );
      expect(result.valid).toBe(false);
      expect(result.message).toContain('Slack');
    });
  });

  describe('Spreadsheet', () => {
    it('正しいGAS Web App URLを受け入れる', () => {
      const result = validateWebhookTemplateUrl(
        'spreadsheet',
        'https://script.google.com/macros/s/AKfycbxxxxxxxxxxx/exec'
      );
      expect(result.valid).toBe(true);
    });

    it('不正なURLを拒否する', () => {
      const result = validateWebhookTemplateUrl(
        'spreadsheet',
        'https://docs.google.com/spreadsheets/d/xxx'
      );
      expect(result.valid).toBe(false);
      expect(result.message).toContain('Google Spreadsheet');
    });
  });

  describe('custom', () => {
    it('有効なURLを受け入れる', () => {
      const result = validateWebhookTemplateUrl(
        'custom',
        'https://example.com/webhook'
      );
      expect(result.valid).toBe(true);
    });

    it('無効なURLを拒否する', () => {
      const result = validateWebhookTemplateUrl('custom', 'not-a-url');
      expect(result.valid).toBe(false);
      expect(result.message).toContain('URLの形式');
    });
  });
});

describe('applyHeaderValues', () => {
  it('LINEのAuthorizationヘッダーにトークンを適用できる', () => {
    const preset = WEBHOOK_TEMPLATE_PRESETS.line;
    const result = applyHeaderValues(preset, {
      LINE_CHANNEL_ACCESS_TOKEN: 'my-secret-token',
    });
    expect(result.Authorization).toBe('Bearer my-secret-token');
    expect(result['Content-Type']).toBe('application/json');
  });

  it('Slackのヘッダーはそのまま返される（プレースホルダーなし）', () => {
    const preset = WEBHOOK_TEMPLATE_PRESETS.slack;
    const result = applyHeaderValues(preset, {});
    expect(result['Content-Type']).toBe('application/json');
  });

  it('未置換のプレースホルダーはそのまま残る', () => {
    const preset = WEBHOOK_TEMPLATE_PRESETS.line;
    const result = applyHeaderValues(preset, {});
    expect(result.Authorization).toBe(
      'Bearer {{LINE_CHANNEL_ACCESS_TOKEN}}'
    );
  });
});

describe('applyBodyTemplateValues', () => {
  it('LINEのボディテンプレートにユーザーIDを適用できる', () => {
    const preset = WEBHOOK_TEMPLATE_PRESETS.line;
    const result = applyBodyTemplateValues(preset.eventBodyTemplate, {
      LINE_USER_ID: 'U1234567890',
    });
    const parsed = JSON.parse(result);
    expect(parsed.to).toBe('U1234567890');
  });

  it('バッチテンプレートにもユーザーIDを適用できる', () => {
    const preset = WEBHOOK_TEMPLATE_PRESETS.line;
    const result = applyBodyTemplateValues(preset.batchBodyTemplate, {
      LINE_USER_ID: 'U1234567890',
    });
    const parsed = JSON.parse(result);
    expect(parsed.to).toBe('U1234567890');
  });

  it('プレースホルダーが存在しないテンプレートはそのまま返る', () => {
    const template = '{"text": "hello"}';
    const result = applyBodyTemplateValues(template, {
      LINE_USER_ID: 'U1234567890',
    });
    expect(result).toBe(template);
  });

  it('イベント変数のプレースホルダーは保持される', () => {
    const preset = WEBHOOK_TEMPLATE_PRESETS.line;
    const result = applyBodyTemplateValues(preset.eventBodyTemplate, {
      LINE_USER_ID: 'U1234567890',
    });
    // expense.amount等のランタイム変数は残る
    expect(result).toContain('{{expense.amount}}');
    expect(result).toContain('{{expense.category}}');
  });
});

describe('listWebhookTemplatePresets', () => {
  it('3つのプリセットを返す', () => {
    const presets = listWebhookTemplatePresets();
    expect(presets).toHaveLength(3);
  });

  it('LINE、Slack、Spreadsheetが含まれる', () => {
    const presets = listWebhookTemplatePresets();
    const services = presets.map((p) => p.service);
    expect(services).toContain('line');
    expect(services).toContain('slack');
    expect(services).toContain('spreadsheet');
  });
});

describe('テンプレートプリセットの整合性', () => {
  it('全テンプレートのイベントボディテンプレートが有効なJSONである', () => {
    for (const preset of Object.values(WEBHOOK_TEMPLATE_PRESETS)) {
      expect(() => JSON.parse(preset.eventBodyTemplate)).not.toThrow();
    }
  });

  it('全テンプレートのバッチボディテンプレートが有効なJSONである', () => {
    for (const preset of Object.values(WEBHOOK_TEMPLATE_PRESETS)) {
      expect(() => JSON.parse(preset.batchBodyTemplate)).not.toThrow();
    }
  });

  it('全テンプレートにsetupDescriptionがある', () => {
    for (const preset of Object.values(WEBHOOK_TEMPLATE_PRESETS)) {
      expect(preset.setupDescription.length).toBeGreaterThan(0);
    }
  });

  it('全テンプレートにurlExampleがある', () => {
    for (const preset of Object.values(WEBHOOK_TEMPLATE_PRESETS)) {
      expect(preset.urlExample.length).toBeGreaterThan(0);
      expect(preset.urlExample).toMatch(/^https:\/\//);
    }
  });

  it('LINEテンプレートはAuthorizationヘッダーが必須', () => {
    const preset = WEBHOOK_TEMPLATE_PRESETS.line;
    expect(preset.requiredHeaderKeys).toContain('Authorization');
  });

  it('Slackテンプレートは追加の必須ヘッダーなし', () => {
    const preset = WEBHOOK_TEMPLATE_PRESETS.slack;
    expect(preset.requiredHeaderKeys).toHaveLength(0);
  });

  it('Spreadsheetテンプレートは追加の必須ヘッダーなし', () => {
    const preset = WEBHOOK_TEMPLATE_PRESETS.spreadsheet;
    expect(preset.requiredHeaderKeys).toHaveLength(0);
  });
});
