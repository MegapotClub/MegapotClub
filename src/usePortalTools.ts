import { useEffect, useRef } from "react";
import type { Snapshot } from "./model.ts";
import { APP_NAME } from "./config.ts";
import { VIEWS, type View } from "./navigation.ts";
type Tool = {
  name: string;
  title: string;
  description: string;
  inputSchema: object;
  annotations: { readOnlyHint: boolean; untrustedContentHint: boolean };
  execute: (input: unknown) => unknown;
};
type Context = {
  registerTool: (
    tool: Tool,
    options: { signal: AbortSignal },
  ) => Promise<void> | void;
};

export function usePortalTools(
  snapshot: Snapshot,
  navigate: (view: View) => void,
  stale: boolean,
) {
  const state = useRef({ snapshot, navigate, stale });
  state.current = { snapshot, navigate, stale };
  useEffect(() => {
    const context = (document as Document & { modelContext?: Context })
      .modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    const add = (tool: Tool) => {
      try {
        Promise.resolve(
          context.registerTool(tool, { signal: lifecycle.signal }),
        ).catch(() => {});
      } catch {}
    };
    add({
      name: "read_draw_snapshot",
      title: "Read draw snapshot",
      description: `Read the same public Base draw snapshot shown by ${APP_NAME}. Includes its block and time. Does not refresh or send transactions.`,
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute(input) {
        if (
          !input ||
          typeof input !== "object" ||
          Array.isArray(input) ||
          Object.keys(input).length
        )
          throw new Error("Expected an empty object");
        return {
          snapshot: state.current.snapshot,
          stale: state.current.stale,
        };
      },
    });
    add({
      name: "show_portal_section",
      title: "Show portal section",
      description:
        "Navigate the visible portal to a section. Changes page navigation only. Does not connect a wallet or submit a transaction.",
      inputSchema: {
        type: "object",
        properties: {
          section: {
            type: "string",
            enum: [...VIEWS],
          },
        },
        required: ["section"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      async execute(input) {
        if (
          !input ||
          typeof input !== "object" ||
          Array.isArray(input) ||
          Object.keys(input).length !== 1 ||
          !("section" in input) ||
          !VIEWS.includes(String(input.section) as View)
        )
          throw new Error("Invalid section");
        state.current.navigate(input.section as View);
        await new Promise(requestAnimationFrame);
        return { section: input.section };
      },
    });
    return () => lifecycle.abort();
  }, []);
}
