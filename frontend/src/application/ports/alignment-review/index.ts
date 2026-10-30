import { InjectionToken } from '@angular/core';

/** Source-locked admin review of individual Ayahs and contiguous blocks. */
export type AlignmentReviewStatus = 'needs-review' | 'verified' | 'corrected' | 'unflagged';
export interface AlignmentReviewItem {
  ayah: number;
  status: AlignmentReviewStatus;
  estimatedStartMs: number;
  /** Nonempty only when the offline alignment algorithms flag a boundary. */
  reason?: string;
  verifiedBy?: string;
}
export type AlignmentReviewAction =
  | { kind: 'verify'; surahId: number; ayah: number }
  | { kind: 'correct'; surahId: number; ayah: number; startMs: number };
export interface AlignmentReviewPort {
  /** Must be false until a real authenticated backend capability exists. */
  readonly previewOnly: boolean;
  list(surahId: number): Promise<AlignmentReviewItem[]>;
  authenticate(code: string): Promise<{ authorized: boolean; message?: string }>;
  submit(action: AlignmentReviewAction): Promise<AlignmentReviewItem[]>;
  submitBlock(surahId: number, ayahs: readonly number[]): Promise<AlignmentReviewItem[]>;
}
export const ALIGNMENT_REVIEW = new InjectionToken<AlignmentReviewPort>('AlignmentReviewPort');
