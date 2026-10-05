import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import { AppRoutes } from "./App";
import "./styles.css";
import "./navigation-experiment.css";
import "./photo-recognition.css";
import "./reference-layout.css";
const router = createBrowserRouter([
  { path: "*", element: <AppRoutes dataRouter /> },
]);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
