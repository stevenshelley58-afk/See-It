/**
 * check-schema-sync.ts
 *
 * Validates that the see-it-monitor Prisma schema is a valid subset of the main app schema.
 * This script parses both schema files and compares models and enums.
 *
 * Run: npx tsx scripts/check-schema-sync.ts
 */

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const MAIN_SCHEMA_PATH = path.resolve(__dirname, "../prisma/schema.prisma");
const MONITOR_SCHEMA_PATH = path.resolve(
  __dirname,
  "../../see-it-monitor/prisma/schema.prisma"
);

interface ParsedSchema {
  models: Map<string, ModelDef>;
  enums: Map<string, string[]>;
}

interface ModelDef {
  name: string;
  fields: Map<string, FieldDef>;
  tableName: string | null;
}

interface FieldDef {
  name: string;
  type: string;
  isOptional: boolean;
  isArray: boolean;
  columnName: string | null;
}

function parseSchema(content: string): ParsedSchema {
  const models = new Map<string, ModelDef>();
  const enums = new Map<string, string[]>();

  const lines = content.split("\n");
  let currentModel: ModelDef | null = null;
  let currentEnum: { name: string; values: string[] } | null = null;
  let braceDepth = 0;

  for (const line of lines) {
    const trimmed = line.trim();

    // Skip comments and empty lines
    if (trimmed.startsWith("//") || trimmed === "") continue;

    // Model start
    const modelMatch = trimmed.match(/^model\s+(\w+)\s*\{/);
    if (modelMatch) {
      currentModel = {
        name: modelMatch[1],
        fields: new Map(),
        tableName: null,
      };
      braceDepth = 1;
      continue;
    }

    // Enum start
    const enumMatch = trimmed.match(/^enum\s+(\w+)\s*\{/);
    if (enumMatch) {
      currentEnum = { name: enumMatch[1], values: [] };
      braceDepth = 1;
      continue;
    }

    // Track braces
    if (trimmed === "{") {
      braceDepth++;
      continue;
    }
    if (trimmed === "}" || trimmed.startsWith("}")) {
      braceDepth--;
      if (braceDepth === 0) {
        if (currentModel) {
          models.set(currentModel.name, currentModel);
          currentModel = null;
        }
        if (currentEnum) {
          enums.set(currentEnum.name, currentEnum.values);
          currentEnum = null;
        }
      }
      continue;
    }

    // Inside model
    if (currentModel && braceDepth === 1) {
      // Check for @@map
      const mapMatch = trimmed.match(/@@map\("([^"]+)"\)/);
      if (mapMatch) {
        currentModel.tableName = mapMatch[1];
        continue;
      }

      // Skip @@index, @@unique, etc.
      if (trimmed.startsWith("@@")) continue;

      // Parse field
      const fieldMatch = trimmed.match(/^(\w+)\s+(\w+)(\[\])?(\?)?/);
      if (fieldMatch) {
        const fieldName = fieldMatch[1];
        const fieldType = fieldMatch[2];
        const isArray = !!fieldMatch[3];
        const isOptional = !!fieldMatch[4];

        // Check for @map
        const columnMatch = trimmed.match(/@map\("([^"]+)"\)/);
        const columnName = columnMatch ? columnMatch[1] : null;

        currentModel.fields.set(fieldName, {
          name: fieldName,
          type: fieldType,
          isOptional,
          isArray,
          columnName,
        });
      }
    }

    // Inside enum
    if (currentEnum && braceDepth === 1) {
      // Enum values are just identifiers
      const enumValueMatch = trimmed.match(/^(\w+)$/);
      if (enumValueMatch) {
        currentEnum.values.push(enumValueMatch[1]);
      }
    }
  }

  return { models, enums };
}

function compareSchemas(main: ParsedSchema, monitor: ParsedSchema): string[] {
  const errors: string[] = [];

  // Check all enums in monitor exist in main with same values
  for (const [enumName, monitorValues] of monitor.enums) {
    const mainValues = main.enums.get(enumName);
    if (!mainValues) {
      errors.push(`Enum "${enumName}" in monitor schema not found in main schema`);
      continue;
    }

    for (const value of monitorValues) {
      if (!mainValues.includes(value)) {
        errors.push(
          `Enum "${enumName}" value "${value}" in monitor not found in main schema`
        );
      }
    }
  }

  // Check all models in monitor exist in main
  for (const [modelName, monitorModel] of monitor.models) {
    const mainModel = main.models.get(modelName);
    if (!mainModel) {
      errors.push(`Model "${modelName}" in monitor schema not found in main schema`);
      continue;
    }

    // Check table names match
    if (monitorModel.tableName && mainModel.tableName) {
      if (monitorModel.tableName !== mainModel.tableName) {
        errors.push(
          `Model "${modelName}" table name mismatch: ` +
            `monitor="${monitorModel.tableName}", main="${mainModel.tableName}"`
        );
      }
    }

    // Check all fields in monitor exist in main with compatible types
    for (const [fieldName, monitorField] of monitorModel.fields) {
      const mainField = mainModel.fields.get(fieldName);
      if (!mainField) {
        errors.push(
          `Field "${modelName}.${fieldName}" in monitor not found in main schema`
        );
        continue;
      }

      // Check type compatibility
      if (monitorField.type !== mainField.type) {
        errors.push(
          `Field "${modelName}.${fieldName}" type mismatch: ` +
            `monitor="${monitorField.type}", main="${mainField.type}"`
        );
      }

      // Check array/optional compatibility
      if (monitorField.isArray !== mainField.isArray) {
        errors.push(
          `Field "${modelName}.${fieldName}" array mismatch: ` +
            `monitor=${monitorField.isArray}, main=${mainField.isArray}`
        );
      }

      // Check column name mapping
      if (monitorField.columnName && mainField.columnName) {
        if (monitorField.columnName !== mainField.columnName) {
          errors.push(
            `Field "${modelName}.${fieldName}" column name mismatch: ` +
              `monitor="${monitorField.columnName}", main="${mainField.columnName}"`
          );
        }
      }
    }
  }

  return errors;
}

function main() {
  console.log("Checking schema sync...\n");

  // Check files exist
  if (!fs.existsSync(MAIN_SCHEMA_PATH)) {
    console.error(`Main schema not found: ${MAIN_SCHEMA_PATH}`);
    process.exit(1);
  }
  if (!fs.existsSync(MONITOR_SCHEMA_PATH)) {
    console.error(`Monitor schema not found: ${MONITOR_SCHEMA_PATH}`);
    process.exit(1);
  }

  // Parse schemas
  const mainContent = fs.readFileSync(MAIN_SCHEMA_PATH, "utf-8");
  const monitorContent = fs.readFileSync(MONITOR_SCHEMA_PATH, "utf-8");

  const mainSchema = parseSchema(mainContent);
  const monitorSchema = parseSchema(monitorContent);

  console.log(`Main schema: ${mainSchema.models.size} models, ${mainSchema.enums.size} enums`);
  console.log(`Monitor schema: ${monitorSchema.models.size} models, ${monitorSchema.enums.size} enums\n`);

  // Compare
  const errors = compareSchemas(mainSchema, monitorSchema);

  if (errors.length > 0) {
    console.error("Schema sync errors found:\n");
    for (const error of errors) {
      console.error(`  - ${error}`);
    }
    console.error(`\n${errors.length} error(s) found.`);
    console.error("\nThe monitor schema must be a valid subset of the main schema.");
    console.error("See docs/LAYER_DEPENDENCIES.md for details.\n");
    process.exit(1);
  }

  console.log("Schema sync check passed.");
}

main();
