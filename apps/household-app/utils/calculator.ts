/**
 * 電卓の式評価ユーティリティ
 * evalを使わない安全な四則演算パーサー
 */

/**
 * 数式文字列を評価して計算結果を返す
 * @param expression - 計算式（例: "100+50*2"）
 * @returns 計算結果、エラー時はnull
 */
export function evaluateExpression(expression: string): number | null {
  try {
    // 空文字列チェック
    if (!expression.trim()) {
      return null;
    }

    // 数字と演算子のみを許可（×と÷も含む）
    if (!/^[\d+\-*/().\s×÷]+$/.test(expression)) {
      return null;
    }

    // 演算子を記号に変換（×→*、÷→/）
    const normalizedExpression = expression
      .replace(/×/g, '*')
      .replace(/÷/g, '/')
      .replace(/\s/g, '');

    // シンプルなトークナイザー
    const tokens = tokenize(normalizedExpression);
    if (tokens.length === 0) {
      return null;
    }

    // 式を評価
    const result = parseExpression(tokens);

    // 結果が有限数でない場合はエラー
    if (!Number.isFinite(result)) {
      return null;
    }

    // 整数に丸める
    return Math.round(result);
  } catch {
    return null;
  }
}

type Token = { type: 'number'; value: number } | { type: 'operator'; value: string } | { type: 'paren'; value: string };

/**
 * 式をトークンに分解
 */
function tokenize(expression: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < expression.length) {
    const char = expression[i];

    // 数字
    if (/\d/.test(char)) {
      let numStr = '';
      while (i < expression.length && /[\d.]/.test(expression[i])) {
        numStr += expression[i];
        i++;
      }
      tokens.push({ type: 'number', value: parseFloat(numStr) });
      continue;
    }

    // 演算子
    if (['+', '-', '*', '/'].includes(char)) {
      tokens.push({ type: 'operator', value: char });
      i++;
      continue;
    }

    // 括弧
    if (['(', ')'].includes(char)) {
      tokens.push({ type: 'paren', value: char });
      i++;
      continue;
    }

    i++;
  }

  return tokens;
}

/**
 * トークンを評価（再帰下降パーサー）
 */
function parseExpression(tokens: Token[]): number {
  let index = 0;

  function parseAddSub(): number {
    let left = parseMulDiv();

    while (index < tokens.length) {
      const token = tokens[index];
      if (token.type === 'operator' && (token.value === '+' || token.value === '-')) {
        index++;
        const right = parseMulDiv();
        left = token.value === '+' ? left + right : left - right;
      } else {
        break;
      }
    }

    return left;
  }

  function parseMulDiv(): number {
    let left = parsePrimary();

    while (index < tokens.length) {
      const token = tokens[index];
      if (token.type === 'operator' && (token.value === '*' || token.value === '/')) {
        index++;
        const right = parsePrimary();
        left = token.value === '*' ? left * right : left / right;
      } else {
        break;
      }
    }

    return left;
  }

  function parsePrimary(): number {
    const token = tokens[index];

    // 数字
    if (token.type === 'number') {
      index++;
      return token.value;
    }

    // 括弧
    if (token.type === 'paren' && token.value === '(') {
      index++; // '(' をスキップ
      const result = parseAddSub();
      index++; // ')' をスキップ
      return result;
    }

    // 負の数
    if (token.type === 'operator' && token.value === '-') {
      index++;
      return -parsePrimary();
    }

    throw new Error('Invalid expression');
  }

  return parseAddSub();
}
