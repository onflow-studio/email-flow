/** Gmail's cap on a sent message, attachments included, once encoded. */
export const MAX_MESSAGE_BYTES = 35 * 1024 * 1024;

/** One upload request, under the 4.5 MB request body Vercel allows. */
export const UPLOAD_PART_BYTES = 4 * 1024 * 1024;

export const MAX_UPLOAD_PARTS = Math.ceil(MAX_MESSAGE_BYTES / UPLOAD_PART_BYTES);

/** What a file of `bytes` takes in the message: base64 in 76-character lines. */
export const encodedBytes = (bytes: number) => Math.ceil((Math.ceil(bytes / 3) * 4 * 78) / 76);
