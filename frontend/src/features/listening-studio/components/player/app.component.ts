import { Component, ElementRef, OnDestroy, ViewChild, computed, effect, inject, signal } from '@angular/core';
import { QURAN_SURAHS, type SurahSummary } from '../../../../application/ports/quran-catalog';
import { AUDIO_OPTIONS } from '../../../../application/ports/audio-options';
import { AUDIO_MEDIA } from '../../../../application/ports/audio-media';
import { MEDIA_CACHE } from '../../../../application/ports/media-cache';
import { CONTINUOUS_RECITATION } from '../../../../application/ports/continuous-recitation';
import { STREAMING_SOURCE } from '../../../../application/ports/streaming-source';
import { VERSE_PREVIEW, type VerseText, type TranslationLanguage } from '../../../../application/ports/verse-preview';
import { createAudioQueue, createAudioTracks, createPassages, normalizeBreakpoints, type ListeningMode, type Passage, type AudioStage } from '../../audio-plan';
import { IconComponent } from './icon.component';
import { ListeningController, type ClipLanguage } from '../../listening-controller';
import { suggestedBreakpoints } from '../../passage-presets';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [IconComponent],
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.css', './study-ui.css', './settings-ui.css', './reading-audio.css']
})
export class AppComponent implements OnDestroy {
  private readonly mediaSource = inject(AUDIO_MEDIA);
  private readonly cache = inject(MEDIA_CACHE);
  private readonly continuousRecitation = inject(CONTINUOUS_RECITATION);
  private readonly streamingSource = inject(STREAMING_SOURCE);
  private readonly verseSource = inject(VERSE_PREVIEW);
  private verseGeneration = 0;
  private readonly boundariesBySurah = new Map<number, number[]>();
  readonly loading = signal(false);
  readonly playbackError = signal<string | null>(null);
  readonly activeAyah = signal(1);
  readonly activeClip = signal<string | null>(null);
  @ViewChild('settingsDialog') settingsDialog!: ElementRef<HTMLDialogElement>;
  openSettings(): void { this.settingsDialog.nativeElement.showModal(); }
  closeSettings(): void { this.settingsDialog.nativeElement.close(); }
  closeOnBackdrop(event: MouseEvent): void { if (event.target === this.settingsDialog.nativeElement) this.closeSettings(); }

  readonly surahs = inject(QURAN_SURAHS);
  readonly audioOptions = inject(AUDIO_OPTIONS);
  readonly selectedId = signal(1);
  readonly search = signal('');
  readonly reciter = 'Muhammad Siddiq Al-Minshawi (Mujawwad)';
  readonly translationLanguage = signal<TranslationLanguage>('English');
  readonly secondTranslation = signal<TranslationLanguage>('German');
  readonly dualTranslation = signal(true);
  readonly displayChoice = signal<'first' | 'second' | 'both'>('second');
  readonly supportedLanguages: readonly TranslationLanguage[] = ['German', ...this.audioOptions.translationLanguages.filter(language => language !== 'German')] as TranslationLanguage[];
  readonly previewVerses = signal<VerseText[]>([]);
  readonly verseLoading = signal(true);
  readonly verseError = signal<string | null>(null);
  readonly listeningMode = signal<ListeningMode>('both');
  readonly breakpoints = signal<number[]>([3, 7]);
  readonly stageIndex = signal(0);
  readonly isPlaying = signal(false);
  readonly sidebarOpen = signal(false);

  readonly selectedSurah = computed<SurahSummary>(() => this.surahs.find(s => s.id === this.selectedId()) ?? this.surahs[0]!);
  readonly filteredSurahs = computed(() => this.surahs.filter(s =>
    (s.name + ' ' + s.meaning + ' ' + s.id).toLowerCase().includes(this.search().toLowerCase().trim())
  ));
  readonly ayahs = computed(() => Array.from({ length: this.selectedSurah().ayahCount }, (_, i) => i + 1));
  readonly passages = computed<Passage[]>(() => createPassages(this.breakpoints(), this.selectedSurah().ayahCount));
  readonly spokenLanguages = computed(() => this.dualTranslation()
    ? [this.translationLanguage(), this.secondTranslation()]
    : [this.translationLanguage()]);
  readonly visibleLanguages = computed<TranslationLanguage[]>(() => {
    if (this.listeningMode() === 'recitation') return [];
    if (!this.dualTranslation()) return [this.translationLanguage()];
    if (this.displayChoice() === 'both') return this.spokenLanguages();
    return [this.displayChoice() === 'first' ? this.translationLanguage() : this.secondTranslation()];
  });
  readonly queue = computed<AudioStage[]>(() => createAudioQueue(
    this.listeningMode(), this.breakpoints(), this.selectedSurah().ayahCount, this.spokenLanguages()
  ));
  readonly activePassageVerses = computed(() => {
    const passage = this.passages()[this.activeStage().passageIndex];
    if (!passage) return [];
    return this.previewVerses().filter(verse => verse.ayah >= passage.start && verse.ayah <= passage.end);
  });
  readonly activePassage = computed(() => this.passages()[this.activeStage().passageIndex] ?? this.passages()[0]);
  readonly selectionSummary = computed(() => this.listeningMode() === 'recitation'
    ? 'Arabic recitation only'
    : ['Arabic', ...this.spokenLanguages()].join('  →  '));
  readonly activeStage = computed(() => this.queue()[this.stageIndex()] ?? this.queue()[0]);
  readonly progress = computed(() => this.queue().length ? (this.stageIndex() + 1) * 100 / this.queue().length : 0);
  readonly isWholeSurah = computed(() => this.breakpoints().length === 1);
  readonly isEveryAyah = computed(() => this.breakpoints().length === this.selectedSurah().ayahCount);

  private readonly controller = new ListeningController(this.mediaSource, this.cache, this.continuousRecitation, this.streamingSource, {
    onPlaying: playing => this.isPlaying.set(playing),
    onLoading: loading => this.loading.set(loading),
    onAyah: ayah => {
      this.activeAyah.set(ayah);
      if (this.listeningMode() === 'recitation' && !this.activeClip()) {
        const stage = this.queue().findIndex(item =>
          item.mode === 'arabic' && item.start <= ayah && item.end >= ayah
        );
        if (stage >= 0) this.stageIndex.set(stage);
      }
    },
    onMainTrack: track => {
      this.activeClip.set(null);
      this.stageIndex.set(track.stage);
      this.activeAyah.set(track.ayah);
    },
    onClipTrack: (ayah, language) => {
      this.activeClip.set(this.clipKey(ayah, language));
      this.activeAyah.set(ayah);
    },
    onError: message => this.playbackError.set(message)
  });
  clipKey(ayah: number, language: ClipLanguage): string {
    return [this.selectedId(), ayah, language].join(':');
  }
  isPlayingClip(ayah: number, language: ClipLanguage): boolean {
    return this.isPlaying() && this.activeClip() === this.clipKey(ayah, language);
  }
  async toggleClip(ayah: number, language: ClipLanguage): Promise<void> {
    await this.controller.toggleClip(this.selectedId(), this.reciter, ayah, language, this.selectedSurah().ayahCount);
  }

  constructor() {
    try {
      const stored = localStorage.getItem('islamtrove-audio-design-v2');
      if (stored) {
        const values = JSON.parse(stored);
        if (this.surahs.some(s => s.id === values?.selectedId)) this.selectedId.set(values.selectedId);
        const count = this.selectedSurah().ayahCount;
        if (values?.boundariesBySurah && typeof values.boundariesBySurah === 'object') {
          for (const surah of this.surahs) {
            const previous = values.boundariesBySurah[String(surah.id)];
            if (Array.isArray(previous)) {
              this.boundariesBySurah.set(surah.id, normalizeBreakpoints(previous, surah.ayahCount));
            }
          }
        }
        const restored = this.boundariesBySurah.get(this.selectedId())
          ?? (Array.isArray(values?.breakpoints)
            ? normalizeBreakpoints(values.breakpoints, count)
            : suggestedBreakpoints(this.selectedId(), count));
        this.setBoundaries(restored);
        if (values?.listeningMode === 'recitation' || values?.listeningMode === 'both') this.listeningMode.set(values.listeningMode);
        if (this.supportedLanguages.includes(values?.translationLanguage)) this.translationLanguage.set(values.translationLanguage);
        if (this.supportedLanguages.includes(values?.secondTranslation)) this.secondTranslation.set(values.secondTranslation);
        if (typeof values?.dualTranslation === 'boolean') this.dualTranslation.set(values.dualTranslation);
        if (values?.displayChoice === 'first' || values?.displayChoice === 'second' || values?.displayChoice === 'both') this.displayChoice.set(values.displayChoice);
        if (this.translationLanguage() === this.secondTranslation()) this.secondTranslation.set(this.supportedLanguages.find(x => x !== this.translationLanguage())!);
      }
    } catch { /* Nonpersistent preview if browser storage is unavailable. */ }
    effect(() => {
      const settings = {
        selectedId: this.selectedId(), breakpoints: this.breakpoints(),
        boundariesBySurah: Object.fromEntries(this.boundariesBySurah),
        listeningMode: this.listeningMode(),
        translationLanguage: this.translationLanguage(), secondTranslation: this.secondTranslation(),
        dualTranslation: this.dualTranslation(), displayChoice: this.displayChoice()
      };
      try { localStorage.setItem('islamtrove-audio-design-v2', JSON.stringify(settings)); }
      catch { /* Private browsing or storage disabled. Session remains usable. */ }
    });
    void this.loadVerseText();
  }

  async loadVerseText(): Promise<void> {
    const run = ++this.verseGeneration;
    const surahId = this.selectedId();
    const count = this.selectedSurah().ayahCount;
    this.verseLoading.set(true);
    this.verseError.set(null);
    this.previewVerses.set([]);
    try {
      const verses = await this.verseSource.getSurahVerses(surahId);
      if (verses.length !== count) {
        throw new Error(`QuranEnc returned ${verses.length} of ${count} Ayahs`);
      }
      if (run === this.verseGeneration) this.previewVerses.set(verses);
    } catch (error) {
      if (run === this.verseGeneration) {
        this.verseError.set(error instanceof Error ? error.message : 'Unable to retrieve QuranEnc verses');
      }
    } finally {
      if (run === this.verseGeneration) this.verseLoading.set(false);
    }
  }

  setPrimaryLanguage(value: TranslationLanguage): void {
    if (!this.supportedLanguages.includes(value)) return;
    if (this.dualTranslation() && value === this.secondTranslation()) {
      this.secondTranslation.set(this.translationLanguage());
    }
    this.translationLanguage.set(value);
    this.resetQueue();
  }
  setSecondaryLanguage(value: TranslationLanguage): void {
    if (!this.supportedLanguages.includes(value) || value === this.translationLanguage()) return;
    this.secondTranslation.set(value);
    this.resetQueue();
  }
  setDualTranslation(on: boolean): void {
    this.dualTranslation.set(on);
    if (on && this.translationLanguage() === this.secondTranslation()) {
      this.secondTranslation.set(this.supportedLanguages.find(x => x !== this.translationLanguage())!);
    }
    if (!on) this.displayChoice.set('first');
    this.resetQueue();
  }
  selectStudyPreset(preset: 'guided' | 'immersion'): void {
    if (preset === 'guided') {
      this.translationLanguage.set('English'); this.secondTranslation.set('German');
      this.dualTranslation.set(true); this.displayChoice.set('second');
    } else {
      this.translationLanguage.set('German'); this.dualTranslation.set(false);
      this.displayChoice.set('first');
    }
    this.listeningMode.set('both'); this.resetQueue();
  }
  setDisplayChoice(choice: 'first' | 'second' | 'both'): void {
    this.displayChoice.set(choice);
  }
  private setBoundaries(boundaries: number[]): void {
    const normalized = normalizeBreakpoints(boundaries, this.selectedSurah().ayahCount);
    this.breakpoints.set(normalized);
    this.boundariesBySurah.set(this.selectedId(), normalized);
  }
  selectSurah(surah: SurahSummary): void {
    this.selectedId.set(surah.id);
    this.setBoundaries(this.boundariesBySurah.get(surah.id)
      ?? suggestedBreakpoints(surah.id, surah.ayahCount));
    this.resetQueue();
    this.sidebarOpen.set(false);
    void this.loadVerseText();
  }
  setSearch(value: string): void { this.search.set(value); }
  setListeningMode(mode: ListeningMode): void {
    this.listeningMode.set(mode);
    this.resetQueue();
  }
  isBoundary(ayah: number): boolean { return this.breakpoints().includes(ayah); }
  toggleBreakpoint(ayah: number): void {
    if (ayah < 1 || ayah >= this.selectedSurah().ayahCount) return;
    const current = this.breakpoints();
    this.setBoundaries(current.includes(ayah) ? current.filter(n => n !== ayah) : [...current, ayah]);
    this.resetQueue();
  }
  setPreset(mode: 'whole' | 'each'): void {
    const n = this.selectedSurah().ayahCount;
    this.setBoundaries(mode === 'whole' ? [n] : Array.from({ length: n }, (_, i) => i + 1));
    this.resetQueue();
  }
  applySuggestedBreakpoints(): void {
    this.setBoundaries(suggestedBreakpoints(this.selectedId(), this.selectedSurah().ayahCount)); this.resetQueue();
  }
  resetQueue(): void {
    this.controller.stop();
    this.activeClip.set(null);
    this.stageIndex.set(0);
    this.activeAyah.set(1);
    this.playbackError.set(null);
  }

  ngOnDestroy(): void { this.verseGeneration++; this.controller.dispose(); }

  private jumpToStage(target: number): void {
    const index = Math.max(0, Math.min(target, this.queue().length - 1));
    this.stageIndex.set(index);
    this.activeAyah.set(this.queue()[index]?.start ?? 1);
    this.activeClip.set(null);
    this.controller.seekStage(index);
  }
  selectPassage(index: number): void { const stage = this.queue().findIndex(s => s.passageIndex === index); if (stage >= 0) this.jumpToStage(stage); }
  async playPassage(index: number): Promise<void> {
    const initialStage = this.queue().findIndex(stage => stage.passageIndex === index);
    if (initialStage < 0) return;
    this.stageIndex.set(initialStage);
    this.activeAyah.set(this.queue()[initialStage].start);
    this.activeClip.set(null);
    const languages = this.listeningMode() === 'recitation' ? [] : this.spokenLanguages();
    await this.controller.toggleMain(
      this.selectedId(), this.reciter, this.queue(), languages, initialStage, index
    );
  }
  previous(): void { this.jumpToStage(this.stageIndex() - 1); }
  next(): void { this.jumpToStage(this.stageIndex() + 1); }

  async togglePlay(): Promise<void> {
    this.activeClip.set(null);
    const languages = this.listeningMode() === 'recitation' ? [] : this.spokenLanguages();
    await this.controller.toggleMain(
      this.selectedId(), this.reciter, this.queue(), languages, this.stageIndex()
    );
  }
  range(start: number, end: number): string { return start === end ? String(start) : start + '–' + end; }
}
