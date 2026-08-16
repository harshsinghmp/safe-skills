#!/usr/bin/env node
// Fake installer: records argv to SAFE_INSTALL_LOG, exits with SAFE_INSTALL_EXIT (default 0).
'use strict';
const fs = require('node:fs');
const log = process.env.SAFE_INSTALL_LOG;
if (log) fs.appendFileSync(log, JSON.stringify(process.argv.slice(2)) + '\n');
process.exit(Number(process.env.SAFE_INSTALL_EXIT || 0));
