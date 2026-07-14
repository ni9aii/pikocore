#pragma once
#include <cstdint>
#include "PikoAudioBank.h"   // for PikoBankHeader, PikoBankSampleRecord, layout constants

namespace piko_bank {

// Audio capacity available for samples given total flash size.
uint32_t capacity_from_flash_size(uint32_t flash_bytes);

// Validate one sample record against the total audio byte count.
bool record_valid(const PikoBankSampleRecord& record, uint32_t total_audio_bytes);

// Sanitize a fixed-length sample name in place (NUL-terminate, replace
// non-printable bytes with '_', stop at first NUL/0xff).
void sanitize_name(char* name, uint32_t len);

// Modular index clamp for sample access (sample_count == 0 -> 0).
uint32_t clamp_sample_index(uint32_t sample_index, uint32_t sample_count);

// Validate a bank header against the audio capacity. Returns true if the
// header is structurally sound and within capacity.
bool header_valid(const PikoBankHeader& header, uint32_t audio_capacity_bytes);

}  // namespace piko_bank
