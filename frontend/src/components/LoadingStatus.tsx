import type { ReactNode } from "react";

export function Spinner() {
  return <span className="spinner" aria-hidden="true" />;
}

export function LoadingStatus({ children }: { children: ReactNode }) {
  return (
    <p className="loading-status" role="status">
      <Spinner />
      {children}
    </p>
  );
}
