cmake_minimum_required(VERSION 3.18)

# Total flash size in bytes. Override with -DPIKO_FLASH_SIZE_BYTES=16777216 for the 16 MiB board.
set(PIKO_FLASH_SIZE_BYTES 2097152u CACHE STRING "Total flash size in bytes (default 2 MiB for stock Pico; set 16777216 for 16 MiB board)")

if(NOT PICO_SDK_PATH)
	if(DEFINED ENV{PICO_SDK_PATH})
		set(PICO_SDK_PATH "$ENV{PICO_SDK_PATH}")
	elseif(EXISTS "${CMAKE_CURRENT_LIST_DIR}/../pico-sdk/pico_sdk_init.cmake")
		set(PICO_SDK_PATH "${CMAKE_CURRENT_LIST_DIR}/../pico-sdk")
	elseif(EXISTS "${CMAKE_CURRENT_LIST_DIR}/pico-sdk/pico_sdk_init.cmake")
		set(PICO_SDK_PATH "${CMAKE_CURRENT_LIST_DIR}/pico-sdk")
	endif()
endif()

include(pico_sdk_import.cmake)

project(pikocore C CXX ASM)

set(CMAKE_C_STANDARD 11)
set(CMAKE_CXX_STANDARD 17)

pico_sdk_init()

add_executable(${PROJECT_NAME} 
	${CMAKE_CURRENT_LIST_DIR}/src/main.cpp
	${CMAKE_CURRENT_LIST_DIR}/src/Settings.cpp
	${CMAKE_CURRENT_LIST_DIR}/src/PikoAudioBank.cpp
	${CMAKE_CURRENT_LIST_DIR}/src/PikoSampleManager.cpp
	${CMAKE_CURRENT_LIST_DIR}/doth/WS2812.cpp 
	${CMAKE_CURRENT_LIST_DIR}/doth/usb_descriptors.c
)
pico_generate_pio_header(${PROJECT_NAME} ${CMAKE_CURRENT_LIST_DIR}/doth/WS2812.pio)
pico_generate_pio_header(${PROJECT_NAME} ${CMAKE_CURRENT_LIST_DIR}/doth/onewiremidi.pio)

target_link_libraries(${PROJECT_NAME} 
	pico_stdlib
	pico_multicore
	hardware_adc
	hardware_dma
	hardware_pio
	hardware_timer
	hardware_clocks
	hardware_pwm
	hardware_flash
	hardware_sync
    tinyusb_device
    tinyusb_board
)

set_property(TARGET ${PROJECT_NAME} APPEND_STRING PROPERTY LINK_FLAGS "-Wl,--print-memory-usage")

pico_set_binary_type(${PROJECT_NAME} copy_to_ram)
pico_enable_stdio_usb(${PROJECT_NAME} 0)
pico_enable_stdio_uart(${PROJECT_NAME} 0)

target_include_directories(${PROJECT_NAME} PRIVATE
	${CMAKE_CURRENT_LIST_DIR}
	${CMAKE_CURRENT_LIST_DIR}/src
)

include(target_compile_definitions.cmake)

target_compile_definitions(${PROJECT_NAME} PRIVATE
	PIKO_FIRMWARE_RESERVE=524288u
	PICO_FLASH_SIZE_BYTES=${PIKO_FLASH_SIZE_BYTES}
	PICO_STDIO_USB_CONNECTION_WITHOUT_DTR=1
	USBD_MANUFACTURER="infinitedigits"
	USBD_PRODUCT="pikocore"
)

pico_add_extra_outputs(${PROJECT_NAME})

add_custom_command(
	TARGET ${PROJECT_NAME}
	POST_BUILD
	COMMAND ${CMAKE_COMMAND}
		-DBIN_FILE="$<TARGET_FILE_DIR:${PROJECT_NAME}>/${PROJECT_NAME}.bin"
		-DFIRMWARE_RESERVE=524288
		-P "${CMAKE_CURRENT_LIST_DIR}/cmake/check_firmware_reserve.cmake"
)
