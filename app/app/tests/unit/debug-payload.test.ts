import { describe, it, expect } from "vitest";
import type { DebugPayload, PreparedImage, AspectRatioSource } from "~/services/see-it-now/types";

describe("Debug Payload Structure", () => {
  it("should have correct debug payload structure for placement set", () => {
    const mockImages: PreparedImage[] = [
      {
        role: "prepared_product_image",
        ref: "gs://bucket/product.png",
        hash: "abc123",
        mimeType: "image/png",
        inputMethod: "INLINE",
        orderIndex: 0,
      },
    ];

    const debugPayload: DebugPayload = {
      promptText: "Generate placement set for mirror product",
      model: "gemini-2.5-flash",
      params: {
        responseModalities: ["TEXT"],
        aspectRatio: "1:1",
        mediaResolution: "MEDIA_RESOLUTION_HIGH",
      },
      images: mockImages,
      aspectRatioSource: "EXPLICIT" as AspectRatioSource,
    };

    expect(debugPayload).toBeDefined();
    expect(debugPayload.promptText).toEqual(expect.any(String));
    expect(debugPayload.model).toEqual(expect.any(String));
    expect(debugPayload.params.responseModalities).toEqual(expect.arrayContaining(["TEXT"]));
    expect(debugPayload.images).toEqual(expect.any(Array));
    expect(debugPayload.aspectRatioSource).toEqual(expect.any(String));
    
    // Verify specific values
    expect(debugPayload.params.responseModalities).toContain("TEXT");
    expect(debugPayload.images.length).toBeGreaterThan(0);
    expect(debugPayload.images[0].role).toBe("prepared_product_image");
  });
  
  it("should have correct debug payload structure for composite", () => {
    const mockImages: PreparedImage[] = [
      {
        role: "prepared_product_image",
        ref: "gs://bucket/product.png",
        hash: "abc123def456",
        mimeType: "image/png",
        inputMethod: "INLINE",
        orderIndex: 0,
      },
      {
        role: "customer_room_image",
        ref: "gs://bucket/room.jpg",
        hash: "xyz789uvw012",
        mimeType: "image/jpeg",
        inputMethod: "INLINE",
        orderIndex: 1,
      },
    ];

    const debugPayload: DebugPayload = {
      promptText: "Composite product into room scene",
      model: "gemini-2.0-flash-exp",
      params: {
        responseModalities: ["TEXT", "IMAGE"],
        aspectRatio: "16:9",
        mediaResolution: "MEDIA_RESOLUTION_HIGH",
      },
      images: mockImages,
      aspectRatioSource: "ROOM_IMAGE_LAST" as AspectRatioSource,
    };

    expect(debugPayload).toBeDefined();
    expect(debugPayload.promptText).toEqual(expect.any(String));
    expect(debugPayload.model).toEqual(expect.any(String));
    expect(debugPayload.params.responseModalities).toEqual(expect.arrayContaining(["TEXT", "IMAGE"]));
    expect(debugPayload.images).toEqual(expect.any(Array));
    expect(debugPayload.aspectRatioSource).toEqual(expect.any(String));
    
    // Verify images have correct structure
    expect(debugPayload.images.length).toBe(2);
    expect(debugPayload.images[0]).toMatchObject({
      role: expect.stringMatching(/prepared_product_image|customer_room_image/),
      hash: expect.any(String),
      mimeType: expect.any(String),
    });
    expect(debugPayload.images[1]).toMatchObject({
      role: expect.stringMatching(/prepared_product_image|customer_room_image/),
      hash: expect.any(String),
      mimeType: expect.any(String),
    });
    
    // Verify both modalities are present
    expect(debugPayload.params.responseModalities).toContain("TEXT");
    expect(debugPayload.params.responseModalities).toContain("IMAGE");
  });

  it("should validate prepared image structure", () => {
    const validImage: PreparedImage = {
      role: "prepared_product_image",
      ref: "gs://bucket/image.png",
      hash: "a".repeat(64), // SHA256 hex
      mimeType: "image/png",
      inputMethod: "INLINE",
      orderIndex: 0,
    };

    expect(validImage.role).toMatch(/prepared_product_image|customer_room_image|reference/);
    expect(validImage.ref).toMatch(/^gs:\/\/|https?:\/\//);
    expect(validImage.hash).toEqual(expect.any(String));
    expect(validImage.mimeType).toMatch(/^image\/(png|jpeg|jpg|webp)$/);
    expect(validImage.inputMethod).toMatch(/INLINE|FILES_API|GCS_REGISTERED|URL/);
    expect(validImage.orderIndex).toEqual(expect.any(Number));
    expect(validImage.orderIndex).toBeGreaterThanOrEqual(0);
  });

  it("should support different aspect ratio sources", () => {
    const sources: AspectRatioSource[] = ["EXPLICIT", "ROOM_IMAGE_LAST", "UNKNOWN"];
    
    sources.forEach(source => {
      const payload: DebugPayload = {
        promptText: "Test",
        model: "gemini-2.0-flash-exp",
        params: {
          responseModalities: ["TEXT", "IMAGE"],
        },
        images: [],
        aspectRatioSource: source,
      };
      
      expect(payload.aspectRatioSource).toBe(source);
    });
  });

  it("should support additional params properties", () => {
    const debugPayload: DebugPayload = {
      promptText: "Test with extra params",
      model: "gemini-2.0-flash-exp",
      params: {
        responseModalities: ["TEXT", "IMAGE"],
        aspectRatio: "4:3",
        mediaResolution: "MEDIA_RESOLUTION_HIGH",
        customParam: "custom_value",
        temperature: 0.7,
      },
      images: [],
      aspectRatioSource: "EXPLICIT",
    };

    expect(debugPayload.params.aspectRatio).toBe("4:3");
    expect(debugPayload.params.mediaResolution).toBe("MEDIA_RESOLUTION_HIGH");
    expect(debugPayload.params.customParam).toBe("custom_value");
    expect(debugPayload.params.temperature).toBe(0.7);
  });

  it("should maintain correct image order indices", () => {
    const images: PreparedImage[] = [
      {
        role: "prepared_product_image",
        ref: "gs://bucket/product.png",
        hash: "hash1",
        mimeType: "image/png",
        inputMethod: "INLINE",
        orderIndex: 0,
      },
      {
        role: "customer_room_image",
        ref: "gs://bucket/room.jpg",
        hash: "hash2",
        mimeType: "image/jpeg",
        inputMethod: "INLINE",
        orderIndex: 1,
      },
      {
        role: "reference",
        ref: "gs://bucket/ref.png",
        hash: "hash3",
        mimeType: "image/png",
        inputMethod: "GCS_REGISTERED",
        orderIndex: 2,
      },
    ];

    const debugPayload: DebugPayload = {
      promptText: "Test ordering",
      model: "gemini-2.0-flash-exp",
      params: {
        responseModalities: ["TEXT", "IMAGE"],
      },
      images,
      aspectRatioSource: "EXPLICIT",
    };

    // Verify order indices are sequential
    debugPayload.images.forEach((img, idx) => {
      expect(img.orderIndex).toBe(idx);
    });
  });
});
