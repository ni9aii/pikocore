UNAME_S := $(shell uname -s)

PICO_SDK_PATH_ENV := $(PICO_SDK_PATH)
PICO_SDK_CANDIDATES = $(PICO_SDK_PATH_ENV) ../pico-sdk $(CURDIR)/pico-sdk
PICO_SDK_PATH ?= $(firstword $(foreach d,$(PICO_SDK_CANDIDATES),$(if $(wildcard $(d)/pico_sdk_init.cmake),$(d))))
export PICO_SDK_PATH

JOBS ?= $(shell getconf _NPROCESSORS_ONLN 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo 4)
PIKO_FLASH_SIZE_BYTES ?= 2097152
WEB_PUBLIC_DIR := web/public
WEB_UF2 := $(WEB_PUBLIC_DIR)/pikocore.uf2

.PHONY: build buildit justbuild quick publish-web-uf2 webapp-build test clean prereqs easing.h filter.h

buildit: quick

build: justbuild publish-web-uf2

publish-web-uf2:
	mkdir -p $(WEB_PUBLIC_DIR)
	cp build/pikocore.uf2 $(WEB_UF2)
	du -sh $(WEB_UF2)

target_compile_definitions.cmake:
	cp target_compile_definitions.cmake.default target_compile_definitions.cmake

justbuild: quick
	du -sh build/pikocore.uf2

doth/easing.h: doth/generate_easing.py doth/easings/*.txt
	cd doth && python3 generate_easing.py > easing.h
	clang-format -i --style=google doth/easing.h

easing.h: doth/easing.h

doth/filter.h: doth/biquad.py
	cd doth && python3 biquad.py > filter.h
	clang-format -i --style=google doth/filter.h

filter.h: doth/filter.h

quick: target_compile_definitions.cmake doth/easing.h doth/filter.h
	@test -n "$(PICO_SDK_PATH)" || (echo "PICO_SDK_PATH not found. Set PICO_SDK_PATH or run 'make pico-sdk'."; exit 1)
	mkdir -p build
	cd build && cmake -DPICO_SDK_PATH="$(PICO_SDK_PATH)" -DPIKO_FLASH_SIZE_BYTES=$(PIKO_FLASH_SIZE_BYTES) ..
	cd build && make -j$(JOBS)
	echo "BUILD SUCCESS"

webapp-build: publish-web-uf2
	cd web && npm install
	cd web && npm run build

test:
	cd web && npm test

clean:
	rm -rf build web/dist

prereqs:
ifeq ($(UNAME_S),Darwin)
	brew install cmake armmbed/formulae/arm-none-eabi-gcc minicom sox python3 pv go
else
	sudo apt install -y clang-format cmake gcc-arm-none-eabi gcc g++ minicom sox python3 python3-pip pv
	sudo -H python3 -m pip install --break-system-packages matplotlib numpy
endif

pico-sdk:
	git clone https://github.com/raspberrypi/pico-sdk
	cd pico-sdk && git checkout 2.1.1
	cd pico-sdk && git submodule update --init
