import { MEMO_IMAGE_RESIZE_OPTIONS } from './memoImageResize';

/** Shared Quill toolbar + formats for company memo rich text editor. */

export const MEMO_TOOLBAR = [
  [{ header: [1, 2, 3, false] }],
  ['bold', 'italic', 'underline', 'strike'],
  [{ color: [] }, { background: [] }],
  [{ list: 'ordered' }, { list: 'bullet' }],
  [{ indent: '-1' }, { indent: '+1' }],
  ['blockquote', 'link', 'image'],
  ['clean'],
];

export const MEMO_FORMATS = [
  'header',
  'bold',
  'italic',
  'underline',
  'strike',
  'color',
  'background',
  'list',
  'indent',
  'blockquote',
  'link',
  'image',
];

export const MEMO_MODULES = {
  toolbar: MEMO_TOOLBAR,
  resize: MEMO_IMAGE_RESIZE_OPTIONS,
};
