import { Component, type ReactNode, type ErrorInfo } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  /** Label shown in the error UI so users/devs know which section failed */
  section?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[ErrorBoundary${this.props.section ? ` – ${this.props.section}` : ""}]`, error, info.componentStack);
  }

  reset = () => this.setState({ hasError: false, error: null });

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <div className="flex flex-col items-center justify-center gap-3 p-8 text-center">
          <AlertTriangle className="w-8 h-8 text-destructive" />
          <div>
            <p className="font-medium text-sm">Something went wrong</p>
            {this.props.section && (
              <p className="text-xs text-muted-foreground mt-0.5">{this.props.section}</p>
            )}
          </div>
          <Button size="sm" variant="outline" onClick={this.reset} className="gap-2">
            <RefreshCw className="w-3.5 h-3.5" />
            Try again
          </Button>
        </div>
      );
    }
    return this.props.children;
  }
}
