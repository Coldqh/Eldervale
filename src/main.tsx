import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App";
import { CareerLibraryProvider } from "./state/CareerLibraryProvider";
import { VersionProvider } from "./components/system/VersionProvider";
import "./styles/index.css";

const root = document.getElementById("root");

if (!root) {
  throw new Error("Root element was not found");
}

createRoot(root).render(
  <StrictMode>
    <VersionProvider>
      <CareerLibraryProvider>
        <App />
      </CareerLibraryProvider>
    </VersionProvider>
  </StrictMode>,
);
