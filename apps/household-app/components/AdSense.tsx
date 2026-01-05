import { useEffect, useRef } from "react";

interface AdSenseProps {
  adSlot: string;
  adFormat?: string;
  fullWidthResponsive?: boolean;
  adLayout?: string;
}

export function AdSense({
  adSlot,
  adFormat = "auto",
  fullWidthResponsive = true,
  adLayout,
}: AdSenseProps) {
  const adRef = useRef<HTMLModElement>(null);

  useEffect(() => {
    if (typeof window !== "undefined" && adRef.current) {
      try {
        // @ts-ignore
        (window.adsbygoogle = window.adsbygoogle || []).push({});
      } catch (error) {
        console.error("AdSense error:", error);
      }
    }
  }, []);

  return (
    <ins
      ref={adRef}
      className="adsbygoogle"
      style={{ display: "block" }}
      data-ad-client="ca-pub-XXXXXXXXXXXXXXXX"
      data-ad-slot={adSlot}
      data-ad-format={adFormat}
      data-full-width-responsive={fullWidthResponsive.toString()}
      {...(adLayout && { "data-ad-layout": adLayout })}
    />
  );
}
