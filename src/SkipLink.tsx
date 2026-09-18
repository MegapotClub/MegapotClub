import { useEffect, useRef, useState, type RefObject } from "react";

/** Keyboard navigation reveals the shortcut; pointer and restored focus do not. */
export function SkipLink({
  label,
  target,
}: {
  label: string;
  target: RefObject<HTMLElement | null>;
}) {
  const link = useRef<HTMLAnchorElement>(null);
  const [keyboard, setKeyboard] = useState(false);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Tab") setKeyboard(true);
    };
    const onPointer = () => {
      setKeyboard(false);
      if (document.activeElement === link.current) link.current?.blur();
    };
    const onHide = () => {
      if (document.hidden) setKeyboard(false);
    };
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("pointerdown", onPointer, true);
    document.addEventListener("visibilitychange", onHide);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("pointerdown", onPointer, true);
      document.removeEventListener("visibilitychange", onHide);
    };
  }, []);
  return (
    <a
      ref={link}
      className={`skip-link${keyboard ? " keyboard-navigation" : ""}`}
      href="#main"
      onClick={(event) => {
        event.preventDefault();
        target.current?.focus({ preventScroll: true });
        target.current?.scrollIntoView({ block: "start", behavior: "instant" });
      }}
    >
      {label}
    </a>
  );
}
