# Cloud Console (React Native / Expo). Run `npm install` from the repo root first.
BIN := ../../node_modules/.bin

.PHONY: start ios typecheck export doctor test-core

start:
	$(BIN)/expo start

ios:
	$(BIN)/expo run:ios

typecheck:
	$(BIN)/tsc --noEmit

export:
	$(BIN)/expo export --platform ios --output-dir /tmp/cloud-console-mobile-export

doctor:
	npx expo-doctor

test-core:
	cd ../../packages/core && $(BIN)/vitest run
