import React from "react";
import ReactDOM from "react-dom/client";
import { queryClient } from "./lib/query";
import { QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
			<QueryClientProvider client={queryClient}>
        {/* Your app components go here */}
        <ReactQueryDevtools initialIsOpen={false} />
      </QueryClientProvider>
  </React.StrictMode>,
);
