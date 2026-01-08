import { useHandPreference } from '../hooks/use-hand-preference';

/**
 * 利き手設定セクション
 * フローティングボタンの配置位置を左右切り替え可能
 */
export function HandPreferenceSection() {
  const { preference, setPreference } = useHandPreference();

  return (
    <section className="settings-section">
      <h2>入力ボタンの配置</h2>
      <p className="settings-description">
        金額入力ボタンの表示位置を選択できます。
      </p>
      <div className="hand-preference-options">
        <label className="hand-preference-option">
          <input
            type="radio"
            name="hand-preference"
            value="right"
            checked={preference === 'right'}
            onChange={() => setPreference('right')}
          />
          <span className="option-label">右下（右利き向け）</span>
        </label>
        <label className="hand-preference-option">
          <input
            type="radio"
            name="hand-preference"
            value="left"
            checked={preference === 'left'}
            onChange={() => setPreference('left')}
          />
          <span className="option-label">左下（左利き向け）</span>
        </label>
      </div>
    </section>
  );
}
