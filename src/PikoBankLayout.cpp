#include "PikoBankLayout.h"
#include <cstring>

namespace piko_bank {

uint32_t capacity_from_flash_size(uint32_t flash_bytes) {
  if (flash_bytes <= PIKO_AUDIO_FLASH_OFFSET + PIKO_BANK_HEADER_SIZE) {
    return 0u;
  }
  return flash_bytes - PIKO_AUDIO_FLASH_OFFSET - PIKO_BANK_HEADER_SIZE;
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

uint32_t clamp_sample_index(uint32_t sample_index, uint32_t sample_count) {
  if (sample_count == 0) {
    return 0u;
  }
  return sample_index % sample_count;
}

bool header_valid(const PikoBankHeader& header, uint32_t audio_capacity_bytes) {
  if (header.magic != PIKO_BANK_MAGIC ||
      header.version != PIKO_BANK_VERSION ||
      header.header_size != PIKO_BANK_HEADER_SIZE ||
      header.sample_rate != PIKO_BANK_SAMPLE_RATE ||
      header.sample_count > PIKO_BANK_MAX_SAMPLES ||
      header.audio_bytes > audio_capacity_bytes ||
      header.capacity_bytes > audio_capacity_bytes) {
    return false;
  }
  return true;
}

}  // namespace piko_bank
