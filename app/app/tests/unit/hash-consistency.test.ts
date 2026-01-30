import { describe, it, expect } from "vitest";
import { computeImageHash } from "~/services/see-it-now/hashing.server";

describe("Hash Consistency", () => {
  it("should produce 64-char hashes", () => {
    const buffer = Buffer.from("test");
    const hash = computeImageHash(buffer);
    expect(hash.length).toBe(64);
  });
});
