export interface DesktopTractionEvidence {
  readonly source: 'uia-dom-traction';
  readonly verifiedTarget: true;
  readonly hwnd: number;
  readonly processId: number;
  readonly state: 'VERIFYING';
}
export function verifyDesktopTraction(
  first: Record<string, unknown> | null,
  second: Record<string, unknown> | null,
  action: { hwnd?: number; selector?: { automationId?: string; name?: string; controlType?: string; className?: string; index?: number }; type?: string },
  timestamps?: { firstAt?: number; secondAt?: number; now?: number }
): DesktopTractionEvidence;
