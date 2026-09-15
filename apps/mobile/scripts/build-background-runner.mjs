#!/usr/bin/env node
// CLI entry point -- see backgroundRunnerBuild.mjs for what this actually does.
import { buildBackgroundRunner, OUTPUT_PATH } from './backgroundRunnerBuild.mjs';

buildBackgroundRunner();
console.log(`background-runner: regenerated ${OUTPUT_PATH}`);
