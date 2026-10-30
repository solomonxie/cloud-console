DIST_DIR := dist
ZIP := chrome-cloud-console.zip
BIN := ../../node_modules/.bin

.PHONY: help build watch zip lint typecheck icons assets clean

help:
	@echo "make build     - bundle src/ + copy static/ into $(DIST_DIR)/ (load unpacked from there)"
	@echo "make watch     - rebuild $(DIST_DIR)/ on every change"
	@echo "make zip       - typecheck, build, then zip $(DIST_DIR)/ into $(ZIP)"
	@echo "make lint      - typecheck (tsc --noEmit) + validate manifest.json"
	@echo "make icons     - regenerate static/icons/*.png"
	@echo "make assets    - regenerate docs/store/*.png listing art"
	@echo "make clean     - remove build output"

build:
	node build.mjs

watch:
	node build.mjs --watch

zip: lint build
	@rm -f $(ZIP)
	@cd $(DIST_DIR) && zip -qr ../$(ZIP) . -x '.*' -x '*.map'
	@echo "Built $(ZIP)"
	@echo "Load it via chrome://extensions -> Load unpacked -> $(DIST_DIR)/"
	@echo "or drag the zip onto chrome://extensions with Developer mode on."

typecheck:
	$(BIN)/tsc --noEmit -p .

lint: typecheck
	@python3 -c "import json; json.load(open('static/manifest.json'))"
	@echo "Lint OK"

icons:
	python3 scripts/gen_icons.py

assets: build
	python3 scripts/gen_store_assets.py

clean:
	rm -rf $(DIST_DIR) $(ZIP)
