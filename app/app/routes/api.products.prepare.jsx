// Legacy path /api/products/prepare — delegate to spec path handler for compatibility
import { handlePrepare } from "./api.products.$id.prepare";

export const action = async ({ request }) => {
    return handlePrepare(request, null);
};
