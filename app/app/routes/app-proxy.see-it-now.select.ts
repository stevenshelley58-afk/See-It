import type { ActionFunctionArgs } from "@remix-run/node";

export const action = async (args: ActionFunctionArgs) => {
  const mod = await import("~/services/app-proxy.see-it-now.select.server");
  return mod.action(args);
};

