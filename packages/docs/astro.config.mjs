import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";

export default defineConfig({
  integrations: [
    starlight({
      title: "Ralph",
      description:
        "Install, manage, and monitor autonomous coding loops across local software projects.",
      social: [
        {
          icon: "github",
          label: "GitHub",
          href: "https://github.com/your-org/ralph",
        },
      ],
      sidebar: [
        {
          label: "Getting Started",
          items: [{ label: "Contributing", slug: "contributing" }],
        },
        {
          label: "Architecture",
          items: [
            { label: "System Architecture", slug: "architecture" },
            { label: "Schemas Reference", slug: "schemas" },
          ],
        },
        {
          label: "Reference",
          items: [
            { label: "CLI Reference", slug: "spec-cli" },
            { label: "Web API Reference", slug: "spec-web" },
            { label: "Core Package", slug: "spec-core" },
            { label: "Artifact Templates", slug: "spec-artifacts" },
          ],
        },
      ],
      customCss: ["./src/styles/custom.css"],
    }),
  ],
});
