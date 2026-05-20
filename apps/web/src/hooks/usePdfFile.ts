import { useEffect, useState } from 'react';

type PdfFile = { data: Uint8Array };

/**
 * Fetch a PDF once and expose a stable `file` object for react-pdf.
 * Avoids passing new `options` / httpHeaders objects on every render.
 */
export function usePdfFile(url: string, headers?: Record<string, string>) {
  const [file, setFile] = useState<PdfFile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const authKey = headers?.Authorization ?? '';

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError('');
      setFile(null);

      try {
        const response = await fetch(url, {
          headers: headers ?? undefined,
        });

        if (!response.ok) {
          throw new Error('Unable to load PDF');
        }

        const bytes = new Uint8Array(await response.arrayBuffer());
        if (cancelled) return;
        setFile({ data: bytes });
      } catch (e) {
        if (!cancelled) {
          setError((e as Error).message);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, [url, authKey]);

  return { file, loading, error };
}
