import { useState, useRef } from 'react';
import {
  parseCSVLines,
  convertToExpensesByFixedColumns,
  type ImportableExpense,
  FIXED_COLUMN_ORDER,
} from '../lib/csv-parser';

interface CSVImporterProps {
  onImport: (expenses: ImportableExpense[]) => Promise<void>;
  onClose: () => void;
}

type ImportStep = 'upload' | 'preview' | 'result';

const PREVIEW_COLLAPSE_COUNT = 5;

export function CSVImporter({ onImport, onClose }: CSVImporterProps) {
  const [step, setStep] = useState<ImportStep>('upload');
  const [rawLines, setRawLines] = useState<string[][]>([]);
  const [previewData, setPreviewData] = useState<ImportableExpense[]>([]);
  const [importErrors, setImportErrors] = useState<{ row: number; message: string }[]>([]);
  const [importedCount, setImportedCount] = useState(0);
  const [isImporting, setIsImporting] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [hasHeaderRow, setHasHeaderRow] = useState(true);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function handleFileSelect(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      const lines = parseCSVLines(text);

      if (lines.length === 0) {
        alert('CSVが空です');
        return;
      }

      setRawLines(lines);

      // 固定列順序で変換
      const result = convertToExpensesByFixedColumns(lines, hasHeaderRow);
      setPreviewData(result.success);
      setImportErrors(result.errors);
      setStep('preview');
    };
    reader.readAsText(file, 'UTF-8');
  }

  function handleHeaderRowToggle() {
    const newHasHeader = !hasHeaderRow;
    setHasHeaderRow(newHasHeader);

    // 再度変換
    if (rawLines.length > 0) {
      const result = convertToExpensesByFixedColumns(rawLines, newHasHeader);
      setPreviewData(result.success);
      setImportErrors(result.errors);
    }
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
    setRawLines([]);
    setPreviewData([]);
    setImportErrors([]);
    setImportedCount(0);
    setIsExpanded(false);
    setHasHeaderRow(true);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }

  const displayedData = isExpanded
    ? previewData
    : previewData.slice(0, PREVIEW_COLLAPSE_COUNT);

  const hiddenCount = previewData.length - PREVIEW_COLLAPSE_COUNT;

  return (
    <div className="csv-importer-overlay" onClick={onClose}>
      <div className="csv-importer-modal" onClick={(e) => e.stopPropagation()}>
        <div className="csv-importer-header">
          <h2>CSVインポート</h2>
          <button className="csv-importer-close" onClick={onClose}>
            ×
          </button>
        </div>

        <div className="csv-importer-body">
          {step === 'upload' && (
            <div className="csv-step-upload">
              <p className="csv-step-description">
                CSVファイルを選択してください。
              </p>
              <div className="csv-column-hint">
                <p className="csv-column-hint-title">列の順序（固定）:</p>
                <ol className="csv-column-order">
                  {FIXED_COLUMN_ORDER.map((field) => (
                    <li key={field.key}>
                      {field.label}
                      {field.required && <span className="csv-required">（必須）</span>}
                    </li>
                  ))}
                </ol>
              </div>
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

          {step === 'preview' && (
            <div className="csv-step-preview">
              <p className="csv-step-description">
                インポート内容を確認してください。
              </p>

              <label className="csv-header-toggle">
                <input
                  type="checkbox"
                  checked={hasHeaderRow}
                  onChange={handleHeaderRowToggle}
                />
                1行目はヘッダー行（データに含めない）
              </label>

              {importErrors.length > 0 && (
                <div className="csv-errors">
                  <p className="csv-errors-title">
                    {importErrors.length}件のエラーがあります
                  </p>
                  <ul className="csv-errors-list">
                    {importErrors.slice(0, 5).map((err, i) => (
                      <li key={i}>
                        行{err.row}: {err.message}
                      </li>
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
                      {FIXED_COLUMN_ORDER.map((field) => (
                        <th key={field.key}>{field.label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {displayedData.map((item, i) => (
                      <tr key={i}>
                        {FIXED_COLUMN_ORDER.map((field) => (
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
              </div>

              {hiddenCount > 0 && (
                <button
                  className="csv-expand-btn"
                  onClick={() => setIsExpanded(!isExpanded)}
                >
                  {isExpanded
                    ? '折りたたむ'
                    : `他${hiddenCount}件を表示`}
                </button>
              )}

              <p className="csv-import-summary">
                インポート可能: {previewData.length}件
              </p>

              <div className="csv-preview-actions">
                <button className="csv-btn-back" onClick={handleReset}>
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
