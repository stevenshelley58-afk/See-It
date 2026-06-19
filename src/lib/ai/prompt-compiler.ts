import type { PromptVersionRecord } from "@/lib/db/schema";
import { promptHash } from "@/lib/ai/prompt-hash";

export type CompiledPrompt = {
  promptTemplateId: string;
  promptVersionId: string;
  resolvedSystemInstruction?: string;
  resolvedDeveloperInstruction?: string;
  resolvedUserPrompt: string;
  resolvedNegativePrompt?: string;
  variablesJson: Record<string, unknown>;
  promptHash: string;
};

function renderTemplate(template: string | undefined, variables: Record<string, unknown>) {
  if (!template) {
    return undefined;
  }
  return template.replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (_match, key: string) => {
    const value = variables[key];
    if (value === undefined || value === null) {
      throw new Error("Missing prompt variable: " + key);
    }
    return String(value);
  });
}

export function validatePromptVariables(version: PromptVersionRecord, variables: Record<string, unknown>) {
  const schema = version.variablesSchema as { required?: string[] };
  const required = schema.required ?? [];
  const missing = required.filter((key) => variables[key] === undefined || variables[key] === null || variables[key] === "");
  if (missing.length > 0) {
    throw new Error("Missing prompt variables: " + missing.join(", "));
  }
}

export function compilePrompt(version: PromptVersionRecord, variables: Record<string, unknown>): CompiledPrompt {
  validatePromptVariables(version, variables);
  const resolved = {
    promptTemplateId: version.promptTemplateId,
    promptVersionId: version.id,
    resolvedSystemInstruction: renderTemplate(version.systemInstruction, variables),
    resolvedDeveloperInstruction: renderTemplate(version.developerInstruction, variables),
    resolvedUserPrompt: renderTemplate(version.userPromptTemplate, variables) ?? "",
    resolvedNegativePrompt: renderTemplate(version.negativePromptTemplate, variables),
    variablesJson: variables
  };
  return {
    ...resolved,
    promptHash: promptHash(resolved)
  };
}

export function diffPromptVersions(a: PromptVersionRecord, b: PromptVersionRecord) {
  return {
    from: a.id,
    to: b.id,
    changed: {
      systemInstruction: a.systemInstruction !== b.systemInstruction,
      developerInstruction: a.developerInstruction !== b.developerInstruction,
      userPromptTemplate: a.userPromptTemplate !== b.userPromptTemplate,
      negativePromptTemplate: a.negativePromptTemplate !== b.negativePromptTemplate,
      variablesSchema: JSON.stringify(a.variablesSchema) !== JSON.stringify(b.variablesSchema),
      defaultParams: JSON.stringify(a.defaultParams) !== JSON.stringify(b.defaultParams)
    }
  };
}
