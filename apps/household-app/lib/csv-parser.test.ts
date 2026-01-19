import { describe, it, expect } from 'vitest';
import {
  parseCSV,
  parseCSVLine,
  parseCSVLines,
  normalizeDate,
  parseAmount,
  initializeMapping,
  validateMapping,
  convertToExpenses,
  convertToExpensesByFixedColumns,
  escapeCSVValue,
  convertToCSV,
  DEFAULT_FIELD_DEFINITIONS,
  FIXED_COLUMN_ORDER,
} from './csv-parser';

describe('parseCSVLine', () => {
  it('カンマ区切りの値をパースする', () => {
    expect(parseCSVLine('a,b,c')).toEqual(['a', 'b', 'c']);
  });

  it('空白をトリムする', () => {
    expect(parseCSVLine('  a  ,  b  ,  c  ')).toEqual(['a', 'b', 'c']);
  });

  it('ダブルクォートで囲まれた値を正しくパースする', () => {
    expect(parseCSVLine('"hello, world",b,c')).toEqual(['hello, world', 'b', 'c']);
  });

  it('エスケープされたダブルクォートを正しくパースする', () => {
    expect(parseCSVLine('"say ""hello""",b')).toEqual(['say "hello"', 'b']);
  });

  it('空の値を正しくパースする', () => {
    expect(parseCSVLine('a,,c')).toEqual(['a', '', 'c']);
  });

  it('改行を含む値を正しくパースする', () => {
    expect(parseCSVLine('"line1\nline2",b')).toEqual(['line1\nline2', 'b']);
  });

  it('空の行を空配列としてパースする', () => {
    expect(parseCSVLine('')).toEqual(['']);
  });
});

describe('parseCSV', () => {
  it('ヘッダーとデータ行をパースする', () => {
    const csv = `日付,金額,メモ
2024-01-15,1000,食費
2024-01-16,2000,交通費`;

    const result = parseCSV(csv);

    expect(result.headers).toEqual(['日付', '金額', 'メモ']);
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]).toEqual({
      '日付': '2024-01-15',
      '金額': '1000',
      'メモ': '食費',
    });
    expect(result.errors).toHaveLength(0);
  });

  it('空のCSVでエラーを返す', () => {
    const result = parseCSV('');
    expect(result.errors).toContain('CSVが空です');
  });

  it('空行をスキップする', () => {
    const csv = `日付,金額
2024-01-15,1000

2024-01-16,2000`;

    const result = parseCSV(csv);
    expect(result.rows).toHaveLength(2);
  });

  it('CRLFの改行を正しく処理する', () => {
    const csv = '日付,金額\r\n2024-01-15,1000\r\n2024-01-16,2000';
    const result = parseCSV(csv);
    expect(result.rows).toHaveLength(2);
  });

  it('ヘッダーの数より値が少ない場合、空文字を補完する', () => {
    const csv = `a,b,c
1`;
    const result = parseCSV(csv);
    expect(result.rows[0]).toEqual({ a: '1', b: '', c: '' });
  });
});

describe('normalizeDate', () => {
  it('YYYY-MM-DD形式はそのまま返す', () => {
    expect(normalizeDate('2024-01-15')).toBe('2024-01-15');
  });

  it('YYYY/MM/DD形式を正規化する', () => {
    expect(normalizeDate('2024/1/5')).toBe('2024-01-05');
    expect(normalizeDate('2024/12/31')).toBe('2024-12-31');
  });

  it('MM/DD/YYYY形式（アメリカ式）を正規化する', () => {
    expect(normalizeDate('1/15/2024')).toBe('2024-01-15');
    expect(normalizeDate('12/31/2024')).toBe('2024-12-31');
  });

  it('YYYY年MM月DD日形式を正規化する', () => {
    expect(normalizeDate('2024年1月15日')).toBe('2024-01-15');
    expect(normalizeDate('2024年12月31日')).toBe('2024-12-31');
  });

  it('Date.parseで解釈可能な形式を正規化する', () => {
    const result = normalizeDate('January 15, 2024');
    expect(result).toBe('2024-01-15');
  });

  it('不正な日付形式でnullを返す', () => {
    expect(normalizeDate('invalid')).toBeNull();
    expect(normalizeDate('2024年')).toBeNull();
    expect(normalizeDate('')).toBeNull();
  });
});

describe('parseAmount', () => {
  it('数値文字列をパースする', () => {
    expect(parseAmount('1000')).toBe(1000);
    expect(parseAmount('999')).toBe(999);
  });

  it('カンマ区切りの金額をパースする', () => {
    expect(parseAmount('1,000')).toBe(1000);
    expect(parseAmount('1,234,567')).toBe(1234567);
  });

  it('円記号付きの金額をパースする', () => {
    expect(parseAmount('¥1000')).toBe(1000);
    expect(parseAmount('¥1,000')).toBe(1000);
    expect(parseAmount('1000円')).toBe(1000);
  });

  it('ドル記号付きの金額をパースする', () => {
    expect(parseAmount('$100')).toBe(100);
  });

  it('ユーロ記号付きの金額をパースする', () => {
    expect(parseAmount('€100')).toBe(100);
  });

  it('小数点を含む金額は整数に丸める', () => {
    expect(parseAmount('1000.5')).toBe(1001);
    expect(parseAmount('1000.4')).toBe(1000);
  });

  it('空文字列でnullを返す', () => {
    expect(parseAmount('')).toBeNull();
    expect(parseAmount('   ')).toBeNull();
  });

  it('0以下の金額でnullを返す', () => {
    expect(parseAmount('0')).toBeNull();
    expect(parseAmount('-100')).toBeNull();
  });

  it('数値に変換できない文字列でnullを返す', () => {
    expect(parseAmount('abc')).toBeNull();
    expect(parseAmount('金額')).toBeNull();
  });

  it('全角カンマを処理する', () => {
    expect(parseAmount('1、000')).toBe(1000);
  });
});

describe('initializeMapping', () => {
  it('デフォルトのフィールド定義から空のマッピングを初期化する', () => {
    const mapping = initializeMapping();

    expect(mapping.amount).toBeNull();
    expect(mapping.date).toBeNull();
    expect(mapping.memo).toBeNull();
    expect(mapping.category).toBeNull();
  });

  it('カスタムフィールド定義から空のマッピングを初期化する', () => {
    const customFields = [
      { key: 'custom1', label: 'カスタム1', required: true },
      { key: 'custom2', label: 'カスタム2', required: false },
    ];
    const mapping = initializeMapping(customFields);

    expect(mapping.custom1).toBeNull();
    expect(mapping.custom2).toBeNull();
    expect(Object.keys(mapping)).toHaveLength(2);
  });
});

describe('validateMapping', () => {
  it('必須項目がすべて設定されていれば有効', () => {
    const mapping = { amount: '金額', date: '日付', memo: null, category: null };
    const result = validateMapping(mapping);

    expect(result.isValid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('金額が未設定ならエラー', () => {
    const mapping = { amount: null, date: '日付', memo: null, category: null };
    const result = validateMapping(mapping);

    expect(result.isValid).toBe(false);
    expect(result.errors).toContain('金額の列を選択してください');
  });

  it('日付が未設定ならエラー', () => {
    const mapping = { amount: '金額', date: null, memo: null, category: null };
    const result = validateMapping(mapping);

    expect(result.isValid).toBe(false);
    expect(result.errors).toContain('日付の列を選択してください');
  });

  it('複数の必須項目が未設定なら複数エラー', () => {
    const mapping = { amount: null, date: null, memo: null, category: null };
    const result = validateMapping(mapping);

    expect(result.isValid).toBe(false);
    expect(result.errors).toHaveLength(2);
  });
});

describe('convertToExpenses', () => {
  it('正常なデータを変換する', () => {
    const rows = [
      { '日付': '2024-01-15', '金額': '1000', 'メモ': '食費' },
      { '日付': '2024-01-16', '金額': '2000', 'メモ': '交通費' },
    ];
    const mapping = { amount: '金額', date: '日付', memo: 'メモ', category: null };
    const result = convertToExpenses(rows, mapping);

    expect(result.success).toHaveLength(2);
    expect(result.errors).toHaveLength(0);
    expect(result.success[0]).toEqual({
      amount: 1000,
      date: '2024-01-15',
      memo: '食費',
    });
  });

  it('金額が空の行はエラーになる', () => {
    const rows = [
      { '日付': '2024-01-15', '金額': '', 'メモ': '食費' },
    ];
    const mapping = { amount: '金額', date: '日付', memo: 'メモ', category: null };
    const result = convertToExpenses(rows, mapping);

    expect(result.success).toHaveLength(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.message).toContain('金額が空です');
  });

  it('日付が不正な行はエラーになる', () => {
    const rows = [
      { '日付': 'invalid', '金額': '1000', 'メモ': '食費' },
    ];
    const mapping = { amount: '金額', date: '日付', memo: 'メモ', category: null };
    const result = convertToExpenses(rows, mapping);

    expect(result.success).toHaveLength(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.message).toContain('日付の形式が不正です');
  });

  it('金額が0以下の行はエラーになる', () => {
    const rows = [
      { '日付': '2024-01-15', '金額': '0', 'メモ': '食費' },
    ];
    const mapping = { amount: '金額', date: '日付', memo: 'メモ', category: null };
    const result = convertToExpenses(rows, mapping);

    expect(result.success).toHaveLength(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.message).toContain('金額が不正です');
  });

  it('オプション項目がなくても変換できる', () => {
    const rows = [
      { '日付': '2024-01-15', '金額': '1000' },
    ];
    const mapping = { amount: '金額', date: '日付', memo: null, category: null };
    const result = convertToExpenses(rows, mapping);

    expect(result.success).toHaveLength(1);
    expect(result.success[0]).toEqual({
      amount: 1000,
      date: '2024-01-15',
    });
  });

  it('エラー行番号はヘッダー行を考慮して2始まり', () => {
    const rows = [
      { '日付': '2024-01-15', '金額': '1000' },
      { '日付': 'invalid', '金額': '2000' },
    ];
    const mapping = { amount: '金額', date: '日付', memo: null, category: null };
    const result = convertToExpenses(rows, mapping);

    expect(result.errors[0]?.row).toBe(3); // 2行目データ = 3行目
  });
});

describe('escapeCSVValue', () => {
  it('特殊文字がない値はそのまま返す', () => {
    expect(escapeCSVValue('hello')).toBe('hello');
    expect(escapeCSVValue('1000')).toBe('1000');
  });

  it('カンマを含む値はダブルクォートで囲む', () => {
    expect(escapeCSVValue('hello, world')).toBe('"hello, world"');
  });

  it('ダブルクォートを含む値はエスケープして囲む', () => {
    expect(escapeCSVValue('say "hello"')).toBe('"say ""hello"""');
  });

  it('改行を含む値はダブルクォートで囲む', () => {
    expect(escapeCSVValue('line1\nline2')).toBe('"line1\nline2"');
  });

  it('空文字列はそのまま返す', () => {
    expect(escapeCSVValue('')).toBe('');
  });
});

describe('convertToCSV', () => {
  it('データをCSV形式に変換する', () => {
    const data = [
      { date: '2024-01-15', amount: 1000, memo: '食費', category: '食費' },
      { date: '2024-01-16', amount: 2000, memo: '交通費', category: '交通' },
    ];
    const csv = convertToCSV(data);

    const lines = csv.split('\n');
    expect(lines[0]).toBe('日付,金額,カテゴリ,メモ');
    expect(lines[1]).toBe('2024-01-15,1000,食費,食費');
    expect(lines[2]).toBe('2024-01-16,2000,交通,交通費');
  });

  it('undefinedの値は空文字として出力する', () => {
    const data = [
      { date: '2024-01-15', amount: 1000 },
    ];
    const csv = convertToCSV(data);

    const lines = csv.split('\n');
    expect(lines[1]).toBe('2024-01-15,1000,,');
  });

  it('nullの値は空文字として出力する', () => {
    const data = [
      { date: '2024-01-15', amount: 1000, memo: null, category: null },
    ];
    const csv = convertToCSV(data);

    const lines = csv.split('\n');
    expect(lines[1]).toBe('2024-01-15,1000,,');
  });

  it('カンマを含む値はエスケープする', () => {
    const data = [
      { date: '2024-01-15', amount: 1000, memo: 'A, B', category: '' },
    ];
    const csv = convertToCSV(data);

    const lines = csv.split('\n');
    expect(lines[1]).toBe('2024-01-15,1000,,"A, B"');
  });

  it('空の配列でもヘッダー行を出力する', () => {
    const csv = convertToCSV([]);

    expect(csv).toBe('日付,金額,カテゴリ,メモ');
  });
});

describe('DEFAULT_FIELD_DEFINITIONS', () => {
  it('必須フィールドはamountとdate', () => {
    const requiredFields = DEFAULT_FIELD_DEFINITIONS.filter((f) => f.required);
    const requiredKeys = requiredFields.map((f) => f.key);

    expect(requiredKeys).toContain('amount');
    expect(requiredKeys).toContain('date');
    expect(requiredKeys).toHaveLength(2);
  });

  it('オプションフィールドはmemoとcategory', () => {
    const optionalFields = DEFAULT_FIELD_DEFINITIONS.filter((f) => !f.required);
    const optionalKeys = optionalFields.map((f) => f.key);

    expect(optionalKeys).toContain('memo');
    expect(optionalKeys).toContain('category');
  });

  it('amountにはparserが定義されている', () => {
    const amountField = DEFAULT_FIELD_DEFINITIONS.find((f) => f.key === 'amount');
    expect(amountField?.parser).toBeDefined();
  });

  it('dateにはparserが定義されている', () => {
    const dateField = DEFAULT_FIELD_DEFINITIONS.find((f) => f.key === 'date');
    expect(dateField?.parser).toBeDefined();
  });
});

describe('parseCSVLines', () => {
  it('CSVテキストを行ごとの配列としてパースする', () => {
    const csv = `日付,金額,カテゴリ,メモ
2024-01-15,1000,食費,ランチ`;
    const result = parseCSVLines(csv);

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual(['日付', '金額', 'カテゴリ', 'メモ']);
    expect(result[1]).toEqual(['2024-01-15', '1000', '食費', 'ランチ']);
  });

  it('空行をスキップする', () => {
    const csv = `日付,金額

2024-01-15,1000`;
    const result = parseCSVLines(csv);

    expect(result).toHaveLength(2);
  });
});

describe('FIXED_COLUMN_ORDER', () => {
  it('固定列順序は日付、金額、カテゴリ、メモの順', () => {
    const keys = FIXED_COLUMN_ORDER.map((f) => f.key);
    expect(keys).toEqual(['date', 'amount', 'category', 'memo']);
  });

  it('日付と金額が必須', () => {
    const requiredKeys = FIXED_COLUMN_ORDER.filter((f) => f.required).map((f) => f.key);
    expect(requiredKeys).toEqual(['date', 'amount']);
  });
});

describe('convertToExpensesByFixedColumns', () => {
  it('固定列順序でデータを変換する（ヘッダー行あり）', () => {
    const lines = [
      ['日付', '金額', 'カテゴリ', 'メモ'],
      ['2024-01-15', '1000', '食費', 'ランチ'],
      ['2024-01-16', '2000', '交通', '電車'],
    ];
    const result = convertToExpensesByFixedColumns(lines, true);

    expect(result.success).toHaveLength(2);
    expect(result.errors).toHaveLength(0);
    expect(result.success[0]).toEqual({
      date: '2024-01-15',
      amount: 1000,
      category: '食費',
      memo: 'ランチ',
    });
  });

  it('固定列順序でデータを変換する（ヘッダー行なし）', () => {
    const lines = [
      ['2024-01-15', '1000', '食費', 'ランチ'],
    ];
    const result = convertToExpensesByFixedColumns(lines, false);

    expect(result.success).toHaveLength(1);
    expect(result.success[0]).toEqual({
      date: '2024-01-15',
      amount: 1000,
      category: '食費',
      memo: 'ランチ',
    });
  });

  it('必須項目がない場合はエラーになる', () => {
    const lines = [
      ['ヘッダー', 'ヘッダー', 'ヘッダー', 'ヘッダー'],
      ['2024-01-15', '', '食費', 'ランチ'],
    ];
    const result = convertToExpensesByFixedColumns(lines, true);

    expect(result.success).toHaveLength(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.message).toContain('金額が空です');
  });

  it('オプション項目がなくても変換できる', () => {
    const lines = [
      ['ヘッダー', 'ヘッダー'],
      ['2024-01-15', '1000'],
    ];
    const result = convertToExpensesByFixedColumns(lines, true);

    expect(result.success).toHaveLength(1);
    expect(result.success[0]).toEqual({
      date: '2024-01-15',
      amount: 1000,
    });
  });

  it('空行をスキップする', () => {
    const lines = [
      ['ヘッダー', 'ヘッダー'],
      ['', ''],
      ['2024-01-15', '1000'],
    ];
    const result = convertToExpensesByFixedColumns(lines, true);

    expect(result.success).toHaveLength(1);
  });

  it('エラー行番号はヘッダー行を考慮する', () => {
    const lines = [
      ['ヘッダー', 'ヘッダー'],
      ['invalid-date', '1000'],
    ];
    const result = convertToExpensesByFixedColumns(lines, true);

    expect(result.errors[0]?.row).toBe(2);
  });
});
