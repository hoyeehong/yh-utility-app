import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { storage } from './firebase';

/**
 * Compress an image in the browser using HTML5 Canvas before uploading.
 * Resizes max dimension to 1600px and encodes at 0.8 JPEG quality,
 * shrinking typical 8MB phone photos down to ~250KB with zero visible loss.
 */
export async function compressImage(file, maxDimension = 1600, quality = 0.8) {
  if (!file || !file.type.startsWith('image/')) {
    return file;
  }

  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        if (width > maxDimension || height > maxDimension) {
          if (width > height) {
            height = Math.round((height * maxDimension) / width);
            width = maxDimension;
          } else {
            width = Math.round((width * maxDimension) / height);
            height = maxDimension;
          }
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);

        canvas.toBlob(
          (blob) => {
            if (blob) {
              resolve(new File([blob], file.name.replace(/\.[^/.]+$/, '.jpg'), { type: 'image/jpeg' }));
            } else {
              resolve(file);
            }
          },
          'image/jpeg',
          quality
        );
      };
      img.onerror = () => resolve(file);
      img.src = e.target.result;
    };
    reader.onerror = () => resolve(file);
    reader.readAsDataURL(file);
  });
}

/**
 * Upload a single bill / meter photo to Firebase Cloud Storage.
 * Path: users/{uid}/bills/{monthSlug}/{photoType}_{timestamp}.jpg
 */
export async function uploadBillPhoto(uid, billingMonth, photoType, file) {
  if (!file) return null;
  try {
    console.info(`[Storage] Compressing ${photoType} (${(file.size / 1024).toFixed(1)} KB)...`);
    const compressed = await compressImage(file);
    console.info(`[Storage] Compressed ${photoType} -> ${(compressed.size / 1024).toFixed(1)} KB`);

    const monthSlug = (billingMonth || 'unspecified').replace(/\s+/g, '_').toLowerCase();
    const filename = `${photoType}_${Date.now()}.jpg`;
    const storagePath = `users/${uid}/bills/${monthSlug}/${filename}`;
    const storageRef = ref(storage, storagePath);

    console.info(`[Storage] Uploading to path: ${storagePath}...`);
    const snapshot = await uploadBytes(storageRef, compressed, {
      contentType: 'image/jpeg',
      customMetadata: {
        billingMonth: billingMonth || '',
        photoType,
        uploadedAt: new Date().toISOString(),
      },
    });

    const downloadUrl = await getDownloadURL(snapshot.ref);
    console.info(`[Storage] Upload complete for ${photoType}! URL: ${downloadUrl}`);
    return downloadUrl;
  } catch (err) {
    console.error(`[Storage] Failed to upload ${photoType} to Cloud Storage:`, err);
    return null;
  }
}

/**
 * Upload all available bill and meter photos in parallel.
 * Returns an object containing the download URLs.
 */
export async function uploadAllBillPhotos(uid, billingMonth, { billFile, elecFile, waterFile }) {
  if (!uid) {
    console.warn('[Storage] uploadAllBillPhotos called without user UID');
    return {};
  }

  console.info(`[Storage] Starting batch upload for user ${uid} (month: ${billingMonth})...`);
  const [billUrl, elecUrl, waterUrl] = await Promise.all([
    billFile ? uploadBillPhoto(uid, billingMonth, 'sp_bill', billFile) : Promise.resolve(null),
    elecFile ? uploadBillPhoto(uid, billingMonth, 'elec_meter', elecFile) : Promise.resolve(null),
    waterFile ? uploadBillPhoto(uid, billingMonth, 'water_meter', waterFile) : Promise.resolve(null),
  ]);

  const photoUrls = {};
  if (billUrl) photoUrls.bill = billUrl;
  if (elecUrl) photoUrls.electricityMeter = elecUrl;
  if (waterUrl) photoUrls.waterMeter = waterUrl;

  console.info('[Storage] Batch upload summary:', photoUrls);
  return photoUrls;
}
