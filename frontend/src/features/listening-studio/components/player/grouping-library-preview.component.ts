import { Component, computed, inject, input, output, signal } from '@angular/core';
import { createPassages } from '../../audio-plan';
import type { SurahGrouping, GroupingDocument } from '../../../../application/ports/grouping-library';
import { GROUPING_LIBRARY } from '../../../../application/ports/grouping-library';
import type { SurahSummary } from '../../../../application/ports/quran-catalog';
import { IconComponent } from './icon.component';

export type GroupSource = 'local' | 'server';
interface GroupingRecord {
  surah: number;
  name: string;
  total: number;
  boundaries: number[];
}

@Component({
  selector: 'it-grouping-library-preview',
  standalone: true,
  imports: [IconComponent],
  templateUrl: './grouping-library-preview.component.html',
  styleUrl: './grouping-library-preview.component.css'
})
export class GroupingLibraryPreviewComponent {
  private readonly port = inject(GROUPING_LIBRARY);
  readonly previewOnly = this.port.previewOnly;
  readonly catalog = input.required<readonly SurahSummary[]>();
  readonly localGroupings = input.required<readonly SurahGrouping[]>();
  readonly serverDocument = input.required<GroupingDocument>();
  readonly source = input.required<GroupSource>();
  readonly activeSurah = input.required<number>();
  readonly sourceChange = output<GroupSource>();
  readonly copyLocal = output<SurahGrouping>();
  readonly publishedDocument = output<GroupingDocument>();

  readonly selectedSurah = signal<number | null>(null);
  readonly unlockOpen = signal(this.previewOnly &&
    new URLSearchParams(window.location.search).get('groups-demo') === 'publish');
  readonly adminCode = signal('');
  readonly adminError = signal('');
  readonly busy = signal(false);
  readonly published = signal(this.previewOnly &&
    new URLSearchParams(window.location.search).get('groups-demo') === 'success');
  readonly copied = signal(false);
  readonly publishingSurahId = signal<number | null>(null);
  readonly publishedSurahName = signal(this.previewOnly &&
    new URLSearchParams(window.location.search).get('groups-demo') === 'success' ? 'Al-Kahf' : '');

  private readonly named = (group: SurahGrouping): GroupingRecord | null => {
    const surah = this.catalog().find(item => item.id === group.surahId);
    return surah ? {surah: surah.id, name: surah.name, total: surah.ayahCount,
      boundaries: [...group.boundaries]} : null;
  };
  readonly local = computed<GroupingRecord[]>(() =>
    this.localGroupings().map(this.named).filter((x): x is GroupingRecord => !!x));
  readonly server = computed<GroupingRecord[]>(() =>
    this.serverDocument().groupings.map(this.named).filter((x): x is GroupingRecord => !!x));
  readonly available = computed(() => this.source() === 'local' ? this.local() : this.server());
  readonly current = computed(() => this.available().find(g => g.surah === this.selectedSurah())
    ?? this.available().find(g => g.surah === this.activeSurah()) ?? null);
  readonly publishingGroup = computed(() =>
    this.local().find(group => group.surah === this.publishingSurahId()) ?? null);
  readonly passages = computed(() => {
    const current = this.current();
    return current ? createPassages(current.boundaries, current.total) : [];
  });

  chooseSource(value: GroupSource): void {
    this.sourceChange.emit(value);
    this.selectedSurah.set(null);
    this.unlockOpen.set(false);
    this.publishingSurahId.set(null);
    this.copied.set(false);
    this.published.set(false);
  }
  chooseSurah(surah: number): void {
    this.selectedSurah.set(surah);
    this.copied.set(false);
  }
  openSurahPublish(): void {
    const selected = this.current();
    if (!selected || this.source() !== 'local') return;
    this.publishingSurahId.set(selected.surah);
    this.adminCode.set('');
    this.adminError.set('');
    this.unlockOpen.set(true);
    this.published.set(false);
  }
  cancelPublish(): void {
    this.unlockOpen.set(false);
    this.publishingSurahId.set(null);
    this.adminCode.set('');
    this.adminError.set('');
  }
  async submitSurahGrouping(): Promise<void> {
    if (this.busy()) return;
    const selected = this.publishingGroup();
    if (!selected) {
      this.adminError.set('Select a local Surah grouping before publishing.'); return;
    }
    this.busy.set(true);
    this.adminError.set('');
    try {
      const session = await this.port.authenticate(this.adminCode());
      if (!session.authorized) throw new Error(session.message || 'Administrator code not accepted');
      const doc = await this.port.publish(this.serverDocument().revision,
        {surahId:selected.surah, boundaries:[...selected.boundaries]});
      this.publishedDocument.emit(doc);
      this.sourceChange.emit('server');
      this.selectedSurah.set(selected.surah);
      this.unlockOpen.set(false);
      this.publishingSurahId.set(null);
      this.publishedSurahName.set(selected.name);
      this.published.set(true);
      this.copied.set(false);
    } catch (error) {
      this.adminError.set(error instanceof Error ? error.message : 'Publication failed');
    } finally {
      this.adminCode.set('');
      this.busy.set(false);
    }
  }
  copyPublishedToLocal(): void {
    const current = this.current();
    if (!current) return;
    this.copyLocal.emit({surahId:current.surah, boundaries:[...current.boundaries]});
    this.selectedSurah.set(current.surah);
    this.copied.set(true);
    this.published.set(false);
  }
}
