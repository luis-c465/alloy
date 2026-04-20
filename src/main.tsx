import React, { lazy, Suspense } from "react";
import ReactDOM from "react-dom/client";
import { HotkeysProvider } from "@tanstack/react-hotkeys";
import { QueryClientProvider } from "@tanstack/react-query";
import { ErrorBoundary } from "~/components/ErrorBoundary";
import App from "~/App";
import { queryClient } from "~/lib/query";
import "~/index.css";

const ReactQueryDevtools = import.meta.env.DEV
  ? lazy(() => import("@tanstack/react-query-devtools")
    .then((module) => ({ default: module.ReactQueryDevtools })))
  : null;

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <HotkeysProvider defaultOptions={{ hotkey: { preventDefault: true } }}>
        <ErrorBoundary>
          <App />
        </ErrorBoundary>
      </HotkeysProvider>
      {ReactQueryDevtools ? (
        <Suspense fallback={null}>
          <ReactQueryDevtools initialIsOpen={false} />
        </Suspense>
      ) : null}
    </QueryClientProvider>
  </React.StrictMode>,
);
