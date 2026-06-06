export const BANK_MAGIC = 0x4f4b4950;
export const BANK_VERSION = 1;
export const BANK_HEADER_SIZE = 4096;
export const BANK_SAMPLE_RATE = 24000;
export const BANK_MAX_SAMPLES = 32;
export const BANK_SAMPLE_RECORD_SIZE = 64;
export const BANK_SAMPLE_NAME_BYTES = 48;

export interface BankSample {
  id: string;
  name: string;
  bpm: number;
  beats: number;
  peak: number;
  pcm: Uint8Array;
  cropStart: number;
  cropEnd: number;
}

export interface ParsedBank {
  samples: BankSample[];
  audioBytes: number;
}

export function signedByteToFloat(byte: number): number {
  return byte - 128;
}

export function usedAudioBytes(samples: BankSample[]): number {
  return samples.reduce((sum, sample) => sum + croppedPcm(sample).length, 0);
}

export function croppedPcm(sample: BankSample): Uint8Array {
  const start = Math.max(0, Math.min(sample.pcm.length, sample.cropStart));
  const end = Math.max(start, Math.min(sample.pcm.length, sample.cropEnd));
  return sample.pcm.slice(start, end);
}

function writeName(target: Uint8Array, offset: number, name: string): void {
  const encoded = new TextEncoder().encode(name);
  const len = Math.min(encoded.length, BANK_SAMPLE_NAME_BYTES - 1);
  target.fill(0, offset, offset + BANK_SAMPLE_NAME_BYTES);
  target.set(encoded.slice(0, len), offset);
}

function readName(source: Uint8Array, offset: number): string {
  let end = offset;
  const max = offset + BANK_SAMPLE_NAME_BYTES;
  while (end < max && source[end] !== 0 && source[end] !== 0xff) end++;
  return new TextDecoder().decode(source.slice(offset, end));
}

export function buildBankBlob(samples: BankSample[], capacityBytes: number): Uint8Array {
  if (samples.length > BANK_MAX_SAMPLES) {
    throw new Error(`pikocore supports up to ${BANK_MAX_SAMPLES} samples`);
  }
  const audioBytes = usedAudioBytes(samples);
  if (audioBytes > capacityBytes) {
    throw new Error('Audio bank exceeds device capacity');
  }

  const blob = new Uint8Array(BANK_HEADER_SIZE + audioBytes);
  blob.fill(0xff);
  const view = new DataView(blob.buffer);
  view.setUint32(0, BANK_MAGIC, true);
  view.setUint32(4, BANK_VERSION, true);
  view.setUint32(8, BANK_HEADER_SIZE, true);
  view.setUint32(12, BANK_SAMPLE_RATE, true);
  view.setUint32(16, samples.length, true);
  view.setUint32(20, audioBytes, true);
  view.setUint32(24, capacityBytes, true);
  view.setUint32(28, 0, true);

  let audioOffset = 0;
  samples.forEach((sample, index) => {
    const pcm = croppedPcm(sample);
    const recordOffset = 32 + index * BANK_SAMPLE_RECORD_SIZE;
    view.setUint32(recordOffset, audioOffset, true);
    view.setUint32(recordOffset + 4, pcm.length, true);
    view.setUint16(recordOffset + 8, Math.max(1, Math.min(65535, Math.round(sample.bpm))), true);
    view.setUint16(recordOffset + 10, Math.max(1, Math.min(65535, Math.round(sample.beats))), true);
    view.setUint8(recordOffset + 12, sample.peak);
    view.setUint8(recordOffset + 13, 0);
    writeName(blob, recordOffset + 14, sample.name);
    blob.set(pcm, BANK_HEADER_SIZE + audioOffset);
    audioOffset += pcm.length;
  });

  return blob;
}

export function parseBankBlob(blob: Uint8Array): ParsedBank {
  if (blob.length < BANK_HEADER_SIZE) throw new Error('Bank blob is too small');
  const view = new DataView(blob.buffer, blob.byteOffset, blob.byteLength);
  const magic = view.getUint32(0, true);
  const version = view.getUint32(4, true);
  const headerSize = view.getUint32(8, true);
  const sampleRate = view.getUint32(12, true);
  const sampleCount = view.getUint32(16, true);
  const audioBytes = view.getUint32(20, true);

  if (magic !== BANK_MAGIC || version !== BANK_VERSION || headerSize !== BANK_HEADER_SIZE) {
    throw new Error('Unsupported pikocore bank');
  }
  if (sampleRate !== BANK_SAMPLE_RATE) throw new Error('Unsupported sample rate');
  if (sampleCount > BANK_MAX_SAMPLES) throw new Error('Too many samples in bank');
  if (BANK_HEADER_SIZE + audioBytes > blob.length) throw new Error('Bank audio is truncated');

  const samples: BankSample[] = [];
  for (let index = 0; index < sampleCount; index++) {
    const recordOffset = 32 + index * BANK_SAMPLE_RECORD_SIZE;
    const offset = view.getUint32(recordOffset, true);
    const frameCount = view.getUint32(recordOffset + 4, true);
    const bpm = view.getUint16(recordOffset + 8, true);
    const beats = view.getUint16(recordOffset + 10, true);
    const peak = view.getUint8(recordOffset + 12);
    const name = readName(blob, recordOffset + 14) || `Sample ${index + 1}`;
    if (offset + frameCount > audioBytes) throw new Error('Sample range exceeds bank audio');
    const pcm = blob.slice(BANK_HEADER_SIZE + offset, BANK_HEADER_SIZE + offset + frameCount);
    samples.push({
      id: crypto.randomUUID(),
      name,
      bpm,
      beats,
      peak,
      pcm,
      cropStart: 0,
      cropEnd: pcm.length,
    });
  }

  return { samples, audioBytes };
}
