# ADR 0004: Live Source Validation Stays Conservative

## Status

Accepted

## Decision

Live-source validation is opt-in, temp-workbench-first, and kept out of default PR gating.

## Why

- Networked public sources drift and can make CI noisy or misleading.
- The workbench should be testable through fixtures and local temp paths by default.
- Maintainers still need first-class smoke paths for real operator rehearsal.

## Consequences

- Fixture coverage and targeted temp-workbench smokes are the normal validation surface.
- `dc smoke <profile>` is the preferred first-class operator seam for live-source rehearsal.
