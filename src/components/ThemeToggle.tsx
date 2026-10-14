"use client";

import { useEffect, useState } from "react";

type Choice = "system" | "light" | "dark";
const KEY = "devpulse-theme";
const NEXT: Record<Choice, Choice> = { system: "light", light: "dark", dark: "system" };
const LABEL: Record<Choice, string> = { system: "Auto", light: "Light", dark: "Dark" };
const ICON: Record<Choice, string> = { system: "◐", light: "☀", dark: "☾" };

/** The server renders the saved choice into <html data-theme>; read it from there. */
function read(): Choice {
  const v = document.documentElement.getAttribute("data-theme");
  return v === "light" || v === "dark" ? v : "system";
}

function apply(choice: Choice) {
  const root = document.documentElement;
  if (choice === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", choice);
}

function remember(choice: Choice) {
  const base = `${KEY}=${choice}; path=/; SameSite=Lax`;
  document.cookie = choice === "system" ? `${KEY}=; path=/; max-age=0; SameSite=Lax` : `${base}; max-age=31536000`;
}

/** Cycles Auto (follow the system) -> Light -> Dark. The choice is remembered in a cookie. */
export function ThemeToggle() {
  const [choice, setChoice] = useState<Choice>("system");

  useEffect(() => {
    setChoice(read());
  }, []);

  const change = () => {
    const next = NEXT[choice];
    setChoice(next);
    apply(next);
    remember(next);
  };

  return (
    <button type="button" className="theme-toggle" onClick={change} title={`Theme: ${LABEL[choice]} (click to change)`} aria-label={`Theme: ${LABEL[choice]}. Click to switch.`}>
      <span aria-hidden>{ICON[choice]}</span> {LABEL[choice]}
    </button>
  );
}
