import { describe, expect, it } from "vitest";
import { computeResolutionHash, computeTemplateHash } from "./hashing";

describe("hashing", () => {
  it("computeTemplateHash is deterministic across params key order", () => {
    const a = computeTemplateHash({
      systemTemplate: "sys",
      developerTemplate: null,
      userTemplate: "user",
      model: "model-x",
      params: { temperature: 0.7, topP: 0.9, nested: { b: 2, a: 1 } },
    });

    const b = computeTemplateHash({
      systemTemplate: "sys",
      developerTemplate: null,
      userTemplate: "user",
      model: "model-x",
      params: { topP: 0.9, temperature: 0.7, nested: { a: 1, b: 2 } },
    });

    expect(a).toBe(b);
  });

  it("computeResolutionHash is deterministic across params key order", () => {
    const messages = [
      { role: "system" as const, content: "s" },
      { role: "user" as const, content: "u" },
    ];

    const a = computeResolutionHash(messages, "model-x", {
      temperature: 0.7,
      topP: 0.9,
      nested: { b: 2, a: 1 },
    });

    const b = computeResolutionHash(messages, "model-x", {
      topP: 0.9,
      nested: { a: 1, b: 2 },
      temperature: 0.7,
    });

    expect(a).toBe(b);
  });

  it("computeResolutionHash changes when message order changes", () => {
    const params = { temperature: 0.7 };

    const first = computeResolutionHash(
      [
        { role: "system" as const, content: "s" },
        { role: "user" as const, content: "u" },
      ],
      "model-x",
      params
    );

    const second = computeResolutionHash(
      [
        { role: "user" as const, content: "u" },
        { role: "system" as const, content: "s" },
      ],
      "model-x",
      params
    );

    expect(first).not.toBe(second);
  });
});

