/** @type {import('@remix-run/dev').AppConfig} */
module.exports = {
  // Prevent non-route assets (like CSS Modules) from being treated as route modules
  // when using `flatRoutes()` in `app/app/routes.js`.
  ignoredRouteFiles: ["**/.*", "**/*.css"],
  appDirectory: "app",
  serverModuleFormat: "cjs",
  dev: { port: process.env.HMR_SERVER_PORT || 8002 },
  future: {},
};
