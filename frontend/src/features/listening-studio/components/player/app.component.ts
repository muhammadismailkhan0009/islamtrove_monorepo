import { Component, ElementRef, OnDestroy, ViewChild, afterNextRender, afterRenderEffect, computed, effect, inject, signal } from '@angular/core';
import { QURAN_SURAHS, type SurahSummary } from '../../../../application/ports/quran-catalog';
import { AUDIO_OPTIONS } from '../../../../application/ports/audio-options';
import { TRANSLATION_AUDIO } from '../../../../application/ports/translation-audio';
import { MEDIA_CACHE } from '../../../../application/ports/media-cache';
import { CONTINUOUS_RECITATION } from '../../../../application/ports/continuous-recitation';
import { STREAMING_SOURCE } from '../../../../application/ports/streaming-source';
import { VERSE_PREVIEW, type VerseText, type TranslationLanguage } from '../../../../application/ports/verse-preview';
import { createAudioQueue, createAudioTracks, createPassages, normalizeBreakpoints, type ListeningMode, type Passage, type AudioStage } from '../../audio-plan';
import { ALIGNMENT_REVIEW, type AlignmentReviewItem, type AlignmentReviewStatus } from '../../../../application/ports/alignment-review';
import { IconComponent } from './icon.component';
import { GroupingLibraryPreviewComponent } from './grouping-library-preview.component';
import { GROUPING_LIBRARY, type GroupingDocument, type SurahGrouping } from '../../../../application/ports/grouping-library';
import type { GroupSource } from './grouping-library-preview.component';
import { ListeningController, type ClipLanguage } from '../../listening-controller';
import { suggestedBreakpoints } from '../../passage-presets';
import { parseSharedListeningLink, createSharedListeningUrl } from '../../shared-listening-link';
import { createReviewBlocks } from '../../alignment-review-blocks';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [IconComponent, GroupingLibraryPreviewComponent],
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.css', './study-ui.css', './settings-ui.css', './reading-audio.css', './alignment-review.css', './share-link-preview.css']
})
export class AppComponent implements OnDestroy {
  private readonly translationSource = inject(TRANSLATION_AUDIO);
  private readonly cache = inject(MEDIA_CACHE);
  private readonly continuousRecitation = inject(CONTINUOUS_RECITATION);
  private readonly streamingSource = inject(STREAMING_SOURCE);
  private readonly verseSource = inject(VERSE_PREVIEW);
  readonly reviewSource = inject(ALIGNMENT_REVIEW);
  private readonly groupingPort = inject(GROUPING_LIBRARY);
  readonly reviewEnabled = true;
  readonly reviewItems = signal<AlignmentReviewItem[]>([]);
  readonly reviewAyah = signal<number | null>(null);
  readonly reviewBlockStart = signal<number | null>(null);
  readonly reviewBlocks = computed(() => createReviewBlocks(this.reviewItems(), this.passages()));
  readonly reviewBlockRows = computed(() => {
    const start = this.reviewBlockStart();
    const passage = this.passages().find(item => item.start === start);
    return passage ? this.reviewItems().filter(
      row => row.ayah >= passage.start && row.ayah <= passage.end
    ) : [];
  });
  readonly reviewBlockEnd = computed(() => this.reviewBlockRows().at(-1)?.ayah ?? 0);
  readonly reviewSavedKind = signal<'ayah' | 'block'>('ayah');

  readonly reviewStep = signal<'access' | 'inspect' | 'correction' | 'saved'>('access');
  readonly reviewCode = signal('');
  readonly reviewError = signal('');
  readonly reviewSaving = signal(false);
  readonly reviewSession = signal(false);
  readonly correctedSeconds = signal(0);
  readonly reviewFocus = computed(() => this.reviewItems().find(row => row.ayah === this.reviewAyah()) ?? null);
  readonly reviewPendingCount = computed(() => this.reviewItems().filter(row => row.status === 'needs-review').length);
  readonly reviewCheckedCount = computed(() => this.reviewItems().filter(row => row.status === 'verified' || row.status === 'corrected').length);
  reviewBlockStatus(start: number): 'pending' | 'checked' | 'unflagged' {
    return this.reviewBlocks().find(block => block.start === start)?.status ?? 'unflagged';
  }
  reviewBlockProgress(start: number): string {
    const block = this.reviewBlocks().find(item => item.start === start);
    if (!block) return 'Review';
    if (block.checked > 0) return block.checked + '/' + block.total + ' checked';
    return block.pending > 0 ? block.pending + ' pending' : 'Review';
  }
  reviewStatus(ayah: number): AlignmentReviewStatus | null {
    return this.reviewItems().find(row => row.ayah === ayah)?.status ?? null;
  }
  reviewInPassage(start: number, end: number): number {
    return this.reviewItems().filter(row => row.status === 'needs-review' && row.ayah >= start && row.ayah <= end).length;
  }
  async loadReviewRows(): Promise<void> {
    const surahId = this.selectedId();
    this.reviewItems.set([]);
    try {
      const rows = await this.reviewSource.list(surahId);
      if (this.selectedId() === surahId) this.reviewItems.set(rows);
    } catch (error) {
      if (this.selectedId() === surahId) this.reviewError.set(
        error instanceof Error ? error.message : 'Review status unavailable'
      );
    }
  }
  openReviewBlock(start: number): void {
    const passage = this.passages().find(item => item.start === start);
    if (!this.reviewEnabled || !passage) return;
    const rows = this.reviewItems().filter(
      row => row.ayah >= passage.start && row.ayah <= passage.end
    );
    if (rows.length !== passage.end - passage.start + 1) return;
    this.reviewBlockStart.set(start);
    const firstPending = rows.find(row => row.status === 'needs-review') ?? rows[0];
    this.selectReviewAyah(firstPending.ayah);
    this.reviewStep.set(this.reviewSession() ? 'inspect' : 'access');
    this.reviewCode.set('');
    this.reviewError.set('');
  }
  /** Corrections use the same passage as the current listening context. */
  openReview(ayah: number): void {
    const passage = this.passages().find(item => item.start <= ayah && item.end >= ayah);
    if (!passage) return;
    this.openReviewBlock(passage.start);
    this.selectReviewAyah(ayah);
  }
  selectReviewAyah(ayah: number): void {
    const row = this.reviewBlockRows().find(item => item.ayah === ayah);
    if (!row) return;
    this.reviewAyah.set(ayah);
    this.correctedSeconds.set(row.estimatedStartMs / 1000);
    this.reviewError.set('');
    if (this.reviewSession()) this.reviewStep.set('inspect');
  }
  closeReview(): void {
    this.reviewBlockStart.set(null);
    this.reviewAyah.set(null);
    this.reviewError.set('');
  }
  async verifyReviewBlock(): Promise<void> {
    const rows = this.reviewBlockRows();
    if (!this.reviewSession() || this.reviewSaving() || rows.length === 0) return;
    const surahId = this.selectedId();
    this.reviewSaving.set(true);
    this.reviewError.set('');
    try {
      const updated = await this.reviewSource.submitBlock(surahId, rows.map(row => row.ayah));
      this.reviewItems.set(updated);
      this.reviewSavedKind.set('block');
      this.reviewStep.set('saved');
      if (!this.reviewSource.previewOnly) {
        this.continuousRecitation.invalidate?.(surahId);
      }
    } catch (error) {
      this.reviewError.set(error instanceof Error ? error.message : 'Could not verify review block');
      if (/session expired|sign in again|CSRF/i.test(this.reviewError())) {
        this.reviewSession.set(false);
        this.reviewStep.set('access');
      }
    } finally {
      this.reviewSaving.set(false);
    }
  }
  async unlockReview(): Promise<void> {
    if (!this.reviewCode().trim()) { this.reviewError.set('Enter the admin code.'); return; }
    this.reviewSaving.set(true);
    try {
      const result = await this.reviewSource.authenticate(this.reviewCode());
      if (!result.authorized) { this.reviewError.set(result.message ?? 'Invalid code'); return; }
      this.reviewSession.set(true);
      this.reviewCode.set('');
      this.reviewError.set('');
      this.reviewStep.set('inspect');
    } catch (error) { this.reviewError.set(error instanceof Error ? error.message : 'Verification unavailable'); }
    finally { this.reviewSaving.set(false); }
  }
  startCorrection(): void { this.reviewStep.set('correction'); this.reviewError.set(''); }
  adjustReviewSeconds(change: number): void {
    this.correctedSeconds.update(previous => Math.max(0, Math.round((previous + change) * 1000) / 1000));
  }
  setReviewSeconds(value: string): void {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) this.correctedSeconds.set(Math.max(0, Math.round(parsed * 1000) / 1000));
  }
  formatReviewTime(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}.${String(ms % 1000).padStart(3, '0')}`;
  }
  async saveReview(kind: 'verify' | 'correct'): Promise<void> {
    const ayah = this.reviewAyah();
    if (!this.reviewEnabled || !this.reviewSession() || ayah === null) return;
    const startMs = Math.round(this.correctedSeconds() * 1000);
    if (kind === 'correct' && (!Number.isSafeInteger(startMs) || startMs < 0)) {
      this.reviewError.set('Enter a valid start time.'); return;
    }
    this.reviewSaving.set(true);
    this.reviewError.set('');
    try {
      const rows = await this.reviewSource.submit(kind === 'correct'
        ? { kind, ayah, surahId: this.selectedId(), startMs }
        : { kind, ayah, surahId: this.selectedId() });
      this.reviewItems.set(rows);
      if (!this.reviewSource.previewOnly) {
        this.resetQueue();
        this.continuousRecitation.invalidate?.(this.selectedId());
      }
      this.reviewSavedKind.set('ayah');
      this.reviewStep.set('saved');
    } catch (error) {
      this.reviewError.set(error instanceof Error ? error.message : 'Could not save review');
      if (!this.reviewSource.previewOnly && /session expired|sign in again|CSRF/i.test(this.reviewError())) {
        this.reviewSession.set(false);
        this.reviewStep.set('access');
      }
    }
    finally { this.reviewSaving.set(false); }
  }

  async listenReviewBlock(): Promise<void> {
    const rows = this.reviewBlockRows();
    if (!rows.length) return;
    const start = rows[0].ayah, end = rows[rows.length - 1].ayah;
    const queue: AudioStage[] = [{
      passageIndex: 0, start, end, mode: 'arabic', label: 'Review block recitation'
    }];
    this.activeClip.set(null);
    await this.controller.toggleMain(this.selectedId(), this.reciter, queue, [], 0, start);
  }

  private verseGeneration = 0;
  private readonly boundariesBySurah = new Map<number, number[]>();
  readonly loading = signal(false);
  readonly playbackError = signal<string | null>(null);
  readonly translationWarning = signal<string | null>(null);
  readonly activeAyah = signal(1);
  readonly activeClip = signal<string | null>(null);
  @ViewChild('sharedLinkStartButton') sharedLinkStartButton?: ElementRef<HTMLButtonElement>;
  @ViewChild('settingsDialog') settingsDialog!: ElementRef<HTMLDialogElement>;
  @ViewChild('verseList') verseList?: ElementRef<HTMLDivElement>;
  private lastScrolledVerse = '';

  readonly groupingLibraryOpen = signal(false);
  readonly shareLinkVisible = signal(false);
  readonly shareStatus = signal('');
  readonly sharingLink = signal(false);

  sharedUrl(): string {
    return createSharedListeningUrl(window.location.href, this.selectedId(), this.spokenLanguages(), true);
  }

  async copySharedUrl(): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.sharedUrl());
      this.shareStatus.set('Link copied. You can paste it into WhatsApp or a message.');
    } catch {
      this.shareStatus.set('Select and copy the link below to send it.');
    }
  }

  async shareCurrentSurah(): Promise<void> {
    this.shareLinkVisible.set(true);
    if (this.sharingLink()) return;
    this.sharingLink.set(true);
    try {
      const url = this.sharedUrl();
      if (navigator.share) {
        try {
          await navigator.share({
            title: 'Listen to Surah ' + this.selectedSurah().name,
            text: 'Arabic recitation with audio translation',
            url
          });
          this.shareStatus.set('Listening link ready to share.');
          return;
        } catch (error) {
          if (error instanceof DOMException && error.name === 'AbortError') return;
          // Browsers can reject native sharing; fall back to copying.
        }
      }
      await this.copySharedUrl();
    } finally {
      this.sharingLink.set(false);
    }
  }



  openSettings(): void {
    this.groupingLibraryOpen.set(this.groupingsDesignPreview);
    this.settingsDialog.nativeElement.showModal();
  }
  openGroupingLibrary(): void {
    this.groupingLibraryOpen.set(true);
    if (!this.settingsDialog.nativeElement.open) this.settingsDialog.nativeElement.showModal();
  }
  closeSettings(): void { this.settingsDialog.nativeElement.close(); }
  closeOnBackdrop(event: MouseEvent): void { if (event.target === this.settingsDialog.nativeElement) this.closeSettings(); }

  readonly surahs = inject(QURAN_SURAHS);
  readonly audioOptions = inject(AUDIO_OPTIONS);
  readonly selectedId = signal(1);
  readonly groupingSource = signal<GroupSource>('local');
  readonly serverGroupings = signal<GroupingDocument>({schemaVersion:1,revision:0,groupings:[]});
  readonly groupingLoadError = signal('');
  private serverGroupingReady: Promise<void> = Promise.resolve();


  readonly search = signal('');
  readonly reciter = 'Muhammad Siddiq Al-Minshawi (Mujawwad)';
  readonly translationLanguage = signal<TranslationLanguage>('English');
  readonly secondTranslation = signal<TranslationLanguage>('Urdu');
  readonly dualTranslation = signal(true);
  readonly displayChoice = signal<'first' | 'second' | 'both'>('first');
  readonly supportedLanguages: readonly TranslationLanguage[] = this.audioOptions.translationLanguages as TranslationLanguage[];
  readonly sharedListeningLink = parseSharedListeningLink(
    new URLSearchParams(window.location.search),
    this.surahs.map(surah => surah.id),
    this.supportedLanguages
  );
  // Design Canvas retains its fixed blocked-autoplay scenario for review.
  readonly groupingsDesignPreview = this.reviewSource.previewOnly && ['local', 'server', 'publish', 'success']
    .includes(new URLSearchParams(window.location.search).get('groups-demo') ?? '');
  readonly sharedLinkDesignPreview = this.reviewSource.previewOnly
    && new URLSearchParams(window.location.search).get('link-demo') === 'blocked';
  readonly showSharedLinkStart = signal(
    this.sharedLinkDesignPreview || this.sharedListeningLink?.autoplay === true
  );

  async startSharedLinkListening(): Promise<void> {
    // An attempted autoplay may still be waiting for the browser to unlock
    // its AudioContext. Cancel that attempt and retry from this user gesture.
    this.controller.stop();
    await this.playPassage(0);
    // The screen closes only after the player reports actual playback.
  }

  readonly previewVerses = signal<VerseText[]>([]);
  readonly verseLoading = signal(true);
  readonly verseError = signal<string | null>(null);
  readonly textTranslationWarnings = signal<Partial<Record<TranslationLanguage, string>>>({});
  readonly textTranslationCredits = signal<Partial<Record<TranslationLanguage, {source: string; attribution: string}>>>({});
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
  readonly localGroupings = computed<SurahGrouping[]>(() => {
    this.selectedId(); this.breakpoints(); // re-read when a local grouping changes
    return [...this.boundariesBySurah.entries()]
      .sort(([a],[b]) => a-b)
      .map(([surahId, boundaries]) => ({surahId,boundaries:[...boundaries]}));
  });

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

  private readonly controller = new ListeningController(this.translationSource, this.cache, this.continuousRecitation, this.streamingSource, {
    onPlaying: playing => {
      this.isPlaying.set(playing);
      if (playing) this.showSharedLinkStart.set(false);
    },
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
    onError: message => this.playbackError.set(message),
    onTranslationWarning: message => this.translationWarning.set(message)
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
    // The reader is independently scrollable. Scroll only when the active Ayah
    // changes during playback; do not move the whole document or steal focus.
    afterRenderEffect(() => {
      const ayah = this.activeAyah();
      const surah = this.selectedId();
      const passage = this.activeStage()?.passageIndex;
      const playing = this.isPlaying();
      this.activePassageVerses(); // Wait until the new passage is rendered.
      if (!playing) return;
      const container = this.verseList?.nativeElement;
      const key = surah + ':' + passage + ':' + ayah;
      if (!container || this.lastScrolledVerse === key) return;
      const row = container.querySelector<HTMLElement>('[data-ayah="' + ayah + '"]');
      if (!row) return;
      const box = container.getBoundingClientRect();
      const position = row.getBoundingClientRect();
      const target = container.scrollTop + position.top - box.top
        - (container.clientHeight - row.clientHeight) / 2;
      container.scrollTo({ top: Math.max(0, target), behavior: 'smooth' });
      this.lastScrolledVerse = key;
    });
    if (this.sharedLinkDesignPreview) {
      // A fixed Al-Kahf + spoken Urdu scenario for design inspection.
      this.selectedId.set(18);
      this.setBoundaries(suggestedBreakpoints(18, this.selectedSurah().ayahCount));
      this.translationLanguage.set('Urdu');
      this.dualTranslation.set(false);
      this.displayChoice.set('first');
      this.listeningMode.set('both');
    }
    try {
      const stored = this.sharedLinkDesignPreview ? null : localStorage.getItem('islamtrove-audio-design-v2');
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
        const lastUsedServer = values?.groupingSource === 'server';
        const restored = this.boundariesBySurah.get(this.selectedId())
          ?? (!lastUsedServer && Array.isArray(values?.breakpoints)
            ? normalizeBreakpoints(values.breakpoints, count)
            : suggestedBreakpoints(this.selectedId(), count));
        // Saved playback boundaries may describe a server grouping; never
        // import them into local data without an explicit Copy action.
        this.setBoundaries(restored, !lastUsedServer);
        if (values?.listeningMode === 'recitation' || values?.listeningMode === 'both') this.listeningMode.set(values.listeningMode);
        if (this.supportedLanguages.includes(values?.translationLanguage)) this.translationLanguage.set(values.translationLanguage);
        if (this.supportedLanguages.includes(values?.secondTranslation)) this.secondTranslation.set(values.secondTranslation);
        if (typeof values?.dualTranslation === 'boolean') this.dualTranslation.set(values.dualTranslation);
        if (values?.groupingSource === 'local' || values?.groupingSource === 'server') {
          this.groupingSource.set(values.groupingSource);
        }
        if (values?.displayChoice === 'first' || values?.displayChoice === 'second' || values?.displayChoice === 'both') this.displayChoice.set(values.displayChoice);
        if (this.translationLanguage() === this.secondTranslation()) this.secondTranslation.set(this.supportedLanguages.find(x => x !== this.translationLanguage())!);
      }
    } catch { /* Nonpersistent preview if browser storage is unavailable. */ }
    if (!this.sharedListeningLink && !this.sharedLinkDesignPreview &&
        !this.boundariesBySurah.has(this.selectedId())) {
      // A first visit still has a local grouping for the selected Surah.
      this.setBoundaries(this.selectedId() === 1 ? this.breakpoints()
        : suggestedBreakpoints(this.selectedId(), this.selectedSurah().ayahCount));
    }
    if (this.groupingsDesignPreview) {
      const route = new URLSearchParams(window.location.search).get('groups-demo');
      if (route === 'server' || route === 'success') this.groupingSource.set('server');
    }
    if (this.sharedListeningLink) {
      // Deep-link parameters override local preferences for this visit only.
      // They always use the app's built-in grouping, not another visitor's
      // personal breakpoint edits. Published admin groupings can replace this
      // default later without changing the URL contract.
      this.groupingSource.set('server');
      this.selectedId.set(this.sharedListeningLink.surahId);
      this.setBoundaries(suggestedBreakpoints(this.selectedId(), this.selectedSurah().ayahCount), false);
      if (this.sharedListeningLink.languages) {
        const languages = this.sharedListeningLink.languages;
        this.translationLanguage.set(languages[0]);
        this.dualTranslation.set(languages.length === 2);
        if (languages.length === 2) this.secondTranslation.set(languages[1]);
        this.displayChoice.set(languages.length === 2 ? 'both' : 'first');
      }
      this.listeningMode.set('both');
    }
    effect(() => {
      if (this.sharedLinkDesignPreview || this.sharedListeningLink) return;
      // Never persist link overrides to this browser's own preferences.
      const settings = {
        groupingSource: this.groupingSource(),
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
    void this.loadReviewRows();
    this.serverGroupingReady = this.loadServerGroupings();
    // Keyboard users land on the single prominent action when a shared
    // listening link opens. This does not count as a browser user gesture.
    afterNextRender(() => {
      if (this.showSharedLinkStart()) this.sharedLinkStartButton?.nativeElement.focus({preventScroll: true});
    });
    // Request autoplay only after settings are applied and the app rendered.
    // When the browser blocks playback, the focused start button remains.
    afterNextRender(() => {
      if (this.sharedListeningLink?.autoplay) {
        // Wait until published defaults have been loaded before starting audio.
        void this.serverGroupingReady.then(() => this.playPassage(0));
      }
    });
    afterNextRender(() => {
      if (this.groupingsDesignPreview) this.openSettings();
    });
    // Design Canvas-only entry states for inspectable desktop/mobile artboards.
    afterNextRender(() => {
      if (!this.reviewSource.previewOnly) return;
      const mode = new URLSearchParams(window.location.search).get('review-demo');
      if (!['grid', 'access', 'inspect', 'correction', 'saved'].includes(mode ?? '')) return;
      this.selectedId.set(55);
      this.setBoundaries(suggestedBreakpoints(55, 78));
      void this.loadVerseText();
      void this.loadReviewRows().then(async () => {
        this.openSettings();
        if (mode === 'grid') return;
        this.openReview(6);
        if (mode === 'access') return;
        this.reviewCode.set('2468');
        await this.unlockReview();
        if (mode === 'correction') this.startCorrection();
        if (mode === 'saved') await this.saveReview('verify');
      });
    });
  }

  async loadVerseText(): Promise<void> {
    const run = ++this.verseGeneration;
    const surahId = this.selectedId();
    const count = this.selectedSurah().ayahCount;
    this.verseLoading.set(true);
    this.verseError.set(null);
    this.textTranslationWarnings.set({});
    this.textTranslationCredits.set({});
    this.previewVerses.set([]);
    try {
      // Arabic is an independent source. Render it immediately, regardless
      // of QuranEnc availability or which written translations are selected.
      const verses = await this.verseSource.getArabicVerses(surahId);
      if (verses.length !== count) {
        throw new Error(`Arabic source returned ${verses.length} of ${count} Ayahs`);
      }
      if (run !== this.verseGeneration) return;
      this.previewVerses.set(verses);
      this.verseLoading.set(false);

      const languages: TranslationLanguage[] = ['German', 'English', 'Urdu'];
      for (const language of languages) {
        void this.verseSource.getTranslationVerses(surahId, language).then(result => {
          if (run !== this.verseGeneration) return;
          const rows = result.verses;
          if (rows.length !== count || rows.some((row, i) => row.ayah !== i + 1)) {
            throw new Error(`${language} translation is incomplete`);
          }
          this.previewVerses.update(current => current.map((verse, i) => ({
            ...verse, translations: {...verse.translations, [language]: rows[i].text}
          })));
          this.textTranslationCredits.update(old => ({
            ...old, [language]: {source: result.source, attribution: result.attribution}
          }));
          this.textTranslationWarnings.update(old => {
            const next = {...old};
            delete next[language];
            return next;
          });
        }).catch(error => {
          if (run !== this.verseGeneration) return;
          this.textTranslationWarnings.update(old => ({
            ...old,
            [language]: error instanceof Error ? error.message : 'Translation temporarily unavailable'
          }));
        });
      }
    } catch (error) {
      if (run === this.verseGeneration) {
        this.verseError.set(error instanceof Error ? error.message : 'Unable to retrieve Arabic Quran text');
      }
    } finally {
      if (run === this.verseGeneration) this.verseLoading.set(false);
    }
  }

  retryTextTranslation(language: TranslationLanguage): void {
    const run = this.verseGeneration;
    const surahId = this.selectedId();
    const count = this.selectedSurah().ayahCount;
    this.textTranslationWarnings.update(old => {
      const updated = {...old};
      delete updated[language];
      return updated;
    });
    void this.verseSource.getTranslationVerses(surahId, language).then(result => {
      if (run !== this.verseGeneration) return;
      const rows = result.verses;
      if (rows.length !== count || rows.some((item, i) => item.ayah !== i + 1)) {
        throw new Error(`${language} written translation incomplete`);
      }
      this.previewVerses.update(current => current.map((verse, i) => ({
        ...verse, translations: {...verse.translations, [language]: rows[i].text}
      })));
      this.textTranslationCredits.update(old => ({
        ...old, [language]: {source: result.source, attribution: result.attribution}
      }));
    }).catch(error => {
      if (run !== this.verseGeneration) return;
      this.textTranslationWarnings.update(old => ({
        ...old, [language]: error instanceof Error ? error.message : 'Translation unavailable'
      }));
    });
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
  setDisplayChoice(choice: 'first' | 'second' | 'both'): void {
    this.displayChoice.set(choice);
  }
  private setBoundaries(boundaries: number[], storeLocally = true): void {
    const normalized = normalizeBreakpoints(boundaries, this.selectedSurah().ayahCount);
    this.breakpoints.set(normalized);
    if (storeLocally) this.boundariesBySurah.set(this.selectedId(), normalized);
  }
  private applySourceGrouping(): void {
    const id = this.selectedId(), count = this.selectedSurah().ayahCount;
    const serverSource = this.groupingSource() === 'server';
    const grouping = serverSource
      ? this.serverGroupings().groupings.find(item => item.surahId === id)?.boundaries
      : this.boundariesBySurah.get(id);
    // Selecting a new Surah in My local groupings creates its local preset.
    this.setBoundaries(grouping ?? suggestedBreakpoints(id,count),
      !serverSource && !this.boundariesBySurah.has(id));
    this.resetQueue();
  }
  async loadServerGroupings(): Promise<void> {
    try {
      const doc = await this.groupingPort.list();
      this.serverGroupings.set(doc);
      this.groupingLoadError.set('');
    } catch (error) {
      this.groupingLoadError.set(error instanceof Error ? error.message : 'Could not load server groupings');
    }
    if (this.groupingSource() === 'server') this.applySourceGrouping();
  }
  selectGroupingSource(source: GroupSource): void {
    if (this.groupingSource() === source) return;
    this.groupingSource.set(source);
    this.applySourceGrouping();
  }
  receivePublishedGroupings(doc: GroupingDocument): void {
    this.serverGroupings.set(doc);
    this.groupingLoadError.set('');
  }
  copyPublishedGrouping(group: SurahGrouping): void {
    const surah = this.surahs.find(item => item.id === group.surahId);
    if (!surah) return;
    this.groupingSource.set('local');
    this.boundariesBySurah.set(group.surahId, normalizeBreakpoints(group.boundaries,surah.ayahCount));
    this.selectSurah(surah);
  }
  selectSurah(surah: SurahSummary): void {
    this.selectedId.set(surah.id);
    this.applySourceGrouping();
    this.resetQueue();
    this.sidebarOpen.set(false);
    void this.loadVerseText();
    void this.loadReviewRows();
    this.closeReview();
  }
  setSearch(value: string): void { this.search.set(value); }
  setListeningMode(mode: ListeningMode): void {
    this.listeningMode.set(mode);
    this.resetQueue();
  }
  isBoundary(ayah: number): boolean { return this.breakpoints().includes(ayah); }
  toggleBreakpoint(ayah: number): void {
    if (this.groupingSource() !== 'local' || ayah < 1 || ayah >= this.selectedSurah().ayahCount) return;
    const current = this.breakpoints();
    this.setBoundaries(current.includes(ayah) ? current.filter(n => n !== ayah) : [...current, ayah]);
    this.resetQueue();
  }
  setPreset(mode: 'whole' | 'each'): void {
    if (this.groupingSource() !== 'local') return;
    const n = this.selectedSurah().ayahCount;
    this.setBoundaries(mode === 'whole' ? [n] : Array.from({ length: n }, (_, i) => i + 1));
    this.resetQueue();
  }
  applySuggestedBreakpoints(): void {
    if (this.groupingSource() !== 'local') return;
    this.setBoundaries(suggestedBreakpoints(this.selectedId(), this.selectedSurah().ayahCount)); this.resetQueue();
  }
  resetQueue(): void {
    this.controller.stop();
    this.activeClip.set(null);
    this.stageIndex.set(0);
    this.activeAyah.set(1);
    this.playbackError.set(null);
    this.translationWarning.set(null);
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
