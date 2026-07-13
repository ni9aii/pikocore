#pragma once

#include <stdbool.h>
#include <stdint.h>

// PICO_FLASH_SIZE_BYTES is provided by the board header (e.g. boards/pico.h),
// which is pulled in transitively via pico/stdlib.h before this header is
// compiled. The #ifndef below is only a fallback for boards that don't
// define it (defaults to 16 MiB). On a stock Pico this resolves to 2 MiB.

static constexpr uint32_t PIKO_BANK_MAGIC = 0x4f4b4950u;  // "PIKO"
static constexpr uint32_t PIKO_BANK_VERSION = 2u;
static constexpr uint32_t PIKO_BANK_HEADER_SIZE = 12288u;
static constexpr uint32_t PIKO_BANK_SAMPLE_RATE = 24000u;
static constexpr uint32_t PIKO_BANK_MAX_SAMPLES = 128u;
static constexpr uint32_t PIKO_FLASH_SECTOR_SIZE = 4096u;

#ifndef PICO_FLASH_SIZE_BYTES
#define PICO_FLASH_SIZE_BYTES (16u * 1024u * 1024u)
#endif

#ifndef PIKO_FIRMWARE_RESERVE
#define PIKO_FIRMWARE_RESERVE (512u * 1024u)
#endif

static constexpr uint32_t PIKO_COMPILED_FLASH_TOTAL_BYTES =
    static_cast<uint32_t>(PICO_FLASH_SIZE_BYTES);
static constexpr uint32_t PIKO_SETTINGS_FLASH_OFFSET =
    PIKO_FIRMWARE_RESERVE - PIKO_FLASH_SECTOR_SIZE;
static constexpr uint32_t PIKO_AUDIO_FLASH_OFFSET = PIKO_FIRMWARE_RESERVE;

struct PikoAudioSample {
  uint32_t offset;
  uint32_t frame_count;
  uint16_t source_bpm;
  uint16_t beat_count;
  uint8_t peak;
  uint8_t flags;
  char name[48];
};

struct PikoBankSampleRecord {
  uint32_t offset;
  uint32_t frame_count;
  uint16_t source_bpm;
  uint16_t beat_count;
  uint8_t peak;
  uint8_t flags;
  char name[48];
};

struct PikoBankHeader {
  uint32_t magic;
  uint32_t version;
  uint32_t header_size;
  uint32_t sample_rate;
  uint32_t sample_count;
  uint32_t audio_bytes;
  uint32_t capacity_bytes;
  uint32_t reserved0;
  PikoBankSampleRecord samples[PIKO_BANK_MAX_SAMPLES];
};

static_assert(sizeof(PikoBankSampleRecord) == 64u,
              "Pikocore bank sample records must stay 64 bytes");
static_assert(sizeof(PikoBankHeader) <= PIKO_BANK_HEADER_SIZE,
              "Pikocore bank header must fit in the reserved header space");
static_assert(PIKO_BANK_HEADER_SIZE % PIKO_FLASH_SECTOR_SIZE == 0u,
              "Pikocore bank header must stay flash-sector aligned");
static_assert(PIKO_FIRMWARE_RESERVE >= 2u * PIKO_FLASH_SECTOR_SIZE,
              "Firmware reserve must leave room for settings and audio header");

void piko_audio_bank_init();
void piko_audio_bank_rescan();
bool piko_audio_bank_valid();
bool piko_audio_bank_mutating();
void piko_audio_bank_set_mutating(bool mutating);
uint32_t piko_audio_sample_count();
uint32_t piko_audio_audio_bytes();
uint32_t piko_audio_capacity_bytes();
uint32_t piko_flash_total_bytes();
uint32_t piko_audio_flash_offset();
uint32_t piko_settings_flash_offset();
const PikoAudioSample& piko_audio_sample(uint32_t index);
uint8_t piko_audio_read_byte(uint32_t offset);

uint8_t piko_raw_val(uint32_t sample_index, uint32_t frame_index);
uint32_t piko_raw_len(uint32_t sample_index);
uint32_t piko_raw_beats(uint32_t sample_index);
