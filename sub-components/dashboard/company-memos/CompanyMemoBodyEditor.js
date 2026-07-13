import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useQuill } from 'react-quilljs';
import Quill from 'quill';
import QuillResize from 'quill-resize-module';
import 'quill/dist/quill.snow.css';
import 'quill-resize-module/dist/resize.css';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { createMemoImageUploadHandler } from '@/lib/quill/memoImageUpload';
import { MEMO_FORMATS, MEMO_MODULES } from '@/lib/quill/memoRichTextConfig';
import { memoBodyForQuill } from '@/lib/utils/memoHtml';
import styles from './CompanyMemoBodyEditor.module.css';

let memoResizeRegistered = false;
if (!memoResizeRegistered) {
  Quill.register('modules/resize', QuillResize);
  memoResizeRegistered = true;
}

/**
 * Rich text body for company memos (Quill via dangerouslyPasteHTML for real HTML).
 * @param {{ value: string, onChange: (html: string) => void, disabled?: boolean, editorKey?: string }} props
 */
export default function CompanyMemoBodyEditor({
  value,
  onChange,
  disabled,
  editorKey = 'default',
}) {
  const { user } = useCurrentUser();
  const [imageUploading, setImageUploading] = useState(false);

  const modules = useMemo(() => MEMO_MODULES, []);

  const { quill, quillRef } = useQuill({
    theme: 'snow',
    modules,
    formats: MEMO_FORMATS,
    placeholder:
      'Write the announcement — use headings, lists, colors, images, and links.',
  });

  const isBootRef = useRef(false);
  const lastExternalRef = useRef('');
  const lastEditorKeyRef = useRef(editorKey);

  const quillHtml = useMemo(() => memoBodyForQuill(value), [value]);

  useEffect(() => {
    if (lastEditorKeyRef.current !== editorKey) {
      lastEditorKeyRef.current = editorKey;
      isBootRef.current = false;
      lastExternalRef.current = '';
    }
  }, [editorKey]);

  useEffect(() => {
    if (!quill) return;
    quill.enable(!disabled);
  }, [quill, disabled]);

  useEffect(() => {
    if (!quill || !user?.id) return;

    const toolbar = quill.getModule('toolbar');
    if (!toolbar) return;

    toolbar.addHandler(
      'image',
      createMemoImageUploadHandler({
        quill,
        userId: user.id,
        onUploading: setImageUploading,
      })
    );
  }, [quill, user?.id]);

  useEffect(() => {
    if (!quill) return;

    const normalized = quillHtml || '';
    const current = quill.root.innerHTML.trim();
    const isEmpty =
      !current || current === '<p><br></p>' || current === '<p><br/></p>';

    if (!isBootRef.current) {
      quill.clipboard.dangerouslyPasteHTML(normalized, 'silent');
      isBootRef.current = true;
      lastExternalRef.current = normalized;
      return;
    }

    if (normalized === lastExternalRef.current) return;

    const matchesLast =
      current === (lastExternalRef.current || '').trim() ||
      (isEmpty && !lastExternalRef.current);

    if (isEmpty || matchesLast) {
      quill.clipboard.dangerouslyPasteHTML(normalized, 'silent');
      lastExternalRef.current = normalized;
    }
  }, [quill, quillHtml]);

  useEffect(() => {
    if (!quill) return;

    const handler = () => {
      const html = quill.root.innerHTML.trim();
      const out =
        !html || html === '<p><br></p>' || html === '<p><br/></p>' ? '' : html;
      onChange(out);
    };

    quill.on('text-change', handler);
    return () => {
      quill.off('text-change', handler);
    };
  }, [quill, onChange]);

  return (
    <div
      className={`${styles.wrap} ${imageUploading ? styles.wrapUploading : ''}`}
    >
      <div ref={quillRef} />
    </div>
  );
}
