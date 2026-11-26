"use client";

import type React from "react";
import { Component, type ReactNode } from "react";

interface LiveErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode | ((error: Error) => ReactNode);
  onError?: (error: Error) => void;
  resetOnChange?: unknown;
}

interface LiveErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

/**
 * LiveErrorBoundary - Specifically for catching errors in the live preview.
 * Reset on code change is handled by the parent passing a key prop.
 */
export class LiveErrorBoundary extends Component<
  LiveErrorBoundaryProps,
  LiveErrorBoundaryState
> {
  constructor(props: LiveErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(
    error: Error
  ): Partial<LiveErrorBoundaryState> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    if (process.env.NODE_ENV === "development") {
      console.error(
        "LiveErrorBoundary caught a runtime error:",
        error,
        errorInfo
      );
    }
    this.props.onError?.(error);
  }

  componentDidUpdate(prevProps: LiveErrorBoundaryProps) {
    // If resetOnChange prop changes and we're in an error state, clear the error
    if (
      this.state.hasError &&
      this.props.resetOnChange !== prevProps.resetOnChange
    ) {
      this.setState({ hasError: false, error: null });
    }
  }

  render() {
    if (this.state.hasError) {
      const error = this.state.error ?? new Error("An unknown error occurred");
      if (typeof this.props.fallback === "function") {
        return this.props.fallback(error);
      }
      return (
        this.props.fallback || (
          <div className="p-4 rounded-md bg-destructive/10 border border-destructive/20 text-destructive">
            <p className="text-sm font-medium">Preview Runtime Error</p>
            <pre className="mt-2 text-xs overflow-auto whitespace-pre-wrap font-mono">
              {error.message}
            </pre>
          </div>
        )
      );
    }

    return this.props.children;
  }
}
