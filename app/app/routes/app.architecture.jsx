import { json } from "@remix-run/node";
import { isRouteErrorResponse, useRouteError } from "@remix-run/react";
import { TitleBar } from "@shopify/app-bridge-react";
import { CodeArchitecture3D } from "../components/CodeArchitecture3D";
import { Card, PageShell } from "../components/ui";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }) => {
  await authenticate.admin(request);
  return json({});
};

export default function ArchitectureRoute() {
  return (
    <>
      <TitleBar title="3D Architecture" />
      <CodeArchitecture3D />
    </>
  );
}

export function ErrorBoundary() {
  const error = useRouteError();
  let title = "Error";
  let message = "Something went wrong";

  if (isRouteErrorResponse(error)) {
    title = `${error.status}`;
    message = error.data?.message || error.statusText;
  } else if (error instanceof Error) {
    message = error.message;
  }

  return (
    <>
      <TitleBar title="3D Architecture" />
      <PageShell>
        <Card>
          <div className="space-y-4">
            <div>
              <h1 className="text-lg font-semibold text-red-600">{title}</h1>
              <p className="text-sm text-neutral-600 mt-1">{message}</p>
            </div>
          </div>
        </Card>
      </PageShell>
    </>
  );
}

