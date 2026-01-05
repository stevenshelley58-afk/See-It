import { NextRequest, NextResponse } from 'next/server';
import { generateHeroVariants, analyzePlacement } from '@/lib/gemini';
import { TEST_PRODUCTS, PLACEMENT_VARIANTS } from '@/lib/products';

export const maxDuration = 60; // Allow up to 60s for parallel generation

export async function POST(request: NextRequest) {
  try {
    const { roomImageBase64, productId, action, selectedImageBase64 } = await request.json();

    // Get product
    const product = TEST_PRODUCTS.find(p => p.id === productId);
    if (!product) {
      return NextResponse.json({ error: 'Product not found' }, { status: 404 });
    }

    // Analyze placement (when user selects a variant)
    if (action === 'analyze' && selectedImageBase64) {
      const analysis = await analyzePlacement(selectedImageBase64, roomImageBase64, product);
      return NextResponse.json({ analysis });
    }

    // Fetch product image and convert to base64
    let productImageBase64 = '';
    try {
      const productImageRes = await fetch(product.image);
      if (productImageRes.ok) {
        const productImageBuffer = await productImageRes.arrayBuffer();
        productImageBase64 = Buffer.from(productImageBuffer).toString('base64');
      }
    } catch (e) {
      console.warn('Could not fetch product image:', e);
    }

    // Generate 4 variants in parallel
    const startTime = Date.now();
    const variants = await generateHeroVariants(
      roomImageBase64,
      productImageBase64,
      product,
      PLACEMENT_VARIANTS
    );
    const duration = Date.now() - startTime;

    console.log(`Generated ${variants.length} variants in ${duration}ms`);

    return NextResponse.json({
      variants: variants.map(v => ({
        id: v.id,
        imageBase64: v.imageBase64,
        hint: PLACEMENT_VARIANTS.find(p => p.id === v.id)?.hint,
      })),
      duration,
      product: {
        id: product.id,
        title: product.title,
      },
    });

  } catch (error) {
    console.error('Generation error:', error);
    return NextResponse.json(
      { error: 'Generation failed', details: String(error) },
      { status: 500 }
    );
  }
}
