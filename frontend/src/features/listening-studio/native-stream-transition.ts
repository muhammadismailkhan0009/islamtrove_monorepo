/** Progressive MP3 playback helpers. No full-file download is performed here. */

async function waitForEvent(audio: HTMLAudioElement, success: 'loadedmetadata' | 'seeked'): Promise<void> {
  if (audio.error) throw new Error('Media source error ' + audio.error.code);
  return new Promise<void>((resolve, reject) => {
    const clean = () => {
      audio.removeEventListener(success, done);
      audio.removeEventListener('error', fail);
    };
    const done = () => { clean(); resolve(); };
    const fail = () => { clean(); reject(new Error('MP3 ' + success + ' failed (' + (audio.error?.code ?? '?') + ')')); };
    audio.addEventListener(success, done, { once: true });
    audio.addEventListener('error', fail, { once: true });
  });
}

/** Start once the browser has buffered enough bytes, without awaiting a Blob. */
export async function startNativeStream(
  audio: HTMLAudioElement, targetSeconds: number,
  isActive: () => boolean
): Promise<void> {
  if (targetSeconds > 0.005) {
    if (audio.readyState < 1) await waitForEvent(audio, 'loadedmetadata');
    if (!isActive()) return;
    if (Number.isFinite(audio.duration) && audio.duration + 0.5 < targetSeconds) {
      throw new Error('The selected Ayah is outside the recording duration');
    }
    audio.currentTime = targetSeconds;
    if (audio.seeking) await waitForEvent(audio, 'seeked');
  }
  if (!isActive()) return;
  await audio.play();
  if (!isActive()) audio.pause();
}

interface PreludeTransition {
  audio: HTMLAudioElement;
  context: AudioContext;
  startAtSeconds: number;
  endOnAudioClock: number;
  introGain: () => GainNode | undefined;
  isActive: () => boolean;
  onPrimed: () => void;
  trackTimer: (timer: ReturnType<typeof setTimeout>) => void;
  untrackTimer: (timer: ReturnType<typeof setTimeout>) => void;
}

/** Crossfade a small decoded Bismillah into a *progressively streaming* MP3.
 * Browser buffering makes this best-effort, rather than sample-perfect. */
export function primeStreamingAfterBismillah(options: PreludeTransition): void {
  const schedule = (callback: () => void, delayMs: number) => {
    const timer = setTimeout(() => { options.untrackTimer(timer); callback(); }, delayMs);
    options.trackTimer(timer);
  };
  const earlyStart = Math.max(0, (options.endOnAudioClock - options.context.currentTime - 0.18) * 1000);
  schedule(() => {
    if (!options.isActive()) return;
    const start = async () => {
      try {
        options.audio.volume = 0;
        await startNativeStream(options.audio, options.startAtSeconds, options.isActive);
        if (!options.isActive()) return;
        options.onPrimed();
        const now = options.context.currentTime;
        const gain = options.introGain()?.gain;
        if (gain && options.endOnAudioClock > now + 0.025) {
          gain.cancelScheduledValues(now);
          gain.setValueAtTime(1, now);
          gain.linearRampToValueAtTime(0, options.endOnAudioClock);
        }
        const fadeUntil = performance.now() + 110;
        const ramp = () => {
          if (!options.isActive()) return;
          const ratio = 1 - Math.max(0, fadeUntil - performance.now()) / 110;
          options.audio.volume = Math.max(0, Math.min(1, ratio));
          if (ratio < 1) schedule(ramp, 16);
        };
        ramp();
      } catch { options.audio.volume = 1; /* Normal ended-event handoff remains possible. */ }
    };
    void start();
  }, earlyStart);
}
