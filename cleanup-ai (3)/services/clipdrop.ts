
const API_KEY = 'b74eaf82ea9a5fdeb463de710330486f24508e95b0c777eb3e61c0136dc355529ac6032d6032729fb6ce668aaee902d0';
const CLEANUP_ENDPOINT = 'https://clipdrop-api.co/cleanup/v1';

export async function cleanupImage(imageFile: File, maskBlob: Blob): Promise<Blob> {
  const formData = new FormData();
  formData.append('image_file', imageFile);
  formData.append('mask_file', maskBlob);

  const response = await fetch(CLEANUP_ENDPOINT, {
    method: 'POST',
    headers: {
      'x-api-key': API_KEY,
    },
    body: formData,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Clipdrop API Error: ${response.status} - ${errorText}`);
  }

  return await response.blob();
}
