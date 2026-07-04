import { describe, expect, it } from 'vitest';
import { BANK_HEADER_SIZE, BANK_MAX_SAMPLES, BANK_VERSION } from './bank';
import { isCompatibleFirmware, parseInfo } from './serial';

const baseInfo = 'PIKO1 FW 2.2 F 16777216 R 524288 S 520192 A 524288 C 16240640 U 0 SR 24000 N 0 CLOCK_INPUT CLOCK';

describe('serial metadata parsing', () => {
  it('parses firmware compatibility tokens', () => {
    const info = parseInfo(
      `${baseInfo} PROTO 1 BANK_VERSION ${BANK_VERSION} BANK_HEADER_SIZE ${BANK_HEADER_SIZE} BANK_MAX_SAMPLES ${BANK_MAX_SAMPLES}\nEND\n`,
    );

    expect(info.firmware).toBe('2.2');
    expect(info.protocolVersion).toBe(1);
    expect(info.bankVersion).toBe(BANK_VERSION);
    expect(info.bankHeaderSize).toBe(BANK_HEADER_SIZE);
    expect(info.bankMaxSamples).toBe(BANK_MAX_SAMPLES);
  });
});

describe('firmware compatibility', () => {
  it('treats missing metadata as incompatible', () => {
    expect(isCompatibleFirmware(parseInfo(baseInfo))).toBe(false);
  });

  it('treats FW 2.1 without compatibility tokens as incompatible', () => {
    expect(isCompatibleFirmware(parseInfo(baseInfo.replace('FW 2.2', 'FW 2.1')))).toBe(false);
  });

  it('accepts matching v2 bank metadata', () => {
    const info = parseInfo(
      `${baseInfo} PROTO 1 BANK_VERSION ${BANK_VERSION} BANK_HEADER_SIZE ${BANK_HEADER_SIZE} BANK_MAX_SAMPLES ${BANK_MAX_SAMPLES}\nEND\n`,
    );

    expect(isCompatibleFirmware(info)).toBe(true);
  });

  it('rejects wrong bank version', () => {
    const info = parseInfo(`${baseInfo} PROTO 1 BANK_VERSION 1 BANK_HEADER_SIZE ${BANK_HEADER_SIZE} BANK_MAX_SAMPLES ${BANK_MAX_SAMPLES}\nEND\n`);

    expect(isCompatibleFirmware(info)).toBe(false);
  });

  it('rejects wrong header size', () => {
    const info = parseInfo(`${baseInfo} PROTO 1 BANK_VERSION ${BANK_VERSION} BANK_HEADER_SIZE 4096 BANK_MAX_SAMPLES ${BANK_MAX_SAMPLES}\nEND\n`);

    expect(isCompatibleFirmware(info)).toBe(false);
  });

  it('rejects insufficient max sample support', () => {
    const info = parseInfo(`${baseInfo} PROTO 1 BANK_VERSION ${BANK_VERSION} BANK_HEADER_SIZE ${BANK_HEADER_SIZE} BANK_MAX_SAMPLES 32\nEND\n`);

    expect(isCompatibleFirmware(info)).toBe(false);
  });
});
