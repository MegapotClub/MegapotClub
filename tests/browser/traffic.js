// Development-only instrumentation, loaded before the production entrypoint.
(() => {
  const parameters = new URLSearchParams(location.search);
  if (parameters.get("history") === "synthetic") {
    const key = "megapot-club:transactions:v1";
    // Only synthetic journal entries; never connect or sign through this fixture.
    const prior = JSON.parse(localStorage.getItem(key) || "[]").filter(
      (e) => !e.id?.startsWith("traffic-fixture-"),
    );
    localStorage.setItem(
      key,
      JSON.stringify([
        ...prior,
        ...Array.from({ length: 10 }, (_, i) => ({
          schema: 2,
          id: `traffic-fixture-${i}`,
          account: "0x1111111111111111111111111111111111111111",
          chainId: 8453,
          to: "0x3bAe643002069dBCbcd62B1A4eb4C4A397d042a2",
          callHash: `0x${"ab".repeat(32)}`,
          hash: `0x${String(i + 1).padStart(64, "0")}`,
          kind: "claim",
          nonce: i,
          createdAt: Date.now() - 86400000 + i,
          status: "unknown",
        })),
      ]),
    );
  }
  const actual = window.fetch.bind(window),
    started = performance.now(),
    calls = [];
  let output;
  const render = () => {
    if (!document.body) return;
    if (!output) {
      const panel = document.createElement("details");
      panel.open = true;
      panel.style.cssText =
        "padding:8px;background:#ffe8a6;color:#171717;font:12px monospace;overflow-wrap:anywhere";
      const label = document.createElement("summary");
      label.textContent = "Production traffic · read-only";
      output = document.createElement("output");
      output.id = "traffic";
      panel.append(label, output);
      document.body.prepend(panel);
    }
    output.textContent = JSON.stringify({
      elapsedSeconds: Math.floor((performance.now() - started) / 1000),
      calls,
    });
  };
  window.fetch = async (input, init) => {
    const url = new URL(
      typeof input === "string" ? input : input.url,
      location.href,
    );
    if (url.origin === location.origin) return actual(input, init);
    let body;
    try {
      body = JSON.parse(init?.body);
    } catch {}
    const call = {
      ms: Math.round(performance.now() - started),
      host: url.host,
      path:
        url.hostname === "api.megapot.io"
          ? url.pathname + url.search
          : undefined,
      method: body?.method ?? "GET",
      selector: body?.params?.[0]?.data?.slice(0, 10),
      status: "pending",
    };
    calls.push(call);
    render();
    try {
      const response = await actual(input, init);
      call.status = response.status;
      return response;
    } catch (e) {
      call.status = "network-error";
      throw e;
    } finally {
      render();
    }
  };
  setInterval(render, 1000);
})();
