import type { LoaderFunctionArgs } from "@remix-run/node";

export const loader = async (args: LoaderFunctionArgs) => {
  const mod = await import("~/services/app-proxy.settings.server");
  return mod.loader(args);
};

