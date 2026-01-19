/**
 * CSV処理ユーティリティ
 * 項目の増減に柔軟に対応できる設計
 */

/**
 * CSVパース結果の1行分のデータ
 * キーはヘッダーの列名、値は文字列
 */
export type CSVRow = Record<string, string>;

/**
 * CSVパース結果
 */
export interface CSVParseResult {
  headers: string[];
  rows: CSVRow[];
  errors: string[];
}

/**
 * フィールド定義
 * 新しい項目を追加する場合はここに定義を追加するだけでOK
 */
export interface FieldDefinition {
  /** 内部で使用するキー名 */
  key: string;
  /** 表示名 */
  label: string;
  /** 必須かどうか */
  required: boolean;
  /** 値のパーサー（省略時は文字列としてそのまま使用） */
  parser?: (value: string) => unknown;
  /** パース失敗時のエラーメッセージ生成関数 */
  errorMessage?: (value: string) => string;
}

/**
 * 動的なマッピング設定
 * キーはFieldDefinitionのkey、値はCSVのヘッダー名
 */
export type ColumnMapping = Record<string, string | null>;

/**
 * インポート可能な支出データ
 * 動的なフィールドに対応
 */
export type ImportableExpense = Record<string, unknown> & {
  amount: number;
  date: string;
};

/**
 * マッピング検証結果
 */
export interface MappingValidationResult {
  isValid: boolean;
  errors: string[];
}

/**
 * インポート結果
 */
export interface ImportResult {
  success: ImportableExpense[];
  errors: { row: number; message: string }[];
}

/**
 * デフォルトのフィールド定義
 * 新しい項目を追加する場合はここに追加
 */
export const DEFAULT_FIELD_DEFINITIONS: FieldDefinition[] = [
  {
    key: 'amount',
    label: '金額',
    required: true,
    parser: parseAmount,
    errorMessage: (v) => `金額が不正です: ${v}`,
  },
  {
    key: 'date',
    label: '日付',
    required: true,
    parser: normalizeDate,
    errorMessage: (v) => `日付の形式が不正です: ${v}`,
  },
  {
    key: 'memo',
    label: 'メモ',
    required: false,
  },
  {
    key: 'category',
    label: 'カテゴリ',
    required: false,
  },
];

/**
 * CSVテキストをパースする
 */
export function parseCSV(csvText: string): CSVParseResult {
  const errors: string[] = [];
  const lines = csvText.trim().split(/\r?\n/);

  if (lines.length === 0) {
    return { headers: [], rows: [], errors: ['CSVが空です'] };
  }

  const headerLine = lines[0];
  if (!headerLine) {
    return { headers: [], rows: [], errors: ['ヘッダー行が空です'] };
  }

  const headers = parseCSVLine(headerLine);

  if (headers.length === 0) {
    return { headers: [], rows: [], errors: ['ヘッダー行が空です'] };
  }

  const rows: CSVRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line || line.trim() === '') continue;

    const values = parseCSVLine(line);

    const row: CSVRow = {};
    headers.forEach((header, index) => {
      row[header] = values[index] ?? '';
    });

    rows.push(row);
  }

  return { headers, rows, errors };
}

/**
 * CSV行をパースする（ダブルクォート対応）
 */
export function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const nextChar = line[i + 1];

    if (inQuotes) {
      if (char === '"' && nextChar === '"') {
        current += '"';
        i++;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        current += char;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
      } else if (char === ',') {
        result.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
  }

  result.push(current.trim());

  return result;
}

/**
 * 空のマッピングを初期化
 */
export function initializeMapping(
  fieldDefinitions: FieldDefinition[] = DEFAULT_FIELD_DEFINITIONS
): ColumnMapping {
  const mapping: ColumnMapping = {};

  for (const field of fieldDefinitions) {
    mapping[field.key] = null;
  }

  return mapping;
}

/**
 * マッピングの検証
 */
export function validateMapping(
  mapping: ColumnMapping,
  fieldDefinitions: FieldDefinition[] = DEFAULT_FIELD_DEFINITIONS
): MappingValidationResult {
  const errors: string[] = [];

  for (const field of fieldDefinitions) {
    if (field.required && !mapping[field.key]) {
      errors.push(`${field.label}の列を選択してください`);
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}

/**
 * 日付文字列をYYYY-MM-DD形式に正規化
 */
export function normalizeDate(dateStr: string): string | null {
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return dateStr;
  }

  // YYYY/MM/DD形式
  const slashMatch = dateStr.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
  if (slashMatch) {
    const [, year, month, day] = slashMatch;
    return `${year}-${(month ?? '').padStart(2, '0')}-${(day ?? '').padStart(2, '0')}`;
  }

  // MM/DD/YYYY形式（アメリカ式）
  const usMatch = dateStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (usMatch) {
    const [, month, day, year] = usMatch;
    return `${year}-${(month ?? '').padStart(2, '0')}-${(day ?? '').padStart(2, '0')}`;
  }

  // YYYY年MM月DD日形式
  const jpMatch = dateStr.match(/^(\d{4})年(\d{1,2})月(\d{1,2})日$/);
  if (jpMatch) {
    const [, year, month, day] = jpMatch;
    return `${year}-${(month ?? '').padStart(2, '0')}-${(day ?? '').padStart(2, '0')}`;
  }

  // Date.parseで試行
  const parsed = Date.parse(dateStr);
  if (!isNaN(parsed)) {
    const date = new Date(parsed);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  return null;
}

/**
 * 金額文字列を数値に変換
 */
export function parseAmount(amountStr: string): number | null {
  if (!amountStr || amountStr.trim() === '') {
    return null;
  }

  const cleaned = amountStr
    .replace(/[¥$€,、]/g, '')
    .replace(/円$/g, '')
    .trim();

  const amount = parseFloat(cleaned);

  if (isNaN(amount) || amount <= 0) {
    return null;
  }

  return Math.round(amount);
}

/**
 * CSVデータをインポート可能な形式に変換
 */
export function convertToExpenses(
  rows: CSVRow[],
  mapping: ColumnMapping,
  fieldDefinitions: FieldDefinition[] = DEFAULT_FIELD_DEFINITIONS
): ImportResult {
  const success: ImportableExpense[] = [];
  const errors: { row: number; message: string }[] = [];

  rows.forEach((row, index) => {
    const rowNumber = index + 2;
    const expense: Record<string, unknown> = {};
    let hasError = false;

    for (const field of fieldDefinitions) {
      const csvColumn = mapping[field.key];
      const rawValue = csvColumn ? row[csvColumn] : undefined;

      if (field.required && !rawValue) {
        errors.push({ row: rowNumber, message: `${field.label}が空です` });
        hasError = true;
        continue;
      }

      if (!rawValue) continue;

      if (field.parser) {
        const parsed = field.parser(rawValue);
        if (parsed === null) {
          const message = field.errorMessage
            ? field.errorMessage(rawValue)
            : `${field.label}が不正です: ${rawValue}`;
          errors.push({ row: rowNumber, message });
          hasError = true;
        } else {
          expense[field.key] = parsed;
        }
      } else {
        expense[field.key] = rawValue;
      }
    }

    if (!hasError && expense.amount !== undefined && expense.date !== undefined) {
      success.push(expense as ImportableExpense);
    }
  });

  return { success, errors };
}

// ============================================
// エクスポート機能
// ============================================

/**
 * エクスポート用のフィールド設定
 */
export interface ExportFieldConfig {
  key: string;
  header: string;
  formatter?: (value: unknown) => string;
}

/**
 * デフォルトのエクスポートフィールド設定
 */
export const DEFAULT_EXPORT_FIELDS: ExportFieldConfig[] = [
  { key: 'date', header: '日付' },
  {
    key: 'amount',
    header: '金額',
    formatter: (v) => String(v),
  },
  { key: 'category', header: 'カテゴリ' },
  { key: 'memo', header: 'メモ' },
];

/**
 * 値をCSVセル用にエスケープ
 */
export function escapeCSVValue(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/**
 * データをCSV文字列に変換
 */
export function convertToCSV<T extends Record<string, unknown>>(
  data: T[],
  fields: ExportFieldConfig[] = DEFAULT_EXPORT_FIELDS
): string {
  const headers = fields.map((f) => escapeCSVValue(f.header));
  const headerLine = headers.join(',');

  const dataLines = data.map((item) => {
    const values = fields.map((field) => {
      const rawValue = item[field.key];
      if (rawValue === undefined || rawValue === null) {
        return '';
      }
      const stringValue = field.formatter
        ? field.formatter(rawValue)
        : String(rawValue);
      return escapeCSVValue(stringValue);
    });
    return values.join(',');
  });

  return [headerLine, ...dataLines].join('\n');
}

/**
 * CSVファイルをダウンロード
 */
export function downloadCSV(csvContent: string, filename: string): void {
  const bom = '\uFEFF';
  const blob = new Blob([bom + csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
