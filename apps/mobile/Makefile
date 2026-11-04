# Cloud Console (React Native / Expo). Run `npm install` from the repo root first.
BIN := ../../node_modules/.bin
# Signing team from the repo's gitignored Config/Local.xcconfig (shared with apps/ios).
TEAM := $(shell sed -n 's/^DEVELOPMENT_TEAM *= *//p' ../../Config/Local.xcconfig | tr -d ' ')
DERIVED := /tmp/cloudconsole-rn-build
DEVICE_UDID ?= $(shell xcrun devicectl list devices 2>/dev/null | awk '/physical/ && (/connected/ || /available/) {print $$3; exit}')

.PHONY: start ios device typecheck export doctor test-core

start:
	$(BIN)/expo start

ios:
	$(BIN)/expo run:ios

# Release build onto the paired iPhone (prebuilds ios/ if missing).
device:
	@test -n "$(DEVICE_UDID)" || { echo "No iPhone connected; set DEVICE_UDID (xcrun devicectl list devices)"; exit 1; }
	@test -d ios || CI=1 $(BIN)/expo prebuild -p ios
	cd ios && xcodebuild -workspace CloudConsole.xcworkspace -scheme CloudConsole -configuration Release \
		-destination 'generic/platform=iOS' -derivedDataPath $(DERIVED) -allowProvisioningUpdates \
		DEVELOPMENT_TEAM=$(TEAM) CODE_SIGN_STYLE=Automatic build
	xcrun devicectl device install app --device $(DEVICE_UDID) $(DERIVED)/Build/Products/Release-iphoneos/CloudConsole.app
	xcrun devicectl device process launch --device $(DEVICE_UDID) --terminate-existing com.solomonxie.cloudconsole.rn

typecheck:
	$(BIN)/tsc --noEmit

export:
	$(BIN)/expo export --platform ios --output-dir /tmp/cloud-console-mobile-export

doctor:
	npx expo-doctor

test-core:
	cd ../../packages/core && $(BIN)/vitest run
