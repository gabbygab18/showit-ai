import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ToastProvider } from "@/components/glint/toast";
import { App } from "./App";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ToastProvider placement="top-center" position="absolute">
      <App />
    </ToastProvider>
  </StrictMode>,
);
