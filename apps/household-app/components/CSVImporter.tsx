import { useState, useRef } from 'react';
import {
  parseCSV,
  suggestMapping,
  validateMapping,
  convertToExpenses,
  type ColumnMapping,
  type CSVRow,
  type ImportableExpense,
  type FieldDefinition,
  DEFAULT_FIELD_DEFINITIONS,
} from '../lib/csv-parser';

interface CSVImporterProps {
  onImport: (expenses: ImportableExpense[]) => Promise<void>;
  onClose: () => void;
  /** カスタムフィールド定義（省略時はデフォルト） */
  fieldDefinitions?: FieldDefinition[];
}

type ImportStep = 'upload' | 'mapping' | 'preview' | 'result';

export function CSVImporter({
  onImport,
  onClose,
  fieldDefinitions = DEFAULT_FIELD_DEFINITIONS,
}: CSVImporterProps) {
  const [step, setStep] = useState<ImportStep>('upload');
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<CSVRow[]>([]);
  const [mapping, setMapping] = useState<ColumnMapping>({});
  const [previewData, setPreviewData] = useState<ImportableExpense[]>([]);
  const [importErrors, setImportErrors] = useState<{ row: number; message: string }[]>([]);
  const [importedCount, setImportedCount] = useState(0);
  const [isImporting, setIsImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function handleFileSelect(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      const result = parseCSV(text);

      if (result.errors.length > 0) {
        alert(result.errors.join('\n'));
        return;
      }

      setHeaders(result.headers);
      setRows(result.rows);

      const suggested = suggestMapping(result.headers, fieldDefinitions);
      setMapping(suggested);

      setStep('mapping');
    };
    reader.readAsText(file, 'UTF-8');
  }

  function handleMappingChange(fieldKey: string, value: string) {
    setMapping((prev) => ({
      ...prev,
      [fieldKey]: value || null,
    }));
  }

  function handleNextToPreview() {
    const validation = validateMapping(mapping, fieldDefinitions);
    if (!validation.isValid) {
      alert(validation.errors.join('\n'));
      return;
    }

    const result = convertToExpenses(rows, mapping, fieldDefinitions);
    setPreviewData(result.success);
    setImportErrors(result.errors);
    setStep('preview');
  }

  async function handleImport() {
    if (previewData.length === 0) {
      alert('インポートするデータがありません');
      return;
    }

    setIsImporting(true);
    try {
      await onImport(previewData);
      setImportedCount(previewData.length);
      setStep('result');
    } catch (error) {
      alert('インポート中にエラーが発生しました');
      console.error(error);
    } finally {
      setIsImporting(false);
    }
  }

  function handleReset() {
    setStep('upload');
    setHeaders([]);
    setRows([]);
    setMapping({});
    setPreviewData([]);
    setImportErrors([]);
    setImportedCount(0);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }

  return (
    <div className="csv-importer-overlay" onClick={onClose}>
      <div className="csv-importer-modal" onClick={(e) => e.stopPropagation()}>
        <div className="csv-importer-header">
          <h2>CSVインポート</h2>
          <button className="csv-importer-close" onClick={onClose}>×</button>
        </div>

        <div className="csv-importer-body">
          {step === 'upload' && (
            <div className="csv-step-upload">
              <p className="csv-step-description">
                CSVファイルを選択してください。
                ヘッダー行がある形式のCSVに対応しています。
              </p>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,text/csv"
                onChange={handleFileSelect}
                className="csv-file-input"
              />
              <p className="csv-hint">
                対応日付形式: YYYY-MM-DD, YYYY/MM/DD, YYYY年MM月DD日
              </p>
            </div>
          )}

          {step === 'mapping' && (
            <div className="csv-step-mapping">
              <p className="csv-step-description">
                CSVの各列を対応する項目に割り当ててください。
              </p>

              <div className="csv-mapping-form">
                {fieldDefinitions.map((field) => (
                  <div key={field.key} className="csv-mapping-row">
                    <label>
                      {field.label}
                      {field.required && '（必須）'}
                    </label>
                    <select
                      value={mapping[field.key] ?? ''}
                      onChange={(e) => handleMappingChange(field.key, e.target.value)}
                    >
                      <option value="">
                        {field.required ? '-- 選択 --' : '-- なし --'}
                      </option>
                      {headers.map((h) => (
                        <option key={h} value={h}>{h}</option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>

              <p className="csv-preview-count">
                読み込んだデータ: {rows.length}件
              </p>

              <div className="csv-mapping-actions">
                <button className="csv-btn-back" onClick={handleReset}>
                  戻る
                </button>
                <button className="csv-btn-next" onClick={handleNextToPreview}>
                  次へ
                </button>
              </div>
            </div>
          )}

          {step === 'preview' && (
            <div className="csv-step-preview">
              <p className="csv-step-description">
                インポート内容を確認してください。
              </p>

              {importErrors.length > 0 && (
                <div className="csv-errors">
                  <p className="csv-errors-title">
                    {importErrors.length}件のエラーがあります
                  </p>
                  <ul className="csv-errors-list">
                    {importErrors.slice(0, 5).map((err, i) => (
                      <li key={i}>行{err.row}: {err.message}</li>
                    ))}
                    {importErrors.length > 5 && (
                      <li>...他{importErrors.length - 5}件</li>
                    )}
                  </ul>
                </div>
              )}

              <div className="csv-preview-table-container">
                <table className="csv-preview-table">
                  <thead>
                    <tr>
                      {fieldDefinitions.map((field) => (
                        <th key={field.key}>{field.label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {previewData.slice(0, 10).map((item, i) => (
                      <tr key={i}>
                        {fieldDefinitions.map((field) => (
                          <td key={field.key}>
                            {field.key === 'amount'
                              ? `¥${(item[field.key] as number).toLocaleString()}`
                              : (item[field.key] as string) ?? '-'}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
                {previewData.length > 10 && (
                  <p className="csv-preview-more">
                    ...他{previewData.length - 10}件
                  </p>
                )}
              </div>

              <p className="csv-import-summary">
                インポート可能: {previewData.length}件
              </p>

              <div className="csv-preview-actions">
                <button className="csv-btn-back" onClick={() => setStep('mapping')}>
                  戻る
                </button>
                <button
                  className="csv-btn-import"
                  onClick={handleImport}
                  disabled={isImporting || previewData.length === 0}
                >
                  {isImporting ? 'インポート中...' : 'インポート実行'}
                </button>
              </div>
            </div>
          )}

          {step === 'result' && (
            <div className="csv-step-result">
              <p className="csv-result-message">
                {importedCount}件の支出をインポートしました
              </p>
              <div className="csv-result-actions">
                <button className="csv-btn-continue" onClick={handleReset}>
                  続けてインポート
                </button>
                <button className="csv-btn-done" onClick={onClose}>
                  閉じる
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
