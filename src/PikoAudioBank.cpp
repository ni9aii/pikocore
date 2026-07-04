#include "PikoAudioBank.h"

#include <string.h>

#include "hardware/flash.h"

#ifndef XIP_BASE
#define XIP_BASE 0x10000000u
#endif

namespace {

PikoAudioSample samples[PIKO_BANK_MAX_SAMPLES];
PikoAudioSample empty_sample = {0, 1, 165, 1, 0, 0, "empty"};
uint32_t sample_count = 0;
uint32_t audio_bytes = 0;
uint32_t flash_total_bytes = PIKO_COMPILED_FLASH_TOTAL_BYTES;
uint32_t audio_capacity_bytes = 0;
bool bank_valid = false;
volatile bool bank_mutating = false;

const PikoBankHeader* flash_header() {
  return reinterpret_cast<const PikoBankHeader*>(XIP_BASE + PIKO_AUDIO_FLASH_OFFSET);
}

uint32_t capacity_from_flash_size(uint32_t flash_bytes) {
  if (flash_bytes <= PIKO_AUDIO_FLASH_OFFSET + PIKO_BANK_HEADER_SIZE) {
    return 0u;
  }
  return flash_bytes - PIKO_AUDIO_FLASH_OFFSET - PIKO_BANK_HEADER_SIZE;
}

uint32_t detect_flash_total_bytes() {
  uint8_t txbuf[4] = {0x9fu, 0u, 0u, 0u};
  uint8_t rxbuf[4] = {0u, 0u, 0u, 0u};
  flash_do_cmd(txbuf, rxbuf, sizeof(txbuf));

  const uint8_t capacity_code = rxbuf[3];
  if (rxbuf[1] == 0 || rxbuf[1] == 0xff || capacity_code < 16u ||
      capacity_code > 31u) {
    return PIKO_COMPILED_FLASH_TOTAL_BYTES;
  }
  return 1u << capacity_code;
}

bool record_valid(const PikoBankSampleRecord& record, uint32_t total_audio_bytes) {
  if (record.frame_count == 0 || record.source_bpm == 0 || record.beat_count == 0) {
    return false;
  }
  if (record.offset > total_audio_bytes) {
    return false;
  }
  return record.frame_count <= total_audio_bytes - record.offset;
}

void sanitize_name(char* name, uint32_t len) {
  name[len - 1u] = '\0';
  for (uint32_t j = 0; j < len - 1u; ++j) {
    unsigned char value = static_cast<unsigned char>(name[j]);
    if (value == 0 || value == 0xff) {
      name[j] = '\0';
      break;
    }
    if (value < 0x20 || value > 0x7e) {
      name[j] = '_';
    }
  }
}

uint32_t clamp_sample_index(uint32_t sample_index) {
  if (sample_count == 0) {
    return 0;
  }
  return sample_index % sample_count;
}

}  // namespace

void piko_audio_bank_init() {
  const uint32_t detected_flash_total_bytes = detect_flash_total_bytes();
  flash_total_bytes = detected_flash_total_bytes < PIKO_COMPILED_FLASH_TOTAL_BYTES
                          ? detected_flash_total_bytes
                          : PIKO_COMPILED_FLASH_TOTAL_BYTES;
  audio_capacity_bytes = capacity_from_flash_size(flash_total_bytes);
  piko_audio_bank_rescan();
}

void piko_audio_bank_rescan() {
  const PikoBankHeader* header = flash_header();
  bank_valid = false;
  sample_count = 0;
  audio_bytes = 0;
  memset(samples, 0, sizeof(samples));

  if (header->magic != PIKO_BANK_MAGIC ||
      header->version != PIKO_BANK_VERSION ||
      header->header_size != PIKO_BANK_HEADER_SIZE ||
      header->sample_rate != PIKO_BANK_SAMPLE_RATE ||
      header->sample_count > PIKO_BANK_MAX_SAMPLES ||
      header->audio_bytes > audio_capacity_bytes ||
      header->capacity_bytes > audio_capacity_bytes) {
    return;
  }

  for (uint32_t i = 0; i < header->sample_count; ++i) {
    const PikoBankSampleRecord& record = header->samples[i];
    if (!record_valid(record, header->audio_bytes)) {
      return;
    }

    samples[i].offset = record.offset;
    samples[i].frame_count = record.frame_count;
    samples[i].source_bpm = record.source_bpm;
    samples[i].beat_count = record.beat_count;
    samples[i].peak = record.peak;
    samples[i].flags = record.flags;
    memcpy(samples[i].name, record.name, sizeof(samples[i].name));
    sanitize_name(samples[i].name, sizeof(samples[i].name));
  }

  sample_count = header->sample_count;
  audio_bytes = header->audio_bytes;
  bank_valid = true;
}

bool piko_audio_bank_valid() {
  return bank_valid;
}

bool piko_audio_bank_mutating() {
  return bank_mutating;
}

void piko_audio_bank_set_mutating(bool mutating) {
  bank_mutating = mutating;
  __asm volatile("dmb" ::: "memory");
}

uint32_t piko_audio_sample_count() {
  return bank_valid ? sample_count : 0u;
}

uint32_t piko_audio_audio_bytes() {
  return bank_valid ? audio_bytes : 0u;
}

uint32_t piko_audio_capacity_bytes() {
  return audio_capacity_bytes;
}

uint32_t piko_flash_total_bytes() {
  return flash_total_bytes;
}

uint32_t piko_audio_flash_offset() {
  return PIKO_AUDIO_FLASH_OFFSET;
}

uint32_t piko_settings_flash_offset() {
  return PIKO_SETTINGS_FLASH_OFFSET;
}

const PikoAudioSample& piko_audio_sample(uint32_t index) {
  if (!bank_valid || sample_count == 0 || index >= sample_count) {
    return empty_sample;
  }
  return samples[index];
}

uint8_t piko_audio_read_byte(uint32_t offset) {
  const uint8_t* data =
      reinterpret_cast<const uint8_t*>(XIP_BASE + PIKO_AUDIO_FLASH_OFFSET +
                                       PIKO_BANK_HEADER_SIZE);
  return data[offset];
}

uint8_t piko_raw_val(uint32_t sample_index, uint32_t frame_index) {
  if (!bank_valid || sample_count == 0) {
    return 128u;
  }
  const PikoAudioSample& sample = samples[clamp_sample_index(sample_index)];
  if (sample.frame_count == 0) {
    return 128u;
  }
  return piko_audio_read_byte(sample.offset + (frame_index % sample.frame_count));
}

uint32_t piko_raw_len(uint32_t sample_index) {
  if (!bank_valid || sample_count == 0) {
    return 1u;
  }
  return samples[clamp_sample_index(sample_index)].frame_count;
}

uint32_t piko_raw_beats(uint32_t sample_index) {
  if (!bank_valid || sample_count == 0) {
    return 1u;
  }
  return static_cast<uint32_t>(samples[clamp_sample_index(sample_index)].beat_count) * 2u;
}
