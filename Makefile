# STORE: App Store region baked into Info.plist (us = Canada/US, cn). Default us.
# Device signing: DEVELOPMENT_TEAM in Config/Local.xcconfig; DEVICE_UDID defaults to the first connected iPhone.
STORE   ?= us
SCHEME  := CloudConsole
DERIVED := build/install
APP     := CloudConsole.app
APP_ID  := com.example.cloudconsole
SIM     ?= iPhone 18 Pro
DEVICE_UDID ?= $(shell xcrun devicectl list devices 2>/dev/null | awk '/physical/ && /connected/ {print $$3; exit}')

.PHONY: project device sim

project:
	xcodegen generate

device: project
	@test -n "$(DEVICE_UDID)" || { echo "No iPhone connected; set DEVICE_UDID (xcrun devicectl list devices)"; exit 1; }
	xcodebuild -scheme $(SCHEME) -configuration Release -destination 'generic/platform=iOS' \
		-derivedDataPath $(DERIVED) -allowProvisioningUpdates STORE=$(STORE) build
	xcrun devicectl device install app --device $(DEVICE_UDID) $(DERIVED)/Build/Products/Release-iphoneos/$(APP)
	xcrun devicectl device process launch --device $(DEVICE_UDID) --terminate-existing $(APP_ID)

sim: project
	xcodebuild -scheme $(SCHEME) -configuration Debug -destination 'generic/platform=iOS Simulator' \
		-derivedDataPath $(DERIVED) STORE=$(STORE) build
	xcrun simctl boot "$(SIM)" 2>/dev/null || true
	open -a Simulator
	xcrun simctl install "$(SIM)" $(DERIVED)/Build/Products/Debug-iphonesimulator/$(APP)
	xcrun simctl launch "$(SIM)" $(APP_ID)
