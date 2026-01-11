/**
 * Pre-hydration Calculator Script
 * hydration前に電卓を動作させ、IndexedDBに直接保存する。
 */
(function() {
  'use strict';

  if (window.__preHydrationCalculatorInitialized) return;

  // === 電卓ロジック ===
  function tokenize(expr) {
    var tokens = [], i = 0;
    while (i < expr.length) {
      var c = expr[i];
      if (/\d/.test(c)) {
        var num = '';
        while (i < expr.length && /[\d.]/.test(expr[i])) num += expr[i++];
        tokens.push({ type: 'number', value: parseFloat(num) });
      } else if (['+', '-', '*', '/'].indexOf(c) >= 0) {
        tokens.push({ type: 'operator', value: c }); i++;
      } else if (['(', ')'].indexOf(c) >= 0) {
        tokens.push({ type: 'paren', value: c }); i++;
      } else { i++; }
    }
    return tokens;
  }

  function parseExpr(tokens) {
    var idx = 0;
    function parseAddSub() {
      var left = parseMulDiv();
      while (idx < tokens.length && tokens[idx].type === 'operator' &&
             (tokens[idx].value === '+' || tokens[idx].value === '-')) {
        var op = tokens[idx++].value;
        left = op === '+' ? left + parseMulDiv() : left - parseMulDiv();
      }
      return left;
    }
    function parseMulDiv() {
      var left = parsePrimary();
      while (idx < tokens.length && tokens[idx].type === 'operator' &&
             (tokens[idx].value === '*' || tokens[idx].value === '/')) {
        var op = tokens[idx++].value;
        left = op === '*' ? left * parsePrimary() : left / parsePrimary();
      }
      return left;
    }
    function parsePrimary() {
      var t = tokens[idx];
      if (t.type === 'number') { idx++; return t.value; }
      if (t.type === 'paren' && t.value === '(') {
        idx++; var r = parseAddSub(); idx++; return r;
      }
      if (t.type === 'operator' && t.value === '-') { idx++; return -parsePrimary(); }
      throw new Error('Invalid');
    }
    return parseAddSub();
  }

  function evaluate(expr) {
    try {
      if (!expr || !expr.trim()) return null;
      if (!/^[\d+\-*/().\s×÷]+$/.test(expr)) return null;
      var norm = expr.replace(/×/g, '*').replace(/÷/g, '/').replace(/\s/g, '');
      var tokens = tokenize(norm);
      if (!tokens.length) return null;
      var result = parseExpr(tokens);
      return Number.isFinite(result) ? Math.round(result) : null;
    } catch (e) { return null; }
  }

  // === ULID生成 ===
  var ENC = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  function ulid() {
    var now = Date.now(), time = '', t = now;
    for (var i = 0; i < 10; i++) { time = ENC[t % 32] + time; t = Math.floor(t / 32); }
    var rand = '';
    for (var j = 0; j < 16; j++) rand += ENC[Math.floor(Math.random() * 32)];
    return time + rand;
  }

  function getDeviceId() {
    var key = 'maronn-household-device-id', id = localStorage.getItem(key);
    if (!id) { id = ulid(); localStorage.setItem(key, id); }
    return id;
  }

  // === IndexedDB ===
  var DB_NAME = 'maronn-household', STORE = 'expenses';

  /**
   * バージョンを指定せずにDBを開く
   * - 既存のDBがある場合：そのバージョンで開く（バージョンエラーを回避）
   * - 既存のDBがない場合：バージョン1で開く → 必要に応じてストアを作成
   */
  function openDB() {
    return new Promise(function(resolve, reject) {
      // まずバージョンなしで開く（既存DBがあればそのバージョン、なければv1）
      var req = indexedDB.open(DB_NAME);
      req.onerror = function() { reject(req.error); };
      req.onsuccess = function() {
        var db = req.result;
        // ストアが存在するか確認
        if (db.objectStoreNames.contains(STORE)) {
          resolve(db);
        } else {
          // ストアがない場合は、バージョンを上げて再度開く
          var currentVersion = db.version;
          db.close();
          var req2 = indexedDB.open(DB_NAME, currentVersion + 1);
          req2.onerror = function() { reject(req2.error); };
          req2.onsuccess = function() { resolve(req2.result); };
          req2.onupgradeneeded = function(e) {
            var db2 = e.target.result;
            var store = db2.createObjectStore(STORE, { keyPath: 'id' });
            store.createIndex('date', 'date');
            store.createIndex('syncStatus', 'syncStatus');
            store.createIndex('createdAt', 'createdAt');
            store.createIndex('userId', 'userId');
            store.createIndex('userId_date', ['userId', 'date']);
          };
        }
      };
      req.onupgradeneeded = function(e) {
        // 新規DB作成時（バージョン1）
        var db = e.target.result;
        var store = db.createObjectStore(STORE, { keyPath: 'id' });
        store.createIndex('date', 'date');
        store.createIndex('syncStatus', 'syncStatus');
        store.createIndex('createdAt', 'createdAt');
        store.createIndex('userId', 'userId');
        store.createIndex('userId_date', ['userId', 'date']);
      };
    });
  }

  function saveExpense(amount, memo) {
    return openDB().then(function(db) {
      return new Promise(function(resolve, reject) {
        var now = new Date(), id = ulid();
        var jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
        var dateStr = jst.toISOString().split('T')[0];
        var expense = {
          id: id,
          userId: 'anonymous',
          amount: amount,
          memo: memo || undefined,
          date: dateStr,
          createdAt: now.toISOString(),
          updatedAt: now.toISOString(),
          syncStatus: 'pending',
          deviceId: getDeviceId()
        };
        var tx = db.transaction([STORE], 'readwrite');
        var store = tx.objectStore(STORE);
        var req = store.add(expense);
        req.onerror = function() { reject(req.error); };
        req.onsuccess = function() { db.close(); resolve(id); };
      });
    });
  }

  // === DOM操作 ===
  var expression = '', memo = '';

  function updateDisplay() {
    var exprEl = document.querySelector('.calculator-display .expression');
    var resultEl = document.querySelector('.calculator-display .result');
    var submitBtn = document.querySelector('.submit-button');
    var calcEl = document.querySelector('.expense-input.calculator');

    if (exprEl) exprEl.textContent = expression || '0';

    var amount = evaluate(expression);
    if (resultEl) {
      resultEl.textContent = (amount !== null && expression !== String(amount)) ? '= ' + amount : '';
    }

    if (submitBtn) {
      var valid = amount !== null && amount > 0;
      submitBtn.disabled = !valid;
      submitBtn.textContent = valid ? '送信 (¥' + amount.toLocaleString() + ')' : '送信';
    }

    if (calcEl) {
      calcEl.setAttribute('data-expression', expression);
      calcEl.setAttribute('data-memo', memo);
    }
  }

  // hydration完了後はイベントをスキップ
  function isHydrated() {
    var calc = document.querySelector('.expense-input.calculator');
    return calc && calc.hasAttribute('data-hydrated');
  }

  function handleButton(val) {
    if (isHydrated()) return; // Reactが引き継いだ後はスキップ

    if (val === 'C') expression = '';
    else if (val === '=') {
      var r = evaluate(expression);
      if (r !== null) expression = String(r);
    } else if (val === '←') expression = expression.slice(0, -1);
    else expression += val;
    updateDisplay();
  }

  function handleSubmit() {
    if (isHydrated()) return; // Reactが引き継いだ後はスキップ

    var amount = evaluate(expression);
    if (!amount || amount <= 0) return;

    var memoInput = document.querySelector('.memo-input');
    var currentMemo = memoInput ? memoInput.value.trim() : '';

    saveExpense(amount, currentMemo || undefined).then(function() {
      expression = '';
      memo = '';
      if (memoInput) memoInput.value = '';
      updateDisplay();

      var btn = document.querySelector('.submit-button');
      if (btn) {
        btn.classList.add('success');
        setTimeout(function() { btn.classList.remove('success'); }, 300);
      }
    }).catch(function(err) {
      console.error('Failed to save:', err);
    });
  }

  // イベント委譲を使用（DOM要素の存在を待たずに即座にイベントをキャッチ）
  // これにより、DOMContentLoadedを待つ必要がなくなる
  function attachDelegatedListeners() {
    // 電卓ボタンのクリック（イベント委譲）
    document.addEventListener('click', function(e) {
      if (isHydrated()) return;

      var target = e.target;
      if (!target) return;

      // calc-btnクラスを持つ要素をクリックした場合
      if (target.classList && target.classList.contains('calc-btn')) {
        var val = target.textContent ? target.textContent.trim() : '';
        if (val) {
          e.preventDefault();
          handleButton(val);
        }
        return;
      }

      // submit-buttonクラスを持つ要素をクリックした場合
      if (target.classList && target.classList.contains('submit-button')) {
        e.preventDefault();
        handleSubmit();
        return;
      }
    }, true); // キャプチャリングフェーズで処理

    // メモ入力（イベント委譲）
    document.addEventListener('input', function(e) {
      if (isHydrated()) return;

      var target = e.target;
      if (target && target.classList && target.classList.contains('memo-input')) {
        memo = target.value || '';
        var calcEl = document.querySelector('.expense-input.calculator');
        if (calcEl) calcEl.setAttribute('data-memo', memo);
      }
    }, true);
  }

  function init() {
    // イベント委譲はDOM要素の存在を待たずに即座に設定できる
    attachDelegatedListeners();

    // 初期表示の更新はDOMが必要なので、準備ができるまで待つ
    function initDisplay() {
      var calc = document.querySelector('.expense-input.calculator');
      if (!calc || calc.hasAttribute('data-hydrated')) return;

      updateDisplay();
      window.__preHydrationCalculatorInitialized = true;
      calc.setAttribute('data-pre-hydration', 'true');
    }

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', initDisplay);
    } else {
      initDisplay();
    }
  }

  init();
})();
