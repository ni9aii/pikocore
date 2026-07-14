#include "PikoBankLayout.h"   // brings in piko_bank::* and (via PikoAudioBank.h) the types/consts
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <string>

static int g_failures = 0;

static void check_bool(const char* name, bool got, bool want) {
  if (got != want) {
    printf("FAIL: %s expected %s got %s\n", name, want ? "true" : "false", got ? "true" : "false");
    ++g_failures;
  }
}
static void check_u32(const char* name, uint32_t got, uint32_t want) {
  if (got != want) {
    printf("FAIL: %s expected %u got %u\n", name, want, got);
    ++g_failures;
  }
}

int main() {
  // --- capacity_from_flash_size ---
  // 2 MiB flash
  check_u32("cap_2mib", piko_bank::capacity_from_flash_size(2u * 1024u * 1024u),
            2u * 1024u * 1024u - PIKO_AUDIO_FLASH_OFFSET - PIKO_BANK_HEADER_SIZE);
  // 16 MiB flash
  check_u32("cap_16mib", piko_bank::capacity_from_flash_size(16u * 1024u * 1024u),
            16u * 1024u * 1024u - PIKO_AUDIO_FLASH_OFFSET - PIKO_BANK_HEADER_SIZE);
  // flash smaller than header -> 0
  check_u32("cap_tiny", piko_bank::capacity_from_flash_size(PIKO_AUDIO_FLASH_OFFSET + PIKO_BANK_HEADER_SIZE - 1u), 0u);
  // exactly boundary -> 0
  check_u32("cap_boundary", piko_bank::capacity_from_flash_size(PIKO_AUDIO_FLASH_OFFSET + PIKO_BANK_HEADER_SIZE), 0u);

  // --- record_valid ---
  PikoBankSampleRecord rec{};
  rec.frame_count = 100; rec.source_bpm = 165; rec.beat_count = 4; rec.offset = 0;
  check_bool("rec_valid_ok", piko_bank::record_valid(rec, 1000u), true);
  // offset beyond total
  rec.offset = 1001;
  check_bool("rec_offset_over", piko_bank::record_valid(rec, 1000u), false);
  // frame_count overflow (offset + frame_count > total)
  rec.offset = 900; rec.frame_count = 200;  // 900+200=1100 > 1000
  check_bool("rec_overflow", piko_bank::record_valid(rec, 1000u), false);
  // zero frame_count
  rec.offset = 0; rec.frame_count = 0;
  check_bool("rec_zero_frames", piko_bank::record_valid(rec, 1000u), false);
  // zero bpm
  rec.frame_count = 100; rec.source_bpm = 0;
  check_bool("rec_zero_bpm", piko_bank::record_valid(rec, 1000u), false);

  // --- header_valid ---
  PikoBankHeader h{};
  h.magic = PIKO_BANK_MAGIC;
  h.version = PIKO_BANK_VERSION;
  h.header_size = PIKO_BANK_HEADER_SIZE;
  h.sample_rate = PIKO_BANK_SAMPLE_RATE;
  h.sample_count = 7;
  h.audio_bytes = 1487829u;
  h.capacity_bytes = 16u * 1024u * 1024u - PIKO_AUDIO_FLASH_OFFSET - PIKO_BANK_HEADER_SIZE;
  const uint32_t cap = h.capacity_bytes;
  check_bool("hdr_valid_ok", piko_bank::header_valid(h, cap), true);
  // wrong magic
  h.magic = 0xDEADBEEFu;
  check_bool("hdr_bad_magic", piko_bank::header_valid(h, cap), false);
  h.magic = PIKO_BANK_MAGIC;
  // wrong version
  h.version = 99;
  check_bool("hdr_bad_version", piko_bank::header_valid(h, cap), false);
  h.version = PIKO_BANK_VERSION;
  // sample_count over max
  h.sample_count = PIKO_BANK_MAX_SAMPLES + 1u;
  check_bool("hdr_too_many", piko_bank::header_valid(h, cap), false);
  h.sample_count = 7;
  // audio_bytes over capacity
  h.audio_bytes = cap + 1u;
  check_bool("hdr_audio_over", piko_bank::header_valid(h, cap), false);
  h.audio_bytes = 1487829u;

  // --- sanitize_name ---
  char name[48];
  std::memset(name, 0xff, sizeof(name));
  std::memcpy(name, "Hello", 5);
  piko_bank::sanitize_name(name, sizeof(name));
  check_bool("name_hello", std::string(name) == "Hello", true);
  // non-printable becomes '_'
  char name2[48];
  std::memset(name2, 0xff, sizeof(name2));
  name2[0] = 'A'; name2[1] = 0x01; name2[2] = 'B';  // 0x01 -> '_'
  piko_bank::sanitize_name(name2, sizeof(name2));
  check_bool("name_ctrl", std::string(name2) == "A_B", true);

  // --- clamp_sample_index ---
  check_u32("clamp_zero", piko_bank::clamp_sample_index(5, 0), 0u);
  check_u32("clamp_wrap", piko_bank::clamp_sample_index(7, 3), 1u);  // 7 % 3
  check_u32("clamp_inrange", piko_bank::clamp_sample_index(2, 5), 2u);

  if (g_failures == 0) {
    printf("ALL TESTS PASSED\n");
    return 0;
  }
  printf("%d TEST(S) FAILED\n", g_failures);
  return 1;
}
