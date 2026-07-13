#pragma once
#include <cstdint>
#include "hardware/flash.h"  // FLASH_PAGE_SIZE

// Single source of truth for persisted settings. Offsets are private to
// Settings.cpp; callers never touch raw indices.
struct PikoSettings {
  uint16_t volume = 0;
  uint16_t bpm = 0;
  uint8_t  filter = 0;
  uint8_t  sample = 0;
  uint16_t gate = 0;
  uint8_t  prob_direction = 0;
  uint8_t  prob_retrig = 0;
  uint8_t  prob_jump = 0;
  uint8_t  prob_gate = 0;
  uint8_t  prob_tunnel = 0;
  uint8_t  clock_input_mode = 0;  // 0 = CLOCK, 1 = MIDI
};

// Fill `save_data` (FLASH_PAGE_SIZE bytes) from `s`. Does NOT program flash;
// the caller is responsible for the actual flash write. Offsets are the
// canonical layout shared with the loader tool.
void settings_save(const PikoSettings& s, uint8_t save_data[FLASH_PAGE_SIZE]);

// Read persisted settings from flash into `s`. No-op (s unchanged) if the
// settings page is uninitialized (missing 0x01,0x02,0x03,0x04 trailer).
void settings_load(PikoSettings& s);
