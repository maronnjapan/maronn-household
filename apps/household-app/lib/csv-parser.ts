/**
 * CSVインポート用パーサー
 * 項目の増減に対応できる柔軟な設計
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
 * 支出インポート用のマッピング設定
 * CSVの列名と内部フィールド名の対応
 */
export interface ColumnMapping {
  amount: string | null;  // 金額（必須）
  date: string | null;    // 日付（必須）
  memo: string | null;    // メモ（任意）
  category: string | null; // カテゴリ（任意）
}

/**
 * インポート可能な支出データ
 */
export interface ImportableExpense {
  amount: number;
  date: string;
  memo?: string;
  category?: string;
}

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
 * CSVテキストをパースする
 */
export function parseCSV(csvText: string): CSVParseResult {
  const errors: string[] = [];
  const lines = csvText.trim().split(/\r?\n/);

  if (lines.length === 0) {
    return { headers: [], rows: [], errors: ['CSVが空です'] };
  }

  // ヘッダー行をパース
  const headers = parseCSVLine(lines[0] ?? '');

  if (headers.length === 0) {
    return { headers: [], rows: [], errors: ['ヘッダー行が空です'] };
  }

  // データ行をパース
  const rows: CSVRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line || line.trim() === '') continue;

    const values = parseCSVLine(line);

    // 行データをオブジェクトに変換
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
function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const nextChar = line[i + 1];

    if (inQuotes) {
      if (char === '"' && nextChar === '"') {
        // エスケープされたダブルクォート
        current += '"';
        i++;
      } else if (char === '"') {
        // クォート終了
        inQuotes = false;
      } else {
        current += char;
      }
    } else {
      if (char === '"') {
        // クォート開始
        inQuotes = true;
      } else if (char === ',') {
        // フィールド区切り
        result.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
  }

  // 最後のフィールドを追加
  result.push(current.trim());

  return result;
}

/**
 * ヘッダーから自動マッピングを推測
 */
export function suggestMapping(headers: string[]): ColumnMapping {
  const mapping: ColumnMapping = {
    amount: null,
    date: null,
    memo: null,
    category: null,
  };

  // 金額の候補
  const amountPatterns = ['金額', 'amount', '価格', '支出', '出金', '合計'];
  // 日付の候補
  const datePatterns = ['日付', 'date', '日', '年月日', '取引日'];
  // メモの候補
  const memoPatterns = ['メモ', 'memo', '備考', 'note', 'notes', '内容', '摘要', '説明'];
  // カテゴリの候補
  const categoryPatterns = ['カテゴリ', 'category', '分類', '種別', '費目'];

  const normalizedHeaders = headers.map(h => h.toLowerCase().trim());

  for (let i = 0; i < headers.length; i++) {
    const header = headers[i] ?? '';
    const normalized = normalizedHeaders[i] ?? '';

    if (!mapping.amount && amountPatterns.some(p => normalized.includes(p.toLowerCase()))) {
      mapping.amount = header;
    }
    if (!mapping.date && datePatterns.some(p => normalized.includes(p.toLowerCase()))) {
      mapping.date = header;
    }
    if (!mapping.memo && memoPatterns.some(p => normalized.includes(p.toLowerCase()))) {
      mapping.memo = header;
    }
    if (!mapping.category && categoryPatterns.some(p => normalized.includes(p.toLowerCase()))) {
      mapping.category = header;
    }
  }

  return mapping;
}

/**
 * マッピングの検証
 */
export function validateMapping(mapping: ColumnMapping): MappingValidationResult {
  const errors: string[] = [];

  if (!mapping.amount) {
    errors.push('金額の列を選択してください');
  }
  if (!mapping.date) {
    errors.push('日付の列を選択してください');
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
  // すでにYYYY-MM-DD形式の場合
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
  // 空文字列の場合
  if (!amountStr || amountStr.trim() === '') {
    return null;
  }

  // 通貨記号とカンマを除去
  const cleaned = amountStr
    .replace(/[¥$€,、]/g, '')
    .replace(/円$/g, '')
    .trim();

  const amount = parseFloat(cleaned);

  if (isNaN(amount) || amount <= 0) {
    return null;
  }

  return Math.round(amount); // 整数に丸める
}

/**
 * CSVデータをインポート可能な形式に変換
 */
export function convertToExpenses(
  rows: CSVRow[],
  mapping: ColumnMapping
): ImportResult {
  const success: ImportableExpense[] = [];
  const errors: { row: number; message: string }[] = [];

  rows.forEach((row, index) => {
    const rowNumber = index + 2; // ヘッダー行を考慮（1始まり）

    // 金額の取得
    const amountStr = mapping.amount ? row[mapping.amount] : undefined;
    if (!amountStr) {
      errors.push({ row: rowNumber, message: '金額が空です' });
      return;
    }

    const amount = parseAmount(amountStr);
    if (amount === null) {
      errors.push({ row: rowNumber, message: `金額が不正です: ${amountStr}` });
      return;
    }

    // 日付の取得
    const dateStr = mapping.date ? row[mapping.date] : undefined;
    if (!dateStr) {
      errors.push({ row: rowNumber, message: '日付が空です' });
      return;
    }

    const date = normalizeDate(dateStr);
    if (date === null) {
      errors.push({ row: rowNumber, message: `日付の形式が不正です: ${dateStr}` });
      return;
    }

    // オプション項目の取得
    const expense: ImportableExpense = {
      amount,
      date,
    };

    if (mapping.memo && row[mapping.memo]) {
      expense.memo = row[mapping.memo];
    }

    if (mapping.category && row[mapping.category]) {
      expense.category = row[mapping.category];
    }

    success.push(expense);
  });

  return { success, errors };
}
