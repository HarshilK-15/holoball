import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { RecordRoute } from "./dev/RecordRoute";
import "./styles.css";

const recording = new URLSearchParams(window.location.search).has("record");

createRoot(document.getElementById("root")!).render(
  <StrictMode>{recording ? <RecordRoute /> : <App />}</StrictMode>,
);
