/**
 * Webhookテンプレートプリセット定義
 *
 * LINE・Slack・Google Spreadsheet向けのWebhook設定プリセットを提供する。
 * 各テンプレートには、送信先のURL形式、必要なヘッダー、ボディテンプレートが含まれる。
 */

/**
 * サポートするWebhookテンプレートのサービス種別
 */
export type WebhookServiceType = 'line' | 'slack' | 'spreadsheet' | 'custom';

/**
 * Webhookテンプレートのプリセット定義
 */
export interface WebhookTemplatePreset {
  /** サービス種別 */
  service: WebhookServiceType;
  /** サービスの表示名 */
  displayName: string;
  /** URLのバリデーションパターン（正規表現文字列） */
  urlPattern: string;
  /** URLの入力例 */
  urlExample: string;
  /** デフォルトのカスタムヘッダー（認証トークン等のプレースホルダー含む） */
  defaultHeaders: Record<string, string>;
  /** ユーザーが設定すべきヘッダーキーの一覧（トークン等） */
  requiredHeaderKeys: string[];
  /** ユーザーが入力すべきヘッダーの説明（キー: ヘッダーキー、値: 説明文） */
  headerDescriptions: Record<string, string>;
  /** イベントWebhook用デフォルトボディテンプレート */
  eventBodyTemplate: string;
  /** バッチWebhook用デフォルトボディテンプレート */
  batchBodyTemplate: string;
  /** セットアップ手順の説明 */
  setupDescription: string;
}

/**
 * LINE Messaging API向けテンプレート
 *
 * LINE公式アカウントのMessaging APIを使用してプッシュメッセージを送信する。
 * チャネルアクセストークンと送信先ユーザーIDが必要。
 */
const lineTemplate: WebhookTemplatePreset = {
  service: 'line',
  displayName: 'LINE',
  urlPattern: '^https://api\\.line\\.me/v2/bot/message/push$',
  urlExample: 'https://api.line.me/v2/bot/message/push',
  defaultHeaders: {
    'Content-Type': 'application/json',
    Authorization: 'Bearer {{LINE_CHANNEL_ACCESS_TOKEN}}',
  },
  requiredHeaderKeys: ['Authorization'],
  headerDescriptions: {
    'Content-Type': 'リクエストのコンテンツタイプ（application/json固定）',
    Authorization:
      'LINEチャネルアクセストークン（LINE Developers Consoleから取得）',
  },
  eventBodyTemplate: JSON.stringify(
    {
      to: '{{LINE_USER_ID}}',
      messages: [
        {
          type: 'text',
          text: '💰 支出記録\n金額: ¥{{expense.amount}}\nカテゴリ: {{expense.category}}\nメモ: {{expense.memo}}\n日付: {{expense.date}}',
        },
      ],
    },
    null,
    2
  ),
  batchBodyTemplate: JSON.stringify(
    {
      to: '{{LINE_USER_ID}}',
      messages: [
        {
          type: 'text',
          text: '📊 家計簿サマリー ({{month}})\n期間: {{periodStart}} 〜 {{periodEnd}}\n支出合計: ¥{{totalSpent}}\n予算: ¥{{budget}}\n残額: ¥{{remaining}}\n件数: {{expenseCount}}件',
        },
      ],
    },
    null,
    2
  ),
  setupDescription:
    'LINE Developers ConsoleでMessaging APIチャネルを作成し、チャネルアクセストークンを取得してください。送信先のユーザーIDはLINEのプロフィールから確認できます。',
};

/**
 * Slack Incoming Webhook向けテンプレート
 *
 * SlackのIncoming Webhookを使用してチャンネルにメッセージを送信する。
 * Slack Appの作成とIncoming Webhook URLの取得が必要。
 */
const slackTemplate: WebhookTemplatePreset = {
  service: 'slack',
  displayName: 'Slack',
  urlPattern: '^https://hooks\\.slack\\.com/services/.+$',
  urlExample: 'https://hooks.slack.com/services/T.../B.../xxx',
  defaultHeaders: {
    'Content-Type': 'application/json',
  },
  requiredHeaderKeys: [],
  headerDescriptions: {
    'Content-Type':
      'リクエストのコンテンツタイプ（application/json固定）',
  },
  eventBodyTemplate: JSON.stringify(
    {
      blocks: [
        {
          type: 'header',
          text: {
            type: 'plain_text',
            text: '💰 支出記録',
          },
        },
        {
          type: 'section',
          fields: [
            { type: 'mrkdwn', text: '*金額:*\n¥{{expense.amount}}' },
            { type: 'mrkdwn', text: '*カテゴリ:*\n{{expense.category}}' },
            { type: 'mrkdwn', text: '*メモ:*\n{{expense.memo}}' },
            { type: 'mrkdwn', text: '*日付:*\n{{expense.date}}' },
          ],
        },
      ],
    },
    null,
    2
  ),
  batchBodyTemplate: JSON.stringify(
    {
      blocks: [
        {
          type: 'header',
          text: {
            type: 'plain_text',
            text: '📊 家計簿サマリー',
          },
        },
        {
          type: 'section',
          fields: [
            { type: 'mrkdwn', text: '*期間:*\n{{periodStart}} 〜 {{periodEnd}}' },
            { type: 'mrkdwn', text: '*月:*\n{{month}}' },
            { type: 'mrkdwn', text: '*支出合計:*\n¥{{totalSpent}}' },
            { type: 'mrkdwn', text: '*予算:*\n¥{{budget}}' },
            { type: 'mrkdwn', text: '*残額:*\n¥{{remaining}}' },
            { type: 'mrkdwn', text: '*件数:*\n{{expenseCount}}件' },
          ],
        },
      ],
    },
    null,
    2
  ),
  setupDescription:
    'Slack Appを作成し、Incoming Webhooksを有効化してWebhook URLを取得してください。',
};

/**
 * Google Spreadsheet向けテンプレート
 *
 * Google Apps Script (GAS) のWebアプリをデプロイし、
 * doPost関数でWebhookデータを受信してスプレッドシートに書き込む。
 */
const spreadsheetTemplate: WebhookTemplatePreset = {
  service: 'spreadsheet',
  displayName: 'Google Spreadsheet',
  urlPattern: '^https://script\\.google\\.com/macros/s/.+/exec$',
  urlExample: 'https://script.google.com/macros/s/AKfycb.../exec',
  defaultHeaders: {
    'Content-Type': 'application/json',
  },
  requiredHeaderKeys: [],
  headerDescriptions: {
    'Content-Type':
      'リクエストのコンテンツタイプ（application/json固定）',
  },
  eventBodyTemplate: JSON.stringify(
    {
      type: 'expense',
      date: '{{expense.date}}',
      amount: '{{expense.amount}}',
      category: '{{expense.category}}',
      memo: '{{expense.memo}}',
    },
    null,
    2
  ),
  batchBodyTemplate: JSON.stringify(
    {
      type: 'summary',
      month: '{{month}}',
      periodStart: '{{periodStart}}',
      periodEnd: '{{periodEnd}}',
      totalSpent: '{{totalSpent}}',
      budget: '{{budget}}',
      remaining: '{{remaining}}',
      expenseCount: '{{expenseCount}}',
    },
    null,
    2
  ),
  setupDescription:
    'Google Spreadsheetを作成し、「拡張機能」→「Apps Script」からスクリプトをデプロイしてください。doPost(e)関数でJSONを受信し、スプレッドシートに書き込むスクリプトが必要です。',
};

/**
 * 全テンプレートプリセットのマップ
 */
export const WEBHOOK_TEMPLATE_PRESETS: Record<
  Exclude<WebhookServiceType, 'custom'>,
  WebhookTemplatePreset
> = {
  line: lineTemplate,
  slack: slackTemplate,
  spreadsheet: spreadsheetTemplate,
};

/**
 * サービス種別からテンプレートプリセットを取得する
 *
 * @param service サービス種別
 * @returns テンプレートプリセット（存在しない場合はundefined）
 */
export function getWebhookTemplatePreset(
  service: string
): WebhookTemplatePreset | undefined {
  if (service === 'line' || service === 'slack' || service === 'spreadsheet') {
    return WEBHOOK_TEMPLATE_PRESETS[service];
  }
  return undefined;
}

/**
 * テンプレートプリセットのURLバリデーション
 *
 * @param service サービス種別
 * @param url URL文字列
 * @returns バリデーション結果
 */
export function validateWebhookTemplateUrl(
  service: WebhookServiceType,
  url: string
): { valid: boolean; message?: string } {
  if (service === 'custom') {
    // カスタムは基本的なURL形式チェックのみ
    try {
      new URL(url);
      return { valid: true };
    } catch {
      return { valid: false, message: 'URLの形式が正しくありません' };
    }
  }

  const preset = WEBHOOK_TEMPLATE_PRESETS[service];
  if (!preset) {
    return { valid: false, message: `不明なサービス種別: ${service}` };
  }

  const pattern = new RegExp(preset.urlPattern);
  if (!pattern.test(url)) {
    return {
      valid: false,
      message: `${preset.displayName}のURLが正しくありません。例: ${preset.urlExample}`,
    };
  }

  return { valid: true };
}

/**
 * テンプレートプリセットのヘッダーにユーザー値を適用する
 *
 * defaultHeaders内の {{PLACEHOLDER}} をユーザー入力値で置換する。
 *
 * @param preset テンプレートプリセット
 * @param userValues ユーザーが入力した値（キー: プレースホルダー名, 値: 実際の値）
 * @returns 置換済みのヘッダーマップ
 */
export function applyHeaderValues(
  preset: WebhookTemplatePreset,
  userValues: Record<string, string>
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, template] of Object.entries(preset.defaultHeaders)) {
    let value = template;
    for (const [placeholder, replacement] of Object.entries(userValues)) {
      value = value.replace(`{{${placeholder}}}`, replacement);
    }
    result[key] = value;
  }
  return result;
}

/**
 * テンプレートプリセットのボディテンプレートにユーザー固有の値を埋め込む
 *
 * LINE の to (ユーザーID) など、サービス固有のフィールドをテンプレートに設定する。
 *
 * @param bodyTemplate ボディテンプレート文字列
 * @param userValues ユーザー固有の値（キー: プレースホルダー名, 値: 実際の値）
 * @returns ユーザー固有値が埋め込まれたボディテンプレート
 */
export function applyBodyTemplateValues(
  bodyTemplate: string,
  userValues: Record<string, string>
): string {
  let result = bodyTemplate;
  for (const [placeholder, replacement] of Object.entries(userValues)) {
    result = result.split(`{{${placeholder}}}`).join(replacement);
  }
  return result;
}

/**
 * 利用可能なテンプレート一覧を取得する
 *
 * @returns テンプレートプリセットの配列
 */
export function listWebhookTemplatePresets(): WebhookTemplatePreset[] {
  return Object.values(WEBHOOK_TEMPLATE_PRESETS);
}
