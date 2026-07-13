import toast from 'react-hot-toast';
import { uploadFile } from '../supabase/storage';

const MEMO_IMAGE_BUCKET = 'company';
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

/**
 * @param {string} userId
 * @param {string} fileName
 */
function memoImageStoragePath(userId, fileName) {
  const safeUserId = userId && userId !== 'undefined' ? String(userId) : 'anonymous';
  return `memos/${safeUserId}/${fileName}`;
}

/**
 * @param {File} file
 */
function fileExtension(file) {
  const fromName = file.name?.split('.').pop();
  if (fromName && fromName.length <= 5) return fromName.toLowerCase();
  const mime = file.type?.split('/')[1];
  if (mime === 'jpeg') return 'jpg';
  return mime || 'png';
}

/**
 * Custom Quill image handler — uploads to Supabase `company/memos/{userId}/…`.
 * @param {{ quill: import('quill').default, userId: string, onUploading?: (uploading: boolean) => void }} opts
 */
export function createMemoImageUploadHandler({ quill, userId, onUploading }) {
  return function memoImageHandler() {
    const input = document.createElement('input');
    input.setAttribute('type', 'file');
    input.setAttribute('accept', 'image/*');
    input.style.display = 'none';
    document.body.appendChild(input);

    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      input.remove();

      if (!file) return;

      if (!file.type?.startsWith('image/')) {
        toast.error('Please choose an image file.');
        return;
      }

      if (file.size > MAX_IMAGE_BYTES) {
        toast.error('Image must be 2 MB or smaller.');
        return;
      }

      const range = quill.getSelection(true);
      const index = range ? range.index : quill.getLength();

      onUploading?.(true);
      try {
        const timestamp = Date.now();
        const uuid =
          typeof crypto !== 'undefined' && crypto.randomUUID
            ? crypto.randomUUID()
            : `${timestamp}-${Math.random().toString(36).slice(2)}`;
        const ext = fileExtension(file);
        const path = memoImageStoragePath(userId, `${timestamp}-${uuid}.${ext}`);

        const { url } = await uploadFile(MEMO_IMAGE_BUCKET, path, file, { upsert: false });
        quill.insertEmbed(index, 'image', url, 'user');
        quill.setSelection(index + 1, 0);
      } catch (err) {
        console.error('[memoImageUpload]', err);
        toast.error('Could not upload image. Try again.');
      } finally {
        onUploading?.(false);
      }
    });

    input.click();
  };
}
