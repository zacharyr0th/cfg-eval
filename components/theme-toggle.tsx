"use client";

import * as React from "react";
import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => {
    // SSR mount guard: next-themes can't resolve the theme until after hydration.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
  }, []);

  if (!mounted) {
    // Pre-hydration placeholder: still needs an accessible name, or a screen
    // reader hitting the page before mount finds an unlabeled button.
    return (
      <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Toggle theme" disabled>
        <Sun aria-hidden className="h-4 w-4" />
      </Button>
    );
  }

  return (
    <Button
      variant="ghost"
      size="icon"
      className="h-8 w-8"
      aria-label="Toggle theme"
      onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
    >
      {theme === "dark" ? (
        <Sun aria-hidden className="h-4 w-4" />
      ) : (
        <Moon aria-hidden className="h-4 w-4" />
      )}
      <span className="sr-only">Toggle theme</span>
    </Button>
  );
}
