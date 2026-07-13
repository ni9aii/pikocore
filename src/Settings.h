#pragma once
#include <cstdint>

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
