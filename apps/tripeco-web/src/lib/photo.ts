// An odometer photo (tripeco TR-6, design §5): taken with the camera input,
// shrunk in the browser to at most 1280 px on the long side as a JPEG, sent
// once to the reader and once to the ride as proof (≤ 400 KB; quality steps
// down until it fits).

const MAX_SIDE = 1280;
const MAX_BYTES = 390 * 1024;

export interface Shot {
  /** base64, no data: prefix */
  base64: string;
  /** for an <img> */
  url: string;
}

const bytesOf = (base64: string) => Math.floor((base64.length * 3) / 4);

export async function shrink(file: Blob): Promise<Shot> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  let quality = 0.8;
  let url = canvas.toDataURL("image/jpeg", quality);
  while (bytesOf(url.split(",")[1] ?? "") > MAX_BYTES && quality > 0.3) {
    quality -= 0.15;
    url = canvas.toDataURL("image/jpeg", quality);
  }
  return { base64: url.split(",")[1] ?? "", url };
}
