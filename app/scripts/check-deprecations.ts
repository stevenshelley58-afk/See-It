/**
 * check-deprecations.ts
 *
 * Scans Prisma schema files for DEPRECATED comments and fails if any have expired.
 * Expected format: // DEPRECATED(YYYY-MM-DD): reason
 *
 * Run: npx tsx scripts/check-deprecations.ts
 */

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SCHEMA_PATHS = [
  path.resolve(__dirname, "../prisma/schema.prisma"),
  path.resolve(__dirname, "../../see-it-monitor/prisma/schema.prisma"),
];

interface Deprecation {
  file: string;
  line: number;
  date: Date;
  dateString: string;
  reason: string;
  context: string;
}

function parseDeprecations(filePath: string): Deprecation[] {
  const deprecations: Deprecation[] = [];

  if (!fs.existsSync(filePath)) {
    return deprecations;
  }

  const content = fs.readFileSync(filePath, "utf-8");
  const lines = content.split("\n");

  // Pattern: // DEPRECATED(YYYY-MM-DD): reason
  const deprecatedPattern = /\/\/\s*DEPRECATED\((\d{4}-\d{2}-\d{2})\):\s*(.+)/;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const match = line.match(deprecatedPattern);

    if (match) {
      const dateString = match[1];
      const reason = match[2].trim();
      const date = new Date(dateString);

      // Get context (the field/model on the next non-comment line)
      let context = "";
      for (let j = i + 1; j < lines.length; j++) {
        const nextLine = lines[j].trim();
        if (nextLine && !nextLine.startsWith("//")) {
          context = nextLine.substring(0, 60) + (nextLine.length > 60 ? "..." : "");
          break;
        }
      }

      deprecations.push({
        file: path.relative(process.cwd(), filePath),
        line: i + 1,
        date,
        dateString,
        reason,
        context,
      });
    }
  }

  return deprecations;
}

function main() {
  console.log("Checking for expired deprecations...\n");

  const now = new Date();
  const allDeprecations: Deprecation[] = [];
  const expiredDeprecations: Deprecation[] = [];

  for (const schemaPath of SCHEMA_PATHS) {
    const deprecations = parseDeprecations(schemaPath);
    allDeprecations.push(...deprecations);

    for (const dep of deprecations) {
      if (dep.date <= now) {
        expiredDeprecations.push(dep);
      }
    }
  }

  if (allDeprecations.length === 0) {
    console.log("No deprecation comments found.");
    return;
  }

  console.log(`Found ${allDeprecations.length} deprecation(s):\n`);

  for (const dep of allDeprecations) {
    const isExpired = dep.date <= now;
    const status = isExpired ? "[EXPIRED]" : "[active]";
    console.log(`  ${status} ${dep.file}:${dep.line}`);
    console.log(`           Date: ${dep.dateString}`);
    console.log(`           Reason: ${dep.reason}`);
    if (dep.context) {
      console.log(`           Context: ${dep.context}`);
    }
    console.log();
  }

  if (expiredDeprecations.length > 0) {
    console.error(`\n${expiredDeprecations.length} deprecation(s) have expired!`);
    console.error("\nExpired deprecations must be resolved:");
    console.error("  1. Remove the deprecated code/column");
    console.error("  2. Create a migration to drop the column (if DB)");
    console.error("  3. Remove the DEPRECATED comment");
    console.error("\nOr, if more time is needed:");
    console.error("  - Update the date in the DEPRECATED comment");
    console.error("  - Document the reason in the migration template\n");
    process.exit(1);
  }

  console.log("No expired deprecations. All clear.");
}

main();
