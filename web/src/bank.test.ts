import { describe, expect, it } from 'vitest';
import {
  BANK_HEADER_SIZE,
  BANK_MAGIC,
  BANK_MAX_SAMPLES,
  BANK_SAMPLE_RECORD_SIZE,
  buildBankBlob,
  parseBankBlob,
  type BankSample,
} from './bank';
import { estimateBpmFromFrames, inferBeatsFromName, inferBpmFromName } from './audio';

function sample(index: number, pcm = new Uint8Array([index & 0xff])): BankSample {
  return {
    id: String(index),
    name: `Sample ${index + 1}`,
    bpm: 170,
    beats: 8,
    peak: 64,
    pcm,
    cropStart: 0,
    cropEnd: pcm.length,
  };
}

describe('pikocore bank format', () => {
  it('round-trips sample metadata and raw pcm', () => {
    const pcm = new Uint8Array([0, 1, 255, 128]);
    const blob = buildBankBlob(
      [
        {
          id: 'a',
          name: 'Amen',
          bpm: 170,
          beats: 16,
          peak: 127,
          pcm,
          cropStart: 1,
          cropEnd: 3,
        },
      ],
      1024,
    );

    const parsed = parseBankBlob(blob);
    expect(parsed.samples).toHaveLength(1);
    expect(parsed.samples[0].name).toBe('Amen');
    expect(parsed.samples[0].bpm).toBe(170);
    expect(parsed.samples[0].beats).toBe(16);
    expect(Array.from(parsed.samples[0].pcm)).toEqual([1, 255]);
  });

  it('builds and parses a full 128-sample bank', () => {
    const samples = Array.from({ length: BANK_MAX_SAMPLES }, (_, index) => sample(index));
    const blob = buildBankBlob(samples, samples.length);
    const parsed = parseBankBlob(blob);

    expect(blob).toHaveLength(BANK_HEADER_SIZE + samples.length);
    expect(parsed.samples).toHaveLength(BANK_MAX_SAMPLES);
    expect(parsed.samples[127].name).toBe('Sample 128');
    expect(Array.from(parsed.samples[127].pcm)).toEqual([127]);
  });

  it('rejects more than 128 samples', () => {
    const samples = Array.from({ length: BANK_MAX_SAMPLES + 1 }, (_, index) => sample(index));

    expect(() => buildBankBlob(samples, samples.length)).toThrow('pikocore supports up to 128 samples');
  });

  it('rejects v1 4 KiB banks as unsupported', () => {
    const blob = new Uint8Array(4096);
    const view = new DataView(blob.buffer);
    view.setUint32(0, BANK_MAGIC, true);
    view.setUint32(4, 1, true);
    view.setUint32(8, 4096, true);

    expect(() => parseBankBlob(blob)).toThrow('Unsupported pikocore bank');
  });

  it('rejects banks that exceed audio capacity', () => {
    expect(() => buildBankBlob([sample(0, new Uint8Array([1, 2]))], 1)).toThrow('Audio bank exceeds device capacity');
  });

  it('keeps all sample records inside the v2 header', () => {
    expect(32 + BANK_MAX_SAMPLES * BANK_SAMPLE_RECORD_SIZE).toBeLessThanOrEqual(BANK_HEADER_SIZE);
  });
});

describe('BPM detection', () => {
  it('prefers filename bpm', () => {
    expect(inferBpmFromName('break_bpm170.wav')).toBe(170);
  });

  it('prefers filename beats', () => {
    expect(inferBeatsFromName('amen_beats16_bpm170.wav')).toBe(16);
  });

  it('estimates loop bpm from duration', () => {
    expect(estimateBpmFromFrames(526629)).toBe(175);
  });
});
