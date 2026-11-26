import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FontCategory, PaginatedFontsResponse } from "@/types/fonts";
import { debounce } from "../utils/debounce";

export type FilterFontCategory = "all" | FontCategory;

interface UseFontSearchParams {
  query: string;
  category?: FilterFontCategory;
  limit?: number;
  enabled?: boolean;
}

export function useFontSearch({
  query,
  category = "all",
  limit = 20,
  enabled = true,
}: UseFontSearchParams) {
  const [data, setData] = useState<PaginatedFontsResponse[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const offsetRef = useRef(0);
  const inflightRef = useRef<AbortController | null>(null);

  const fetchPage = useCallback(
    async (pageOffset: number) => {
      if (!enabled) return;

      // A newer request supersedes the previous one, so a slow response for
      // an old query can never overwrite the current results.
      inflightRef.current?.abort();
      const controller = new AbortController();
      inflightRef.current = controller;

      setIsLoading(true);
      setError(null);

      try {
        const searchParams = new URLSearchParams({
          q: query,
          limit: limit.toString(),
          offset: pageOffset.toString(),
        });

        if (category && category !== "all") {
          searchParams.append("category", category);
        }

        const response = await fetch(`/api/google-fonts?${searchParams}`, {
          cache: "no-store",
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error("Failed to fetch fonts");
        }

        const result = (await response.json()) as PaginatedFontsResponse;

        if (pageOffset === 0) {
          setData([result]);
        } else {
          setData((prev) => [...prev, result]);
        }

        offsetRef.current = pageOffset + limit;
      } catch (err) {
        if (controller.signal.aborted) return;
        setError(err as Error);
      } finally {
        if (inflightRef.current === controller) {
          inflightRef.current = null;
          setIsLoading(false);
        }
      }
    },
    [query, category, limit, enabled]
  );

  const debouncedFetchPage = useMemo(
    () => debounce((offset: number) => fetchPage(offset), 150),
    [fetchPage]
  );

  useEffect(() => {
    offsetRef.current = 0;
    debouncedFetchPage(0);
    return () => debouncedFetchPage.cancel();
  }, [debouncedFetchPage]);

  const loadMore = useCallback(() => {
    if (!enabled) return;
    fetchPage(offsetRef.current);
  }, [enabled, fetchPage]);

  const hasMore = data.length > 0 && data[data.length - 1]?.hasMore;

  return {
    data: {
      pages: data,
      pageParams: [0],
    },
    isLoading,
    error,
    hasMore,
    loadMore,
    refetch: () => {
      offsetRef.current = 0;
      fetchPage(0);
    },
  };
}
