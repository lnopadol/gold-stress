// Static-only build: no backend. queryClient is kept only so React Query
// hooks have a provider. All real queries pass their own queryFn (fetching
// the snapshot JSON from GitHub raw).
import { QueryClient } from "@tanstack/react-query";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: 60_000,
      retry: 1,
    },
    mutations: { retry: false },
  },
});
