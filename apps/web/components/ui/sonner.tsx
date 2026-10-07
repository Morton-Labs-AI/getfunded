"use client";

import * as React from "react";
import { useTheme } from "next-themes";
import { Toaster as Sonner, type ToasterProps } from "sonner";

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme();

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--success-bg": "var(--success-tint)",
          "--success-text": "var(--success)",
          "--success-border": "var(--border)",
          "--error-bg": "var(--danger-tint)",
          "--error-text": "var(--danger)",
          "--error-border": "var(--border)",
          "--warning-bg": "var(--warning-tint)",
          "--warning-text": "var(--warning)",
          "--warning-border": "var(--border)",
          "--border-radius": "var(--radius-card)",
        } as React.CSSProperties
      }
      {...props}
    />
  );
};

export { Toaster };
