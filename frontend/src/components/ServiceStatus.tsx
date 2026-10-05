import { Spinner } from "./LoadingStatus";
import { useEffect, useState } from "react";
import { ApiClient } from "../services/api";

export function ServiceStatus() {
  const [status, setStatus] = useState("Checking service…");

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    void new ApiClient()
      .health(controller.signal)
      .then(() => {
        if (active) setStatus("Service available");
      })
      .catch(() => {
        if (active) setStatus("Service unavailable");
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, []);

  return (
    <span className="service-status" role="status">
      {status === "Checking service…" && <Spinner />}
      {status}
    </span>
  );
}
