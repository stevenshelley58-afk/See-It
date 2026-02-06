/**
 * Cross-repo contract checks (type-level).
 *
 * Goal: Keep `see-it-monitor/` aligned with the app's `/external/v1/*` API shapes.
 *
 * This file is validated by `npm run typecheck` (tsc). It is not intended to be
 * executed directly.
 */

import type {
  ExternalArtifact,
  ExternalEvent,
  ExternalRunDetail,
  ExternalRunsListItem,
  ExternalShopDetail,
  ExternalShopListItem,
} from "~/services/monitor/queries.server";

import type {
  RunArtifact,
  RunDetail,
  RunEvent,
  RunListItem,
  ShopDetail,
  ShopListItem,
} from "../../see-it-monitor/lib/types";

type Assert<T extends true> = T;
type IsAssignable<From, To> = From extends To ? true : false;

// External API types must be assignable to monitor expectations.
export type MonitorContractAssertions = [
  Assert<IsAssignable<ExternalRunsListItem, RunListItem>>,
  Assert<IsAssignable<ExternalRunDetail, RunDetail>>,
  Assert<IsAssignable<ExternalEvent, RunEvent>>,
  Assert<IsAssignable<ExternalArtifact, RunArtifact>>,
  Assert<IsAssignable<ExternalShopListItem, ShopListItem>>,
  Assert<IsAssignable<ExternalShopDetail, ShopDetail>>,
];
