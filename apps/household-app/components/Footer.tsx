import { AdSense } from "./AdSense";
import "../styles/footer.css";

interface FooterProps {
  showAd?: boolean;
}

export function Footer({ showAd = true }: FooterProps) {
  return (
    <footer className="footer">
      {showAd && (
        <div className="footer-ad">
          <AdSense
            adSlot="1234567890"
            adFormat="auto"
            fullWidthResponsive={true}
          />
        </div>
      )}
      <div className="footer-content">
        <p>&copy; {new Date().getFullYear()} 家計簿アプリ</p>
      </div>
    </footer>
  );
}
