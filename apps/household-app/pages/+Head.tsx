// https://vike.dev/Head

import logoUrl from "../assets/kakeibo-icon.svg";

export function Head() {
  return (
    <>
      <link rel="icon" href={logoUrl} />
      {/* Google AdSense - 実際に使用する際は、data-ad-client の値を自分のものに置き換えてください */}
      <script
        async
        src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-XXXXXXXXXXXXXXXX"
        crossOrigin="anonymous"
      />
    </>
  );
}
