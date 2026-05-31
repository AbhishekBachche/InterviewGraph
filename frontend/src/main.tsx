import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { ToastProvider } from "./components/ui";
import "./styles/globals.css";
import "./styles.css";
import "./styles/ui-kit.css";
import "./styles/jdqa-business.css";
import "./styles/interview-graph.css";

class RootErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-background p-6" role="alert">
          <div className="w-full max-w-md rounded-xl border bg-card p-6 shadow-card">
            <h1 className="font-display text-xl font-semibold">Something went wrong</h1>
            <p className="mt-2 text-sm text-muted-foreground break-words">{this.state.error.message}</p>
            <button
              type="button"
              className="mt-4 inline-flex h-10 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground"
              onClick={() => window.location.reload()}
            >
              Reload page
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <a
      href="#main-content"
      className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-foreground"
    >
      Skip to content
    </a>
    <BrowserRouter>
      <ToastProvider>
        <RootErrorBoundary>
          <App />
        </RootErrorBoundary>
      </ToastProvider>
    </BrowserRouter>
  </React.StrictMode>
);
