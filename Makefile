# STORE: App Store region baked into Info.plist (us = Canada/US, cn). Default us.
# Device signing: DEVELOPMENT_TEAM + APP_BUNDLE_ID in Config/Local.xcconfig (copy the .example); DEVICE_UDID defaults to the first connected iPhone.
STORE   ?= us
SCHEME  := CloudConsole
DERIVED := build/install
APP     := CloudConsole.app
APP_ID  := $(shell sed -n 's/^APP_BUNDLE_ID *= *//p' Config/Local.xcconfig)
SIM     ?= iPhone 18 Pro
DEVICE_UDID ?= $(shell xcrun devicectl list devices 2>/dev/null | awk '/physical/ && /connected/ {print $$3; exit}')

.PHONY: help project device sim check release screenshots icon

help:
	@echo "make device       Release build onto the connected iPhone (STORE=cn for the China App Store; default us)"
	@echo "make check        generate the project and build Release for a generic iPhone"
	@echo "make release      check, then archive + upload to App Store Connect (BUILD=<n> pins the build number)"
	@echo "make screenshots  SHOTS=<dir>  resize to the App Store slots"
	@echo "make icon         regenerate the app icon PNGs (light, dark, tinted)"


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

check: project
	xcodebuild -project CloudConsole.xcodeproj -scheme $(SCHEME) -configuration Release \
		-destination 'generic/platform=iOS' -derivedDataPath build/check STORE=$(STORE) -quiet build
	@echo "Release build OK"

# Archive, sign for the App Store and upload — no Xcode Organizer.
# Needs Config/Local.xcconfig (Team ID) and the app record already created in App Store Connect.
release: check
	@git diff --quiet HEAD -- || echo "warning: uncommitted changes are going into this build"
	STORE=$(STORE) scripts/release-ios.sh $(BUILD)

screenshots:
	scripts/store-screenshots.sh $(SHOTS)

icon:
	swiftc -O scripts/make-icon.swift -o /tmp/make-icon
	for v in light dark tinted; do /tmp/make-icon CloudConsole/Assets.xcassets/AppIcon.appiconset/icon-$$v.png $$v; done
