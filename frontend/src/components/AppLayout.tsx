import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { Logo, InterviewGraphWordmark } from "./Logo";

type AppLayoutProps = {
  children: React.ReactNode;
};

export function AppLayout({ children }: AppLayoutProps) {
  const location = useLocation();

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [location.pathname]);

  return (
    <div className="ig-app">
      <header className="ig-header">
        <Logo variant="compact" />
        <InterviewGraphWordmark className="hidden sm:flex" />
        <span className="ig-hero__badge hidden md:inline-flex">Agentic AI</span>
      </header>
      <main id="main-content" className="ig-main" tabIndex={-1}>
        {children}
      </main>
    </div>
  );
}
