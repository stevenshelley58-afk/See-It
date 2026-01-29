// =============================================================================
// Runtime Config API Route
// GET: Returns current runtime config and status
// PATCH: Updates runtime config fields
// =============================================================================

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";
import {
  jsonError,
  jsonSuccess,
  validateShopId,
  requireShopAccessAndPermission,
  getIpAddress,
  getUserAgent,
} from "@/lib/api-utils";
import { resolveShopId } from "@/lib/shop-resolver";
import type {
  RuntimeConfigResponse,
  UpdateRuntimeConfigRequest,
  AuditAction,
} from "@/lib/types-prompt-control";

const FILES_API_SAFE_MODE_AVOIDABLE_DOWNLOAD_EVENT_TYPE =
  "sf_files_api_safe_mode_avoidable_download_ms";
const FILES_API_OPTIMIZATION_WINDOW_HOURS = 24;
const FILES_API_OPTIMIZATION_MAX_EVENTS = 2000;

type FilesApiOptimizationMetrics = RuntimeConfigResponse["status"]["filesApiOptimization"];

async function getFilesApiOptimizationMetrics(shopId: string): Promise<FilesApiOptimizationMetrics> {
  const windowMs = FILES_API_OPTIMIZATION_WINDOW_HOURS * 60 * 60 * 1000;
  const since = new Date(Date.now() - windowMs);

  const events = await prisma.monitorEvent.findMany({
    where: {
      shopId,
      type: FILES_API_SAFE_MODE_AVOIDABLE_DOWNLOAD_EVENT_TYPE,
      ts: { gte: since },
    },
    select: { payload: true },
    orderBy: { ts: "desc" },
    take: FILES_API_OPTIMIZATION_MAX_EVENTS,
  });

  let avoidableDownloadMsTotal = 0;
  let avoidableDownloadMsProduct = 0;
  let avoidableDownloadMsRoom = 0;

  for (const ev of events) {
    const payload = ev.payload as any;
    avoidableDownloadMsTotal += Number(payload?.avoidable_download_ms_total ?? 0) || 0;
    avoidableDownloadMsProduct += Number(payload?.avoidable_download_ms_product ?? 0) || 0;
    avoidableDownloadMsRoom += Number(payload?.avoidable_download_ms_room ?? 0) || 0;
  }

  const samples = events.length;
  const avgAvoidableDownloadMsTotal = samples > 0 ? avoidableDownloadMsTotal / samples : 0;

  return {
    windowHours: FILES_API_OPTIMIZATION_WINDOW_HOURS,
    samples,
    avoidableDownloadMsTotal,
    avoidableDownloadMsProduct,
    avoidableDownloadMsRoom,
    avgAvoidableDownloadMsTotal,
  };
}

// =============================================================================
// Helper: Get Daily Cost for Shop
// Sums costEstimate for today's LLM calls
// =============================================================================

async function getDailyCostForShop(shopId: string): Promise<number> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const result = await prisma.lLMCall.aggregate({
    where: {
      shopId,
      startedAt: { gte: today },
      status: "SUCCEEDED",
    },
    _sum: { costEstimate: true },
  });

  return Number(result._sum.costEstimate ?? 0);
}

// =============================================================================
// Helper: Get Current Concurrency
// Counts LLM calls with status STARTED for this shop
// =============================================================================

async function getCurrentConcurrency(shopId: string): Promise<number> {
  const count = await prisma.lLMCall.count({
    where: {
      shopId,
      status: "STARTED",
    },
  });

  return count;
}

// =============================================================================
// GET /api/shops/[shopId]/runtime-config
// Returns current runtime config and status
// =============================================================================

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ shopId: string }> }
): Promise<NextResponse> {
  try {
    const { shopId: rawShopId } = await params;
    const validatedId = validateShopId(rawShopId);

    if (!validatedId) {
      return jsonError(400, "bad_request", "Invalid or missing shopId");
    }

    // Resolve shop ID (supports UUID or domain name like "bohoem58")
    const shopId = await resolveShopId(validatedId);
    if (!shopId) {
      return jsonError(404, "not_found", `Shop not found: ${validatedId}`);
    }

    // Verify authentication and shop access
    const authResult = requireShopAccessAndPermission(
      request,
      shopId,
      "VIEW_RUNTIME_CONFIG"
    );
    if ("error" in authResult) {
      return authResult.error;
    }

    // Get or create runtime config
    let config = await prisma.shopRuntimeConfig.findUnique({
      where: { shopId },
    });

    // If no config exists, create default
    if (!config) {
      config = await prisma.shopRuntimeConfig.create({
        data: {
          shopId,
          maxConcurrency: 5,
          forceFallbackModel: null,
          modelAllowList: [],
          maxTokensOutputCap: 8192,
          maxImageBytesCap: 20000000,
          dailyCostCap: 50.0,
          disabledPromptNames: [],
          updatedBy: "system",
        },
      });
    }

    // Get current status
    const [currentConcurrency, dailyCostUsed, filesApiOptimization] = await Promise.all([
      getCurrentConcurrency(shopId),
      getDailyCostForShop(shopId),
      getFilesApiOptimizationMetrics(shopId),
    ]);

    const response: RuntimeConfigResponse = {
      config: {
        id: config.id,
        maxConcurrency: config.maxConcurrency,
        forceFallbackModel: config.forceFallbackModel,
        modelAllowList: config.modelAllowList,
        maxTokensOutputCap: config.maxTokensOutputCap,
        maxImageBytesCap: config.maxImageBytesCap,
        dailyCostCap: Number(config.dailyCostCap),
        disabledPromptNames: config.disabledPromptNames,
        skipGcsDownloadWhenGeminiUriValid: config.skipGcsDownloadWhenGeminiUriValid,
        updatedAt: config.updatedAt.toISOString(),
        updatedBy: config.updatedBy,
      },
      status: {
        currentConcurrency,
        dailyCostUsed,
        filesApiOptimization,
      },
    };

    return jsonSuccess(response);
  } catch (error) {
    console.error("GET /api/shops/[shopId]/runtime-config error:", error);
    return jsonError(500, "internal_error", "Failed to fetch runtime config");
  }
}

// =============================================================================
// PATCH /api/shops/[shopId]/runtime-config
// Updates runtime config fields
// Creates audit log entry with RUNTIME_UPDATE action
// =============================================================================

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ shopId: string }> }
): Promise<NextResponse> {
  try {
    const { shopId: rawShopId } = await params;
    const validatedId = validateShopId(rawShopId);

    if (!validatedId) {
      return jsonError(400, "bad_request", "Invalid or missing shopId");
    }

    // Resolve shop ID (supports UUID or domain name like "bohoem58")
    const shopId = await resolveShopId(validatedId);
    if (!shopId) {
      return jsonError(404, "not_found", `Shop not found: ${validatedId}`);
    }

    // Verify authentication, shop access, and admin permission
    const authResult = requireShopAccessAndPermission(
      request,
      shopId,
      "UPDATE_RUNTIME_CONFIG"
    );
    if ("error" in authResult) {
      return authResult.error;
    }

    const { session } = authResult;

    // Parse request body
    let body: UpdateRuntimeConfigRequest;
    try {
      body = await request.json();
    } catch {
      return jsonError(400, "bad_request", "Invalid JSON body");
    }

    // Validate fields
    if (body.maxConcurrency !== undefined) {
      if (typeof body.maxConcurrency !== "number" || body.maxConcurrency < 1 || body.maxConcurrency > 100) {
        return jsonError(400, "validation_error", "maxConcurrency must be between 1 and 100");
      }
    }

    if (body.maxTokensOutputCap !== undefined) {
      if (typeof body.maxTokensOutputCap !== "number" || body.maxTokensOutputCap < 100 || body.maxTokensOutputCap > 32768) {
        return jsonError(400, "validation_error", "maxTokensOutputCap must be between 100 and 32768");
      }
    }

    if (body.maxImageBytesCap !== undefined) {
      if (typeof body.maxImageBytesCap !== "number" || body.maxImageBytesCap < 1000000 || body.maxImageBytesCap > 100000000) {
        return jsonError(400, "validation_error", "maxImageBytesCap must be between 1MB and 100MB");
      }
    }

    if (body.dailyCostCap !== undefined) {
      if (typeof body.dailyCostCap !== "number" || body.dailyCostCap < 0 || body.dailyCostCap > 10000) {
        return jsonError(400, "validation_error", "dailyCostCap must be between 0 and 10000");
      }
    }

    if (body.modelAllowList !== undefined) {
      if (!Array.isArray(body.modelAllowList) || !body.modelAllowList.every((m) => typeof m === "string")) {
        return jsonError(400, "validation_error", "modelAllowList must be an array of strings");
      }
    }

    if (body.disabledPromptNames !== undefined) {
      if (!Array.isArray(body.disabledPromptNames) || !body.disabledPromptNames.every((p) => typeof p === "string")) {
        return jsonError(400, "validation_error", "disabledPromptNames must be an array of strings");
      }
    }

    if (body.skipGcsDownloadWhenGeminiUriValid !== undefined) {
      if (typeof body.skipGcsDownloadWhenGeminiUriValid !== "boolean") {
        return jsonError(400, "validation_error", "skipGcsDownloadWhenGeminiUriValid must be a boolean");
      }
    }

    // Get current config for audit log
    const currentConfig = await prisma.shopRuntimeConfig.findUnique({
      where: { shopId },
    });

    // Get actor from authenticated session
    const actor = session.actor;
    const ipAddress = getIpAddress(request);
    const userAgent = getUserAgent(request);

    // Build update data
    const updateData: Record<string, unknown> = {
      updatedBy: actor,
    };

    if (body.maxConcurrency !== undefined) updateData.maxConcurrency = body.maxConcurrency;
    if (body.forceFallbackModel !== undefined) updateData.forceFallbackModel = body.forceFallbackModel;
    if (body.modelAllowList !== undefined) updateData.modelAllowList = body.modelAllowList;
    if (body.maxTokensOutputCap !== undefined) updateData.maxTokensOutputCap = body.maxTokensOutputCap;
    if (body.maxImageBytesCap !== undefined) updateData.maxImageBytesCap = body.maxImageBytesCap;
    if (body.dailyCostCap !== undefined) updateData.dailyCostCap = body.dailyCostCap;
    if (body.disabledPromptNames !== undefined) updateData.disabledPromptNames = body.disabledPromptNames;
    if (body.skipGcsDownloadWhenGeminiUriValid !== undefined) {
      updateData.skipGcsDownloadWhenGeminiUriValid = body.skipGcsDownloadWhenGeminiUriValid;
    }

    // Upsert runtime config
    const updatedConfig = await prisma.shopRuntimeConfig.upsert({
      where: { shopId },
      create: {
        shopId,
        maxConcurrency: body.maxConcurrency ?? 5,
        forceFallbackModel: body.forceFallbackModel ?? null,
        modelAllowList: body.modelAllowList ?? [],
        maxTokensOutputCap: body.maxTokensOutputCap ?? 8192,
        maxImageBytesCap: body.maxImageBytesCap ?? 20000000,
        dailyCostCap: body.dailyCostCap ?? 50.0,
        disabledPromptNames: body.disabledPromptNames ?? [],
        skipGcsDownloadWhenGeminiUriValid: body.skipGcsDownloadWhenGeminiUriValid ?? false,
        updatedBy: actor,
      },
      update: updateData,
    });

    // Create audit log entry
    const beforeState = currentConfig
      ? {
          maxConcurrency: currentConfig.maxConcurrency,
          forceFallbackModel: currentConfig.forceFallbackModel,
          modelAllowList: currentConfig.modelAllowList,
           maxTokensOutputCap: currentConfig.maxTokensOutputCap,
           maxImageBytesCap: currentConfig.maxImageBytesCap,
           dailyCostCap: Number(currentConfig.dailyCostCap),
           disabledPromptNames: currentConfig.disabledPromptNames,
           skipGcsDownloadWhenGeminiUriValid:
             currentConfig.skipGcsDownloadWhenGeminiUriValid,
         }
       : null;

    const afterState = {
      maxConcurrency: updatedConfig.maxConcurrency,
      forceFallbackModel: updatedConfig.forceFallbackModel,
      modelAllowList: updatedConfig.modelAllowList,
      maxTokensOutputCap: updatedConfig.maxTokensOutputCap,
      maxImageBytesCap: updatedConfig.maxImageBytesCap,
      dailyCostCap: Number(updatedConfig.dailyCostCap),
      disabledPromptNames: updatedConfig.disabledPromptNames,
      skipGcsDownloadWhenGeminiUriValid: updatedConfig.skipGcsDownloadWhenGeminiUriValid,
    };

    await prisma.promptAuditLog.create({
      data: {
        shopId,
        actor,
        action: "RUNTIME_UPDATE" as AuditAction,
        targetType: "ShopRuntimeConfig",
        targetId: updatedConfig.id,
        targetName: "runtime-config",
        before: beforeState ?? undefined,
        after: afterState,
        ipAddress,
        userAgent,
      },
    });

    // Get current status
    const [currentConcurrency, dailyCostUsed, filesApiOptimization] = await Promise.all([
      getCurrentConcurrency(shopId),
      getDailyCostForShop(shopId),
      getFilesApiOptimizationMetrics(shopId),
    ]);

    const response: RuntimeConfigResponse = {
      config: {
        id: updatedConfig.id,
        maxConcurrency: updatedConfig.maxConcurrency,
        forceFallbackModel: updatedConfig.forceFallbackModel,
        modelAllowList: updatedConfig.modelAllowList,
        maxTokensOutputCap: updatedConfig.maxTokensOutputCap,
        maxImageBytesCap: updatedConfig.maxImageBytesCap,
        dailyCostCap: Number(updatedConfig.dailyCostCap),
        disabledPromptNames: updatedConfig.disabledPromptNames,
        skipGcsDownloadWhenGeminiUriValid: updatedConfig.skipGcsDownloadWhenGeminiUriValid,
        updatedAt: updatedConfig.updatedAt.toISOString(),
        updatedBy: updatedConfig.updatedBy,
      },
      status: {
        currentConcurrency,
        dailyCostUsed,
        filesApiOptimization,
      },
    };

    return jsonSuccess(response);
  } catch (error) {
    console.error("PATCH /api/shops/[shopId]/runtime-config error:", error);
    return jsonError(500, "internal_error", "Failed to update runtime config");
  }
}
