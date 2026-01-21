// https://vike.dev/Head

import logoUrl from "../assets/kakeibo-icon.svg";

export function Head() {
  return (
    <>
      <link rel="icon" href={logoUrl} />
      <link rel="manifest" href="/manifest.json" />
      <meta name="theme-color" content="#3b82f6" />
      <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1" />
    </>
  );
}
