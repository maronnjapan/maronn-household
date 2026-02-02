/**
 * 為替レート取得ユーティリティ
 * 外貨建てサブスクリプションの円換算に使用
 *
 * 使用API: Frankfurter (https://frankfurter.app/)
 * - 無料、認証不要
 * - ECB（欧州中央銀行）の為替レートを使用
 * - 平日のみ更新（週末は金曜日のレートを返す）
 */

import type { CurrencyCode } from '../database/drizzle/schema/household';

/**
 * 為替レート情報
 */
export interface ExchangeRateInfo {
  rate: number;       // 1外貨 = X円
  date: string;       // レート取得日（YYYY-MM-DD）
  source: string;     // レートソース
}

/**
 * キャッシュされた為替レート
 */
interface CachedRate {
  info: ExchangeRateInfo;
  cachedAt: number;
}

// メモリ内キャッシュ（1時間有効）
const rateCache = new Map<string, CachedRate>();
const CACHE_TTL_MS = 60 * 60 * 1000; // 1時間

/**
 * サポートする通貨一覧
 */
export const SUPPORTED_CURRENCIES: { code: CurrencyCode; name: string; symbol: string }[] = [
  { code: 'JPY', name: '日本円', symbol: '¥' },
  { code: 'USD', name: '米ドル', symbol: '$' },
  { code: 'EUR', name: 'ユーロ', symbol: '€' },
];

/**
 * 通貨コードから通貨情報を取得
 */
export function getCurrencyInfo(code: CurrencyCode) {
  return SUPPORTED_CURRENCIES.find((c) => c.code === code) ?? SUPPORTED_CURRENCIES[0];
}

/**
 * Frankfurter APIから為替レートを取得
 */
async function fetchExchangeRateFromAPI(
  fromCurrency: CurrencyCode
): Promise<ExchangeRateInfo> {
  // JPYの場合はレート1.0を返す
  if (fromCurrency === 'JPY') {
    return {
      rate: 1,
      date: new Date().toISOString().split('T')[0]!,
      source: 'internal',
    };
  }

  const url = `https://api.frankfurter.app/latest?from=${fromCurrency}&to=JPY`;

  const response = await fetch(url, {
    headers: {
      'Accept': 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch exchange rate: ${response.status}`);
  }

  const data = await response.json() as {
    date: string;
    rates: { JPY: number };
  };

  return {
    rate: data.rates.JPY,
    date: data.date,
    source: 'frankfurter.app (ECB)',
  };
}

/**
 * 為替レートを取得（キャッシュ付き）
 *
 * @param fromCurrency - 変換元の通貨コード
 * @returns 為替レート情報
 */
export async function getExchangeRate(
  fromCurrency: CurrencyCode
): Promise<ExchangeRateInfo> {
  // JPYの場合はキャッシュ不要
  if (fromCurrency === 'JPY') {
    return {
      rate: 1,
      date: new Date().toISOString().split('T')[0]!,
      source: 'internal',
    };
  }

  const cacheKey = `${fromCurrency}-JPY`;
  const cached = rateCache.get(cacheKey);

  // キャッシュが有効ならそれを返す
  if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
    return cached.info;
  }

  // APIから取得
  const info = await fetchExchangeRateFromAPI(fromCurrency);

  // キャッシュに保存
  rateCache.set(cacheKey, {
    info,
    cachedAt: Date.now(),
  });

  return info;
}

/**
 * 外貨を円に換算
 *
 * @param amount - 元の金額（最小単位: USDならセント、EURならセント）
 * @param currency - 通貨コード
 * @param rate - 為替レート（省略時は最新を取得）
 * @returns 円換算後の金額（整数）
 */
export async function convertToJPY(
  amount: number,
  currency: CurrencyCode,
  rate?: number
): Promise<{ amountJPY: number; rateInfo: ExchangeRateInfo }> {
  // JPYの場合はそのまま返す
  if (currency === 'JPY') {
    return {
      amountJPY: amount,
      rateInfo: {
        rate: 1,
        date: new Date().toISOString().split('T')[0]!,
        source: 'internal',
      },
    };
  }

  // レートを取得
  const rateInfo = await getExchangeRate(currency);
  const actualRate = rate ?? rateInfo.rate;

  // 最小単位から基本単位に変換（セント→ドル）してから円に換算
  // USDとEURは100で割る（セント→ドル/ユーロ）
  const baseAmount = amount / 100;
  const amountJPY = Math.round(baseAmount * actualRate);

  return {
    amountJPY,
    rateInfo: { ...rateInfo, rate: actualRate },
  };
}

/**
 * 金額を通貨に応じてフォーマット
 *
 * @param amount - 金額（最小単位）
 * @param currency - 通貨コード
 * @returns フォーマットされた金額文字列
 */
export function formatCurrencyAmount(
  amount: number,
  currency: CurrencyCode
): string {
  const info = getCurrencyInfo(currency);

  if (currency === 'JPY') {
    return `${info?.symbol}${amount.toLocaleString('ja-JP')}`;
  }

  // USDとEURはセント単位なので100で割る
  const baseAmount = amount / 100;
  return `${info?.symbol}${baseAmount.toFixed(2)}`;
}

/**
 * 為替レート情報をJSON文字列にシリアライズ
 */
export function serializeExchangeRate(info: ExchangeRateInfo): string {
  return JSON.stringify(info);
}

/**
 * JSON文字列から為替レート情報をデシリアライズ
 */
export function deserializeExchangeRate(json: string | null): ExchangeRateInfo | null {
  if (!json) return null;
  try {
    return JSON.parse(json) as ExchangeRateInfo;
  } catch {
    return null;
  }
}
