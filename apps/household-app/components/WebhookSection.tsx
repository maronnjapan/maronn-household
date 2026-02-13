import { useState, useRef } from 'react';
import { trpc } from '../trpc/client';
import {
  WEBHOOK_TEMPLATE_PRESETS,
  type WebhookServiceType,
  type WebhookTemplatePreset,
} from '@maronn/domain/webhook-templates';

const MAX_WEBHOOKS = 5;

/**
 * 都度通知で使用可能な変数
 */
const EVENT_VARIABLES = [
  { key: 'event', label: 'イベント種別' },
  { key: 'expense.amount', label: '金額' },
  { key: 'expense.category', label: 'カテゴリ' },
  { key: 'expense.memo', label: 'メモ' },
  { key: 'expense.date', label: '日付' },
  { key: 'expense.id', label: '支出ID' },
  { key: 'userId', label: 'ユーザーID' },
  { key: 'expense.createdAt', label: '作成日時' },
  { key: 'expense.updatedAt', label: '更新日時' },
] as const;

/**
 * バッチ通知で使用可能な変数
 */
const BATCH_VARIABLES = [
  { key: 'totalSpent', label: '支出合計' },
  { key: 'budget', label: '予算' },
  { key: 'remaining', label: '残額' },
  { key: 'expenseCount', label: '支出件数' },
  { key: 'month', label: '対象月' },
  { key: 'periodStart', label: '集計開始日' },
  { key: 'periodEnd', label: '集計終了日' },
  { key: 'scheduleType', label: 'スケジュール種別' },
] as const;

/**
 * 都度通知のプリセットテンプレート
 */
const EVENT_PRESETS = [
  {
    name: 'Slack',
    template: `{"text":"支出: ¥{{expense.amount}} ({{expense.category}})\\nメモ: {{expense.memo}}\\n日付: {{expense.date}}"}`,
  },
  {
    name: 'Discord',
    template: `{"content":"💰 支出記録\\n金額: ¥{{expense.amount}}\\nカテゴリ: {{expense.category}}\\nメモ: {{expense.memo}}\\n日付: {{expense.date}}"}`,
  },
  {
    name: 'LINE Notify',
    template: `{"message":"\\n支出: ¥{{expense.amount}}\\nカテゴリ: {{expense.category}}\\nメモ: {{expense.memo}}\\n日付: {{expense.date}}"}`,
  },
  {
    name: 'JSON（全項目）',
    template: `{"event":"{{event}}","userId":"{{userId}}","amount":{{expense.amount}},"category":"{{expense.category}}","memo":"{{expense.memo}}","date":"{{expense.date}}","expenseId":"{{expense.id}}"}`,
  },
] as const;

/**
 * バッチ通知のプリセットテンプレート
 */
const BATCH_PRESETS = [
  {
    name: 'Slack',
    template: `{"text":"📊 {{month}} 支出サマリー\\n支出合計: ¥{{totalSpent}}\\n予算: ¥{{budget}}\\n残額: ¥{{remaining}}\\n件数: {{expenseCount}}件"}`,
  },
  {
    name: 'Discord',
    template: `{"content":"📊 {{month}} 支出サマリー\\n支出合計: ¥{{totalSpent}}\\n予算: ¥{{budget}}\\n残額: ¥{{remaining}}\\n件数: {{expenseCount}}件"}`,
  },
  {
    name: 'LINE Notify',
    template: `{"message":"\\n📊 {{month}} 支出サマリー\\n支出合計: ¥{{totalSpent}}\\n予算: ¥{{budget}}\\n残額: ¥{{remaining}}\\n件数: {{expenseCount}}件"}`,
  },
  {
    name: 'JSON（全項目）',
    template: `{"totalSpent":{{totalSpent}},"budget":{{budget}},"remaining":{{remaining}},"expenseCount":{{expenseCount}},"month":"{{month}}","periodStart":"{{periodStart}}","periodEnd":"{{periodEnd}}","scheduleType":"{{scheduleType}}"}`,
  },
] as const;

const SCHEDULE_TYPE_LABELS: Record<string, string> = {
  hourly: '毎時',
  daily: '毎日',
  weekly: '毎週',
  monthly: '毎月',
};

const DAY_OF_WEEK_LABELS = ['日', '月', '火', '水', '木', '金', '土'];

type NotificationType = 'event' | 'batch';

/**
 * カスタムヘッダーのキーバリューペアエディター
 */
function CustomHeadersEditor(props: {
  headers: Array<{ key: string; value: string }>;
  onChange: (headers: Array<{ key: string; value: string }>) => void;
}) {
  function handleAdd() {
    props.onChange([...props.headers, { key: '', value: '' }]);
  }

  function handleRemove(index: number) {
    props.onChange(props.headers.filter((_, i) => i !== index));
  }

  function handleChange(index: number, field: 'key' | 'value', val: string) {
    const updated = props.headers.map((h, i) =>
      i === index ? { ...h, [field]: val } : h
    );
    props.onChange(updated);
  }

  return (
    <div className="webhook-custom-headers-editor">
      <label className="webhook-field-label">カスタムヘッダー（任意）</label>
      <p className="webhook-field-hint">
        Authorization等の認証ヘッダーを設定できます。値は暗号化して保存されます。
      </p>
      {props.headers.map((header, i) => (
        <div key={i} className="webhook-header-row">
          <input
            type="text"
            value={header.key}
            onChange={(e) => handleChange(i, 'key', e.target.value)}
            placeholder="ヘッダー名（例: Authorization）"
            className="webhook-header-key"
          />
          <input
            type="text"
            value={header.value}
            onChange={(e) => handleChange(i, 'value', e.target.value)}
            placeholder="値（例: Bearer sk-xxx）"
            className="webhook-header-value"
          />
          <button
            type="button"
            onClick={() => handleRemove(i)}
            className="webhook-header-remove"
            aria-label="ヘッダーを削除"
          >
            &times;
          </button>
        </div>
      ))}
      <button type="button" onClick={handleAdd} className="webhook-header-add">
        + ヘッダーを追加
      </button>
    </div>
  );
}

/**
 * サービステンプレート選択ボタン
 * テンプレートを選択すると、URL、ヘッダー、ボディテンプレートが一括設定される
 */
function ServiceTemplateSelector(props: {
  notificationType: NotificationType;
  onApplyTemplate: (template: WebhookTemplatePreset) => void;
}) {
  const templates = Object.values(WEBHOOK_TEMPLATE_PRESETS);

  return (
    <div className="webhook-service-template-selector">
      <label className="webhook-field-label">サービステンプレート</label>
      <p className="webhook-field-hint">
        テンプレートを選択すると、URL例、ヘッダー、ボディテンプレートが自動設定されます。
      </p>
      <div className="webhook-service-template-buttons">
        {templates.map((template) => (
          <button
            key={template.service}
            type="button"
            onClick={() => props.onApplyTemplate(template)}
            className="webhook-service-template-button"
          >
            {template.displayName}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * ボディテンプレートエディター（自由記述 + プリセット + 変数挿入）
 */
function BodyTemplateEditor(props: {
  value: string;
  onChange: (value: string) => void;
  variables: readonly { key: string; label: string }[];
  presets: readonly { name: string; template: string }[];
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  function handleInsertVariable(key: string) {
    const textarea = textareaRef.current;
    if (!textarea) {
      props.onChange(props.value + `{{${key}}}`);
      return;
    }
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const insert = `{{${key}}}`;
    const newValue =
      props.value.substring(0, start) + insert + props.value.substring(end);
    props.onChange(newValue);
    // カーソルを挿入位置の直後に移動（次のレンダリング後）
    const newPos = start + insert.length;
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(newPos, newPos);
    });
  }

  function handlePreset(template: string) {
    props.onChange(template);
  }

  return (
    <div className="webhook-body-editor">
      <label className="webhook-field-label">リクエストボディ（任意）</label>
      <p className="webhook-field-hint">
        送信先サービスが期待するJSON形式で記述してください。
        {'{{変数名}}'} で動的な値を埋め込めます。空欄の場合はデフォルト形式で送信されます。
      </p>

      <div className="webhook-body-presets">
        <span className="webhook-body-presets-label">プリセット:</span>
        {props.presets.map((preset) => (
          <button
            key={preset.name}
            type="button"
            onClick={() => handlePreset(preset.template)}
            className="webhook-body-preset-button"
          >
            {preset.name}
          </button>
        ))}
      </div>

      <textarea
        ref={textareaRef}
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        className="webhook-body-textarea"
        rows={5}
        placeholder='例: {"text":"支出: ¥{{expense.amount}} ({{expense.category}})"}'
        spellCheck={false}
      />

      <div className="webhook-body-variables">
        <span className="webhook-body-variables-label">変数を挿入:</span>
        <div className="webhook-body-variable-tags">
          {props.variables.map((v) => (
            <button
              key={v.key}
              type="button"
              onClick={() => handleInsertVariable(v.key)}
              className="webhook-body-variable-tag"
              title={v.label}
            >
              {v.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * バッチスケジュール設定フォーム
 */
function ScheduleConfigForm(props: {
  scheduleType: string;
  hour: number;
  dayOfWeek: number;
  dayOfMonth: number;
  onScheduleTypeChange: (type: string) => void;
  onHourChange: (hour: number) => void;
  onDayOfWeekChange: (day: number) => void;
  onDayOfMonthChange: (day: number) => void;
}) {
  return (
    <div className="webhook-schedule-config">
      <label className="webhook-field-label">配信スケジュール</label>
      <div className="webhook-schedule-type-options">
        {(['hourly', 'daily', 'weekly', 'monthly'] as const).map((type) => (
          <label key={type} className="webhook-schedule-type-option">
            <input
              type="radio"
              name="scheduleType"
              value={type}
              checked={props.scheduleType === type}
              onChange={() => props.onScheduleTypeChange(type)}
            />
            <span>{SCHEDULE_TYPE_LABELS[type]}</span>
          </label>
        ))}
      </div>

      <div className="webhook-schedule-details">
        {props.scheduleType === 'hourly' && (
          <p className="webhook-field-hint">毎時0分に実行されます</p>
        )}

        {props.scheduleType === 'daily' && (
          <label className="webhook-schedule-field">
            毎日
            <select
              value={props.hour}
              onChange={(e) => props.onHourChange(Number(e.target.value))}
            >
              {Array.from({ length: 24 }, (_, h) => (
                <option key={h} value={h}>{h}時</option>
              ))}
            </select>
            に実行
          </label>
        )}

        {props.scheduleType === 'weekly' && (
          <label className="webhook-schedule-field">
            毎週
            <select
              value={props.dayOfWeek}
              onChange={(e) => props.onDayOfWeekChange(Number(e.target.value))}
            >
              {DAY_OF_WEEK_LABELS.map((label, i) => (
                <option key={i} value={i}>{label}曜日</option>
              ))}
            </select>
            <select
              value={props.hour}
              onChange={(e) => props.onHourChange(Number(e.target.value))}
            >
              {Array.from({ length: 24 }, (_, h) => (
                <option key={h} value={h}>{h}時</option>
              ))}
            </select>
            に実行
          </label>
        )}

        {props.scheduleType === 'monthly' && (
          <label className="webhook-schedule-field">
            毎月
            <select
              value={props.dayOfMonth}
              onChange={(e) => props.onDayOfMonthChange(Number(e.target.value))}
            >
              {Array.from({ length: 28 }, (_, d) => (
                <option key={d + 1} value={d + 1}>{d + 1}日</option>
              ))}
            </select>
            <select
              value={props.hour}
              onChange={(e) => props.onHourChange(Number(e.target.value))}
            >
              {Array.from({ length: 24 }, (_, h) => (
                <option key={h} value={h}>{h}時</option>
              ))}
            </select>
            に実行
          </label>
        )}
      </div>
    </div>
  );
}

/**
 * Webhook設定セクション
 */
export function WebhookSection() {
  // --- フォーム表示 ---
  const [showForm, setShowForm] = useState(false);
  const [showGuide, setShowGuide] = useState(false);
  const [showBatchForm, setShowBatchForm] = useState<string | null>(null);

  // --- 作成フォーム ---
  const [url, setUrl] = useState('');
  const [secret, setSecret] = useState('');
  const [notificationType, setNotificationType] = useState<NotificationType>('event');
  const [eventBodyTemplate, setEventBodyTemplate] = useState('');
  const [batchBodyTemplate, setBatchBodyTemplate] = useState('');
  const [customHeaders, setCustomHeaders] = useState<Array<{ key: string; value: string }>>([]);
  const [scheduleType, setScheduleType] = useState('weekly');
  const [hour, setHour] = useState(9);
  const [dayOfWeek, setDayOfWeek] = useState(1);
  const [dayOfMonth, setDayOfMonth] = useState(1);
  const [errorMessage, setErrorMessage] = useState('');

  // --- バッチ追加フォーム ---
  const [batchAddBodyTemplate, setBatchAddBodyTemplate] = useState('');
  const [batchAddHeaders, setBatchAddHeaders] = useState<Array<{ key: string; value: string }>>([]);
  const [batchAddScheduleType, setBatchAddScheduleType] = useState('weekly');
  const [batchAddHour, setBatchAddHour] = useState(9);
  const [batchAddDayOfWeek, setBatchAddDayOfWeek] = useState(1);
  const [batchAddDayOfMonth, setBatchAddDayOfMonth] = useState(1);
  const [batchAddError, setBatchAddError] = useState('');

  const utils = trpc.useUtils();
  const { data: webhookData, isLoading } = trpc.listWebhooks.useQuery();
  const { data: scheduleData } = trpc.listWebhookBatchSchedules.useQuery();

  const createWebhookMutation = trpc.createWebhook.useMutation({
    onSuccess: (result) => {
      if (notificationType === 'batch') {
        // バッチの場合、webhookを作成した後にスケジュールも作成
        const headersObj = headersToObj(customHeaders);
        createScheduleMutation.mutate({
          webhookId: result.id,
          scheduleType: scheduleType as 'hourly' | 'daily' | 'weekly' | 'monthly',
          hour: scheduleType !== 'hourly' ? hour : undefined,
          dayOfWeek: scheduleType === 'weekly' ? dayOfWeek : undefined,
          dayOfMonth: scheduleType === 'monthly' ? dayOfMonth : undefined,
          bodyTemplate: batchBodyTemplate || undefined,
          customHeaders: Object.keys(headersObj).length > 0 ? headersObj : undefined,
        });
      }
      resetForm();
      utils.listWebhooks.invalidate();
    },
    onError: (error) => {
      setErrorMessage(error.message || '保存に失敗しました');
    },
  });

  const deleteWebhookMutation = trpc.deleteWebhook.useMutation({
    onSuccess: () => {
      utils.listWebhooks.invalidate();
      utils.listWebhookBatchSchedules.invalidate();
    },
  });

  const createScheduleMutation = trpc.createWebhookBatchSchedule.useMutation({
    onSuccess: () => {
      setShowBatchForm(null);
      setBatchAddError('');
      resetBatchAddForm();
      utils.listWebhookBatchSchedules.invalidate();
    },
    onError: (error) => {
      setBatchAddError(error.message || 'スケジュールの保存に失敗しました');
    },
  });

  const deleteScheduleMutation = trpc.deleteWebhookBatchSchedule.useMutation({
    onSuccess: () => {
      utils.listWebhookBatchSchedules.invalidate();
    },
  });

  const webhookCount = webhookData?.webhooks.length ?? 0;
  const canAddMore = webhookCount < MAX_WEBHOOKS;

  function headersToObj(
    headers: Array<{ key: string; value: string }>
  ): Record<string, string> {
    const obj: Record<string, string> = {};
    for (const h of headers) {
      if (h.key.trim()) {
        obj[h.key.trim()] = h.value;
      }
    }
    return obj;
  }

  function resetForm() {
    setUrl('');
    setSecret('');
    setNotificationType('event');
    setEventBodyTemplate('');
    setBatchBodyTemplate('');
    setCustomHeaders([]);
    setScheduleType('weekly');
    setHour(9);
    setDayOfWeek(1);
    setDayOfMonth(1);
    setShowForm(false);
    setErrorMessage('');
  }

  function resetBatchAddForm() {
    setBatchAddBodyTemplate('');
    setBatchAddHeaders([]);
    setBatchAddScheduleType('weekly');
    setBatchAddHour(9);
    setBatchAddDayOfWeek(1);
    setBatchAddDayOfMonth(1);
  }

  function handleCreate() {
    const headersObj = headersToObj(customHeaders);

    createWebhookMutation.mutate({
      url,
      secret: secret || undefined,
      customHeaders: Object.keys(headersObj).length > 0 ? headersObj : undefined,
      bodyTemplate:
        notificationType === 'event' && eventBodyTemplate
          ? eventBodyTemplate
          : undefined,
    });
  }

  function handleDelete(id: string) {
    if (confirm('このWebhookと紐づくバッチスケジュールも全て削除されます。よろしいですか？')) {
      deleteWebhookMutation.mutate({ id });
    }
  }

  function handleCreateBatchSchedule(webhookId: string) {
    const headersObj = headersToObj(batchAddHeaders);
    createScheduleMutation.mutate({
      webhookId,
      scheduleType: batchAddScheduleType as 'hourly' | 'daily' | 'weekly' | 'monthly',
      hour: batchAddScheduleType !== 'hourly' ? batchAddHour : undefined,
      dayOfWeek: batchAddScheduleType === 'weekly' ? batchAddDayOfWeek : undefined,
      dayOfMonth: batchAddScheduleType === 'monthly' ? batchAddDayOfMonth : undefined,
      bodyTemplate: batchAddBodyTemplate || undefined,
      customHeaders: Object.keys(headersObj).length > 0 ? headersObj : undefined,
    });
  }

  function handleDeleteSchedule(id: string) {
    if (confirm('このバッチスケジュールを削除しますか？')) {
      deleteScheduleMutation.mutate({ id });
    }
  }

  /**
   * サービステンプレートを適用する
   * URL例、ヘッダー、ボディテンプレートを一括設定
   */
  function applyServiceTemplate(template: WebhookTemplatePreset) {
    // URL例を設定
    setUrl(template.urlExample);

    // ヘッダーを設定（Record<string, string> → Array<{key, value}>）
    const headersArray = Object.entries(template.defaultHeaders).map(
      ([key, value]) => ({ key, value })
    );
    setCustomHeaders(headersArray);

    // ボディテンプレートを設定
    if (notificationType === 'event') {
      setEventBodyTemplate(template.eventBodyTemplate);
    } else {
      setBatchBodyTemplate(template.batchBodyTemplate);
    }
  }

  function formatSchedule(s: {
    scheduleType: string;
    hour: number | null;
    dayOfWeek: number | null;
    dayOfMonth: number | null;
  }): string {
    switch (s.scheduleType) {
      case 'hourly':
        return '毎時 0分';
      case 'daily':
        return `毎日 ${s.hour ?? 9}:00`;
      case 'weekly':
        return `毎週${DAY_OF_WEEK_LABELS[s.dayOfWeek ?? 1]}曜 ${s.hour ?? 9}:00`;
      case 'monthly':
        return `毎月${s.dayOfMonth ?? 1}日 ${s.hour ?? 9}:00`;
      default:
        return s.scheduleType;
    }
  }

  return (
    <section className="settings-section">
      <h2>Webhook連携</h2>
      <p className="settings-description">
        支出の登録時やスケジュールに応じて、外部サービスへ通知を送信できます。
      </p>
      <p className="webhook-limit-note">
        ※最大{MAX_WEBHOOKS}件まで登録可能
      </p>

      {/* 設定ガイド */}
      <div className="webhook-guide-toggle">
        <button
          type="button"
          onClick={() => setShowGuide((prev) => !prev)}
          className="toggle-example-button"
        >
          {showGuide ? '設定ガイドを閉じる' : '設定ガイドを表示'}
        </button>
      </div>

      {showGuide && (
        <div className="webhook-guide">
          <h3>設定方法</h3>

          <div className="webhook-guide-section">
            <h4>1. 通知の種類</h4>
            <p><strong>都度通知</strong> — 支出を登録するたびに通知が送信されます。リアルタイムで支出を把握したい場合に便利です。</p>
            <p><strong>バッチ通知</strong> — 設定したスケジュール（毎時/毎日/毎週/毎月）で支出のサマリーが送信されます。「毎週月曜にLINEで合計額を確認」のような使い方ができます。</p>
          </div>

          <div className="webhook-guide-section">
            <h4>2. 送信先URL</h4>
            <p>通知を受け取るサービスのWebhook URLを入力してください。</p>
            <ul>
              <li><strong>Slack</strong>: Incoming Webhook URLを設定</li>
              <li><strong>LINE Notify</strong>: LINE NotifyのWebhook URL</li>
              <li><strong>Discord</strong>: Webhook URLを設定</li>
              <li><strong>その他</strong>: POSTリクエストを受信できる任意のURL</li>
            </ul>
          </div>

          <div className="webhook-guide-section">
            <h4>3. カスタムヘッダー</h4>
            <p>認証が必要なサービスの場合、ヘッダーにAPIキーやトークンを設定できます。</p>
            <p>例: LINE Notifyの場合</p>
            <pre className="webhook-guide-code">
              Authorization: Bearer YOUR_LINE_TOKEN
            </pre>
            <p className="webhook-field-hint">全てのヘッダー値は暗号化して保存されるため、シークレットが漏洩する心配はありません。</p>
          </div>

          <div className="webhook-guide-section">
            <h4>4. リクエストボディ</h4>
            <p>送信先サービスが期待するJSON形式で自由に記述できます。プリセット（Slack、Discord、LINE Notify）を選択すると、テンプレートが自動入力されます。</p>
            <p>{'{{変数名}}'} と記述すると、実際のデータで自動置換されます。変数名のボタンをクリックすると、カーソル位置に挿入されます。</p>
            <p>空欄の場合は全項目を含むデフォルト形式で送信されます。</p>
          </div>
        </div>
      )}

      {/* 追加ボタン */}
      {!showForm && (
        <button
          type="button"
          onClick={() => setShowForm(true)}
          className="issue-token-button"
          disabled={!canAddMore}
        >
          Webhookを追加
        </button>
      )}

      {!canAddMore && !showForm && (
        <p className="webhook-limit-warning">登録上限に達しています。</p>
      )}

      {/* 作成フォーム */}
      {showForm && (
        <div className="webhook-create-form">
          <h3>Webhook追加</h3>

          {/* 通知タイプ選択 */}
          <div className="webhook-type-selector">
            <label className="webhook-field-label">通知タイプ</label>
            <div className="webhook-type-options">
              <label className="webhook-type-option">
                <input
                  type="radio"
                  name="notificationType"
                  value="event"
                  checked={notificationType === 'event'}
                  onChange={() => setNotificationType('event')}
                />
                <div className="webhook-type-option-content">
                  <strong>都度通知</strong>
                  <span>支出登録のたびに通知</span>
                </div>
              </label>
              <label className="webhook-type-option">
                <input
                  type="radio"
                  name="notificationType"
                  value="batch"
                  checked={notificationType === 'batch'}
                  onChange={() => setNotificationType('batch')}
                />
                <div className="webhook-type-option-content">
                  <strong>バッチ通知</strong>
                  <span>スケジュールでサマリー通知</span>
                </div>
              </label>
            </div>
          </div>

          {/* サービステンプレート選択 */}
          <ServiceTemplateSelector
            notificationType={notificationType}
            onApplyTemplate={applyServiceTemplate}
          />

          {/* URL + シークレット */}
          <label className="webhook-form-label">
            Webhook URL:
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://example.com/webhook"
              className="webhook-form-input"
              required
            />
          </label>

          <label className="webhook-form-label">
            シークレット（任意）:
            <input
              type="text"
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              placeholder="HMAC署名に使うシークレット"
              className="webhook-form-input"
            />
          </label>

          {/* カスタムヘッダー */}
          <CustomHeadersEditor
            headers={customHeaders}
            onChange={setCustomHeaders}
          />

          {/* 都度通知: ボディテンプレート */}
          {notificationType === 'event' && (
            <BodyTemplateEditor
              value={eventBodyTemplate}
              onChange={setEventBodyTemplate}
              variables={EVENT_VARIABLES}
              presets={EVENT_PRESETS}
            />
          )}

          {/* バッチ通知: スケジュール + ボディテンプレート */}
          {notificationType === 'batch' && (
            <>
              <ScheduleConfigForm
                scheduleType={scheduleType}
                hour={hour}
                dayOfWeek={dayOfWeek}
                dayOfMonth={dayOfMonth}
                onScheduleTypeChange={setScheduleType}
                onHourChange={setHour}
                onDayOfWeekChange={setDayOfWeek}
                onDayOfMonthChange={setDayOfMonth}
              />
              <BodyTemplateEditor
                value={batchBodyTemplate}
                onChange={setBatchBodyTemplate}
                variables={BATCH_VARIABLES}
                presets={BATCH_PRESETS}
              />
            </>
          )}

          {errorMessage && (
            <p className="webhook-error-message">{errorMessage}</p>
          )}

          <div className="form-actions">
            <button
              type="button"
              onClick={handleCreate}
              disabled={createWebhookMutation.isPending || !url}
            >
              {createWebhookMutation.isPending ? '保存中...' : '保存'}
            </button>
            <button
              type="button"
              onClick={resetForm}
              className="cancel-button"
            >
              キャンセル
            </button>
          </div>
        </div>
      )}

      {/* 登録済みWebhook一覧 */}
      <h3>登録済みWebhook</h3>
      {isLoading ? (
        <p>読込中...</p>
      ) : webhookData?.webhooks && webhookData.webhooks.length > 0 ? (
        <ul className="webhook-list">
          {webhookData.webhooks.map((hook) => {
            const hookSchedules =
              scheduleData?.schedules.filter((s) => s.webhookId === hook.id) ?? [];

            return (
              <li key={hook.id} className="webhook-list-item">
                <div className="webhook-item-main">
                  <div className="webhook-item-info">
                    <strong className="webhook-item-url">{hook.url}</strong>
                    <div className="webhook-item-badges">
                      <span className="webhook-badge webhook-badge-event">都度通知</span>
                      {hookSchedules.length > 0 && (
                        <span className="webhook-badge webhook-badge-batch">
                          バッチ {hookSchedules.length}件
                        </span>
                      )}
                      {hook.hasSecret && (
                        <span className="webhook-badge webhook-badge-secret">署名あり</span>
                      )}
                      {hook.customHeaders && (
                        <span className="webhook-badge webhook-badge-headers">
                          ヘッダー {Object.keys(hook.customHeaders).length}件
                        </span>
                      )}
                    </div>
                    <span className="token-date">
                      登録: {new Date(hook.createdAt).toLocaleDateString('ja-JP')}
                    </span>
                  </div>
                  <div className="webhook-item-actions">
                    <button
                      type="button"
                      onClick={() => {
                        setShowBatchForm(
                          showBatchForm === hook.id ? null : hook.id
                        );
                        setBatchAddError('');
                        resetBatchAddForm();
                      }}
                      className="webhook-add-batch-button"
                    >
                      + バッチ追加
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(hook.id)}
                      disabled={deleteWebhookMutation.isPending}
                      className="revoke-button"
                    >
                      削除
                    </button>
                  </div>
                </div>

                {/* バッチスケジュール一覧 */}
                {hookSchedules.length > 0 && (
                  <div className="webhook-schedules">
                    {hookSchedules.map((s) => (
                      <div key={s.id} className="webhook-schedule-item">
                        <div className="webhook-schedule-info">
                          <span className="webhook-schedule-timing">
                            {formatSchedule(s)}
                          </span>
                          <span
                            className={`webhook-schedule-status ${s.isActive ? 'active' : 'inactive'}`}
                          >
                            {s.isActive ? '有効' : '停止中'}
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleDeleteSchedule(s.id)}
                          disabled={deleteScheduleMutation.isPending}
                          className="webhook-schedule-delete"
                        >
                          削除
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {/* バッチスケジュール追加フォーム */}
                {showBatchForm === hook.id && (
                  <div className="webhook-batch-add-form">
                    <h4>バッチスケジュール追加</h4>
                    <ScheduleConfigForm
                      scheduleType={batchAddScheduleType}
                      hour={batchAddHour}
                      dayOfWeek={batchAddDayOfWeek}
                      dayOfMonth={batchAddDayOfMonth}
                      onScheduleTypeChange={setBatchAddScheduleType}
                      onHourChange={setBatchAddHour}
                      onDayOfWeekChange={setBatchAddDayOfWeek}
                      onDayOfMonthChange={setBatchAddDayOfMonth}
                    />
                    <BodyTemplateEditor
                      value={batchAddBodyTemplate}
                      onChange={setBatchAddBodyTemplate}
                      variables={BATCH_VARIABLES}
                      presets={BATCH_PRESETS}
                    />
                    <CustomHeadersEditor
                      headers={batchAddHeaders}
                      onChange={setBatchAddHeaders}
                    />
                    {batchAddError && (
                      <p className="webhook-error-message">{batchAddError}</p>
                    )}
                    <div className="form-actions">
                      <button
                        type="button"
                        onClick={() => handleCreateBatchSchedule(hook.id)}
                        disabled={createScheduleMutation.isPending}
                      >
                        {createScheduleMutation.isPending
                          ? '保存中...'
                          : 'スケジュールを保存'}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setShowBatchForm(null);
                          setBatchAddError('');
                        }}
                        className="cancel-button"
                      >
                        キャンセル
                      </button>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <p>Webhookが登録されていません。</p>
      )}
    </section>
  );
}
