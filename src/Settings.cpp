#include "Settings.h"
#include "hardware/flash.h"
#include "pico/stdlib.h"
#include "PikoAudioBank.h"  // PIKO_SETTINGS_FLASH_OFFSET, XIP_BASE

static constexpr uint32_t S_OFF_VOLUME = 0;
static constexpr uint32_t S_OFF_BPM = 2;
static constexpr uint32_t S_OFF_FILTER = 4;
static constexpr uint32_t S_OFF_SAMPLE = 5;
static constexpr uint32_t S_OFF_GATE = 6;
static constexpr uint32_t S_OFF_PROB_DIRECTION = 8;
static constexpr uint32_t S_OFF_PROB_RETRIG = 9;
static constexpr uint32_t S_OFF_PROB_JUMP = 10;
static constexpr uint32_t S_OFF_PROB_GATE = 11;
static constexpr uint32_t S_OFF_PROB_TUNNEL = 12;
static constexpr uint32_t S_OFF_CLOCK_INPUT_MODE = 13;

static constexpr uint32_t kSettingsPage = PIKO_SETTINGS_FLASH_OFFSET;

void settings_load(PikoSettings& s) {
  const uint8_t* p = reinterpret_cast<const uint8_t*>(XIP_BASE + kSettingsPage);
  if (!(p[FLASH_PAGE_SIZE - 1] == 0x01 && p[FLASH_PAGE_SIZE - 2] == 0x02 &&
        p[FLASH_PAGE_SIZE - 3] == 0x03 && p[FLASH_PAGE_SIZE - 4] == 0x04)) {
    return;
  }
  s.volume = static_cast<uint16_t>((p[S_OFF_VOLUME] << 8) | p[S_OFF_VOLUME + 1]);
  s.bpm = static_cast<uint16_t>((p[S_OFF_BPM] << 8) | p[S_OFF_BPM + 1]);
  s.filter = p[S_OFF_FILTER];
  s.sample = p[S_OFF_SAMPLE];
  s.gate = static_cast<uint16_t>((p[S_OFF_GATE] << 8) | p[S_OFF_GATE + 1]);
  s.prob_direction = p[S_OFF_PROB_DIRECTION];
  s.prob_retrig = p[S_OFF_PROB_RETRIG];
  s.prob_jump = p[S_OFF_PROB_JUMP];
  s.prob_gate = p[S_OFF_PROB_GATE];
  s.prob_tunnel = p[S_OFF_PROB_TUNNEL];
  s.clock_input_mode = p[S_OFF_CLOCK_INPUT_MODE];
}

void settings_save(const PikoSettings& s, uint8_t save_data[FLASH_PAGE_SIZE]) {
  save_data[S_OFF_VOLUME] = static_cast<uint8_t>(s.volume >> 8);
  save_data[S_OFF_VOLUME + 1] = static_cast<uint8_t>(s.volume & 0xff);
  save_data[S_OFF_BPM] = static_cast<uint8_t>(s.bpm >> 8);
  save_data[S_OFF_BPM + 1] = static_cast<uint8_t>(s.bpm & 0xff);
  save_data[S_OFF_FILTER] = s.filter;
  save_data[S_OFF_SAMPLE] = s.sample;
  save_data[S_OFF_GATE] = static_cast<uint8_t>(s.gate >> 8);
  save_data[S_OFF_GATE + 1] = static_cast<uint8_t>(s.gate & 0xff);
  save_data[S_OFF_PROB_DIRECTION] = s.prob_direction;
  save_data[S_OFF_PROB_RETRIG] = s.prob_retrig;
  save_data[S_OFF_PROB_JUMP] = s.prob_jump;
  save_data[S_OFF_PROB_GATE] = s.prob_gate;
  save_data[S_OFF_PROB_TUNNEL] = s.prob_tunnel;
  save_data[S_OFF_CLOCK_INPUT_MODE] = s.clock_input_mode;
}
