import { useCallback, useState } from 'react';
import toast from 'react-hot-toast';

const DEFAULT_TOAST_STYLES = {
  BASE: {
    borderRadius: '12px',
    padding: '12px 16px',
    fontSize: '14px',
    maxWidth: '400px',
  },
  SUCCESS: {
    background: '#f0fdf4',
    color: '#166534',
    border: '1px solid #bbf7d0',
  },
  ERROR: {
    background: '#fef2f2',
    color: '#991b1b',
    border: '1px solid #fecaca',
  },
  LOADING: {
    background: '#eff6ff',
    color: '#1e40af',
    border: '1px solid #bfdbfe',
  },
  WARNING: {
    background: '#fffbeb',
    color: '#92400e',
    border: '1px solid #fde68a',
  },
};

/**
 * Two-step SAP delta sync: preview modal → confirm → POST sync-delta.
 *
 * @param {{
 *   toastStyles?: typeof DEFAULT_TOAST_STYLES,
 *   onSyncSuccess?: (payload: { summary: object, normalizedCode: string }) => Promise<void> | void,
 * }} options
 */
export function useSapDeltaSync({ toastStyles = DEFAULT_TOAST_STYLES, onSyncSuccess } = {}) {
  const [syncCode, setSyncCode] = useState('');
  const [portalCustomerCode, setPortalCustomerCode] = useState('');
  const [isSyncingDelta, setIsSyncingDelta] = useState(false);
  const [syncDeltaError, setSyncDeltaError] = useState('');
  const [syncDeltaSummary, setSyncDeltaSummary] = useState(null);
  const [previewModal, setPreviewModal] = useState({
    show: false,
    loading: false,
    preview: null,
    error: null,
    pendingCode: '',
    pendingPortalCode: '',
  });

  const closePreviewModal = useCallback(() => {
    setPreviewModal((prev) => ({
      ...prev,
      show: false,
      loading: false,
      preview: null,
      error: null,
      pendingCode: '',
      pendingPortalCode: '',
    }));
  }, []);

  const runActualSync = useCallback(
    async (normalizedCode, normalizedPortalCode = '') => {
      setIsSyncingDelta(true);
      setSyncDeltaError('');
      setSyncDeltaSummary(null);

      const loadingMessage = normalizedCode
        ? `Syncing SAP delta for ${normalizedCode}...`
        : 'Syncing SAP delta...';
      const loadingToastId = toast.loading(loadingMessage, {
        style: {
          ...toastStyles.BASE,
          ...toastStyles.LOADING,
        },
      });

      const SYNC_TIMEOUT_MS = normalizedCode ? 120_000 : 300_000;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), SYNC_TIMEOUT_MS);

      const requestBody = {};
      if (normalizedCode) requestBody.customerCode = normalizedCode;
      if (normalizedPortalCode) requestBody.portalCustomerCode = normalizedPortalCode;

      try {
        const response = await fetch('/api/customers/sync-delta', {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
          },
          signal: controller.signal,
          body: JSON.stringify(requestBody),
        });
        const payload = await response.json().catch(() => ({}));

        if (!response.ok || !payload?.success) {
          throw new Error(payload?.error || `Sync failed with HTTP ${response.status}`);
        }

        const summary = payload.summary || {};
        const warnings = Array.isArray(payload.warnings)
          ? payload.warnings.filter(Boolean)
          : [];
        setSyncDeltaSummary(summary);
        closePreviewModal();

        if (onSyncSuccess) {
          await onSyncSuccess({ summary, normalizedCode, loadingToastId, warnings, payload });
        }

        if (warnings.length > 0) {
          toast(warnings.slice(0, 3).join(' · '), {
            icon: '⚠️',
            duration: 9000,
            style: {
              ...toastStyles.BASE,
              ...(toastStyles.WARNING || DEFAULT_TOAST_STYLES.WARNING),
            },
          });
        }

        return { summary, payload, warnings };
      } catch (error) {
        const message =
          error?.name === 'AbortError'
            ? 'Sync timed out. Retry in a moment; if SAP is slow, check SAP_B1_* env and Service Layer connectivity.'
            : error?.message || 'Failed to sync from SAP';
        setSyncDeltaError(message);
        toast.error(message, {
          id: loadingToastId,
          style: {
            ...toastStyles.BASE,
            ...toastStyles.ERROR,
          },
        });
        throw error;
      } finally {
        clearTimeout(timeoutId);
        setIsSyncingDelta(false);
      }
    },
    [closePreviewModal, onSyncSuccess, toastStyles]
  );

  const fetchPreview = useCallback(async (normalizedCode, normalizedPortalCode = '') => {
    const requestBody = { preview: true };
    if (normalizedCode) requestBody.customerCode = normalizedCode;
    if (normalizedPortalCode) requestBody.portalCustomerCode = normalizedPortalCode;

    const response = await fetch('/api/customers/sync-delta', {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });
    const payload = await response.json().catch(() => ({}));

    if (!response.ok || !payload?.success) {
      throw new Error(payload?.error || `Preview failed with HTTP ${response.status}`);
    }

    return payload.preview || payload.summary;
  }, []);

  const openSyncPreview = useCallback(async () => {
    if (isSyncingDelta) return;

    const normalizedCode = String(syncCode || '').trim().toUpperCase();
    const normalizedPortalCode = String(portalCustomerCode || '').trim().toUpperCase();
    setSyncDeltaError('');
    setPreviewModal({
      show: true,
      loading: true,
      preview: null,
      error: null,
      pendingCode: normalizedCode,
      pendingPortalCode: normalizedPortalCode,
    });

    try {
      const preview = await fetchPreview(normalizedCode, normalizedPortalCode);
      setPreviewModal((prev) => ({
        ...prev,
        loading: false,
        preview,
        error: null,
      }));
    } catch (error) {
      setPreviewModal((prev) => ({
        ...prev,
        loading: false,
        preview: null,
        error: error?.message || 'Failed to load SAP preview',
      }));
    }
  }, [fetchPreview, isSyncingDelta, portalCustomerCode, syncCode]);

  const confirmSyncFromPreview = useCallback(async () => {
    const normalizedCode = previewModal.pendingCode || String(syncCode || '').trim().toUpperCase();
    const normalizedPortalCode =
      previewModal.pendingPortalCode || String(portalCustomerCode || '').trim().toUpperCase();
    await runActualSync(normalizedCode, normalizedPortalCode);
  }, [portalCustomerCode, previewModal.pendingCode, previewModal.pendingPortalCode, runActualSync, syncCode]);

  return {
    syncCode,
    setSyncCode,
    portalCustomerCode,
    setPortalCustomerCode,
    isSyncingDelta,
    syncDeltaError,
    syncDeltaSummary,
    previewModal,
    openSyncPreview,
    closePreviewModal,
    confirmSyncFromPreview,
  };
}
