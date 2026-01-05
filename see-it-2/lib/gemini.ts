import { GoogleGenerativeAI } from '@google/generative-ai';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

// Use Flash for speed
const model = genAI.getGenerativeModel({ 
  model: 'gemini-2.0-flash-exp-image-generation',
  generationConfig: {
    responseModalities: ['Text', 'Image'],
  } as any,
});

interface Product {
  title: string;
  description: string;
  type: string;
  placementHint: string;
}

interface GenerateOptions {
  roomImageBase64: string;
  productImageBase64: string;
  product: Product;
  placementHint: string;
  lowRes?: boolean;
}

export async function generateHeroShot({
  roomImageBase64,
  productImageBase64,
  product,
  placementHint,
  lowRes = true,
}: GenerateOptions): Promise<string | null> {
  
  const prompt = `Place this ${product.type} naturally into this room photograph.

Product: ${product.title}
${product.description}
Placement guidance: ${product.placementHint}. ${placementHint}

Look at the room and choose a logical placement based on the guidance above.
Render photorealistically:
- Add soft contact shadow where product meets the floor/surface
- Match the room's lighting direction and color temperature
- Keep the product's exact shape, colors and proportions
- Make it look like it was professionally photographed in this space

${lowRes ? 'Output at standard resolution for quick preview.' : 'Output at highest quality.'}`;

  try {
    const result = await model.generateContent([
      prompt,
      {
        inlineData: {
          mimeType: 'image/jpeg',
          data: roomImageBase64,
        },
      },
      {
        inlineData: {
          mimeType: 'image/png', 
          data: productImageBase64,
        },
      },
    ]);

    const response = result.response;
    
    // Extract image from response
    for (const part of response.candidates?.[0]?.content?.parts || []) {
      if ((part as any).inlineData?.mimeType?.startsWith('image/')) {
        return (part as any).inlineData.data;
      }
    }
    
    return null;
  } catch (error) {
    console.error('Gemini generation error:', error);
    return null;
  }
}

// Generate 4 variants in parallel
export async function generateHeroVariants(
  roomImageBase64: string,
  productImageBase64: string,
  product: Product,
  variants: { id: string; hint: string }[]
): Promise<{ id: string; imageBase64: string | null }[]> {
  
  const promises = variants.map(async (variant) => {
    const imageBase64 = await generateHeroShot({
      roomImageBase64,
      productImageBase64,
      product,
      placementHint: variant.hint,
      lowRes: true,
    });
    
    return {
      id: variant.id,
      imageBase64,
    };
  });

  return Promise.all(promises);
}

// Analyze why a placement was chosen (for learning)
export async function analyzePlacement(
  selectedImageBase64: string,
  roomImageBase64: string,
  product: Product
): Promise<string> {
  
  const analysisModel = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
  
  const prompt = `The user chose this furniture placement for their ${product.type}. 

Describe in 2-3 sentences:
1. Where in the room (wall, corner, center, near window)
2. Approximate position (left/center/right of frame)
3. Why this placement likely works well

Keep it concise - this will be used to generate similar placements for other products.`;

  try {
    const result = await analysisModel.generateContent([
      prompt,
      {
        inlineData: {
          mimeType: 'image/jpeg',
          data: selectedImageBase64,
        },
      },
      {
        inlineData: {
          mimeType: 'image/jpeg',
          data: roomImageBase64,
        },
      },
    ]);

    return result.response.text();
  } catch (error) {
    console.error('Analysis error:', error);
    return 'Placement in main living area with good natural lighting.';
  }
}
