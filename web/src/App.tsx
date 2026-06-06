import {
  ArrowDown,
  ArrowUp,
  Cable,
  Download,
  Eraser,
  FolderOpen,
  Pause,
  Play,
  Plus,
  HelpCircle,
  Terminal,
  Trash2,
  Upload,
} from 'lucide-react';
import { driver, type Driver } from 'driver.js';
import 'driver.js/dist/driver.css';
import { useEffect, useMemo, useRef, useState } from 'react';
import { decodeAndEncodeFile, makePreviewBuffer } from './audio';
import {
  BANK_SAMPLE_RATE,
  BankSample,
  buildBankBlob,
  croppedPcm,
  parseBankBlob,
  usedAudioBytes,
} from './bank';
import { DeviceInfo, PikocoreSerial } from './serial';
import ittybittymidiConnection from './assets/ittybittymidi_connection.jpg';
import pikocoreInstructions from './assets/pikocore_instructions.png';

const serial = new PikocoreSerial();
const firmwareDownloadUrl = `${import.meta.env.BASE_URL}pikocore.uf2`;

type StatusKind = 'idle' | 'good' | 'warn' | 'bad';
type Theme = 'light' | 'dark';

interface Status {
  text: string;
  kind: StatusKind;
}

export function App() {
  const [samples, setSamples] = useState<BankSample[]>([]);
  const [device, setDevice] = useState<DeviceInfo | null>(null);
  const [connected, setConnected] = useState(false);
  const [bankDirty, setBankDirty] = useState(false);
  const [status, setStatus] = useState<Status>({ text: 'Disconnected', kind: 'idle' });
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [playheadFrame, setPlayheadFrame] = useState(0);
  const [debugLog, setDebugLog] = useState<string[]>([]);
  const [debugOpen, setDebugOpen] = useState(false);
  const [ittybittymidiInfoOpen, setIttybittymidiInfoOpen] = useState(false);
  const [theme] = useState<Theme>(() => loadTheme());
  const debugOpenRef = useRef(false);
  const debugEntriesRef = useRef<string[]>([]);
  const debugFlushTimerRef = useRef<number | null>(null);
  const debugInteractionRef = useRef(false);
  const audioRef = useRef<{
    context: AudioContext;
    source: AudioBufferSourceNode;
    startedAt: number;
    frameCount: number;
  } | null>(null);

  useEffect(() => {
    window.localStorage.setItem('pikocore-theme', theme);
  }, [theme]);

  useEffect(() => {
    debugOpenRef.current = debugOpen;
    if (debugOpen) flushDebugLog(true);
  }, [debugOpen]);

  useEffect(() => {
    const closeSerial = () => {
      void serial.disconnect();
    };
    window.addEventListener('pagehide', closeSerial);
    window.addEventListener('beforeunload', closeSerial);
    return () => {
      window.removeEventListener('pagehide', closeSerial);
      window.removeEventListener('beforeunload', closeSerial);
      void serial.disconnect();
    };
  }, []);

  useEffect(() => {
    if (!playingId || !audioRef.current) {
      setPlayheadFrame(0);
      return;
    }

    let raf = 0;
    const tick = () => {
      const active = audioRef.current;
      if (!active) return;
      const elapsed = active.context.currentTime - active.startedAt;
      const frame = Math.floor((elapsed * BANK_SAMPLE_RATE) % Math.max(1, active.frameCount));
      setPlayheadFrame(frame);
      raf = window.requestAnimationFrame(tick);
    };
    raf = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(raf);
  }, [playingId]);

  const capacity = device?.capacityBytes ?? null;
  const used = useMemo(() => usedAudioBytes(samples), [samples]);
  const overCapacity = capacity != null && used > capacity;
  const usageRatio = capacity != null && capacity > 0 ? Math.min(1, used / capacity) : 0;
  const showStatusSpinner = busy && status.kind === 'idle';
  const bankEditingDisabled = !connected || busy;
  const uploadNeedsSync = connected && bankDirty;
  const uploadDisabled = !connected || busy || overCapacity || (!uploadNeedsSync && samples.length === 0);

  async function connect() {
    if (connected) {
      stopPreview();
      await serial.disconnect();
      setConnected(false);
      setDevice(null);
      setBankDirty(false);
      setStatus({ text: 'Disconnected', kind: 'idle' });
      return;
    }

    try {
      setBusy(true);
      clearDebugLog();
      serial.setLogger(appendDebugLog);
      setStatus({ text: 'Connecting', kind: 'idle' });
      await serial.connect();
      const info = await initialiseWithRetry();
      setDevice(info);
      setConnected(true);
      setStatus({ text: 'Downloading', kind: 'idle' });
      const bank = await serial.readBank((ratio) => setProgress(ratio));
      if (bank) {
        const parsed = parseBankBlob(bank);
        setSamples(parsed.samples);
        setBankDirty(false);
        setStatus({ text: `Loaded ${parsed.samples.length} samples from device`, kind: 'good' });
      } else {
        setSamples([]);
        setBankDirty(false);
        setStatus({ text: 'Connected: device bank is empty', kind: 'good' });
      }
      setProgress(0);
    } catch (error) {
      setStatus({ text: errorMessage(error), kind: 'bad' });
      try {
        await serial.disconnect();
      } catch (_) {}
      serial.setLogger(null);
      setConnected(false);
      setBankDirty(false);
    } finally {
      setBusy(false);
    }
  }

  async function initialiseWithRetry(): Promise<DeviceInfo> {
    let lastError: unknown = null;
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        setStatus({ text: attempt === 0 ? 'Connecting' : 'Retrying connection', kind: 'idle' });
        await serial.sync();
        return await serial.stopAndInfo(true);
      } catch (error) {
        lastError = error;
        await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }

  function clearDebugLog() {
    debugEntriesRef.current = [];
    setDebugLog([]);
    if (debugFlushTimerRef.current != null) {
      window.clearTimeout(debugFlushTimerRef.current);
      debugFlushTimerRef.current = null;
    }
  }

  function appendDebugLog(message: string) {
    debugEntriesRef.current.push(`${new Date().toLocaleTimeString()} ${message}`);
    if (debugEntriesRef.current.length > 80) debugEntriesRef.current.splice(0, debugEntriesRef.current.length - 80);
    if (!debugOpenRef.current || debugInteractionRef.current || debugFlushTimerRef.current != null) return;
    debugFlushTimerRef.current = window.setTimeout(() => {
      debugFlushTimerRef.current = null;
      flushDebugLog();
    }, 250);
  }

  function flushDebugLog(force = false) {
    if (debugFlushTimerRef.current != null) {
      window.clearTimeout(debugFlushTimerRef.current);
      debugFlushTimerRef.current = null;
    }
    if (!force && debugInteractionRef.current) return;
    setDebugLog([...debugEntriesRef.current]);
  }

  function toggleDebug() {
    const next = !debugOpenRef.current;
    debugOpenRef.current = next;
    setDebugOpen(next);
    if (next) flushDebugLog(true);
  }

  function pauseDebugLog() {
    debugInteractionRef.current = true;
    if (debugFlushTimerRef.current != null) {
      window.clearTimeout(debugFlushTimerRef.current);
      debugFlushTimerRef.current = null;
    }
  }

  function resumeDebugLog() {
    debugInteractionRef.current = false;
    flushDebugLog(true);
  }

  async function addFiles(fileList: FileList | File[]) {
    if (!connected) {
      setStatus({ text: 'Connect to a pikocore before adding audio', kind: 'warn' });
      return;
    }
    const files = Array.from(fileList).filter((file) => file.type.startsWith('audio/') || /\.(aif|aiff|wav|mp3|flac|ogg)$/i.test(file.name));
    if (files.length === 0) return;
    setBusy(true);
    try {
      const next: BankSample[] = [];
      for (const file of files) {
        setStatus({ text: `Processing ${file.name}`, kind: 'idle' });
        next.push(await decodeAndEncodeFile(file));
      }
      setSamples((current) => [...current, ...next].slice(0, 32));
      setBankDirty(true);
      setStatus({ text: `Added ${next.length} sample${next.length === 1 ? '' : 's'}`, kind: 'good' });
    } catch (error) {
      setStatus({ text: errorMessage(error), kind: 'bad' });
    } finally {
      setBusy(false);
    }
  }

  async function uploadBank() {
    if (!connected) {
      setStatus({ text: 'Connect to a pikocore before uploading', kind: 'warn' });
      return;
    }
    try {
      if (!device) throw new Error('Connect to a pikocore before uploading');
      setBusy(true);
      stopPreview();
      setStatus({ text: 'Uploading', kind: 'idle' });
      const blob = buildBankBlob(samples, device.capacityBytes);
      await serial.writeBank(blob, (ratio) => setProgress(ratio));
      const info = await serial.info();
      setDevice(info);
      setBankDirty(false);
      setProgress(0);
      setStatus({ text: 'Upload complete', kind: 'good' });
    } catch (error) {
      setStatus({ text: errorMessage(error), kind: 'bad' });
    } finally {
      setBusy(false);
    }
  }

  async function readDevice() {
    if (!connected) return;
    try {
      setBusy(true);
      stopPreview();
      setStatus({ text: 'Downloading', kind: 'idle' });
      const bank = await serial.readBank((ratio) => setProgress(ratio));
      const info = await serial.info();
      setDevice(info);
      if (bank) {
        const parsed = parseBankBlob(bank);
        setSamples(parsed.samples);
        setBankDirty(false);
        setStatus({ text: `Read ${parsed.samples.length} samples`, kind: 'good' });
      } else {
        setSamples([]);
        setBankDirty(false);
        setStatus({ text: 'Device bank is empty', kind: 'good' });
      }
      setProgress(0);
    } catch (error) {
      setStatus({ text: errorMessage(error), kind: 'bad' });
    } finally {
      setBusy(false);
    }
  }

  async function eraseDevice() {
    if (!connected) return;
    try {
      setBusy(true);
      stopPreview();
      setStatus({ text: 'Erasing', kind: 'idle' });
      await serial.erase();
      const info = await serial.info();
      setDevice(info);
      setSamples([]);
      setBankDirty(false);
      setStatus({ text: 'Device bank erased', kind: 'good' });
    } catch (error) {
      setStatus({ text: errorMessage(error), kind: 'bad' });
    } finally {
      setBusy(false);
    }
  }

  async function setIttybittymidiMode(enabled: boolean) {
    if (!connected || !device) return;
    try {
      setBusy(true);
      setStatus({ text: 'Saving clock input mode', kind: 'idle' });
      await serial.setClockInputMode(enabled);
      const info = await serial.info();
      setDevice(info);
      setStatus({
        text: enabled ? 'Clock input set to ittybittymidi' : 'Clock input set to pulses',
        kind: 'good',
      });
    } catch (error) {
      setStatus({ text: errorMessage(error), kind: 'bad' });
    } finally {
      setBusy(false);
    }
  }

  function updateSample(id: string, patch: Partial<BankSample>) {
    setSamples((current) => current.map((sample) => (sample.id === id ? { ...sample, ...patch } : sample)));
    if (connected) setBankDirty(true);
  }

  function removeSample(id: string) {
    if (playingId === id) stopPreview();
    setSamples((current) => current.filter((sample) => sample.id !== id));
    if (connected) setBankDirty(true);
  }

  function moveSample(index: number, direction: -1 | 1) {
    const target = index + direction;
    const changed = target >= 0 && target < samples.length;
    setSamples((current) => {
      const next = [...current];
      if (target < 0 || target >= next.length) return current;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
    if (connected && changed) setBankDirty(true);
  }

  function stopPreview() {
    audioRef.current?.source.stop();
    audioRef.current?.context.close();
    audioRef.current = null;
    setPlayingId(null);
  }

  async function togglePreview(sample: BankSample) {
    if (playingId === sample.id) {
      stopPreview();
      return;
    }
    stopPreview();
    const context = new AudioContext();
    const pcm = croppedPcm(sample);
    const source = context.createBufferSource();
    source.buffer = makePreviewBuffer(context, pcm);
    source.loop = true;
    source.connect(context.destination);
    const startedAt = context.currentTime;
    source.start();
    source.onended = () => {
      if (audioRef.current?.source === source) setPlayingId(null);
    };
    audioRef.current = { context, source, startedAt, frameCount: pcm.length };
    setPlayingId(sample.id);
  }

  function startTour() {
    let tour: Driver;
    tour = driver({
      animate: true,
      smoothScroll: true,
      overlayOpacity: 0.62,
      stagePadding: 6,
      stageRadius: 7,
      popoverClass: `pikocore-tour pikocore-tour-${theme}`,
      showProgress: true,
      progressText: '{{current}} / {{total}}',
      nextBtnText: 'Next',
      prevBtnText: 'Back',
      doneBtnText: 'Done',
      showButtons: ['previous', 'next', 'close'],
      overlayClickBehavior: () => undefined,
      steps: [
        {
          popover: {
            title: 'Welcome to pikocore loader',
            description: `<img class="tour-pikocore" src="${pikocoreInstructions}" alt="pikocore front panel" /><p>Use this page to update firmware and manage the samples on your pikocore.</p>`,
            side: 'over',
          },
        },
        {
          element: '[data-tour="uf2"]',
          popover: {
            title: 'Download firmware',
            description: "Download the latest v2 UF2 firmware if you haven't already, then copy it to your pikocore in bootloader mode.",
            side: 'bottom',
            align: 'center',
          },
        },
        {
          element: '[data-tour="connect"]',
          popover: {
            title: 'Connect',
            description: 'Connect your pikocore over USB serial so the loader can read the current sample bank.',
            side: 'bottom',
            align: 'center',
          },
        },
        {
          element: '[data-tour="add"]',
          popover: {
            title: 'Add samples',
            description: 'After connecting, add audio files or drag them into the sample area. The loader converts them for pikocore.',
            side: 'bottom',
            align: 'center',
          },
        },
        {
          element: '[data-tour="upload"]',
          popover: {
            title: 'Upload samples',
            description: 'When your sample list is ready, upload it to write the bank back to your pikocore.',
            side: 'bottom',
            align: 'center',
          },
        },
        {
          element: '[data-tour="read"]',
          popover: {
            title: 'Read from pikocore',
            description: 'Use Read to reload the sample bank from the device if you want to inspect or restore what is currently on your pikocore.',
            side: 'bottom',
            align: 'center',
          },
        },
        {
          element: '[data-tour="erase"]',
          popover: {
            title: 'Erase the bank',
            description: 'Use Erase only when you want to clear the sample bank on the device.',
            side: 'bottom',
            align: 'center',
          },
        },
      ],
      onNextClick: (_, __, { driver: activeTour }) => {
        if (activeTour.isLastStep()) {
          activeTour.destroy();
          return;
        }
        activeTour.moveNext();
      },
      onCloseClick: (_, __, { driver: activeTour }) => {
        activeTour.destroy();
      },
    });
    tour.drive();
  }

  return (
    <main className="app" data-theme={theme}>
      <header className="topbar">
        <div>
          <h1>pikocore loader</h1>
          <div className={`status ${status.kind}`}>
            {showStatusSpinner ? <span className="spinner" aria-hidden="true" /> : null}
            {status.text}
          </div>
        </div>
        <div className="toolbar">
          <button
            className="primary"
            data-tour="connect"
            onClick={connect}
            disabled={busy}
            title={connected ? 'Disconnect from pikocore' : 'Connect to pikocore over USB serial'}
          >
            <Cable size={18} />
            {connected ? 'Disconnect' : 'Connect'}
          </button>
          <label
            className={`button ${bankEditingDisabled ? 'disabled' : ''}`}
            data-tour="add"
            title={connected ? 'Add audio files to the sample list' : 'Connect to a pikocore before adding audio'}
          >
            <Plus size={18} />
            Add
            <input
              type="file"
              multiple
              accept="audio/*,.aif,.aiff"
              disabled={bankEditingDisabled}
              onChange={(event) => {
                if (event.target.files) void addFiles(event.target.files);
                event.currentTarget.value = '';
              }}
            />
          </label>
          <button
            data-tour="upload"
            onClick={uploadBank}
            disabled={uploadDisabled}
            className={uploadNeedsSync ? 'needs-sync' : undefined}
            title={uploadNeedsSync ? 'Upload changes to sync pikocore' : 'Upload the current sample bank to the device'}
          >
            <Upload size={18} />
            Upload
          </button>
          <button data-tour="read" onClick={readDevice} disabled={!connected || busy} title="Read the sample bank from the device">
            <Download size={18} />
            Read
          </button>
          <button data-tour="erase" onClick={eraseDevice} disabled={!connected || busy} title="Erase the sample bank from the device">
            <Eraser size={18} />
            Erase
          </button>
          <a
            className="button"
            data-tour="uf2"
            href={firmwareDownloadUrl}
            download="pikocore.uf2"
            title="Download the latest pikocore UF2 firmware"
            aria-label="Download pikocore UF2 firmware"
          >
            <Download size={18} />
            UF2
          </a>
          <button
            className="icon-button"
            onClick={startTour}
            title="Show pikocore tour"
            aria-label="Show pikocore tour"
          >
            <HelpCircle size={18} />
          </button>
          <button
            className="icon-button debug-toggle"
            onClick={toggleDebug}
            title={debugOpen ? 'Hide serial debug messages' : 'Show serial debug messages'}
            aria-label={debugOpen ? 'Hide serial debug messages' : 'Show serial debug messages'}
            aria-pressed={debugOpen}
          >
            <Terminal size={18} />
          </button>
        </div>
        <div className="toolbar-subrow">
          <div
            className="clock-mode"
          >
            <label
              className={!connected || busy ? 'disabled' : ''}
              title="Use serial MIDI from ittybittymidi on the clock input"
            >
              <input
                type="checkbox"
                checked={device?.ittybittymidiMode ?? false}
                disabled={!connected || busy}
                onChange={(event) => void setIttybittymidiMode(event.currentTarget.checked)}
              />
              Ittybittymidi mode
            </label>
            <button
              type="button"
              className="text-button"
              title="Learn more about ittybittymidi"
              onClick={(event) => {
                event.stopPropagation();
                setIttybittymidiInfoOpen(true);
              }}
            >
              more info
            </button>
          </div>
        </div>
      </header>

      {ittybittymidiInfoOpen ? (
        <div className="modal-backdrop" role="presentation" onClick={() => setIttybittymidiInfoOpen(false)}>
          <div
            className="info-modal"
            role="dialog"
            aria-modal="true"
            aria-label="ittybittymidi clock input"
            onClick={(event) => event.stopPropagation()}
          >
            <img src={ittybittymidiConnection} alt="ittybittymidi connected to a pikocore clock input" />
            <div className="info-modal-copy">
              <h2>ittybittymidi mode</h2>
              <p>
                If you have an ittybittymidi, enable this mode to send TRS MIDI directly into the pikocore clock input.
                Without it, leave this unchecked and use the clock input for pulses; USB MIDI still works either way.
              </p>
              <a href="https://infinitedigits.co/ittybittymidi/" title="Open the ittybittymidi page">
                ittybittymidi details
              </a>
            </div>
            <button
              className="modal-close"
              onClick={() => setIttybittymidiInfoOpen(false)}
              title="Close ittybittymidi info"
              aria-label="Close ittybittymidi info"
            >
              Close
            </button>
          </div>
        </div>
      ) : null}

      <section className="capacity">
        <div className="capacity-line">
          <span>{formatBytes(used)} used</span>
          <span>{capacity == null ? 'Capacity unknown' : `${formatBytes(Math.max(0, capacity - used))} free`}</span>
          <span>
            {samples.length} sample{samples.length === 1 ? '' : 's'}
          </span>
          <span>{device ? `FW ${device.firmware}` : 'No device'}</span>
        </div>
        <div className="meter">
          <div className={overCapacity ? 'over' : ''} style={{ width: `${usageRatio * 100}%` }} />
        </div>
        {busy && progress > 0 ? <div className="transfer" style={{ width: `${progress * 100}%` }} /> : null}
      </section>

      {debugOpen ? (
        <section className="debug-log">
          <div className="debug-title">Serial debug</div>
          {debugLog.length > 0 ? (
            <textarea
              className="debug-output"
              readOnly
              spellCheck={false}
              value={debugLog.join('\n')}
              onFocus={pauseDebugLog}
              onMouseDown={pauseDebugLog}
              onTouchStart={pauseDebugLog}
              onBlur={resumeDebugLog}
              title="Serial debug messages"
              aria-label="Serial debug messages"
            />
          ) : (
            <div className="debug-empty">No serial messages yet</div>
          )}
        </section>
      ) : null}

      <section
        className="sample-list"
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          if (!connected) {
            setStatus({ text: 'Connect to a pikocore before adding audio', kind: 'warn' });
            return;
          }
          void addFiles(event.dataTransfer.files);
        }}
      >
        {samples.length === 0 ? (
          <div className="empty">
            <FolderOpen size={28} />
            <span>No samples loaded</span>
          </div>
        ) : (
          samples.map((sample, index) => (
            <SampleRow
              key={sample.id}
              sample={sample}
              index={index}
              playing={playingId === sample.id}
              playheadFrame={playingId === sample.id ? playheadFrame : null}
              theme={theme}
              onUpdate={(patch) => updateSample(sample.id, patch)}
              onRemove={() => removeSample(sample.id)}
              onMove={(direction) => moveSample(index, direction)}
              onPreview={() => void togglePreview(sample)}
            />
          ))
        )}
      </section>

      <footer className="site-footer">
        made by{' '}
        <a href="https://infinitedigits.co/products/" title="Open Infinite Digits products">
          Infinite Digits
        </a>
        , inspired by{' '}
        <a href="https://github.com/dessertplanet/MLRws-web/" title="Open dessertplanet/MLRws-web on GitHub">
          MLRws-web
        </a>
      </footer>
    </main>
  );
}

function SampleRow({
  sample,
  index,
  playing,
  playheadFrame,
  theme,
  onUpdate,
  onRemove,
  onMove,
  onPreview,
}: {
  sample: BankSample;
  index: number;
  playing: boolean;
  playheadFrame: number | null;
  theme: Theme;
  onUpdate: (patch: Partial<BankSample>) => void;
  onRemove: () => void;
  onMove: (direction: -1 | 1) => void;
  onPreview: () => void;
}) {
  const length = croppedPcm(sample).length;
  return (
    <article className="sample-row">
      <div className="sample-meta">
        <span className="slot">{index + 1}</span>
        <input
          className="name"
          value={sample.name}
          maxLength={47}
          onChange={(event) => onUpdate({ name: event.target.value })}
        />
        <div className="sample-stats">
          <label>
            BPM
            <input
              className="bpm"
              type="number"
              min={1}
              max={65535}
              value={sample.bpm}
              onChange={(event) => onUpdate({ bpm: Number(event.target.value) || 1 })}
            />
          </label>
          <label>
            Beats
            <input
              className="bpm"
              type="number"
              min={1}
              max={65535}
              value={sample.beats}
              onChange={(event) => onUpdate({ beats: Number(event.target.value) || 1 })}
            />
          </label>
          <span>{formatDuration(length)}</span>
          <span>{formatBytes(length)}</span>
        </div>
      </div>
      <Waveform sample={sample} playheadFrame={playheadFrame} theme={theme} />
      <div className="row-actions">
        <button
          onClick={onPreview}
          title={playing ? 'Stop preview playback' : 'Preview this sample'}
          aria-label={playing ? 'Stop preview playback' : 'Preview this sample'}
        >
          {playing ? <Pause size={16} /> : <Play size={16} />}
        </button>
        <button
          onClick={() => onMove(-1)}
          disabled={index === 0}
          title="Move this sample up in the bank"
          aria-label="Move this sample up in the bank"
        >
          <ArrowUp size={16} />
        </button>
        <button onClick={() => onMove(1)} title="Move this sample down in the bank" aria-label="Move this sample down in the bank">
          <ArrowDown size={16} />
        </button>
        <button onClick={onRemove} title="Remove this sample from the bank" aria-label="Remove this sample from the bank">
          <Trash2 size={16} />
        </button>
      </div>
    </article>
  );
}

function Waveform({
  sample,
  playheadFrame,
  theme,
}: {
  sample: BankSample;
  playheadFrame: number | null;
  theme: Theme;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  function draw(canvas: HTMLCanvasElement) {
    const rect = canvas.getBoundingClientRect();
    const scale = window.devicePixelRatio || 1;
    const width = Math.max(1, Math.floor(rect.width * scale));
    const height = Math.max(1, Math.floor(rect.height * scale));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const waveBackground = theme === 'dark' ? '#191918' : '#f7f7f4';
    const waveLine = theme === 'dark' ? '#f1f0ea' : '#202020';
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = waveBackground;
    ctx.fillRect(0, 0, width, height);
    ctx.strokeStyle = waveLine;
    ctx.lineWidth = Math.max(1, scale);
    ctx.beginPath();
    const mid = height / 2;
    for (let x = 0; x < width; x++) {
      const start = Math.floor((x / width) * sample.pcm.length);
      const end = Math.max(start + 1, Math.floor(((x + 1) / width) * sample.pcm.length));
      let min = 0;
      let max = 0;
      for (let i = start; i < end; i++) {
        const value = (sample.pcm[i] - 128) / 128;
        min = Math.min(min, value);
        max = Math.max(max, value);
      }
      ctx.moveTo(x, mid + min * mid * 0.9);
      ctx.lineTo(x, mid + max * mid * 0.9);
    }
    ctx.stroke();

    if (playheadFrame != null) {
      const playhead = ((sample.cropStart + playheadFrame) / sample.pcm.length) * width;
      ctx.fillStyle = theme === 'dark' ? '#ff7667' : '#d23b2a';
      ctx.fillRect(playhead, 0, Math.max(2, 2 * scale), height);
    }
  }

  useEffect(() => {
    if (canvasRef.current) draw(canvasRef.current);
  }, [sample, playheadFrame, theme]);

  return (
    <canvas
      ref={(node) => {
        canvasRef.current = node;
        if (node) draw(node);
      }}
      className="waveform"
    />
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function formatDuration(frames: number): string {
  return `${(frames / BANK_SAMPLE_RATE).toFixed(2)} s`;
}

function loadTheme(): Theme {
  const stored =
    window.localStorage.getItem('pikocore-theme') ?? window.localStorage.getItem('pikocore-theme');
  if (stored === 'light' || stored === 'dark') return stored;
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function colorWithAlpha(color: string, alpha: number): string {
  if (!color.startsWith('#')) return color;
  const hex = color.slice(1);
  const full =
    hex.length === 3
      ? hex
          .split('')
          .map((part) => part + part)
          .join('')
      : hex;
  const value = Number.parseInt(full, 16);
  if (!Number.isFinite(value)) return color;
  const r = (value >> 16) & 0xff;
  const g = (value >> 8) & 0xff;
  const b = value & 0xff;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
