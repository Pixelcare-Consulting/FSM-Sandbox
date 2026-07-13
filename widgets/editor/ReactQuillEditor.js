import { useEffect, useRef } from 'react';
import { useQuill } from 'react-quilljs';
import { normalizeRichTextHtml } from '../../lib/utils/normalizeRichTextHtml';

const ReactQuillEditor = ({ initialValue, onDescriptionChange }) => {
  const { quill, quillRef } = useQuill();
  const isInitializedRef = useRef(false);
  const lastInitialValueRef = useRef(initialValue);
  const onDescriptionChangeRef = useRef(onDescriptionChange);

  useEffect(() => {
    onDescriptionChangeRef.current = onDescriptionChange;
  }, [onDescriptionChange]);

  // Keep a stable text-change listener so parent re-renders do not drop in-flight edits.
  useEffect(() => {
    if (!quill) return undefined;

    const handleTextChange = () => {
      const htmlContent = quill.root.innerHTML;
      if (onDescriptionChangeRef.current) {
        onDescriptionChangeRef.current(htmlContent);
      }
    };

    quill.on('text-change', handleTextChange);
    return () => {
      quill.off('text-change', handleTextChange);
    };
  }, [quill]);

  // Seed / externally reset editor content without tearing down the change listener.
  useEffect(() => {
    if (!quill) return;

    if (!isInitializedRef.current) {
      quill.clipboard.dangerouslyPasteHTML(normalizeRichTextHtml(initialValue) || '');
      isInitializedRef.current = true;
      lastInitialValueRef.current = initialValue;
      return;
    }

    const currentContent = quill.root.innerHTML.trim();
    const lastInitial = lastInitialValueRef.current || '';

    // Only apply external resets (form clear / remount key) — never overwrite live typing.
    if (
      initialValue !== lastInitialValueRef.current &&
      (currentContent === lastInitial.trim() ||
        currentContent === '<p><br></p>' ||
        currentContent === '')
    ) {
      quill.clipboard.dangerouslyPasteHTML(normalizeRichTextHtml(initialValue) || '');
      lastInitialValueRef.current = initialValue;
    }
  }, [quill, initialValue]);

  return (
    <div style={{ width: 'auto', height: 'auto' }}>
      <div ref={quillRef} />
    </div>
  );
};

export default ReactQuillEditor;
