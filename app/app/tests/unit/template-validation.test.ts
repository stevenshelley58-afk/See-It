import { describe, it, expect, vi } from "vitest";

// =============================================================================
// Mock Prisma
// =============================================================================

const mockPrisma = vi.hoisted(() => ({
  promptDefinition: {
    findUnique: vi.fn(),
    findMany: vi.fn(),
  },
  shopRuntimeConfig: {
    findUnique: vi.fn(),
  },
}));

vi.mock("~/db.server", () => ({
  default: mockPrisma,
}));

// Import after mocking
import { renderTemplate } from "~/services/prompt-control/prompt-resolver.server";

describe("Template Validation", () => {
  it("should warn when variables are not replaced", () => {
    const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const template = "Hello {{name}}, your order is {{orderId}}";
    const variables = { name: "John" }; // missing orderId

    renderTemplate(template, variables);

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("Unreplaced variables"),
      expect.any(Object)
    );

    consoleSpy.mockRestore();
  });

  it("should not warn when all variables are replaced", () => {
    const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const template = "Hello {{name}}, your order is {{orderId}}";
    const variables = { name: "John", orderId: "123" };

    renderTemplate(template, variables);

    expect(consoleSpy).not.toHaveBeenCalled();

    consoleSpy.mockRestore();
  });

  it("should handle dot notation paths correctly", () => {
    const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const template = "Product: {{product.title}} - {{product.price}}";
    const variables = {
      product: { title: "Chair", price: "$99" }
    };

    const result = renderTemplate(template, variables);

    expect(consoleSpy).not.toHaveBeenCalled();
    expect(result).toBe("Product: Chair - $99");

    consoleSpy.mockRestore();
  });

  it("should warn for missing nested path variables", () => {
    const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const template = "Product: {{product.title}} - {{product.price}}";
    const variables = {
      product: { title: "Chair" } // missing price
    };

    renderTemplate(template, variables);

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("Unreplaced variables"),
      expect.objectContaining({
        unreplacedVariables: expect.arrayContaining(["{{product.price}}"])
      })
    );

    consoleSpy.mockRestore();
  });
});
