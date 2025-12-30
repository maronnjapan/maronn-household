import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "../styles/global.css";

import logoUrl from "../assets/logo.svg";
import { Link } from "../components/Link";
import { trpc, getTRPCClient } from "../trpc/client";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
      staleTime: 5 * 60 * 1000, // 5分
    },
  },
});

const trpcClient = getTRPCClient();

export default function Layout({ children }: { children: React.ReactNode }) {
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  const toggleMenu = () => {
    setIsMenuOpen(!isMenuOpen);
  };

  const closeMenu = () => {
    setIsMenuOpen(false);
  };

  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        <HamburgerButton isOpen={isMenuOpen} onClick={toggleMenu} />
        <SidebarOverlay isOpen={isMenuOpen} onClick={closeMenu} />
        <Sidebar isOpen={isMenuOpen} onLinkClick={closeMenu}>
          <Logo />
          <Link href="/">Welcome</Link>
          <Link href="/household">Household</Link>
          <Link href="/household/budget">Budget</Link>
          <Link href="/calendar">Calendar</Link>
          <Link href="/todo">Todo</Link>
          <Link href="/star-wars">Data Fetching</Link>
        </Sidebar>
        <Content>{children}</Content>
      </QueryClientProvider>
    </trpc.Provider>
  );
}

function HamburgerButton({
  isOpen,
  onClick,
}: {
  isOpen: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className={`hamburger-button ${isOpen ? "open" : ""}`}
      onClick={onClick}
      aria-label="Toggle menu"
    >
      <div className="hamburger-icon">
        <span></span>
        <span></span>
        <span></span>
      </div>
    </button>
  );
}

function SidebarOverlay({
  isOpen,
  onClick,
}: {
  isOpen: boolean;
  onClick: () => void;
}) {
  return (
    <div
      className={`sidebar-overlay ${isOpen ? "open" : ""}`}
      onClick={onClick}
    />
  );
}

function Sidebar({
  children,
  isOpen,
  onLinkClick,
}: {
  children: React.ReactNode;
  isOpen: boolean;
  onLinkClick: () => void;
}) {
  return (
    <div id="sidebar" className={isOpen ? "open" : ""} onClick={onLinkClick}>
      {children}
    </div>
  );
}

function Content({ children }: { children: React.ReactNode }) {
  return (
    <div id="page-container">
      <div id="page-content">{children}</div>
    </div>
  );
}

function Logo() {
  return (
    <div className="logo">
      <a href="/">
        <img src={logoUrl} height={64} width={64} alt="logo" />
      </a>
    </div>
  );
}
