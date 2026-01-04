
import { GoogleGenAI } from "@google/genai";

export async function cleanupImageGemini(imageFile: File, maskBlob: Blob): Promise<Blob> {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  
  const fileToSib64 = (file: File | Blob): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const base64 = (reader.result as string).split(',')[1];
        resolve(base64);
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  };

  const imageBase64 = await fileToSib64(imageFile);
  const maskBase64 = await fileToSib64(maskBlob);

  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash-image',
    contents: {
      parts: [
        {
          inlineData: {
            data: imageBase64,
            mimeType: imageFile.type,
          },
        },
        {
          inlineData: {
            data: maskBase64,
            mimeType: 'image/png',
          },
        },
        {
          text: "The first image is a source photograph. The second image is a binary mask where the white area indicates an object that should be completely removed. Please reconstruct the background in the white area naturally based on the surroundings in the first image. Return only the edited image.",
        },
      ],
    },
  });

  const imagePart = response.candidates?.[0]?.content?.parts.find(p => p.inlineData);
  
  if (!imagePart || !imagePart.inlineData) {
    throw new Error("Gemini failed to generate an edited image.");
  }

  const byteCharacters = atob(imagePart.inlineData.data);
  const byteNumbers = new Array(byteCharacters.length);
  for (let i = 0; i < byteCharacters.length; i++) {
    byteNumbers[i] = byteCharacters.charCodeAt(i);
  }
  const byteArray = new Uint8Array(byteNumbers);
  return new Blob([byteArray], { type: 'image/png' });
}
