(() => {
  try {
    const preference = localStorage.getItem("megapot-club:theme") || "system";
    document.documentElement.dataset.theme = preference === "dark" || preference === "light"
      ? preference : matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  } catch {
    document.documentElement.dataset.theme = matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
})();
