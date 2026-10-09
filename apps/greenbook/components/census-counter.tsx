"use client";

import { useEffect, useState } from "react";
import { OpenRing } from "./open-ring";
import { countFull } from "@/lib/format";

const DIGITS = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"];

/**
 * The Census Counter — per-digit odometer roll (900ms, 40ms stagger
 * right-to-left), then "the settle": the Open Ring stamps in with the
 * verification caption 250ms after the last digit lands. The verification
 * claim arriving *after* the number is the product ethic as choreography.
 */
export function CensusCounter({
  value,
  label,
  caption,
}: {
  value: string; // raw integer string, e.g. "2633212"
  label: string;
  caption: string;
}) {
  const formatted = countFull(value);
  const chars = formatted.split("");
  const digitCount = chars.filter((c) => /\d/.test(c)).length;
  const [rolled, setRolled] = useState(false);
  const [settled, setSettled] = useState(false);

  useEffect(() => {
    const raf = requestAnimationFrame(() => setRolled(true));
    const totalRoll = 900 + digitCount * 40;
    const t = setTimeout(() => setSettled(true), totalRoll + 250);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(t);
    };
  }, [digitCount]);

  let digitIdx = -1;
  return (
    <div className="flex flex-col items-center text-center">
      <div
        className="tnum flex items-baseline font-[640] leading-none tracking-[-0.035em] text-ink-1"
        style={{ fontSize: "clamp(56px, 9vw, 96px)" }}
        aria-label={formatted}
      >
        {chars.map((ch, i) => {
          if (!/\d/.test(ch)) {
            return (
              <span key={i} className="text-ink-3" aria-hidden>
                {ch}
              </span>
            );
          }
          digitIdx += 1;
          const d = Number(ch);
          // stagger right-to-left
          const delay = (digitCount - 1 - digitIdx) * 40;
          const start = (d + 4 + ((i * 3) % 5)) % 10;
          return (
            <span
              key={i}
              className="odometer-window"
              style={{ height: "1em" }}
              aria-hidden
            >
              <span
                className="odometer-strip"
                style={{
                  transform: rolled
                    ? `translateY(-${d}em)`
                    : `translateY(-${start}em)`,
                  transitionDelay: `${delay}ms`,
                }}
              >
                {DIGITS.map((n) => (
                  <span key={n} style={{ height: "1em", lineHeight: 1 }}>
                    {n}
                  </span>
                ))}
              </span>
            </span>
          );
        })}
      </div>
      <p
        className="mt-4 text-[22px] italic text-ink-2"
        style={{ fontFamily: "var(--font-newsreader)" }}
      >
        {label}
      </p>
      <div
        className="mt-3 flex items-center gap-2 transition-all duration-[220ms]"
        style={{
          opacity: settled ? 1 : 0,
          transform: settled ? "scale(1)" : "scale(0.6)",
          transitionTimingFunction: "var(--ease-enter)",
        }}
      >
        <OpenRing size={14} />
        <span className="mono-label">{caption}</span>
      </div>
    </div>
  );
}
