/**
 * テキストから金額を抽出するユーティリティ
 * Share Target API で受け取った通知テキストから金額を自動抽出
 */

/**
 * テキストから金額を抽出
 * @param text - 共有されたテキスト（例: "PayPay 350円 でお支払い"）
 * @returns 抽出した金額、見つからない場合はnull
 */
export function extractAmount(text: string): number | null {
  if (!text || typeof text !== 'string') {
    return null;
  }

  // 抽出した金額を格納
  const amounts: number[] = [];

  // パターン1: 円記号 + 数字（¥1,280 または ￥1280）
  const yenSymbolPattern = /[¥￥]\s*([0-9,]+)/g;
  let match: RegExpExecArray | null;

  while ((match = yenSymbolPattern.exec(text)) !== null) {
    const amount = parseAmount(match[1]);
    if (amount !== null) {
      amounts.push(amount);
    }
  }

  // パターン2: 数字 + 円（350円 または 1,280円）
  const yenPattern = /([0-9,]+)\s*円/g;

  while ((match = yenPattern.exec(text)) !== null) {
    const amount = parseAmount(match[1]);
    if (amount !== null) {
      amounts.push(amount);
    }
  }

  // パターン3: 合計などのキーワード + コロン + 数字
  const totalPattern = /(合計|金額|支払|お支払い|決済)[:\s：]*([0-9,]+)/g;

  while ((match = totalPattern.exec(text)) !== null) {
    const amount = parseAmount(match[2]);
    if (amount !== null) {
      amounts.push(amount);
    }
  }

  // 金額が見つからない場合
  if (amounts.length === 0) {
    return null;
  }

  // 複数の金額が見つかった場合、最大値を返す
  // （通知では通常、支払額が最も大きな金額として表示されるため）
  return Math.max(...amounts);
}

/**
 * カンマ区切りの数字文字列をパース
 * @param amountStr - "1,280" のような文字列
 * @returns パースした数値、失敗時はnull
 */
function parseAmount(amountStr: string): number | null {
  if (!amountStr) {
    return null;
  }

  // カンマを除去
  const cleaned = amountStr.replace(/,/g, '');

  // 数字のみかチェック
  if (!/^\d+$/.test(cleaned)) {
    return null;
  }

  const amount = parseInt(cleaned, 10);

  // 有効な金額かチェック（1円〜999,999,999円）
  if (!Number.isFinite(amount) || amount < 1 || amount > 999_999_999) {
    return null;
  }

  return amount;
}
