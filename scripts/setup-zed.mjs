#!/usr/bin/env node
import { setupZed } from '../src/acp/setup-zed.ts'

const isGlobal = process.argv.includes('--global')
setupZed({ global: isGlobal })
