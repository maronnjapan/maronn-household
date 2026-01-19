/**
 * Pre-hydration Calculator Script
 *
 * hydration前に電卓を動作させるためのスクリプト。
 * 外部依存なしで動作し、Raw IndexedDB APIで直接保存する。
 *
 * このファイルはビルド時にインライン化され、SSRのHTMLに埋め込まれる。
 */

// グローバル名前空間を汚染しないようにIIFEでラップ
(function () {
    // すでに初期化済みならスキップ（hydration後の二重実行防止）
    if ((window as Window & { __preHydrationCalculatorInitialized?: boolean }).__preHydrationCalculatorInitialized) {
        return;
    }

    // ============================================
    // 電卓ロジック（calculator.tsの移植）
    // ============================================

    type Token =
        | { type: 'number'; value: number }
        | { type: 'operator'; value: string }
        | { type: 'paren'; value: string };

    function tokenize(expression: string): Token[] {
        const tokens: Token[] = [];
        let i = 0;

        while (i < expression.length) {
            const char = expression[i]!;

            if (/\d/.test(char)) {
                let numStr = '';
                while (i < expression.length && /[\d.]/.test(expression[i]!)) {
                    numStr += expression[i];
                    i++;
                }
                tokens.push({ type: 'number', value: parseFloat(numStr) });
                continue;
            }

            if (['+', '-', '*', '/'].includes(char)) {
                tokens.push({ type: 'operator', value: char });
                i++;
                continue;
            }

            if (['(', ')'].includes(char)) {
                tokens.push({ type: 'paren', value: char });
                i++;
                continue;
            }

            i++;
        }

        return tokens;
    }

    function parseExpression(tokens: Token[]): number {
        let index = 0;

        function parseAddSub(): number {
            let left = parseMulDiv();

            while (index < tokens.length) {
                const token = tokens[index];
                if (token?.type === 'operator' && (token.value === '+' || token.value === '-')) {
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
                if (token?.type === 'operator' && (token.value === '*' || token.value === '/')) {
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

            if (token?.type === 'number') {
                index++;
                return token.value;
            }

            if (token?.type === 'paren' && token.value === '(') {
                index++;
                const result = parseAddSub();
                index++;
                return result;
            }

            if (token?.type === 'operator' && token.value === '-') {
                index++;
                return -parsePrimary();
            }

            throw new Error('Invalid expression');
        }

        return parseAddSub();
    }

    function evaluateExpression(expression: string): number | null {
        try {
            if (!expression.trim()) {
                return null;
            }

            if (!/^[\d+\-*/().\s×÷]+$/.test(expression)) {
                return null;
            }

            const normalizedExpression = expression.replace(/×/g, '*').replace(/÷/g, '/').replace(/\s/g, '');

            const tokens = tokenize(normalizedExpression);
            if (tokens.length === 0) {
                return null;
            }

            const result = parseExpression(tokens);

            if (!Number.isFinite(result)) {
                return null;
            }

            return Math.round(result);
        } catch {
            return null;
        }
    }

    // ============================================
    // ULID生成（簡易版）
    // ============================================

    const ENCODING = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

    function generateULID(): string {
        const now = Date.now();
        let timeStr = '';
        let t = now;
        for (let i = 0; i < 10; i++) {
            timeStr = ENCODING[t % 32] + timeStr;
            t = Math.floor(t / 32);
        }

        let randomStr = '';
        for (let i = 0; i < 16; i++) {
            randomStr += ENCODING[Math.floor(Math.random() * 32)];
        }

        return timeStr + randomStr;
    }

    // ============================================
    // デバイスID生成
    // ============================================

    function getDeviceId(): string {
        const storageKey = 'maronn-household-device-id';
        let deviceId = localStorage.getItem(storageKey);
        if (!deviceId) {
            deviceId = generateULID();
            localStorage.setItem(storageKey, deviceId);
        }
        return deviceId;
    }

    // ============================================
    // Raw IndexedDB操作
    // ============================================

    const DB_NAME = 'maronn-household';
    const STORE_NAME = 'expenses';
    const ANONYMOUS_USER_ID = 'anonymous';

    interface ExpenseRecord {
        id: string;
        userId: string;
        amount: number;
        memo?: string;
        category?: string;
        date: string;
        createdAt: string;
        updatedAt: string;
        syncStatus: 'pending' | 'synced' | 'conflict';
        deviceId: string;
    }

    /**
     * バージョンを指定せずにDBを開く
     * - 既存のDBがある場合：そのバージョンで開く（バージョンエラーを回避）
     * - 既存のDBがない場合：バージョン1で開く → 必要に応じてストアを作成
     */
    function openDB(): Promise<IDBDatabase> {
        return new Promise((resolve, reject) => {
            // まずバージョンなしで開く（既存DBがあればそのバージョン、なければv1）
            const request = indexedDB.open(DB_NAME);

            request.onerror = () => reject(request.error);

            request.onsuccess = () => {
                const db = request.result;
                // ストアが存在するか確認
                if (db.objectStoreNames.contains(STORE_NAME)) {
                    resolve(db);
                } else {
                    // ストアがない場合は、バージョンを上げて再度開く
                    const currentVersion = db.version;
                    db.close();
                    const request2 = indexedDB.open(DB_NAME, currentVersion + 1);
                    request2.onerror = () => reject(request2.error);
                    request2.onsuccess = () => resolve(request2.result);
                    request2.onupgradeneeded = (event) => {
                        const db2 = (event.target as IDBOpenDBRequest).result;
                        const store = db2.createObjectStore(STORE_NAME, { keyPath: 'id' });
                        store.createIndex('date', 'date', { unique: false });
                        store.createIndex('syncStatus', 'syncStatus', { unique: false });
                        store.createIndex('createdAt', 'createdAt', { unique: false });
                        store.createIndex('userId', 'userId', { unique: false });
                        store.createIndex('userId_date', ['userId', 'date'], { unique: false });
                    };
                }
            };

            request.onupgradeneeded = (event) => {
                // 新規DB作成時（バージョン1）
                const db = (event.target as IDBOpenDBRequest).result;
                const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
                store.createIndex('date', 'date', { unique: false });
                store.createIndex('syncStatus', 'syncStatus', { unique: false });
                store.createIndex('createdAt', 'createdAt', { unique: false });
                store.createIndex('userId', 'userId', { unique: false });
                store.createIndex('userId_date', ['userId', 'date'], { unique: false });
            };
        });
    }

    async function saveExpense(amount: number, memo?: string): Promise<string> {
        const db = await openDB();
        const now = new Date();
        const id = generateULID();

        // 日本時間で日付を計算
        const jstOffset = 9 * 60 * 60 * 1000;
        const jstDate = new Date(now.getTime() + jstOffset);
        const dateStr = jstDate.toISOString().split('T')[0]!;

        const expense: ExpenseRecord = {
            id,
            userId: ANONYMOUS_USER_ID,
            amount,
            memo: memo || undefined,
            date: dateStr,
            createdAt: now.toISOString(),
            updatedAt: now.toISOString(),
            syncStatus: 'pending',
            deviceId: getDeviceId(),
        };

        return new Promise((resolve, reject) => {
            const transaction = db.transaction([STORE_NAME], 'readwrite');
            const store = transaction.objectStore(STORE_NAME);
            const request = store.add(expense);

            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
                db.close();
                resolve(id);
            };
        });
    }

    // ============================================
    // DOM操作・イベントハンドラー
    // ============================================

    let expression = '';
    let memo = '';

    function updateDisplay() {
        const expressionEl = document.querySelector('.calculator-display .expression');
        const resultEl = document.querySelector('.calculator-display .result');
        const submitBtn = document.querySelector('.submit-button') as HTMLButtonElement | null;

        if (expressionEl) {
            expressionEl.textContent = expression || '0';
        }

        const calculatedAmount = evaluateExpression(expression);
        if (resultEl) {
            if (calculatedAmount !== null && expression !== calculatedAmount.toString()) {
                resultEl.textContent = `= ${calculatedAmount}`;
            } else {
                resultEl.textContent = '';
            }
        }

        if (submitBtn) {
            const isValid = calculatedAmount !== null && calculatedAmount > 0;
            submitBtn.disabled = !isValid;
            submitBtn.textContent = isValid ? `送信 (¥${calculatedAmount.toLocaleString()})` : '送信';
        }

        // data属性に現在の式を保存（hydration時の引き継ぎ用）
        const calculatorEl = document.querySelector('.expense-input.calculator');
        if (calculatorEl) {
            calculatorEl.setAttribute('data-expression', expression);
            calculatorEl.setAttribute('data-memo', memo);
        }
    }

    // hydration完了後はイベントをスキップ
    function isHydrated(): boolean {
        const calc = document.querySelector('.expense-input.calculator');
        return calc !== null && calc.hasAttribute('data-hydrated');
    }

    function handleButtonClick(value: string) {
        if (isHydrated()) return; // Reactが引き継いだ後はスキップ

        if (value === 'C') {
            expression = '';
        } else if (value === '=') {
            const result = evaluateExpression(expression);
            if (result !== null) {
                expression = result.toString();
            }
        } else if (value === '←') {
            expression = expression.slice(0, -1);
        } else {
            expression = expression + value;
        }
        updateDisplay();
    }

    async function handleSubmit() {
        if (isHydrated()) return; // Reactが引き継いだ後はスキップ

        const amount = evaluateExpression(expression);
        if (!amount || amount <= 0) {
            return;
        }

        const memoInput = document.querySelector('.memo-input') as HTMLInputElement | null;
        const currentMemo = memoInput?.value.trim() || '';

        try {
            await saveExpense(amount, currentMemo || undefined);

            // フォームをクリア
            expression = '';
            memo = '';
            if (memoInput) {
                memoInput.value = '';
            }
            updateDisplay();

            // 保存成功のフィードバック（簡易的なアニメーション）
            const submitBtn = document.querySelector('.submit-button');
            if (submitBtn) {
                submitBtn.classList.add('success');
                setTimeout(() => submitBtn.classList.remove('success'), 300);
            }
        } catch (error) {
            console.error('Failed to save expense:', error);
        }
    }

    // イベント委譲を使用（DOM要素の存在を待たずに即座にイベントをキャッチ）
    // これにより、DOMContentLoadedを待つ必要がなくなる
    function attachDelegatedListeners() {
        // 電卓ボタンのクリック（イベント委譲）
        document.addEventListener(
            'click',
            (e) => {
                if (isHydrated()) return;

                const target = e.target as HTMLElement | null;
                if (!target) return;

                // calc-btnクラスを持つ要素をクリックした場合
                if (target.classList?.contains('calc-btn')) {
                    const value = target.textContent?.trim();
                    if (value) {
                        e.preventDefault();
                        handleButtonClick(value);
                    }
                    return;
                }

                // submit-buttonクラスを持つ要素をクリックした場合
                if (target.classList?.contains('submit-button')) {
                    e.preventDefault();
                    handleSubmit();
                    return;
                }
            },
            true
        ); // キャプチャリングフェーズで処理

        // メモ入力（イベント委譲）
        document.addEventListener(
            'input',
            (e) => {
                if (isHydrated()) return;

                const target = e.target as HTMLElement | null;
                if (target?.classList?.contains('memo-input')) {
                    memo = (target as HTMLInputElement).value || '';
                    const calculatorEl = document.querySelector('.expense-input.calculator');
                    if (calculatorEl) {
                        calculatorEl.setAttribute('data-memo', memo);
                    }
                }
            },
            true
        );
    }

    // ============================================
    // 初期化
    // ============================================

    function init() {
        // イベント委譲はDOM要素の存在を待たずに即座に設定できる
        attachDelegatedListeners();

        // 初期表示の更新はDOMが必要なので、準備ができるまで待つ
        function initDisplay() {
            const calculator = document.querySelector('.expense-input.calculator');
            if (!calculator || calculator.hasAttribute('data-hydrated')) {
                return;
            }

            updateDisplay();

            // 初期化完了フラグ
            (window as Window & { __preHydrationCalculatorInitialized?: boolean }).__preHydrationCalculatorInitialized = true;

            // pre-hydration状態であることをマーク
            calculator.setAttribute('data-pre-hydration', 'true');
        }

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', initDisplay);
        } else {
            initDisplay();
        }
    }

    init();
})();
