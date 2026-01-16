/**
 * household ページ用の Head コンポーネント
 *
 * Pre-hydration Calculator Script を読み込み、
 * Reactのhydration前から電卓を動作可能にする。
 *
 * Service Worker を登録し、オフラインでも爆速表示を実現する。
 */
export function Head() {
  return (
    <>
      {/* Pre-hydration Calculator: Reactのhydration前から電卓を動作させる */}
      {/* defer/asyncなしで読み込み、DOMContentLoaded後に即座に実行 */}
      <script src="/pre-hydration-calculator.js" />
      {/* Service Worker Registration: オフラインサポート */}
      <script src="/sw-register.js" />
    </>
  );
}
