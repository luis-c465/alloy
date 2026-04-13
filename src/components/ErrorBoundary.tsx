import { Component, type ErrorInfo, type ReactNode } from "react";

import { Button } from "~/components/ui/button";

type ErrorBoundaryProps = {
  children: ReactNode;
};

type ErrorBoundaryState = {
  hasError: boolean;
};

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  public constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  public static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error("Unhandled render error", error, errorInfo);
  }

  public render(): ReactNode {
    if (!this.state.hasError) {
      return this.props.children;
    }

    return (
      <div className="flex h-screen w-screen items-center justify-center bg-background px-6 text-foreground">
        <div className="max-w-md space-y-3 rounded-md border border-border bg-muted/20 p-4 text-center">
          <h1 className="text-base font-semibold">Something went wrong</h1>
          <p className="text-sm text-muted-foreground">
            The app hit an unexpected error while rendering.
          </p>
          <Button
            type="button"
            onClick={() => {
              window.location.reload();
            }}
          >
            Reload App
          </Button>
        </div>
      </div>
    );
  }
}
