import { vitePlugin as remix } from "@remix-run/dev";
import { installGlobals } from "@remix-run/node";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

installGlobals({ nativeFetch: true });

const resolvedAppUrl =
  process.env.SHOPIFY_APP_URL ||
  process.env.HOST ||
  "http://localhost";

const host = new URL(resolvedAppUrl)
  .hostname;
let hmrConfig;

if (host === "localhost") {
  hmrConfig = {
    protocol: "ws",
    host: "localhost",
    port: 64999,
    clientPort: 64999,
  };
} else {
  hmrConfig = {
    protocol: "wss",
    host: host,
    port: parseInt(process.env.FRONTEND_PORT) || 8002,
    clientPort: 443,
  };
}

export default defineConfig({
  server: {
    allowedHosts: [host],
    cors: {
      preflightContinue: true,
    },
    port: Number(process.env.PORT || 3000),
    hmr: hmrConfig,
    fs: {
      // See https://vitejs.dev/config/server-options.html#server-fs-allow for more information
      allow: ["app", "node_modules"],
    },
  },
  plugins: [
    remix({
      ignoredRouteFiles: ["**/.*", "**/*.css"],
      future: {
        v3_fetcherPersist: true,
        v3_relativeSplatPath: true,
        v3_throwAbortReason: true,
        v3_lazyRouteDiscovery: true,
        v3_singleFetch: false,
        v3_routeConfig: true,
      },
    }),
    tsconfigPaths(),
  ],
  build: {
    assetsInlineLimit: 0,
    rollupOptions: {
      external: [
        // Node.js-only image processing libraries
        "sharp",
        // Google Cloud services (server-only)
        "@google-cloud/storage",
        "google-auth-library",
        "@google/genai",
        // Database client (server-only)
        "@prisma/client",
        ".prisma/client",
        // OpenTelemetry (server-only, includes native gRPC bindings)
        "@opentelemetry/sdk-node",
        "@opentelemetry/exporter-trace-otlp-grpc",
        "@opentelemetry/resources",
        "@opentelemetry/sdk-trace-node",
        "@opentelemetry/semantic-conventions",
        "@opentelemetry/api",
        "@prisma/instrumentation",
        "@grpc/grpc-js",
      ],
    },
  },
  optimizeDeps: {
    include: ["@shopify/app-bridge-react", "@shopify/polaris"],
  },
});
