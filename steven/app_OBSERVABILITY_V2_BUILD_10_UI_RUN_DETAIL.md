# Step 10: UI - Run Detail Page

## Context

You are working on a Shopify Remix app. You have created the runs list page. Now create the run detail page.

## Task

Create the run detail page with variants, timeline, inputs, and export.

## Instructions

Create `app/routes/app.monitor.$id.tsx` with the following structure:

### Page Structure

1. **Summary Card** - Status, duration, variant counts, request ID, trace ID link
2. **Variants Grid** - 4x2 grid showing image, status, latency, error
3. **Events Timeline** - Collapsible list of MonitorEvents sorted by time
4. **Inputs Section** - Collapsible JSON views for resolved facts and prompt pack
5. **Artifacts Section** - Collapsible list of artifacts with download links

### Key Features

- Poll every 2s if status is "in_flight"
- Copy buttons for IDs and JSON
- Click variant to see full-size image in modal
- Export button links to `/api/monitor/v1/runs/:id/export`
- Trace ID links to Google Cloud Trace console

### Component Requirements

Use Polaris components:
- Page with backAction to /app/monitor
- Card for each section
- Badge for status (success=green, failed=red, timeout=yellow, in_flight=blue)
- Collapsible for expandable sections
- Modal for variant image preview
- Button with ClipboardIcon for copy actions

### Loader

```typescript
export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  // Authenticate admin
  // Get shop ID
  // Fetch run detail, events, and artifacts using monitor module
  // Return all data
};
```

### Polling Logic

```typescript
useEffect(() => {
  if (run.status !== "in_flight") return;
  
  const interval = setInterval(() => {
    if (revalidator.state === "idle") {
      revalidator.revalidate();
    }
  }, 2000);
  
  return () => clearInterval(interval);
}, [run.status, revalidator]);
```

### Variants Grid

For each variant show:
- Image thumbnail (or placeholder if failed)
- Variant ID (e.g., "V01", "hero_bright")
- Status badge
- Latency in seconds
- Error message (if failed)

Clicking a variant opens a modal with:
- Full-size image
- All variant details
- Error message if present

### Events Timeline

Group events by source, show:
- Timestamp
- Event type
- Severity badge
- Payload preview (truncated)

### Inputs Section

Two collapsible panels:
1. Resolved Facts - JSON with copy button
2. Prompt Pack - JSON with copy button

Use `<pre>` with `JSON.stringify(data, null, 2)` for display.

### Error Handling

- Use error boundaries
- If data is malformed, render as JSON instead of crashing
- Show "Not available" for missing optional fields

## Verification

1. Navigate to `/app/monitor/[some-run-id]`
2. Page loads without errors
3. Summary shows correct data
4. Variants grid shows 8 variants
5. Clicking variant opens modal
6. Export button downloads ZIP
7. Collapsible sections expand/collapse

## Do Not

- Do not add chart libraries
- Do not make external API calls from the client
