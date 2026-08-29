#!/usr/bin/env node

import { createRequire } from 'node:module';

const require = createRequire( import.meta.url );
const { version } = require( '../package.json' );

console.log( `
  casomer v${version}

  The JSON-native CMS. Visual editing in, static sites out -
  with view transitions that make static feel alive.

  Casomer is in active development. This package reserves the
  name and the \`caso\` command; the real thing is on its way.

  Follow along: https://casomer.com
` );
