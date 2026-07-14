cmake_minimum_required(VERSION 3.18)
project(pikocore_host_tests CXX)
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

enable_testing()

# Pure bank logic under test (no Pico SDK needed; PikoAudioBank.h has a
# PICO_FLASH_SIZE_BYTES fallback so it compiles on the host).
add_executable(test_bank
  test_bank.cpp
  ${CMAKE_CURRENT_LIST_DIR}/../src/PikoBankLayout.cpp
  ${CMAKE_CURRENT_LIST_DIR}/../src/PikoAudioBank.h   # header only, no .cpp (avoids HW deps)
)
target_include_directories(test_bank PRIVATE
  ${CMAKE_CURRENT_LIST_DIR}/../src
)

add_test(NAME test_bank COMMAND test_bank)
