import type { NextConfig } from "next";
import path from "node:path";

// A separate generated folder avoids locks from OneDrive or a concurrent dev
// process. Never allow an environment value to escape the project directory.
const buildDirectory = process.env.YOKOHAMA_BUILD_DIR || ".next";
if (!/^\.next(?:-[a-zA-Z0-9-]+)?$/.test(buildDirectory)) {
  throw new Error("YOKOHAMA_BUILD_DIR debe ser .next o .next-NOMBRE dentro del panel.");
}
const config: NextConfig = {
  distDir: buildDirectory,
  poweredByHeader: false,
  devIndicators: false,
  turbopack: { root: path.resolve(__dirname) },
  async headers() {
    return [{ source: "/:path*", headers: [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "X-Frame-Options", value: "DENY" },
      { key: "Referrer-Policy", value: "no-referrer" },
      { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
      { key: "X-Robots-Tag", value: "noindex, nofollow" }
    ] }];
  }
};
export default config;
