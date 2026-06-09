import { useQuery, useMutation, type UseQueryOptions, type UseMutationOptions } from '@tanstack/react-query';

// ─── Generic invoke wrapper ───────────────────────────────────────────────────

/**
 * React Query wrapper for IPC invoke calls.
 *
 * Usage:
 *   const { data, isLoading } = useIPCQuery(['conversations'], 'chat:listConversations');
 *   const { data, isLoading } = useIPCQuery(['conversation', id], 'chat:getConversation', id);
 */
export function useIPCQuery<T>(
  queryKey: unknown[],
  channel: Parameters<typeof window.relay.invoke>[0],
  ...args: unknown[]
) {
  return useQuery<T>({
    queryKey,
    queryFn: () => window.relay.invoke<T>(channel, ...args),
  } as UseQueryOptions<T>);
}

/**
 * React Query mutation wrapper for IPC invoke calls.
 *
 * Usage:
 *   const { mutateAsync } = useIPCMutation('chat:deleteConversation');
 *   await mutateAsync(conversationId);
 */
export function useIPCMutation<TData = unknown, TVariables = unknown>(
  channel: Parameters<typeof window.relay.invoke>[0],
  options?: Omit<UseMutationOptions<TData, Error, TVariables>, 'mutationFn'>
) {
  return useMutation<TData, Error, TVariables>({
    mutationFn: (variables: TVariables) =>
      window.relay.invoke<TData>(channel, variables),
    ...options,
  });
}

/**
 * Fire-and-forget IPC invoke without React Query.
 */
export async function ipcInvoke<T>(
  channel: Parameters<typeof window.relay.invoke>[0],
  ...args: unknown[]
): Promise<T> {
  return window.relay.invoke<T>(channel, ...args);
}
