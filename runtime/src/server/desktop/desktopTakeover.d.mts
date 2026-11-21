export function desktopTakeoverState(
  mission: {
    metadata?: { executor?: string };
    status?: string;
    paused?: unknown;
    phase?: string;
    activeTask?: unknown;
    cancelRequested?: boolean;
  } | null,
  state?: { desktopBusy?: boolean; relayLease?: unknown | null },
): { ready: boolean; reason: string };
