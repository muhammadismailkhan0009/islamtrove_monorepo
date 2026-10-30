import { InjectionToken } from '@angular/core';

export interface SurahGrouping {
  surahId: number;
  boundaries: number[];
}
export interface GroupingDocument {
  schemaVersion: number;
  revision: number;
  groupings: SurahGrouping[];
}
export interface GroupingLibraryPort {
  readonly previewOnly: boolean;
  list(): Promise<GroupingDocument>;
  authenticate(code: string): Promise<{authorized: boolean; message?: string}>;
  publish(expectedRevision: number, groupings: SurahGrouping[]): Promise<GroupingDocument>;
}
export const GROUPING_LIBRARY = new InjectionToken<GroupingLibraryPort>('GroupingLibraryPort');
