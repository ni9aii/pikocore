#include "PikoSampleManager.h"

#include <stdio.h>
#include <string.h>

#include "PikoAudioBank.h"
#include "hardware/flash.h"
#include "pico/bootrom.h"
#include "pico/multicore.h"
#include "pico/stdlib.h"
#include "tusb.h"

void do_stop_everything();
void do_start_everything();
bool piko_clock_input_ittybittymidi();
bool piko_set_clock_input_ittybittymidi(bool enabled);

extern "C" void tud_cdc_line_coding_cb(uint8_t itf,
                                       cdc_line_coding_t const* line_coding) {
  if (itf == 0 && line_coding != nullptr && line_coding->bit_rate == 1200) {
    reset_usb_boot(0, 0);
  }
}

#ifndef XIP_BASE
#define XIP_BASE 0x10000000u
#endif

namespace {

static constexpr uint32_t kFlashSectorSize = 4096u;
static constexpr uint32_t kFlashPageSize = 256u;
static constexpr uint32_t kReadChunkSize = 1024u;
static constexpr uint8_t kReadAck = 'A';
static constexpr uint32_t kReadTimeoutMs = 15000u;
static constexpr uint32_t kWriteTimeoutMs = 5000u;
static constexpr uint8_t kCdcInterface = 0;
static constexpr uint32_t kCdcPacketBytes = 64u;
static constexpr uint32_t kCdcSmallWriteThreshold = 512u;

uint8_t header_staging[PIKO_BANK_HEADER_SIZE] __attribute__((aligned(4)));
uint8_t page_buf[kFlashPageSize] __attribute__((aligned(4)));
volatile bool command_interface_ready = false;

struct ScopedPlaybackMute {
  ScopedPlaybackMute() {
    piko_audio_bank_set_mutating(true);
  }

  ~ScopedPlaybackMute() {
    piko_audio_bank_set_mutating(false);
  }
};

// core0 executes from flash continuously (main loop, audio ISR), so it must
// be parked while flash_range_erase/flash_range_program disable XIP — those
// calls issue raw QSPI commands and don't do this locking themselves.
struct ScopedFlashLockout {
  ScopedFlashLockout() {
    multicore_lockout_start_blocking();
  }

  ~ScopedFlashLockout() {
    multicore_lockout_end_blocking();
  }
};

void erase_range_locked(uint32_t offset, uint32_t size) {
  ScopedFlashLockout lockout;
  flash_range_erase(offset, size);
}

void program_range_locked(uint32_t offset, const uint8_t* data, uint32_t size) {
  ScopedFlashLockout lockout;
  flash_range_program(offset, data, size);
}

void service_usb() {
  tud_task();
}

bool serial_connected() {
  return tud_ready() && tud_cdc_n_connected(kCdcInterface);
}

int read_byte_timeout(uint32_t timeout_ms) {
  const absolute_time_t deadline = make_timeout_time_ms(timeout_ms);
  while (!time_reached(deadline)) {
    service_usb();
    if (!serial_connected()) {
      return PICO_ERROR_TIMEOUT;
    }
    if (tud_cdc_n_available(kCdcInterface) > 0) {
      uint8_t value = 0;
      if (tud_cdc_n_read(kCdcInterface, &value, 1) == 1) {
        return value;
      }
    }
    sleep_us(100);
  }
  return PICO_ERROR_TIMEOUT;
}

bool read_exact(uint8_t* dst, uint32_t len, uint32_t timeout_ms) {
  for (uint32_t i = 0; i < len; ++i) {
    const int value = read_byte_timeout(timeout_ms);
    if (value == PICO_ERROR_TIMEOUT) {
      return false;
    }
    dst[i] = static_cast<uint8_t>(value);
  }
  return true;
}

void write_bytes(const void* data, uint32_t len) {
  const uint8_t* bytes = static_cast<const uint8_t*>(data);
  uint32_t sent = 0;
  while (sent < len) {
    service_usb();
    if (!serial_connected()) {
      return;
    }

    const uint32_t available = tud_cdc_n_write_available(kCdcInterface);
    if (available == 0) {
      tud_cdc_n_write_flush(kCdcInterface);
      sleep_us(100);
      continue;
    }

    const uint32_t limit =
        len <= kCdcSmallWriteThreshold && available > kCdcPacketBytes
            ? kCdcPacketBytes
            : available;
    const uint32_t remaining = len - sent;
    const uint32_t chunk = remaining < limit ? remaining : limit;
    const uint32_t written = tud_cdc_n_write(kCdcInterface, bytes + sent, chunk);
    if (written == 0) {
      sleep_us(100);
      continue;
    }
    sent += written;
    tud_cdc_n_write_flush(kCdcInterface);
    service_usb();
    if (len <= kCdcSmallWriteThreshold) {
      sleep_us(100);
    }
  }
}

void write_u32(uint32_t value) {
  write_bytes(&value, sizeof(value));
}

void write_str(const char* text) {
  write_bytes(text, static_cast<uint32_t>(strlen(text)));
}

void flush_serial() {
  tud_cdc_n_write_flush(kCdcInterface);
  for (uint8_t i = 0; i < 4; ++i) {
    service_usb();
    sleep_us(50);
  }
}

void send_sync() {
  write_str("SYNC\n");
  flush_serial();
}

[[noreturn]] void handle_bootloader_reset() {
  do_stop_everything();
  write_str("OK\n");
  flush_serial();
  sleep_ms(100);
  reset_usb_boot(0, 0);
  while (true) {
    tight_loop_contents();
  }
}

bool validate_header(const PikoBankHeader& header, uint32_t total_len) {
  if (total_len < PIKO_BANK_HEADER_SIZE) {
    return false;
  }
  const uint32_t audio_bytes = total_len - PIKO_BANK_HEADER_SIZE;
  if (header.magic != PIKO_BANK_MAGIC ||
      header.version != PIKO_BANK_VERSION ||
      header.header_size != PIKO_BANK_HEADER_SIZE ||
      header.sample_rate != PIKO_BANK_SAMPLE_RATE ||
      header.sample_count > PIKO_BANK_MAX_SAMPLES ||
      header.audio_bytes != audio_bytes ||
      header.audio_bytes > piko_audio_capacity_bytes() ||
      header.capacity_bytes > piko_audio_capacity_bytes()) {
    return false;
  }

  for (uint32_t i = 0; i < header.sample_count; ++i) {
    const PikoBankSampleRecord& record = header.samples[i];
    if (record.frame_count == 0 || record.source_bpm == 0 ||
        record.beat_count == 0 || record.offset > header.audio_bytes ||
        record.frame_count > header.audio_bytes - record.offset) {
      return false;
    }
  }
  return true;
}

void handle_info() {
  char info[256];
  uint32_t used = 0;
  int n = snprintf(info + used, sizeof(info) - used,
                   "PIKO1 FW 2.2 F %lu R %lu S %lu A %lu C %lu U %lu SR %lu N %lu CLOCK_INPUT %s PROTO 1 BANK_VERSION %lu BANK_HEADER_SIZE %lu BANK_MAX_SAMPLES %lu\nEND\n",
                   static_cast<unsigned long>(piko_flash_total_bytes()),
                   static_cast<unsigned long>(PIKO_FIRMWARE_RESERVE),
                   static_cast<unsigned long>(piko_settings_flash_offset()),
                   static_cast<unsigned long>(piko_audio_flash_offset()),
                   static_cast<unsigned long>(piko_audio_capacity_bytes()),
                   static_cast<unsigned long>(piko_audio_audio_bytes()),
                   static_cast<unsigned long>(PIKO_BANK_SAMPLE_RATE),
                   static_cast<unsigned long>(piko_audio_sample_count()),
                   piko_clock_input_ittybittymidi() ? "MIDI" : "CLOCK",
                   static_cast<unsigned long>(PIKO_BANK_VERSION),
                   static_cast<unsigned long>(PIKO_BANK_HEADER_SIZE),
                   static_cast<unsigned long>(PIKO_BANK_MAX_SAMPLES));
  if (n < 0 || static_cast<uint32_t>(n) >= sizeof(info) - used) {
    return;
  }
  used += static_cast<uint32_t>(n);

  write_u32(used);
  write_bytes(info, used);
  flush_serial();
}

void handle_read() {
  if (!piko_audio_bank_valid()) {
    write_u32(0);
    flush_serial();
    return;
  }

  const uint32_t total_len = PIKO_BANK_HEADER_SIZE + piko_audio_audio_bytes();
  ScopedPlaybackMute playback_mute;
  write_u32(total_len);
  flush_serial();
  const uint8_t* src =
      reinterpret_cast<const uint8_t*>(XIP_BASE + PIKO_AUDIO_FLASH_OFFSET);

  uint32_t sent = 0;
  while (sent < total_len) {
    const uint32_t chunk =
        total_len - sent < kReadChunkSize ? total_len - sent : kReadChunkSize;
    write_bytes(src + sent, chunk);
    flush_serial();
    const int ack = read_byte_timeout(kReadTimeoutMs);
    if (ack != kReadAck) {
      send_sync();
      return;
    }
    sent += chunk;
  }
  write_str("DONE\n");
  flush_serial();
}

void erase_bank_header() {
  piko_audio_bank_set_mutating(true);
  erase_range_locked(PIKO_AUDIO_FLASH_OFFSET, PIKO_BANK_HEADER_SIZE);
  piko_audio_bank_rescan();
  piko_audio_bank_set_mutating(false);
}

void drain_rejected_write(uint32_t remaining) {
  while (remaining > 0) {
    uint8_t scratch[32];
    const uint32_t chunk = remaining < sizeof(scratch) ? remaining : sizeof(scratch);
    if (!read_exact(scratch, chunk, kWriteTimeoutMs)) {
      return;
    }
    remaining -= chunk;
  }
}

void handle_write() {
  uint8_t len_buf[4];
  if (!read_exact(len_buf, sizeof(len_buf), kWriteTimeoutMs)) {
    write_str("TIMEOUT\n");
    flush_serial();
    return;
  }
  uint32_t total_len = 0;
  memcpy(&total_len, len_buf, sizeof(total_len));

  if (total_len < PIKO_BANK_HEADER_SIZE ||
      total_len > PIKO_BANK_HEADER_SIZE + piko_audio_capacity_bytes()) {
    write_str("ERR\n");
    flush_serial();
    drain_rejected_write(total_len);
    return;
  }

  write_str("OK\n");
  flush_serial();

  if (!read_exact(header_staging, PIKO_BANK_HEADER_SIZE, kWriteTimeoutMs)) {
    write_str("TIMEOUT\n");
    flush_serial();
    return;
  }

  const PikoBankHeader* header =
      reinterpret_cast<const PikoBankHeader*>(header_staging);
  if (!validate_header(*header, total_len)) {
    write_str("ERR\n");
    flush_serial();
    drain_rejected_write(total_len - PIKO_BANK_HEADER_SIZE);
    return;
  }

  piko_audio_bank_set_mutating(true);

  erase_range_locked(PIKO_AUDIO_FLASH_OFFSET, PIKO_BANK_HEADER_SIZE);

  uint32_t bytes_written = PIKO_BANK_HEADER_SIZE;
  uint32_t audio_flash_off = PIKO_AUDIO_FLASH_OFFSET + PIKO_BANK_HEADER_SIZE;
  uint32_t next_erase = audio_flash_off;

  while (bytes_written < total_len) {
    const uint32_t remaining = total_len - bytes_written;
    const uint32_t page_fill = remaining < kFlashPageSize ? remaining : kFlashPageSize;
    memset(page_buf, 0xff, sizeof(page_buf));
    if (!read_exact(page_buf, page_fill, kWriteTimeoutMs)) {
      piko_audio_bank_rescan();
      piko_audio_bank_set_mutating(false);
      write_str("TIMEOUT\n");
      flush_serial();
      return;
    }

    const uint32_t page_off = audio_flash_off + (bytes_written - PIKO_BANK_HEADER_SIZE);
    if (page_off >= next_erase) {
      erase_range_locked(next_erase, kFlashSectorSize);
      next_erase += kFlashSectorSize;
    }
    program_range_locked(page_off, page_buf, sizeof(page_buf));
    bytes_written += page_fill;
  }

  memset(page_buf, 0xff, sizeof(page_buf));
  for (uint32_t offset = 0; offset < PIKO_BANK_HEADER_SIZE; offset += kFlashPageSize) {
    memcpy(page_buf, header_staging + offset, kFlashPageSize);
    program_range_locked(PIKO_AUDIO_FLASH_OFFSET + offset, page_buf, sizeof(page_buf));
  }

  piko_audio_bank_rescan();
  piko_audio_bank_set_mutating(false);
  write_str("OK\n");
  flush_serial();
}

void handle_clock_input_mode() {
  const int value = read_byte_timeout(kWriteTimeoutMs);
  if (value == PICO_ERROR_TIMEOUT || (value != 0 && value != 1)) {
    write_str("ERR\n");
    flush_serial();
    return;
  }
  if (!piko_set_clock_input_ittybittymidi(value == 1)) {
    write_str("ERR\n");
    flush_serial();
    return;
  }
  write_str("OK\n");
  flush_serial();
}

}  // namespace

void piko_sample_manager_set_ready() {
  __asm volatile("dmb" ::: "memory");
  command_interface_ready = true;
}

void piko_sample_manager_core() {
  // core1 is the victim when core0 calls multicore_lockout_start_blocking()
  // from save_settings() (main.cpp). Without this, core0 hangs forever in
  // that call waiting for a lockout handshake that core1 never answers.
  multicore_lockout_victim_init();

  while (true) {
    service_usb();
    if (!serial_connected()) {
      sleep_ms(1);
      continue;
    }
    if (!command_interface_ready) {
      sleep_ms(1);
      continue;
    }

    const int value = read_byte_timeout(1);
    if (value == PICO_ERROR_TIMEOUT) {
      continue;
    }

    switch (value & 0xff) {
      case 'X':
        send_sync();
        break;
      case 'I':
        handle_info();
        break;
      case 'R':
        handle_read();
        break;
      case 'W':
        handle_write();
        break;
      case 'E':
        erase_bank_header();
        write_str("OK\n");
        flush_serial();
        break;
      case 'S':
        do_stop_everything();
        write_str("OK\n");
        flush_serial();
        break;
      case 'B':
        do_stop_everything();
        handle_info();
        do_start_everything();
        break;
      case 'C':
        handle_clock_input_mode();
        break;
      case 'U':
        handle_bootloader_reset();
        break;
      default:
        break;
    }
  }
}
