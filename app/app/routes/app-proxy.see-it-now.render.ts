import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";

export const action = async (args: ActionFunctionArgs) => {
  const mod = await import("~/services/app-proxy.see-it-now.render.server");
  return mod.action(args);
};

export const loader = async (args: LoaderFunctionArgs) => {
  const mod = await import("~/services/app-proxy.see-it-now.render.server");
  return mod.loader(args);
};
