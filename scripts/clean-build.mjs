import { rm } from "node:fs/promises";

// Generated output must never carry files from an earlier release into a new manifest.
for (const name of ["dist", ".build"])
  await rm(new URL(`../${name}/`, import.meta.url), {
    recursive: true,
    force: true,
  });
