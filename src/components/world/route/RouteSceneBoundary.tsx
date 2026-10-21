'use client';

import { Component, useCallback, type ErrorInfo, type ReactNode } from 'react';
import { useWorldState } from './WorldStateProvider';
import { markSceneFailed } from './world-readiness';

/**
 * Local recovery for a scene that throws — a rejected dynamic chunk, a missing
 * model, a shader compile failure, a render-time exception.
 *
 * Without this the error propagates to the route's `error.tsx`, which replaces
 * a page whose DATA loaded perfectly with "League failed to load". A broken
 * decoration must not cost the visitor the league, so the boundary degrades to
 * Lite in place: the semantic sections were already rendered and are simply
 * never hidden (readiness never reached `presented`), and the visitor keeps
 * working content plus a retry.
 *
 * Application-data failures are NOT this boundary's business — those still
 * belong to the route error boundary, and must not be relabelled as an empty
 * or unrenderable world.
 */
interface BoundaryProps {
  onSceneError: (error: Error) => void;
  children: ReactNode;
}

interface BoundaryState {
  failed: boolean;
}

class SceneBoundary extends Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { failed: false };

  static getDerivedStateFromError(): BoundaryState {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    this.props.onSceneError(error);
    // The component stack is what distinguishes a chunk failure from a scene
    // actor throwing; keep it server-side only, never in a client response.
    console.error('[world] scene stack:', info.componentStack);
  }

  render(): ReactNode {
    return this.state.failed ? null : this.props.children;
  }
}

export default function RouteSceneBoundary({ children }: { children: ReactNode }) {
  const { degradeToLite } = useWorldState();

  const onSceneError = useCallback(
    (error: Error) => {
      console.error('[world] scene failed to present; recovered to Lite', error);
      markSceneFailed();
      degradeToLite('scene-failed');
    },
    [degradeToLite],
  );

  return <SceneBoundary onSceneError={onSceneError}>{children}</SceneBoundary>;
}
