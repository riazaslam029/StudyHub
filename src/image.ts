import * as ImageManipulator from 'expo-image-manipulator';

export type PreparedImage = { base64: string; mimeType: 'image/jpeg' };

export async function prepareImageForGemini(uri: string): Promise<PreparedImage> {
  const result = await ImageManipulator.manipulateAsync(uri, [{ resize: { width: 1600 } }], { compress: 0.72, format: ImageManipulator.SaveFormat.JPEG, base64: true });
  if (!result.base64) throw new Error('Could not prepare that image. Please choose another photo.');
  return { base64: result.base64, mimeType: 'image/jpeg' };
}
