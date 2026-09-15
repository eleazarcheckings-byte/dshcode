# Agent Note: Remove packaged smoke profile junctions without traversing targets

Status: implemented

English | [中文](2026-09-15-packaged-smoke-junction-cleanup.zh.md)

## Problem

The packaged desktop can render successfully while the startup smoke fails with Windows `EPERM` during recursive removal of its private profile. That profile contains package junctions pointing outside the smoke directory. Inherited child output also exposes the single-use preview URL token.

## Decision

The [startup helper](../../../../apps/desktop/scripts/smoke-packaged-startup.mjs) validates its temporary root, rejects a link-shaped root, unlinks descendant links without visiting their targets, and then removes the remaining real tree with bounded retries. It captures bounded child output and removes URL credentials, queries, and fragments before printing. Manifest restoration, fixture removal, and scratch cleanup are all attempted; their failures remain visible alongside any launch failure.

## Alternatives considered

**Retry recursive removal unchanged.** The previous retry loop still fails on the actual profile junction tree; waiting does not remove the link-handling defect.

**Ignore cleanup failure after a successful render.** This leaves temporary credentials and browser state behind and misreports the release check.

## Consequences

Cleanup owns an additional link scan but does not traverse package targets or alter an installed application. The [focused tests](../../../../apps/desktop/tests/packaged-startup-smoke.spec.ts) preserve an external junction target, reject an unsafe root, and retain useful diagnostics after token redaction. The previously failed Windows scratch tree is removable with the corrected helper while the packaged manifest remains unchanged.
