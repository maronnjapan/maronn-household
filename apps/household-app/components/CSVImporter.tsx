import { useState, useCallback, useRef } from 'react';
import {
  parseCSV,
  suggestMapping,
  validateMapping,
  convertToExpenses,
  type ColumnMapping,
  type CSVRow,
  type ImportableExpense,
} from '../lib/csv-parser';

interface CSVImporterProps {
  onImport: (expenses: ImportableExpense[]) => Promise<void>;
  onClose: () => void;
}

type ImportStep = 'upload' | 'mapping' | 'preview' | 'result';

export function CSVImporter({ onImport, onClose }: CSVImporterProps) {
  const [step, setStep] = useState<ImportStep>('upload');
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<CSVRow[]>([]);
  const [mapping, setMapping] = useState<ColumnMapping>({
    amount: null,
    date: null,
    memo: null,
    category: null,
  });
  const [previewData, setPreviewData] = useState<ImportableExpense[]>([]);
  const [importErrors, setImportErrors] = useState<{ row: number; message: string }[]>([]);
  const [importedCount, setImportedCount] = useState(0);
  const [isImporting, setIsImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
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

      // 自動マッピングを推測
      const suggested = suggestMapping(result.headers);
      setMapping(suggested);

      setStep('mapping');
    };
    reader.readAsText(file, 'UTF-8');
  }, []);

  const handleMappingChange = useCallback((field: keyof ColumnMapping, value: string) => {
    setMapping(prev => ({
      ...prev,
      [field]: value || null,
    }));
  }, []);

  const handleNextToPreview = useCallback(() => {
    const validation = validateMapping(mapping);
    if (!validation.isValid) {
      alert(validation.errors.join('\n'));
      return;
    }

    const result = convertToExpenses(rows, mapping);
    setPreviewData(result.success);
    setImportErrors(result.errors);
    setStep('preview');
  }, [rows, mapping]);

  const handleImport = useCallback(async () => {
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
  }, [previewData, onImport]);

  const handleReset = useCallback(() => {
    setStep('upload');
    setHeaders([]);
    setRows([]);
    setMapping({ amount: null, date: null, memo: null, category: null });
    setPreviewData([]);
    setImportErrors([]);
    setImportedCount(0);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, []);

  return (
    <div className="csv-importer-overlay" onClick={onClose}>
      <div className="csv-importer-modal" onClick={(e) => e.stopPropagation()}>
        <div className="csv-importer-header">
          <h2>CSVインポート</h2>
          <button className="csv-importer-close" onClick={onClose}>×</button>
        </div>

        <div className="csv-importer-body">
          {/* ステップ1: ファイルアップロード */}
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

          {/* ステップ2: マッピング設定 */}
          {step === 'mapping' && (
            <div className="csv-step-mapping">
              <p className="csv-step-description">
                CSVの各列を対応する項目に割り当ててください。
                金額と日付は必須です。
              </p>

              <div className="csv-mapping-form">
                <div className="csv-mapping-row">
                  <label>金額（必須）</label>
                  <select
                    value={mapping.amount ?? ''}
                    onChange={(e) => handleMappingChange('amount', e.target.value)}
                  >
                    <option value="">-- 選択 --</option>
                    {headers.map((h) => (
                      <option key={h} value={h}>{h}</option>
                    ))}
                  </select>
                </div>

                <div className="csv-mapping-row">
                  <label>日付（必須）</label>
                  <select
                    value={mapping.date ?? ''}
                    onChange={(e) => handleMappingChange('date', e.target.value)}
                  >
                    <option value="">-- 選択 --</option>
                    {headers.map((h) => (
                      <option key={h} value={h}>{h}</option>
                    ))}
                  </select>
                </div>

                <div className="csv-mapping-row">
                  <label>メモ</label>
                  <select
                    value={mapping.memo ?? ''}
                    onChange={(e) => handleMappingChange('memo', e.target.value)}
                  >
                    <option value="">-- なし --</option>
                    {headers.map((h) => (
                      <option key={h} value={h}>{h}</option>
                    ))}
                  </select>
                </div>

                <div className="csv-mapping-row">
                  <label>カテゴリ</label>
                  <select
                    value={mapping.category ?? ''}
                    onChange={(e) => handleMappingChange('category', e.target.value)}
                  >
                    <option value="">-- なし --</option>
                    {headers.map((h) => (
                      <option key={h} value={h}>{h}</option>
                    ))}
                  </select>
                </div>
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

          {/* ステップ3: プレビュー */}
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
                      <th>日付</th>
                      <th>金額</th>
                      <th>メモ</th>
                      <th>カテゴリ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {previewData.slice(0, 10).map((item, i) => (
                      <tr key={i}>
                        <td>{item.date}</td>
                        <td>¥{item.amount.toLocaleString()}</td>
                        <td>{item.memo ?? '-'}</td>
                        <td>{item.category ?? '-'}</td>
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

          {/* ステップ4: 結果 */}
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
