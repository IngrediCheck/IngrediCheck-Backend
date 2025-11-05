#!/usr/bin/env -S deno run --allow-env --allow-net --allow-read

import { runSuite } from "./run-testcase.ts";

await runSuite("EndToEndTests", Deno.args);

