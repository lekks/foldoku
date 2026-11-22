.PHONY: build test check dev

PORT ?= 8080

build:
	npm run build

test:
	npm test

check:
	npm run check

dev:
	npm run dev -- --serve=$(PORT)
